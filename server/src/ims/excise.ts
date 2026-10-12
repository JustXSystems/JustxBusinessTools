import type { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, can, isoDate, optText, parse, parsePatch, qstr, recordEvent, requireAnyPerm, type ImsDeps } from "./context.js";
import { exec, isoOf, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { ImsError, notFound, type ImsActor } from "./host.js";
import { EXCISE_STATUSES, exciseBottles, exciseBulkLitres, exciseClosing, fiscalYearStart, isFutureDate, monthStartISO, periodRange, round2, round3, todayISO } from "./logic.js";
import { getSettings } from "./settings.js";
import { postMovement } from "./stock.js";

const qtyField = z.coerce.number().min(0).max(1e9);

const ExciseInput = z.object({
  date: isoDate,
  itemId: z.string().trim().max(36).nullable().optional(),
  itemName: z.string().trim().max(200).optional(),
  brand: optText(80),
  volumeMl: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  exciseCategory: optText(40),
  batchNo: optText(64),
  permitNo: z.string().trim().min(1, "Permit / TP number is required").max(64),
  transportPermitNo: optText(64),
  permitDate: isoDate.nullable().optional(),
  vendorId: z.string().trim().max(36).nullable().optional(),
  vendorName: optText(200),
  cases: qtyField.default(0),
  bottlesPerCase: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  receivedQty: qtyField.default(0),
  issuedQty: qtyField.default(0),
  /** Omit to carry forward the item's last closing balance. */
  openingQty: qtyField.nullable().optional(),
  dutyRate: z.coerce.number().min(0).max(1e9).default(0),
  /** Omit to compute duty rate × bottles received. */
  dutyAmount: z.coerce.number().min(0).max(1e12).nullable().optional(),
  status: z.enum(EXCISE_STATUSES).default("received"),
  notes: optText(500),
  postStock: z.boolean().optional(),
});
type ExciseInputT = z.infer<typeof ExciseInput>;

type ExciseRow = {
  id: string;
  record_date: string;
  item_id: string | null;
  item_name: string;
  brand: string | null;
  volume_ml: number | null;
  excise_category: string | null;
  opening_qty: string;
  received_qty: string;
  issued_qty: string;
  closing_qty: string;
  duty_rate: string;
  duty_amount: string;
  permit_no: string | null;
  transport_permit_no: string | null;
  permit_date: string | null;
  batch_no: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  cases: string;
  bottles_per_case: number | null;
  status: string;
  movement_id: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const mapRecord = (r: ExciseRow) => ({
  id: r.id,
  date: isoOf(r.record_date),
  itemId: r.item_id,
  itemName: r.item_name,
  brand: r.brand,
  volumeMl: r.volume_ml === null ? null : Number(r.volume_ml),
  exciseCategory: r.excise_category,
  batchNo: r.batch_no,
  permitNo: r.permit_no,
  transportPermitNo: r.transport_permit_no,
  permitDate: r.permit_date ? isoOf(r.permit_date) : null,
  vendorId: r.vendor_id,
  vendorName: r.vendor_name,
  cases: round3(money(r.cases)),
  bottlesPerCase: r.bottles_per_case === null ? null : Number(r.bottles_per_case),
  openingQty: round3(money(r.opening_qty)),
  receivedQty: round3(money(r.received_qty)),
  issuedQty: round3(money(r.issued_qty)),
  closingQty: round3(money(r.closing_qty)),
  bulkLitres: exciseBulkLitres(money(r.received_qty), r.volume_ml),
  dutyRate: round2(money(r.duty_rate)),
  dutyAmount: round2(money(r.duty_amount)),
  status: r.status,
  stockPosted: Boolean(r.movement_id),
  notes: r.notes,
  createdByName: r.created_by_name,
  createdAt: tsOf(r.created_at),
  updatedAt: tsOf(r.updated_at),
});

async function requireExcise(deps: ImsDeps, tenantId: number) {
  const settings = await getSettings(deps, tenantId);
  if (!settings.exciseActive) throw new ImsError(400, "The excise register is turned off. Turn on excise in Settings → Business profile, or set a liquor / bar business type.");
  return settings;
}

function requireExciseWrite(res: Response) {
  requireAnyPerm(res, ["stockIn", "items"], "Your IMS role can view the excise register but not change it (needs Stock in or Items).");
}

/** The item's (or unlinked product's) last closing balance before this record. */
async function lastClosing(db: Queryable, tenantId: number, key: { itemId: string | null; itemName: string }, date: string, excludeId?: string): Promise<number> {
  const row = await one<{ closing_qty: string }>(
    db,
    `SELECT closing_qty FROM ims_excise_records
     WHERE tenant_id = :tenantId AND ${key.itemId ? "item_id = :itemId" : "item_id IS NULL AND item_name = :itemName"} AND record_date <= :date ${excludeId ? "AND id <> :excludeId" : ""}
     ORDER BY record_date DESC, created_at DESC LIMIT 1`,
    { tenantId, itemId: key.itemId, itemName: key.itemName, date, excludeId: excludeId ?? null },
  );
  return round3(money(row?.closing_qty));
}

type ItemLite = { id: string; name: string; brand: string | null; volume_ml: number | null; excise_category: string | null; unit: string };

async function itemLite(db: Queryable, tenantId: number, id: string | null | undefined): Promise<ItemLite | null> {
  if (!id) return null;
  const item = await one<ItemLite>(db, `SELECT id, name, brand, volume_ml, excise_category, unit FROM ims_items WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  if (!item) throw notFound("Item");
  return item;
}

/** Fills derived values: bottles from cases, the carried-forward opening, closing and duty. */
async function resolveValues(db: Queryable, actor: ImsActor, input: ExciseInputT, excludeId?: string) {
  const item = await itemLite(db, actor.tenantId, input.itemId);
  const itemName = (input.itemName?.trim() || item?.name || "").slice(0, 200);
  if (!itemName) throw new ImsError(400, "Pick an item or enter the product / brand name");
  const received = input.receivedQty > 0 ? round3(input.receivedQty) : input.cases > 0 && input.bottlesPerCase ? exciseBottles(input.cases, input.bottlesPerCase, 0) : 0;
  const opening = input.openingQty ?? (await lastClosing(db, actor.tenantId, { itemId: item?.id ?? null, itemName }, input.date, excludeId));
  const issued = round3(input.issuedQty);
  return {
    item,
    values: {
      recordDate: input.date,
      itemId: item?.id ?? null,
      itemName,
      brand: input.brand ?? item?.brand ?? null,
      volumeMl: input.volumeMl ?? item?.volume_ml ?? null,
      exciseCategory: input.exciseCategory ?? item?.excise_category ?? null,
      openingQty: round3(opening),
      receivedQty: received,
      issuedQty: issued,
      closingQty: exciseClosing(opening, received, issued),
      dutyRate: round2(input.dutyRate),
      dutyAmount: round2(input.dutyAmount ?? input.dutyRate * received),
      permitNo: input.permitNo,
      transportPermitNo: input.transportPermitNo ?? null,
      permitDate: input.permitDate ?? null,
      batchNo: input.batchNo ?? null,
      vendorId: input.vendorId || null,
      vendorName: input.vendorName ?? null,
      cases: round3(input.cases),
      bottlesPerCase: input.bottlesPerCase ?? null,
      status: input.status,
      notes: input.notes ?? null,
    },
  };
}

export function registerExcise(router: Router, deps: ImsDeps): void {
  router.get("/excise", async (req, res) => {
    const actor = actorOf(res);
    const settings = await requireExcise(deps, actor.tenantId);
    const today = todayISO();
    const range = periodRange(qstr(req.query.period) || "mtd", today, settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) });
    const where = ["tenant_id = :tenantId", "record_date BETWEEN :from AND :to"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, ...range };
    const q = qstr(req.query.q);
    if (q) {
      where.push("(item_name LIKE :q OR brand LIKE :q OR permit_no LIKE :q OR transport_permit_no LIKE :q OR batch_no LIKE :q OR vendor_name LIKE :q)");
      params.q = likeOf(q);
    }
    const itemId = qstr(req.query.itemId, 36);
    if (itemId) {
      where.push("item_id = :itemId");
      params.itemId = itemId;
    }
    const status = qstr(req.query.status, 12);
    if (status && (EXCISE_STATUSES as readonly string[]).includes(status)) {
      where.push("status = :status");
      params.status = status;
    }
    const list = await rows<ExciseRow>(deps.db, `SELECT * FROM ims_excise_records WHERE ${where.join(" AND ")} ORDER BY record_date DESC, created_at DESC LIMIT 2000`, params);
    const records = list.map(mapRecord);
    const totals = await one<{ duty_mtd: string; duty_fy: string }>(
      deps.db,
      `SELECT COALESCE(SUM(CASE WHEN record_date >= :mtd THEN duty_amount END), 0) AS duty_mtd, COALESCE(SUM(duty_amount), 0) AS duty_fy
       FROM ims_excise_records WHERE tenant_id = :tenantId AND record_date BETWEEN :fy AND :today`,
      { tenantId: actor.tenantId, mtd: monthStartISO(today), fy: fiscalYearStart(today, settings.fiscalYearStart), today },
    );
    type Roll = { key: string; itemId: string | null; itemName: string; brand: string | null; volumeMl: number | null; opening: number; received: number; issued: number; closing: number; duty: number; first: string; last: string };
    const roll = new Map<string, Roll>();
    for (const r of [...records].reverse()) {
      const key = r.itemId ?? `name:${r.itemName.toLowerCase()}`;
      const cur = roll.get(key);
      if (!cur) {
        roll.set(key, { key, itemId: r.itemId, itemName: r.itemName, brand: r.brand, volumeMl: r.volumeMl, opening: r.openingQty, received: r.receivedQty, issued: r.issuedQty, closing: r.closingQty, duty: r.dutyAmount, first: r.date, last: r.date });
      } else {
        cur.received = round3(cur.received + r.receivedQty);
        cur.issued = round3(cur.issued + r.issuedQty);
        cur.closing = r.closingQty;
        cur.duty = round2(cur.duty + r.dutyAmount);
        cur.last = r.date;
      }
    }
    const items = await rows<{ id: string; name: string; brand: string | null; volume_ml: number | null; excise_category: string | null; unit: string; current_stock: string }>(
      deps.db,
      `SELECT id, name, brand, volume_ml, excise_category, unit, current_stock FROM ims_items
       WHERE tenant_id = :tenantId AND active = 1 AND (volume_ml IS NOT NULL OR excise_category IS NOT NULL) ORDER BY name LIMIT 3000`,
      { tenantId: actor.tenantId },
    );
    res.json({
      range,
      records,
      totals: {
        records: records.length,
        dutyPeriod: round2(records.reduce((s, r) => s + r.dutyAmount, 0)),
        dutyMtd: round2(money(totals?.duty_mtd)),
        dutyFy: round2(money(totals?.duty_fy)),
        bottlesIn: round3(records.reduce((s, r) => s + r.receivedQty, 0)),
        bottlesOut: round3(records.reduce((s, r) => s + r.issuedQty, 0)),
        casesIn: round3(records.reduce((s, r) => s + r.cases, 0)),
        bulkLitresIn: round3(records.reduce((s, r) => s + r.bulkLitres, 0)),
        permits: new Set(records.map((r) => r.permitNo).filter(Boolean)).size,
        inTransit: records.filter((r) => r.status === "in_transit").length,
      },
      register: [...roll.values()].sort((a, b) => a.itemName.localeCompare(b.itemName)),
      items: items.map((i) => ({ id: i.id, name: i.name, brand: i.brand, volumeMl: i.volume_ml === null ? null : Number(i.volume_ml), exciseCategory: i.excise_category, unit: i.unit, currentStock: round3(money(i.current_stock)) })),
      canEdit: can(res, "stockIn") || can(res, "items"),
    });
  });

  router.post("/excise", async (req, res) => {
    const actor = actorOf(res);
    const settings = await requireExcise(deps, actor.tenantId);
    requireExciseWrite(res);
    const input = parse(ExciseInput, req.body);
    if (isFutureDate(input.date, todayISO())) throw new ImsError(400, "The record date can't be in the future");
    const id = randomUUID();
    const result = await tx(deps.db, async (conn) => {
      const { item, values } = await resolveValues(conn, actor, input);
      let movementId: string | null = null;
      if (input.postStock && item && values.receivedQty > 0 && values.status !== "in_transit") {
        const mv = await postMovement(
          conn,
          actor,
          {
            itemId: item.id,
            type: "IN",
            qty: values.receivedQty,
            exciseDuty: values.dutyAmount || null,
            refType: "manual",
            refNo: values.permitNo,
            partyId: values.vendorId,
            partyName: values.vendorName,
            reason: "Excise permit receipt",
            notes: [values.batchNo ? `Batch ${values.batchNo}` : null, values.transportPermitNo ? `TP ${values.transportPermitNo}` : null].filter(Boolean).join(" · ") || null,
            date: values.recordDate,
          },
          { allowNegative: settings.allowNegativeStock },
        );
        movementId = mv.id;
      }
      await exec(
        conn,
        `INSERT INTO ims_excise_records
           (id, tenant_id, record_date, item_id, item_name, brand, volume_ml, excise_category, opening_qty, received_qty, issued_qty, closing_qty,
            duty_rate, duty_amount, permit_no, transport_permit_no, permit_date, batch_no, vendor_id, vendor_name, cases, bottles_per_case, status,
            movement_id, notes, created_by, created_by_name)
         VALUES
           (:id, :tenantId, :recordDate, :itemId, :itemName, :brand, :volumeMl, :exciseCategory, :openingQty, :receivedQty, :issuedQty, :closingQty,
            :dutyRate, :dutyAmount, :permitNo, :transportPermitNo, :permitDate, :batchNo, :vendorId, :vendorName, :cases, :bottlesPerCase, :status,
            :movementId, :notes, :userId, :userName)`,
        { ...values, id, tenantId: actor.tenantId, movementId, userId: actor.userId, userName: actorName(actor) },
      );
      return { values, movementId };
    });
    await recordEvent(deps, actor, {
      type: "excise.created",
      entityType: "excise",
      entityId: id,
      summary: `Excise ${result.values.permitNo}: ${result.values.itemName} +${result.values.receivedQty}${result.values.issuedQty ? ` / −${result.values.issuedQty}` : ""} bottles, duty ₹${result.values.dutyAmount.toLocaleString("en-IN")}${result.movementId ? " · stock received" : ""}`,
      ip: req.ip,
    });
    const row = await one<ExciseRow>(deps.db, `SELECT * FROM ims_excise_records WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    res.status(201).json({ record: row ? mapRecord(row) : null });
  });

  router.patch("/excise/:id", async (req, res) => {
    const actor = actorOf(res);
    await requireExcise(deps, actor.tenantId);
    requireExciseWrite(res);
    const existing = await one<ExciseRow>(deps.db, `SELECT * FROM ims_excise_records WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!existing) throw notFound("Excise record");
    const patch = parsePatch(ExciseInput.omit({ postStock: true }), req.body);
    const current = mapRecord(existing);
    const merged = parse(ExciseInput, {
      date: current.date,
      itemId: current.itemId,
      itemName: current.itemName,
      brand: current.brand,
      volumeMl: current.volumeMl,
      exciseCategory: current.exciseCategory,
      batchNo: current.batchNo,
      permitNo: current.permitNo ?? "",
      transportPermitNo: current.transportPermitNo,
      permitDate: current.permitDate,
      vendorId: current.vendorId,
      vendorName: current.vendorName,
      cases: current.cases,
      bottlesPerCase: current.bottlesPerCase,
      receivedQty: current.receivedQty,
      issuedQty: current.issuedQty,
      openingQty: current.openingQty,
      dutyRate: current.dutyRate,
      dutyAmount: patch.dutyAmount === undefined && (patch.dutyRate !== undefined || patch.receivedQty !== undefined) ? null : current.dutyAmount,
      status: current.status,
      notes: current.notes,
      ...patch,
    });
    if (isFutureDate(merged.date, todayISO())) throw new ImsError(400, "The record date can't be in the future");
    if (existing.movement_id && (merged.itemId !== current.itemId || merged.receivedQty !== current.receivedQty)) {
      throw new ImsError(409, "This receipt already added stock — the item and bottles received can't change. Delete it and post a stock adjustment instead.");
    }
    const { values } = await resolveValues(deps.db, actor, merged, existing.id);
    await exec(
      deps.db,
      `UPDATE ims_excise_records SET record_date = :recordDate, item_id = :itemId, item_name = :itemName, brand = :brand, volume_ml = :volumeMl,
         excise_category = :exciseCategory, opening_qty = :openingQty, received_qty = :receivedQty, issued_qty = :issuedQty, closing_qty = :closingQty,
         duty_rate = :dutyRate, duty_amount = :dutyAmount, permit_no = :permitNo, transport_permit_no = :transportPermitNo, permit_date = :permitDate,
         batch_no = :batchNo, vendor_id = :vendorId, vendor_name = :vendorName, cases = :cases, bottles_per_case = :bottlesPerCase, status = :status, notes = :notes
       WHERE tenant_id = :tenantId AND id = :id`,
      { ...values, tenantId: actor.tenantId, id: existing.id },
    );
    await recordEvent(deps, actor, { type: "excise.updated", entityType: "excise", entityId: existing.id, summary: `Updated excise record ${values.permitNo} (${values.itemName})`, payload: { fields: Object.keys(patch) }, ip: req.ip });
    const row = await one<ExciseRow>(deps.db, `SELECT * FROM ims_excise_records WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: existing.id });
    res.json({ record: row ? mapRecord(row) : null });
  });

  router.delete("/excise/:id", async (req, res) => {
    const actor = actorOf(res);
    await requireExcise(deps, actor.tenantId);
    requireExciseWrite(res);
    const existing = await one<ExciseRow>(deps.db, `SELECT * FROM ims_excise_records WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!existing) throw notFound("Excise record");
    await exec(deps.db, `DELETE FROM ims_excise_records WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: existing.id });
    await recordEvent(deps, actor, {
      type: "excise.deleted",
      entityType: "excise",
      entityId: existing.id,
      summary: `Deleted excise record ${existing.permit_no ?? ""} (${existing.item_name})`,
      payload: { stockPosted: Boolean(existing.movement_id) },
      ip: req.ip,
    });
    res.json({ ok: true, stockPosted: Boolean(existing.movement_id) });
  });
}
