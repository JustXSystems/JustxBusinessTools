import type { Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, can, isoDate, optText, parse, parsePatch, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows, tsOf, tx } from "./db.js";
import { ImsError, conflict, notFound, type ImsActor } from "./host.js";
import {
  MOVEMENT_TYPES,
  RESTORE_REASON,
  addDaysISO as addDays,
  agingBucket,
  daysBetween,
  honoursDamagedFlag,
  isFutureDate,
  monthStartISO,
  movementEffect,
  periodRange,
  refundAmountFor,
  reorderQty,
  restorePlan,
  round2,
  round3,
  stockStatus,
  summarizeCount,
  todayISO,
  type ImsPermission,
  type MovementType,
  type StockStatus,
} from "./logic.js";
import { getSettings } from "./settings.js";
import { nextDocNo, postMovement, type PostedMovement } from "./stock.js";

/* ---------- Items ---------- */

export type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  hsn: string | null;
  gst_rate: string;
  supplier_id: string | null;
  supplier_name?: string | null;
  purchase_price: string;
  selling_price: string;
  mrp: string | null;
  current_stock: string;
  damaged_stock: string;
  min_stock: string;
  max_stock: string | null;
  reorder_qty: string | null;
  location: string | null;
  volume_ml: number | null;
  excise_category: string | null;
  notes: string | null;
  active: number;
  last_movement_at: string | null;
  created_at: string;
  updated_at: string;
  moved_30d?: string | null;
};

export type ImsItem = ReturnType<typeof mapItem>;

export function mapItem(r: ItemRow, today = todayISO()) {
  const current = round3(money(r.current_stock));
  const min = round3(money(r.min_stock));
  const max = r.max_stock == null ? null : round3(money(r.max_stock));
  const purchasePrice = round2(money(r.purchase_price));
  const lastMove = r.last_movement_at ?? r.created_at;
  const idleDays = lastMove ? Math.max(0, daysBetween(isoOf(lastMove), today)) : 0;
  const status: StockStatus = stockStatus(current, min, max);
  return {
    id: r.id,
    name: r.name,
    sku: r.sku,
    barcode: r.barcode,
    category: r.category,
    brand: r.brand,
    unit: r.unit,
    hsn: r.hsn,
    gstRate: money(r.gst_rate),
    supplierId: r.supplier_id,
    supplierName: r.supplier_name ?? null,
    purchasePrice,
    sellingPrice: round2(money(r.selling_price)),
    mrp: r.mrp == null ? null : round2(money(r.mrp)),
    currentStock: current,
    damagedStock: round3(money(r.damaged_stock)),
    minStock: min,
    maxStock: max,
    reorderQty: r.reorder_qty == null ? null : round3(money(r.reorder_qty)),
    suggestedReorder: status === "LOW" || status === "OUT_OF_STOCK" ? reorderQty({ current, min, max, reorderQty: r.reorder_qty == null ? null : money(r.reorder_qty) }) : 0,
    location: r.location,
    volumeMl: r.volume_ml == null ? null : Number(r.volume_ml),
    exciseCategory: r.excise_category,
    notes: r.notes,
    active: Boolean(r.active),
    status,
    stockValue: round2(Math.max(0, current) * purchasePrice),
    idleDays,
    agingBucket: agingBucket(idleDays),
    movement30d: round3(money(r.moved_30d)),
    lastMovementAt: tsOf(r.last_movement_at),
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
  };
}

const ITEM_SELECT = `SELECT i.*, p.name AS supplier_name,
  (SELECT SUM(m.qty) FROM ims_movements m WHERE m.tenant_id = i.tenant_id AND m.item_id = i.id AND m.type = 'OUT' AND m.movement_date >= :since30) AS moved_30d
  FROM ims_items i LEFT JOIN ims_parties p ON p.id = i.supplier_id AND p.tenant_id = i.tenant_id`;

export async function getItem(deps: ImsDeps, tenantId: number, id: string) {
  const today = todayISO();
  const r = await one<ItemRow>(deps.db, `${ITEM_SELECT} WHERE i.tenant_id = :tenantId AND i.id = :id LIMIT 1`, { tenantId, id, since30: addDays(today, -29) });
  return r ? mapItem(r, today) : null;
}
const ItemInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  sku: optText(64),
  barcode: optText(64),
  category: optText(80),
  brand: optText(80),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  hsn: optText(20),
  gstRate: z.coerce.number().min(0).max(100).default(18),
  supplierId: z.string().uuid().nullable().optional(),
  purchasePrice: z.coerce.number().min(0).max(1e10).default(0),
  sellingPrice: z.coerce.number().min(0).max(1e10).default(0),
  mrp: z.coerce.number().min(0).max(1e10).nullable().optional(),
  minStock: z.coerce.number().min(0).max(1e9).default(0),
  maxStock: z.coerce.number().min(0).max(1e9).nullable().optional(),
  reorderQty: z.coerce.number().min(0).max(1e9).nullable().optional(),
  location: optText(80),
  volumeMl: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  exciseCategory: optText(40),
  notes: optText(2000),
  active: z.boolean().optional(),
});

const ITEM_COLUMN: Record<string, string> = {
  name: "name",
  sku: "sku",
  barcode: "barcode",
  category: "category",
  brand: "brand",
  unit: "unit",
  hsn: "hsn",
  gstRate: "gst_rate",
  supplierId: "supplier_id",
  purchasePrice: "purchase_price",
  sellingPrice: "selling_price",
  mrp: "mrp",
  minStock: "min_stock",
  maxStock: "max_stock",
  reorderQty: "reorder_qty",
  location: "location",
  volumeMl: "volume_ml",
  exciseCategory: "excise_category",
  notes: "notes",
  active: "active",
};

const blankToNull = (v: unknown) => (typeof v === "string" && !v.trim() ? null : v);

async function insertItem(deps: ImsDeps, actor: ImsActor, input: z.infer<typeof ItemInput>, opening: { qty: number; date?: string } | null, allowNegative: boolean): Promise<string> {
  const id = randomUUID();
  await tx(deps.db, async (conn) => {
    await exec(
      conn,
      `INSERT INTO ims_items (id, tenant_id, name, sku, barcode, category, brand, unit, hsn, gst_rate, supplier_id, purchase_price, selling_price, mrp,
                              min_stock, max_stock, reorder_qty, location, volume_ml, excise_category, notes, active, created_by)
       VALUES (:id, :tenantId, :name, :sku, :barcode, :category, :brand, :unit, :hsn, :gstRate, :supplierId, :purchasePrice, :sellingPrice, :mrp,
               :minStock, :maxStock, :reorderQty, :location, :volumeMl, :exciseCategory, :notes, :active, :userId)`,
      {
        id,
        tenantId: actor.tenantId,
        name: input.name,
        sku: blankToNull(input.sku) ?? null,
        barcode: blankToNull(input.barcode) ?? null,
        category: blankToNull(input.category) ?? null,
        brand: blankToNull(input.brand) ?? null,
        unit: input.unit,
        hsn: blankToNull(input.hsn) ?? null,
        gstRate: input.gstRate,
        supplierId: input.supplierId ?? null,
        purchasePrice: input.purchasePrice,
        sellingPrice: input.sellingPrice,
        mrp: input.mrp ?? null,
        minStock: input.minStock,
        maxStock: input.maxStock ?? null,
        reorderQty: input.reorderQty ?? null,
        location: blankToNull(input.location) ?? null,
        volumeMl: input.volumeMl ?? null,
        exciseCategory: blankToNull(input.exciseCategory) ?? null,
        notes: blankToNull(input.notes) ?? null,
        active: input.active === false ? 0 : 1,
        userId: actor.userId,
      },
    );
    if (opening && opening.qty > 0) {
      await postMovement(conn, actor, { itemId: id, type: "OPENING", qty: opening.qty, unitCost: input.purchasePrice, refType: "manual", reason: "Opening stock", date: opening.date }, { allowNegative });
    }
  });
  return id;
}

/* ---------- Movements ---------- */

type MovementRow = {
  id: string;
  item_id: string;
  item_name: string;
  type: MovementType;
  qty: string;
  delta: string;
  before_qty: string;
  after_qty: string;
  unit_cost: string | null;
  unit_price: string | null;
  value: string;
  ref_type: string;
  ref_id: string | null;
  ref_no: string | null;
  party_id: string | null;
  party_name: string | null;
  reason: string | null;
  refund_status: string | null;
  excise_duty: string | null;
  notes: string | null;
  movement_date: string;
  actor_name: string | null;
  created_at: string;
  unit?: string | null;
  sku?: string | null;
  category?: string | null;
};

export const mapMovement = (m: MovementRow) => ({
  id: m.id,
  itemId: m.item_id,
  itemName: m.item_name,
  sku: m.sku ?? null,
  unit: m.unit ?? null,
  category: m.category ?? null,
  type: m.type,
  qty: round3(money(m.qty)),
  delta: round3(money(m.delta)),
  before: round3(money(m.before_qty)),
  after: round3(money(m.after_qty)),
  unitCost: m.unit_cost == null ? null : round2(money(m.unit_cost)),
  unitPrice: m.unit_price == null ? null : round2(money(m.unit_price)),
  value: round2(money(m.value)),
  refType: m.ref_type,
  refId: m.ref_id,
  refNo: m.ref_no,
  partyId: m.party_id,
  partyName: m.party_name,
  reason: m.reason,
  refundStatus: m.refund_status,
  exciseDuty: m.excise_duty == null ? null : round2(money(m.excise_duty)),
  notes: m.notes,
  date: isoOf(m.movement_date),
  actorName: m.actor_name,
  createdAt: tsOf(m.created_at),
});

/** Which permission each manual movement type needs. */
const MOVEMENT_PERM: Record<MovementType, ImsPermission> = {
  OPENING: "items",
  IN: "stockIn",
  OUT: "stockOut",
  DAMAGE: "damage",
  WRITE_OFF: "damage",
  RETURN_IN: "damage",
  RETURN_OUT: "damage",
  ADJUSTMENT: "stockCheck",
};

const MovementLine = z.object({
  itemId: z.string().uuid(),
  qty: z.coerce.number().refine((n) => Number.isFinite(n) && n !== 0, "Quantity must not be zero").refine((n) => Math.abs(n) <= 1e9, "Too large"),
  unitCost: z.coerce.number().min(0).max(1e10).nullable().optional(),
  unitPrice: z.coerce.number().min(0).max(1e10).nullable().optional(),
  exciseDuty: z.coerce.number().min(0).max(1e10).nullable().optional(),
  notes: optText(500),
});

const MovementInput = z.object({
  type: z.enum(MOVEMENT_TYPES),
  lines: z.array(MovementLine).min(1, "Add at least one item").max(200),
  partyId: z.string().uuid().nullable().optional(),
  partyName: optText(200),
  refNo: optText(64),
  reason: optText(80),
  refundStatus: optText(12),
  notes: optText(500),
  date: isoDate.optional(),
  damaged: z.boolean().optional(),
});

/** Saleable stock may only block a movement that actually takes saleable units away. */
function negativeAllowed(allowNegativeStock: boolean, type: MovementType, qty: number, damaged?: boolean): boolean {
  return allowNegativeStock || movementEffect(type, qty, { damaged }).saleable >= 0;
}

function assertNotFuture(date: string | undefined) {
  if (date && isFutureDate(date, todayISO())) throw new ImsError(400, "The date can't be in the future");
}

/* ---------- Stock checks ---------- */

type CheckLine = {
  itemId: string;
  name: string;
  sku: string | null;
  unit: string;
  category: string | null;
  location?: string | null;
  systemQty: number;
  physicalQty: number | null;
  difference: number;
  unitCost: number;
  note: string | null;
};

type CheckRow = {
  id: string;
  check_no: string;
  title: string;
  status: "counting" | "submitted" | "approved" | "adjusted" | "cancelled";
  scope: unknown;
  lines: unknown;
  variance_qty: string;
  variance_value: string;
  notes: string | null;
  counted_by_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

const mapCheck = (r: CheckRow, withLines = true) => {
  const lines = json<CheckLine[]>(r.lines, []);
  const { summary } = summarizeCount(lines);
  return {
    id: r.id,
    checkNo: r.check_no,
    title: r.title,
    status: r.status,
    scope: json<Record<string, unknown>>(r.scope, {}),
    itemCount: lines.length,
    countedCount: summary.counted,
    mismatchCount: summary.mismatches,
    varianceQty: round3(money(r.variance_qty)),
    varianceValue: round2(money(r.variance_value)),
    shortQty: summary.shortQty,
    shortValue: summary.shortValue,
    excessQty: summary.excessQty,
    excessValue: summary.excessValue,
    notes: r.notes,
    countedByName: r.counted_by_name,
    decidedByName: r.decided_by_name,
    decidedAt: tsOf(r.decided_at),
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    ...(withLines ? { lines } : {}),
  };
};

const CheckCreate = z.object({
  title: z.string().trim().min(1).max(200),
  category: optText(80),
  location: optText(80),
  itemIds: z.array(z.string().uuid()).max(5000).optional(),
  lowOnly: z.boolean().optional(),
  notes: optText(2000),
});

const CheckCount = z.object({
  lines: z.array(z.object({ itemId: z.string().uuid(), physicalQty: z.coerce.number().min(0).max(1e9).nullable(), note: optText(300) })).max(5000),
  notes: optText(2000),
});

function recomputeCheck(lines: CheckLine[]): { lines: CheckLine[]; varianceQty: number; varianceValue: number } {
  const { lines: next, summary } = summarizeCount(lines);
  return { lines: next, varianceQty: summary.varianceQty, varianceValue: summary.varianceValue };
}

async function loadCheck(deps: ImsDeps, tenantId: number, id: string): Promise<CheckRow> {
  const row = await one<CheckRow>(deps.db, `SELECT * FROM ims_stock_checks WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId, id });
  if (!row) throw notFound("Stock check");
  return row;
}

/* ---------- Returns ---------- */

type ReturnLine = { itemId: string; name: string; unit: string | null; qty: number; rate: number; amount: number };

type ReturnRow = {
  id: string;
  return_no: string;
  kind: "customer" | "supplier";
  status: "open" | "completed" | "cancelled";
  party_id: string | null;
  party_name: string;
  ref_doc_id: string | null;
  ref_doc_no: string | null;
  return_date: string;
  lines: unknown;
  total: string;
  reason: string | null;
  disposition: "restock" | "damaged";
  refund_status: string;
  refund_amount: string;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
};

const mapReturn = (r: ReturnRow) => ({
  id: r.id,
  returnNo: r.return_no,
  kind: r.kind,
  status: r.status,
  partyId: r.party_id,
  partyName: r.party_name,
  refDocId: r.ref_doc_id,
  refDocNo: r.ref_doc_no,
  date: isoOf(r.return_date),
  lines: json<ReturnLine[]>(r.lines, []),
  total: round2(money(r.total)),
  reason: r.reason,
  disposition: r.disposition,
  refundStatus: r.refund_status,
  refundAmount: round2(money(r.refund_amount)),
  notes: r.notes,
  createdByName: r.created_by_name,
  createdAt: tsOf(r.created_at),
});

const ReturnInput = z.object({
  kind: z.enum(["customer", "supplier"]),
  partyId: z.string().uuid().nullable().optional(),
  partyName: z.string().trim().min(1, "Who is returning / receiving the goods?").max(200),
  refDocId: z.string().max(36).nullable().optional(),
  refDocNo: optText(64),
  date: isoDate.optional(),
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: z.coerce.number().positive().max(1e9), rate: z.coerce.number().min(0).max(1e10).optional() })).min(1).max(200),
  reason: optText(120),
  disposition: z.enum(["restock", "damaged"]).default("restock"),
  refundStatus: z.enum(["none", "pending", "refunded", "credit_note"]).default("none"),
  refundAmount: z.coerce.number().min(0).max(1e12).optional(),
  notes: optText(2000),
});

/* ---------- Routes ---------- */

function requireMovementPerm(res: Response, type: MovementType) {
  requirePerm(res, MOVEMENT_PERM[type]);
}

export function registerInventory(router: Router, deps: ImsDeps): void {
  /* Items */
  router.get("/items", async (req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const where = ["i.tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, since30: addDays(today, -29) };
    const q = qstr(req.query.q);
    if (q) {
      where.push("(i.name LIKE :q OR i.sku LIKE :q OR i.barcode = :exact OR i.brand LIKE :q OR i.hsn LIKE :q)");
      params.q = likeOf(q);
      params.exact = q;
    }
    const category = qstr(req.query.category, 80);
    if (category) {
      where.push("i.category = :category");
      params.category = category;
    }
    const brand = qstr(req.query.brand, 80);
    if (brand) {
      where.push("i.brand = :brand");
      params.brand = brand;
    }
    const supplierId = qstr(req.query.supplierId, 36);
    if (supplierId) {
      where.push("i.supplier_id = :supplierId");
      params.supplierId = supplierId;
    }
    if (req.query.includeInactive !== "1") where.push("i.active = 1");
    const list = (await rows<ItemRow>(deps.db, `${ITEM_SELECT} WHERE ${where.join(" AND ")} ORDER BY i.name LIMIT 5000`, params)).map((r) => mapItem(r, today));
    const status = qstr(req.query.status, 20).toUpperCase();
    const filtered = status === "ATTENTION" ? list.filter((i) => i.status === "LOW" || i.status === "OUT_OF_STOCK") : status ? list.filter((i) => i.status === status) : list;
    const facets = await rows<{ category: string | null; brand: string | null; unit: string }>(
      deps.db,
      `SELECT DISTINCT category, brand, unit FROM ims_items WHERE tenant_id = :tenantId AND active = 1`,
      { tenantId: actor.tenantId },
    );
    res.json({
      items: filtered,
      facets: {
        categories: [...new Set(facets.map((f) => f.category).filter((c): c is string => Boolean(c)))].sort(),
        brands: [...new Set(facets.map((f) => f.brand).filter((c): c is string => Boolean(c)))].sort(),
        units: [...new Set(facets.map((f) => f.unit).filter(Boolean))].sort(),
      },
      summary: {
        count: list.length,
        value: round2(list.reduce((s, i) => s + i.stockValue, 0)),
        units: round3(list.reduce((s, i) => s + Math.max(0, i.currentStock), 0)),
        low: list.filter((i) => i.status === "LOW").length,
        out: list.filter((i) => i.status === "OUT_OF_STOCK").length,
        over: list.filter((i) => i.status === "OVERSTOCK").length,
        damaged: round3(list.reduce((s, i) => s + i.damagedStock, 0)),
      },
    });
  });

  /** Scanner / quick-entry lookup by exact barcode or SKU. */
  router.get("/items/lookup", async (req, res) => {
    const actor = actorOf(res);
    const code = qstr(req.query.code, 64);
    if (!code) throw new ImsError(400, "Scan or type a code");
    const today = todayISO();
    const r = await one<ItemRow>(deps.db, `${ITEM_SELECT} WHERE i.tenant_id = :tenantId AND (i.barcode = :code OR i.sku = :code OR i.id = :code) LIMIT 1`, {
      tenantId: actor.tenantId,
      code,
      since30: addDays(today, -29),
    });
    res.json({ item: r ? mapItem(r, today) : null });
  });

  router.get("/items/:id", async (req, res) => {
    const actor = actorOf(res);
    const item = await getItem(deps, actor.tenantId, req.params.id);
    if (!item) throw notFound("Item");
    const movements = await rows<MovementRow>(
      deps.db,
      `SELECT * FROM ims_movements WHERE tenant_id = :tenantId AND item_id = :id ORDER BY created_at DESC LIMIT 100`,
      { tenantId: actor.tenantId, id: item.id },
    );
    const stats = await rows<{ type: string; qty: string; value: string }>(
      deps.db,
      `SELECT type, SUM(qty) AS qty, SUM(value) AS value FROM ims_movements WHERE tenant_id = :tenantId AND item_id = :id AND movement_date >= :since GROUP BY type`,
      { tenantId: actor.tenantId, id: item.id, since: addDays(todayISO(), -89) },
    );
    res.json({ item, movements: movements.map(mapMovement), stats90d: Object.fromEntries(stats.map((s) => [s.type, { qty: round3(money(s.qty)), value: round2(money(s.value)) }])) });
  });

  router.post("/items", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "items");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input = parse(ItemInput, body);
    const openingQty = Math.max(0, Number(body.openingStock) || 0);
    const settings = await getSettings(deps, actor.tenantId);
    const id = await insertItem(deps, actor, input, openingQty ? { qty: openingQty } : null, settings.allowNegativeStock);
    await recordEvent(deps, actor, { type: "item.created", entityType: "item", entityId: id, summary: `Added item ${input.name}${openingQty ? ` with ${openingQty} ${input.unit} opening stock` : ""}` });
    res.status(201).json({ item: await getItem(deps, actor.tenantId, id) });
  });

  /** Bulk import (CSV / Excel parsed on the client). Upserts by SKU; new items may carry opening stock. */
  router.post("/items/bulk", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "items");
    const body = parse(z.object({ items: z.array(z.record(z.string(), z.unknown())).min(1).max(2000) }), req.body);
    const settings = await getSettings(deps, actor.tenantId);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    for (const [idx, raw] of body.items.entries()) {
      const result = ItemInput.safeParse(raw);
      if (!result.success) {
        errors.push(`Row ${idx + 1}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`);
        continue;
      }
      const input = result.data;
      const sku = blankToNull(input.sku) as string | null | undefined;
      const existing = sku ? await one<{ id: string }>(deps.db, `SELECT id FROM ims_items WHERE tenant_id = :tenantId AND sku = :sku LIMIT 1`, { tenantId: actor.tenantId, sku }) : null;
      try {
        if (existing) {
          const sets: string[] = [];
          const params: Record<string, unknown> = { tenantId: actor.tenantId, id: existing.id };
          for (const [k, v] of Object.entries(input)) {
            if (v === undefined || !ITEM_COLUMN[k] || k === "active") continue;
            sets.push(`${ITEM_COLUMN[k]} = :${k}`);
            params[k] = blankToNull(v);
          }
          if (sets.length) await exec(deps.db, `UPDATE ims_items SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
          updated += 1;
        } else {
          const openingQty = Math.max(0, Number(raw.openingStock ?? raw.currentStock) || 0);
          await insertItem(deps, actor, input, openingQty ? { qty: openingQty } : null, settings.allowNegativeStock);
          created += 1;
        }
      } catch (err) {
        errors.push(`Row ${idx + 1}: ${(err as { code?: string }).code === "ER_DUP_ENTRY" ? "duplicate SKU" : err instanceof Error ? err.message : "failed"}`);
      }
    }
    await recordEvent(deps, actor, { type: "item.imported", entityType: "item", entityId: "bulk", summary: `Imported items: ${created} new, ${updated} updated${errors.length ? `, ${errors.length} skipped` : ""}` });
    res.json({ created, updated, errors: errors.slice(0, 50) });
  });

  router.patch("/items/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "items");
    const existing = await getItem(deps, actor.tenantId, req.params.id);
    if (!existing) throw notFound("Item");
    const patch = parsePatch(ItemInput, req.body) as Record<string, unknown>;
    const sets: string[] = [];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, id: existing.id };
    for (const [k, v] of Object.entries(patch)) {
      if (!ITEM_COLUMN[k]) continue;
      sets.push(`${ITEM_COLUMN[k]} = :${k}`);
      params[k] = typeof v === "boolean" ? (v ? 1 : 0) : (blankToNull(v) ?? null);
    }
    if (sets.length) {
      await exec(deps.db, `UPDATE ims_items SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
      await recordEvent(deps, actor, { type: "item.updated", entityType: "item", entityId: existing.id, summary: `Updated item ${existing.name}`, payload: { fields: Object.keys(patch) } });
    }
    res.json({ item: await getItem(deps, actor.tenantId, existing.id) });
  });

  /** Items with history are archived (kept for reports); untouched items are deleted. */
  router.delete("/items/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "items");
    const item = await getItem(deps, actor.tenantId, req.params.id);
    if (!item) throw notFound("Item");
    const used = await one<{ n: number }>(deps.db, `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id = :tenantId AND item_id = :id AND type <> 'OPENING'`, {
      tenantId: actor.tenantId,
      id: item.id,
    });
    if (Number(used?.n) > 0 || item.currentStock !== 0) {
      await exec(deps.db, `UPDATE ims_items SET active = 0 WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: item.id });
      await recordEvent(deps, actor, { type: "item.archived", entityType: "item", entityId: item.id, summary: `Archived item ${item.name}` });
      res.json({ archived: true });
      return;
    }
    await tx(deps.db, async (conn) => {
      await exec(conn, `DELETE FROM ims_movements WHERE tenant_id = :tenantId AND item_id = :id`, { tenantId: actor.tenantId, id: item.id });
      await exec(conn, `DELETE FROM ims_items WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: item.id });
    });
    await recordEvent(deps, actor, { type: "item.deleted", entityType: "item", entityId: item.id, summary: `Deleted item ${item.name}` });
    res.status(204).end();
  });

  /* Movements: stock in / out / damage / adjust / write-off (one request = one batch). */
  router.post("/movements", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(MovementInput, req.body);
    requireMovementPerm(res, input.type);
    if (input.type !== "ADJUSTMENT" && input.lines.some((l) => l.qty < 0)) throw new ImsError(400, "Quantities must be positive");
    assertNotFuture(input.date);
    const damaged = honoursDamagedFlag(input.type) ? Boolean(input.damaged) : false;
    const settings = await getSettings(deps, actor.tenantId);
    const posted: PostedMovement[] = await tx(deps.db, async (conn) => {
      const out: PostedMovement[] = [];
      for (const line of input.lines) {
        out.push(
          await postMovement(
            conn,
            actor,
            {
              itemId: line.itemId,
              type: input.type,
              qty: line.qty,
              damaged,
              unitCost: line.unitCost ?? null,
              unitPrice: line.unitPrice ?? null,
              exciseDuty: line.exciseDuty ?? null,
              refType: "manual",
              refNo: input.refNo ?? null,
              partyId: input.partyId ?? null,
              partyName: input.partyName ?? null,
              reason: input.reason ?? null,
              refundStatus: input.refundStatus ?? null,
              notes: line.notes ?? input.notes ?? null,
              date: input.date,
            },
            { allowNegative: negativeAllowed(settings.allowNegativeStock, input.type, line.qty, damaged) },
          ),
        );
      }
      return out;
    });
    const label: Record<MovementType, string> = { OPENING: "Opening stock", IN: "Stock in", OUT: "Stock out", DAMAGE: "Damage", ADJUSTMENT: "Adjustment", RETURN_IN: "Return in", RETURN_OUT: "Return out", WRITE_OFF: "Write-off" };
    const units = round3(posted.reduce((s, p) => s + p.qty, 0));
    await recordEvent(deps, actor, {
      type: `stock.${input.type.toLowerCase()}`,
      entityType: "movement",
      entityId: posted[0]?.id ?? "batch",
      summary: `${label[input.type]}: ${posted.length === 1 ? `${posted[0].qty} × ${posted[0].itemName}` : `${posted.length} items, ${units} units`}${input.partyName ? ` · ${input.partyName}` : ""}`,
      payload: { refNo: input.refNo, lines: posted.map((p) => ({ itemId: p.itemId, qty: p.qty, after: p.after })) },
    });
    res.status(201).json({ movements: posted });
  });

  /** Transactions / history with filters and totals. */
  router.get("/movements", async (req, res) => {
    const actor = actorOf(res);
    const settings = await getSettings(deps, actor.tenantId);
    const range = periodRange(qstr(req.query.period) || "30d", todayISO(), settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) });
    const where = ["m.tenant_id = :tenantId", "m.movement_date BETWEEN :from AND :to"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, ...range, limit: qint(req.query.limit, 500, 1, 5000) };
    const types = qstr(req.query.type, 80)
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((t): t is MovementType => (MOVEMENT_TYPES as readonly string[]).includes(t));
    if (types.length) {
      where.push(`m.type IN (${types.map((_, i) => `:t${i}`).join(", ")})`);
      types.forEach((t, i) => (params[`t${i}`] = t));
    }
    const itemId = qstr(req.query.itemId, 36);
    if (itemId) {
      where.push("m.item_id = :itemId");
      params.itemId = itemId;
    }
    const partyId = qstr(req.query.partyId, 36);
    if (partyId) {
      where.push("m.party_id = :partyId");
      params.partyId = partyId;
    }
    const refType = qstr(req.query.refType, 12);
    if (refType) {
      where.push("m.ref_type = :refType");
      params.refType = refType;
    }
    const refId = qstr(req.query.refId, 36);
    if (refId) {
      where.push("m.ref_id = :refId");
      params.refId = refId;
    }
    const refNo = qstr(req.query.refNo, 64);
    if (refNo) {
      where.push("m.ref_no = :refNo");
      params.refNo = refNo;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(m.item_name LIKE :q OR m.ref_no LIKE :q OR m.party_name LIKE :q OR m.reason LIKE :q OR m.actor_name LIKE :q OR m.notes LIKE :q)");
      params.q = likeOf(q);
    }
    const list = await rows<MovementRow>(
      deps.db,
      `SELECT m.*, i.unit, i.sku, i.category FROM ims_movements m LEFT JOIN ims_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
       WHERE ${where.join(" AND ")} ORDER BY m.created_at DESC LIMIT :limit`,
      params,
    );
    const totals = await rows<{ type: string; qty: string; delta: string; value: string; n: number }>(
      deps.db,
      `SELECT m.type, SUM(m.qty) AS qty, SUM(m.delta) AS delta, SUM(m.value) AS value, COUNT(*) AS n FROM ims_movements m WHERE ${where.join(" AND ")} GROUP BY m.type`,
      params,
    );
    const total = totals.reduce((n, t) => n + Number(t.n), 0);
    res.json({
      range,
      movements: list.map(mapMovement),
      totals: Object.fromEntries(totals.map((t) => [t.type, { qty: round3(money(t.qty)), delta: round3(money(t.delta)), value: round2(money(t.value)), count: Number(t.n) }])),
      count: total,
      truncated: total > list.length,
    });
  });

  /** Low stock & reorder suggestions grouped by supplier. */
  router.get("/low-stock", async (_req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const list = (
      await rows<ItemRow>(deps.db, `${ITEM_SELECT} WHERE i.tenant_id = :tenantId AND i.active = 1 AND i.current_stock <= i.min_stock ORDER BY i.current_stock / NULLIF(i.min_stock, 0)`, {
        tenantId: actor.tenantId,
        since30: addDays(today, -29),
      })
    ).map((r) => mapItem(r, today));
    const groups = new Map<string, { supplierId: string | null; supplierName: string; items: typeof list; value: number }>();
    for (const i of list) {
      const key = i.supplierId ?? "none";
      const g = groups.get(key) ?? { supplierId: i.supplierId, supplierName: i.supplierName ?? "No preferred supplier", items: [], value: 0 };
      g.items.push(i);
      g.value = round2(g.value + i.suggestedReorder * i.purchasePrice);
      groups.set(key, g);
    }
    res.json({ items: list, bySupplier: [...groups.values()] });
  });

  /* Stock checks */
  router.get("/checks", async (req, res) => {
    const actor = actorOf(res);
    const status = qstr(req.query.status, 12);
    const list = await rows<CheckRow>(
      deps.db,
      `SELECT * FROM ims_stock_checks WHERE tenant_id = :tenantId ${status ? "AND status = :status" : ""} ORDER BY created_at DESC LIMIT 200`,
      { tenantId: actor.tenantId, status },
    );
    res.json({ checks: list.map((c) => mapCheck(c, false)) });
  });

  /** Open checks also carry each item's live stock, so counters see what moved since the snapshot. */
  router.get("/checks/:id", async (req, res) => {
    const actor = actorOf(res);
    const row = await loadCheck(deps, actor.tenantId, req.params.id);
    const check = mapCheck(row);
    if ((row.status === "counting" || row.status === "submitted") && check.lines?.length) {
      const ids = check.lines.map((l) => l.itemId);
      const live = await rows<{ id: string; current_stock: string; location: string | null }>(
        deps.db,
        `SELECT id, current_stock, location FROM ims_items WHERE tenant_id = :tenantId AND id IN (${ids.map((_, i) => `:id${i}`).join(", ")})`,
        { tenantId: actor.tenantId, ...Object.fromEntries(ids.map((id, i) => [`id${i}`, id])) },
      );
      const byId = new Map(live.map((l) => [l.id, l]));
      res.json({
        check: {
          ...check,
          lines: check.lines.map((l) => {
            const it = byId.get(l.itemId);
            return { ...l, location: l.location ?? it?.location ?? null, liveQty: it ? round3(money(it.current_stock)) : null };
          }),
        },
      });
      return;
    }
    res.json({ check });
  });

  router.post("/checks", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "stockCheck");
    const input = parse(CheckCreate, req.body);
    const where = ["tenant_id = :tenantId", "active = 1"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    if (input.category) {
      where.push("category = :category");
      params.category = input.category;
    }
    if (input.location) {
      where.push("location = :location");
      params.location = input.location;
    }
    if (input.lowOnly) where.push("current_stock <= min_stock");
    if (input.itemIds?.length) {
      where.push(`id IN (${input.itemIds.map((_, i) => `:id${i}`).join(", ")})`);
      input.itemIds.forEach((id, i) => (params[`id${i}`] = id));
    }
    const items = await rows<{ id: string; name: string; sku: string | null; unit: string; category: string | null; location: string | null; current_stock: string; purchase_price: string }>(
      deps.db,
      `SELECT id, name, sku, unit, category, location, current_stock, purchase_price FROM ims_items WHERE ${where.join(" AND ")} ORDER BY category, name LIMIT 5000`,
      params,
    );
    if (!items.length) throw new ImsError(400, "No items match that scope");
    const settings = await getSettings(deps, actor.tenantId);
    const lines: CheckLine[] = items.map((i) => ({
      itemId: i.id,
      name: i.name,
      sku: i.sku,
      unit: i.unit,
      category: i.category,
      location: i.location,
      systemQty: round3(money(i.current_stock)),
      physicalQty: null,
      difference: 0,
      unitCost: round2(money(i.purchase_price)),
      note: null,
    }));
    const id = randomUUID();
    const checkNo = await nextDocNo(deps.db, actor.tenantId, "check", settings.checkPrefix, todayISO(), settings.fiscalYearStart);
    await exec(
      deps.db,
      `INSERT INTO ims_stock_checks (id, tenant_id, check_no, title, status, scope, \`lines\`, notes, counted_by, counted_by_name)
       VALUES (:id, :tenantId, :checkNo, :title, 'counting', :scope, :lines, :notes, :userId, :userName)`,
      {
        id,
        tenantId: actor.tenantId,
        checkNo,
        title: input.title,
        scope: JSON.stringify({ category: input.category ?? null, location: input.location ?? null, lowOnly: Boolean(input.lowOnly), itemIds: input.itemIds?.length ?? 0 }),
        lines: JSON.stringify(lines),
        notes: input.notes ?? null,
        userId: actor.userId,
        userName: actor.name ?? actor.email,
      },
    );
    await recordEvent(deps, actor, { type: "check.created", entityType: "check", entityId: id, summary: `Started stock check ${checkNo} (${lines.length} items)` });
    res.status(201).json({ check: mapCheck(await loadCheck(deps, actor.tenantId, id)) });
  });

  router.patch("/checks/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "stockCheck");
    const row = await loadCheck(deps, actor.tenantId, req.params.id);
    if (row.status !== "counting") throw conflict("This stock check is no longer open for counting");
    const input = parse(CheckCount, req.body);
    const byId = new Map(input.lines.map((l) => [l.itemId, l]));
    const merged = json<CheckLine[]>(row.lines, []).map((l) => {
      const u = byId.get(l.itemId);
      return u ? { ...l, physicalQty: u.physicalQty === null ? null : round3(u.physicalQty), note: u.note ?? l.note } : l;
    });
    const { lines, varianceQty, varianceValue } = recomputeCheck(merged);
    await exec(
      deps.db,
      `UPDATE ims_stock_checks SET \`lines\` = :lines, variance_qty = :vq, variance_value = :vv, notes = COALESCE(:notes, notes), counted_by = :userId, counted_by_name = :userName
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: row.id, lines: JSON.stringify(lines), vq: varianceQty, vv: varianceValue, notes: input.notes ?? null, userId: actor.userId, userName: actor.name ?? actor.email },
    );
    res.json({ check: mapCheck(await loadCheck(deps, actor.tenantId, row.id)) });
  });

  router.post("/checks/:id/submit", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "stockCheck");
    const row = await loadCheck(deps, actor.tenantId, req.params.id);
    if (row.status !== "counting") throw conflict("Only an open count can be submitted");
    const lines = json<CheckLine[]>(row.lines, []);
    if (!lines.some((l) => l.physicalQty !== null)) throw new ImsError(400, "Count at least one item before submitting");
    await exec(deps.db, `UPDATE ims_stock_checks SET status = 'submitted' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, {
      type: "check.submitted",
      entityType: "check",
      entityId: row.id,
      summary: `Submitted stock check ${row.check_no} for approval`,
      notice: { kind: "approval_requested", title: `Stock check ${row.check_no} awaits approval`, body: `${row.title} · variance ₹${round2(money(row.variance_value)).toLocaleString("en-IN")}`, path: `?m=checks&open=${row.id}` },
    });
    res.json({ check: mapCheck(await loadCheck(deps, actor.tenantId, row.id)) });
  });

  /** Approve → posts an ADJUSTMENT for every counted difference (relative to the count-time snapshot). */
  router.post("/checks/:id/approve", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const row = await loadCheck(deps, actor.tenantId, req.params.id);
    if (row.status !== "submitted") throw conflict("Only a submitted stock check can be approved");
    const lines = json<CheckLine[]>(row.lines, []).filter((l) => l.physicalQty !== null && Math.abs(l.difference) > 0.0005);
    await tx(deps.db, async (conn) => {
      for (const l of lines) {
        await postMovement(
          conn,
          actor,
          { itemId: l.itemId, type: "ADJUSTMENT", qty: l.difference, refType: "check", refId: row.id, refNo: row.check_no, reason: "Physical count correction", notes: l.note },
          { allowNegative: true },
        );
      }
      await exec(conn, `UPDATE ims_stock_checks SET status = :status, decided_by = :userId, decided_by_name = :userName, decided_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: row.id,
        status: lines.length ? "adjusted" : "approved",
        userId: actor.userId,
        userName: actor.name ?? actor.email,
      });
    });
    await recordEvent(deps, actor, {
      type: "check.approved",
      entityType: "check",
      entityId: row.id,
      summary: `Approved stock check ${row.check_no}${lines.length ? ` — ${lines.length} adjustments posted` : " — no differences"}`,
      notice: { kind: "approval_decided", title: `Stock check ${row.check_no} approved`, body: `${lines.length} stock adjustments posted`, path: `?m=checks&open=${row.id}` },
    });
    res.json({ check: mapCheck(await loadCheck(deps, actor.tenantId, row.id)) });
  });

  router.post("/checks/:id/reject", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const row = await loadCheck(deps, actor.tenantId, req.params.id);
    if (row.status !== "submitted") throw conflict("Only a submitted stock check can be sent back");
    const note = parse(z.object({ note: optText(500) }), req.body).note;
    if (note) {
      await exec(
        deps.db,
        `UPDATE ims_stock_checks SET status = 'counting', notes = IF(notes IS NULL OR notes = '', :note, CONCAT(notes, '\n', :note)) WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id: row.id, note: `[Sent back] ${note}` },
      );
    } else {
      await exec(deps.db, `UPDATE ims_stock_checks SET status = 'counting' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    }
    await recordEvent(deps, actor, { type: "check.returned", entityType: "check", entityId: row.id, summary: `Sent stock check ${row.check_no} back for recount${note ? `: ${note}` : ""}` });
    res.json({ check: mapCheck(await loadCheck(deps, actor.tenantId, row.id)) });
  });

  router.post("/checks/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["stockCheck", "approvals"]);
    const row = await loadCheck(deps, actor.tenantId, req.params.id);
    if (row.status !== "counting" && row.status !== "submitted") throw conflict("This stock check is already closed");
    await exec(deps.db, `UPDATE ims_stock_checks SET status = 'cancelled' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "check.cancelled", entityType: "check", entityId: row.id, summary: `Cancelled stock check ${row.check_no}` });
    res.json({ check: mapCheck(await loadCheck(deps, actor.tenantId, row.id)) });
  });

  /* Returns (customer → stock in, supplier → stock out) */
  router.get("/returns", async (req, res) => {
    const actor = actorOf(res);
    const kind = qstr(req.query.kind, 10);
    const list = await rows<ReturnRow>(
      deps.db,
      `SELECT * FROM ims_returns WHERE tenant_id = :tenantId ${kind === "customer" || kind === "supplier" ? "AND kind = :kind" : ""} ORDER BY return_date DESC, created_at DESC LIMIT 500`,
      { tenantId: actor.tenantId, kind },
    );
    const damage = await rows<MovementRow>(
      deps.db,
      `SELECT m.*, i.unit, i.sku, i.category FROM ims_movements m LEFT JOIN ims_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
       WHERE m.tenant_id = :tenantId AND (m.type IN ('DAMAGE', 'WRITE_OFF') OR (m.type = 'RETURN_IN' AND m.ref_type = 'manual' AND m.reason = :restoreReason))
       ORDER BY m.created_at DESC LIMIT 300`,
      { tenantId: actor.tenantId, restoreReason: RESTORE_REASON },
    );
    const today = todayISO();
    const quarantine = await rows<ItemRow>(deps.db, `${ITEM_SELECT} WHERE i.tenant_id = :tenantId AND i.damaged_stock > 0 ORDER BY i.name`, {
      tenantId: actor.tenantId,
      since30: addDays(today, -29),
    });
    const monthStart = monthStartISO(today);
    const agg = await one<{ customer_n: number; customer_value: string; supplier_n: number; supplier_value: string; refund_pending: string; refund_pending_n: number }>(
      deps.db,
      `SELECT
         SUM(kind = 'customer' AND return_date >= :monthStart) AS customer_n,
         SUM(IF(kind = 'customer' AND return_date >= :monthStart, total, 0)) AS customer_value,
         SUM(kind = 'supplier' AND return_date >= :monthStart) AS supplier_n,
         SUM(IF(kind = 'supplier' AND return_date >= :monthStart, total, 0)) AS supplier_value,
         SUM(IF(refund_status = 'pending', refund_amount, 0)) AS refund_pending,
         SUM(refund_status = 'pending') AS refund_pending_n
       FROM ims_returns WHERE tenant_id = :tenantId AND status <> 'cancelled'`,
      { tenantId: actor.tenantId, monthStart },
    );
    const losses = await one<{ damage_value: string; damage_units: string; writeoff_value: string; writeoff_units: string }>(
      deps.db,
      `SELECT SUM(IF(type = 'DAMAGE', value, 0)) AS damage_value, SUM(IF(type = 'DAMAGE', qty, 0)) AS damage_units,
              SUM(IF(type = 'WRITE_OFF', value, 0)) AS writeoff_value, SUM(IF(type = 'WRITE_OFF', qty, 0)) AS writeoff_units
       FROM ims_movements WHERE tenant_id = :tenantId AND type IN ('DAMAGE', 'WRITE_OFF') AND movement_date >= :monthStart`,
      { tenantId: actor.tenantId, monthStart },
    );
    const quarantined = quarantine.map((r) => mapItem(r, today));
    res.json({
      returns: list.map(mapReturn),
      damage: damage.map(mapMovement),
      quarantine: quarantined,
      summary: {
        monthStart,
        customerReturns: Number(agg?.customer_n ?? 0),
        customerValue: round2(money(agg?.customer_value)),
        supplierReturns: Number(agg?.supplier_n ?? 0),
        supplierValue: round2(money(agg?.supplier_value)),
        refundPending: round2(money(agg?.refund_pending)),
        refundPendingCount: Number(agg?.refund_pending_n ?? 0),
        damagedUnits: round3(quarantined.reduce((s, i) => s + i.damagedStock, 0)),
        damagedValue: round2(quarantined.reduce((s, i) => s + i.damagedStock * i.purchasePrice, 0)),
        damageMtdValue: round2(money(losses?.damage_value)),
        damageMtdUnits: round3(money(losses?.damage_units)),
        writeOffMtdValue: round2(money(losses?.writeoff_value)),
        writeOffMtdUnits: round3(money(losses?.writeoff_units)),
      },
    });
  });

  /** Quarantined units judged saleable again go back into saleable stock (see restorePlan). */
  router.post("/damage/restore", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "damage");
    const input = parse(z.object({ itemId: z.string().uuid(), qty: z.coerce.number().positive().max(1e9), notes: optText(500), date: isoDate.optional() }), req.body);
    assertNotFuture(input.date);
    const refId = randomUUID();
    const posted = await tx(deps.db, async (conn) => {
      const out: PostedMovement[] = [];
      for (const step of restorePlan(input.qty)) {
        out.push(
          await postMovement(
            conn,
            actor,
            { itemId: input.itemId, type: step.type, qty: step.qty, damaged: step.damaged, refType: "manual", refId, reason: RESTORE_REASON, notes: input.notes ?? null, date: input.date },
            { allowNegative: true },
          ),
        );
      }
      return out;
    });
    const last = posted[posted.length - 1];
    await recordEvent(deps, actor, {
      type: "stock.restored",
      entityType: "item",
      entityId: input.itemId,
      summary: `Restored ${round3(input.qty)} × ${last?.itemName ?? "item"} from damaged to saleable stock`,
      payload: { qty: input.qty, notes: input.notes ?? null, after: last?.after },
    });
    res.status(201).json({ movements: posted });
  });

  router.post("/returns", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "damage");
    const input = parse(ReturnInput, req.body);
    assertNotFuture(input.date);
    const settings = await getSettings(deps, actor.tenantId);
    const date = input.date ?? todayISO();
    const id = randomUUID();
    const result = await tx(deps.db, async (conn) => {
      const returnNo = await nextDocNo(conn, actor.tenantId, "return", settings.returnPrefix, date, settings.fiscalYearStart);
      const lines: ReturnLine[] = [];
      for (const l of input.lines) {
        const item = await one<{ name: string; unit: string; purchase_price: string; selling_price: string }>(conn, `SELECT name, unit, purchase_price, selling_price FROM ims_items WHERE tenant_id = :tenantId AND id = :id`, {
          tenantId: actor.tenantId,
          id: l.itemId,
        });
        if (!item) throw notFound("Item");
        const rate = l.rate ?? (input.kind === "customer" ? money(item.selling_price) : money(item.purchase_price));
        lines.push({ itemId: l.itemId, name: item.name, unit: item.unit, qty: round3(l.qty), rate: round2(rate), amount: round2(l.qty * rate) });
        await postMovement(
          conn,
          actor,
          {
            itemId: l.itemId,
            type: input.kind === "customer" ? "RETURN_IN" : "RETURN_OUT",
            qty: l.qty,
            damaged: input.disposition === "damaged",
            unitCost: input.kind === "supplier" ? rate : null,
            unitPrice: input.kind === "customer" ? rate : null,
            refType: "return",
            refId: id,
            refNo: returnNo,
            partyId: input.partyId ?? null,
            partyName: input.partyName,
            reason: input.reason ?? null,
            refundStatus: input.refundStatus,
            notes: input.notes ?? null,
            date,
          },
          { allowNegative: negativeAllowed(settings.allowNegativeStock, input.kind === "customer" ? "RETURN_IN" : "RETURN_OUT", l.qty, input.disposition === "damaged") },
        );
      }
      const total = round2(lines.reduce((s, l) => s + l.amount, 0));
      await exec(
        conn,
        `INSERT INTO ims_returns (id, tenant_id, return_no, kind, status, party_id, party_name, ref_doc_id, ref_doc_no, return_date, \`lines\`, total, reason, disposition, refund_status, refund_amount, notes, created_by, created_by_name)
         VALUES (:id, :tenantId, :returnNo, :kind, 'completed', :partyId, :partyName, :refDocId, :refDocNo, :date, :lines, :total, :reason, :disposition, :refundStatus, :refundAmount, :notes, :userId, :userName)`,
        {
          id,
          tenantId: actor.tenantId,
          returnNo,
          kind: input.kind,
          partyId: input.partyId ?? null,
          partyName: input.partyName,
          refDocId: input.refDocId ?? null,
          refDocNo: input.refDocNo ?? null,
          date,
          lines: JSON.stringify(lines),
          total,
          reason: input.reason ?? null,
          disposition: input.disposition,
          refundStatus: input.refundStatus,
          refundAmount: refundAmountFor(input.refundStatus, total, input.refundAmount),
          notes: input.notes ?? null,
          userId: actor.userId,
          userName: actor.name ?? actor.email,
        },
      );
      return { returnNo, total };
    });
    await recordEvent(deps, actor, {
      type: `return.${input.kind}`,
      entityType: "return",
      entityId: id,
      summary: `${input.kind === "customer" ? "Customer return from" : "Returned to supplier"} ${input.partyName} — ${result.returnNo} (₹${result.total.toLocaleString("en-IN")})`,
    });
    const row = await one<ReturnRow>(deps.db, `SELECT * FROM ims_returns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    res.status(201).json({ return: row ? mapReturn(row) : null });
  });

  router.patch("/returns/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["damage", "receivables", "payables"]);
    const row = await one<ReturnRow>(deps.db, `SELECT * FROM ims_returns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Return");
    if (row.status === "cancelled") throw conflict("This return is cancelled");
    const input = parse(z.object({ refundStatus: z.enum(["none", "pending", "refunded", "credit_note"]).optional(), refundAmount: z.coerce.number().min(0).max(1e12).optional(), notes: optText(2000) }), req.body);
    await exec(
      deps.db,
      `UPDATE ims_returns SET refund_status = COALESCE(:refundStatus, refund_status), refund_amount = COALESCE(:refundAmount, refund_amount), notes = COALESCE(:notes, notes)
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: row.id, refundStatus: input.refundStatus ?? null, refundAmount: input.refundAmount ?? null, notes: input.notes ?? null },
    );
    await recordEvent(deps, actor, { type: "return.updated", entityType: "return", entityId: row.id, summary: `Updated return ${row.return_no}${input.refundStatus ? ` — refund ${input.refundStatus.replace("_", " ")}` : ""}` });
    const next = await one<ReturnRow>(deps.db, `SELECT * FROM ims_returns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    res.json({ return: next ? mapReturn(next) : null });
  });

  /** Cancelling a return reverses its stock movements. */
  router.post("/returns/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "damage");
    const row = await one<ReturnRow>(deps.db, `SELECT * FROM ims_returns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Return");
    if (row.status === "cancelled") throw conflict("This return is already cancelled");
    const settings = await getSettings(deps, actor.tenantId);
    await tx(deps.db, async (conn) => {
      const type: MovementType = row.kind === "customer" ? "RETURN_OUT" : "RETURN_IN";
      const damaged = row.disposition === "damaged";
      for (const l of json<ReturnLine[]>(row.lines, [])) {
        await postMovement(
          conn,
          actor,
          {
            itemId: l.itemId,
            type,
            qty: l.qty,
            damaged,
            unitCost: row.kind === "supplier" ? l.rate : null,
            refType: "return",
            refId: row.id,
            refNo: row.return_no,
            partyId: row.party_id,
            partyName: row.party_name,
            reason: "Return cancelled",
          },
          { allowNegative: negativeAllowed(settings.allowNegativeStock, type, l.qty, damaged) },
        );
      }
      await exec(conn, `UPDATE ims_returns SET status = 'cancelled' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    });
    await recordEvent(deps, actor, { type: "return.cancelled", entityType: "return", entityId: row.id, summary: `Cancelled return ${row.return_no} (stock reversed)` });
    res.json({ ok: true });
  });

  /** Taxonomy-driven pick-lists for forms (categories with HSN/GST defaults, units, reasons). */
  router.get("/inventory/meta", async (_req, res) => {
    const actor = actorOf(res);
    const settings = await getSettings(deps, actor.tenantId);
    const suppliers = await rows<{ id: string; name: string }>(deps.db, `SELECT id, name FROM ims_parties WHERE tenant_id = :tenantId AND active = 1 AND kind IN ('supplier', 'both') ORDER BY name`, {
      tenantId: actor.tenantId,
    });
    res.json({ taxonomy: settings.taxonomy, suppliers, allowNegativeStock: settings.allowNegativeStock, canSeeCost: can(res, "reports") || can(res, "items") || can(res, "po") });
  });
}
