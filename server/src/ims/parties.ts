import type { Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, can, optText, parse, parsePatch, qstr, recordEvent, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { conflict, forbidden, notFound, type ImsActor } from "./host.js";
import { OPEN_PO_STATUSES, isValidGstin, panFromGstin, resolvePartyState, round2, round3, stockStatus } from "./logic.js";

export const PARTY_KINDS = ["supplier", "customer", "both"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

type PartyRow = {
  id: string;
  kind: string;
  name: string;
  contact_person: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  payment_terms_days: number | null;
  credit_limit: string | null;
  opening_balance: string;
  account_manager_id: number | null;
  account_manager_name: string | null;
  tags: string | null;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
};

export type PartyStats = {
  itemsSupplied: number;
  openPoCount: number;
  openPoValue: number;
  lastPurchaseDate: string | null;
  receivable: number;
  payable: number;
  /** Opening balance + receivable − payable (positive = they owe us). */
  netBalance: number;
};

const kindOf = (v: string): PartyKind => ((PARTY_KINDS as readonly string[]).includes(v) ? (v as PartyKind) : "customer");
const tagsOf = (v: string | null): string[] =>
  String(v ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

export function mapParty(r: PartyRow) {
  return {
    id: r.id,
    kind: kindOf(r.kind),
    name: r.name,
    contactPerson: r.contact_person,
    mobile: r.mobile,
    email: r.email,
    gstin: r.gstin,
    pan: r.pan,
    address: r.address,
    city: r.city,
    state: r.state,
    stateCode: r.state_code,
    paymentTermsDays: r.payment_terms_days == null ? null : Number(r.payment_terms_days),
    creditLimit: r.credit_limit == null ? null : round2(money(r.credit_limit)),
    openingBalance: round2(money(r.opening_balance)),
    accountManagerId: r.account_manager_id == null ? null : Number(r.account_manager_id),
    accountManagerName: r.account_manager_name,
    tags: tagsOf(r.tags),
    notes: r.notes,
    active: Boolean(r.active),
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
  };
}
export type ImsParty = ReturnType<typeof mapParty>;

export async function loadParty(db: Queryable, tenantId: number, id: string): Promise<ImsParty | null> {
  const r = await one<PartyRow>(db, `SELECT * FROM ims_parties WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId, id });
  return r ? mapParty(r) : null;
}

/** Per-party aggregates in a handful of grouped queries (never one query per party). */
async function partyStats(db: Queryable, tenantId: number, ids: ReadonlyArray<string>, openingById: ReadonlyMap<string, number>): Promise<Map<string, PartyStats>> {
  const out = new Map<string, PartyStats>();
  if (!ids.length) return out;
  const params: Record<string, unknown> = { tenantId };
  const inList = ids.map((id, i) => {
    params[`p${i}`] = id;
    return `:p${i}`;
  });
  const inSql = `(${inList.join(", ")})`;
  const openSql = OPEN_PO_STATUSES.map((s) => `'${s}'`).join(", ");
  const [items, pos, lastPo, lastBill, inv, bills] = await Promise.all([
    rows<{ pid: string; n: number }>(db, `SELECT supplier_id AS pid, COUNT(*) AS n FROM ims_items WHERE tenant_id = :tenantId AND active = 1 AND supplier_id IN ${inSql} GROUP BY supplier_id`, params),
    rows<{ pid: string; n: number; v: string }>(
      db,
      `SELECT supplier_id AS pid, COUNT(*) AS n, SUM(grand_total) AS v FROM ims_purchase_orders WHERE tenant_id = :tenantId AND status IN (${openSql}) AND supplier_id IN ${inSql} GROUP BY supplier_id`,
      params,
    ),
    rows<{ pid: string; d: string | null }>(
      db,
      `SELECT supplier_id AS pid, MAX(order_date) AS d FROM ims_purchase_orders WHERE tenant_id = :tenantId AND status NOT IN ('draft', 'rejected', 'cancelled') AND supplier_id IN ${inSql} GROUP BY supplier_id`,
      params,
    ),
    rows<{ pid: string; d: string | null }>(db, `SELECT supplier_id AS pid, MAX(bill_date) AS d FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' AND supplier_id IN ${inSql} GROUP BY supplier_id`, params),
    rows<{ pid: string; v: string }>(
      db,
      `SELECT customer_id AS pid, SUM(GREATEST(grand_total - amount_paid, 0)) AS v FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND customer_id IN ${inSql} GROUP BY customer_id`,
      params,
    ),
    rows<{ pid: string; v: string }>(
      db,
      `SELECT supplier_id AS pid, SUM(GREATEST(grand_total - amount_paid, 0)) AS v FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' AND supplier_id IN ${inSql} GROUP BY supplier_id`,
      params,
    ),
  ]);
  const byId = <T extends { pid: string }>(list: T[]) => new Map(list.map((r) => [r.pid, r]));
  const itemsBy = byId(items);
  const posBy = byId(pos);
  const lastPoBy = byId(lastPo);
  const lastBillBy = byId(lastBill);
  const invBy = byId(inv);
  const billsBy = byId(bills);
  for (const id of ids) {
    const dates = [lastPoBy.get(id)?.d, lastBillBy.get(id)?.d].filter((d): d is string => Boolean(d)).map((d) => isoOf(d));
    const receivable = round2(money(invBy.get(id)?.v));
    const payable = round2(money(billsBy.get(id)?.v));
    out.set(id, {
      itemsSupplied: Number(itemsBy.get(id)?.n ?? 0),
      openPoCount: Number(posBy.get(id)?.n ?? 0),
      openPoValue: round2(money(posBy.get(id)?.v)),
      lastPurchaseDate: dates.sort().pop() ?? null,
      receivable,
      payable,
      netBalance: round2((openingById.get(id) ?? 0) + receivable - payable),
    });
  }
  return out;
}

/* ---------- Input ---------- */

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const PartyInput = z.object({
  kind: z.enum(PARTY_KINDS).default("supplier"),
  name: z.string().trim().min(1, "Name is required").max(200),
  contactPerson: z.preprocess(blank, optText(120)),
  mobile: z.preprocess(blank, z.string().trim().max(40).regex(/^\+?[\d\s()-]{6,}$/, "Use a valid phone number").nullable().optional()),
  email: z.preprocess(blank, z.string().trim().max(180).email("Use a valid email").nullable().optional()),
  gstin: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() ? v.trim().toUpperCase() : null) : v),
    z.string().refine(isValidGstin, "GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5").nullable().optional(),
  ),
  pan: z.preprocess((v) => (typeof v === "string" ? (v.trim() ? v.trim().toUpperCase() : null) : v), z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN looks like ABCDE1234F").nullable().optional()),
  address: z.preprocess(blank, optText(500)),
  city: z.preprocess(blank, optText(80)),
  state: z.preprocess(blank, optText(80)),
  stateCode: z.preprocess(blank, optText(4)),
  paymentTermsDays: z.preprocess(blank, z.coerce.number().int().min(0).max(365).nullable().optional()),
  creditLimit: z.preprocess(blank, z.coerce.number().min(0).max(1e12).nullable().optional()),
  openingBalance: z.preprocess(blank, z.coerce.number().min(-1e12).max(1e12).nullable().optional()),
  accountManagerId: z.preprocess(blank, z.coerce.number().int().positive().nullable().optional()),
  tags: z
    .preprocess(
      (v) =>
        typeof v === "string"
          ? v
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : v,
      z.array(z.string().trim().min(1).max(40)).max(20),
    )
    .optional(),
  notes: z.preprocess(blank, optText(4000)),
  active: z.boolean().optional(),
});
type PartyInputT = z.infer<typeof PartyInput>;

const COLUMN: Record<string, string> = {
  kind: "kind",
  name: "name",
  contactPerson: "contact_person",
  mobile: "mobile",
  email: "email",
  gstin: "gstin",
  pan: "pan",
  address: "address",
  city: "city",
  state: "state",
  stateCode: "state_code",
  paymentTermsDays: "payment_terms_days",
  creditLimit: "credit_limit",
  openingBalance: "opening_balance",
  accountManagerId: "account_manager_id",
  accountManagerName: "account_manager_name",
  tags: "tags",
  notes: "notes",
  active: "active",
};

/** Derives state / code / PAN from the GSTIN and resolves the account manager's name. */
async function normalizeParty(deps: ImsDeps, actor: ImsActor, input: Partial<PartyInputT>, current: ImsParty | null): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...input };
  const touchesPlace = input.gstin !== undefined || input.state !== undefined || input.stateCode !== undefined;
  if (touchesPlace) {
    const gstin = input.gstin !== undefined ? input.gstin : (current?.gstin ?? null);
    const stateInput = input.state !== undefined ? input.state : input.gstin !== undefined && input.gstin ? null : (current?.state ?? null);
    const codeInput = input.stateCode !== undefined ? input.stateCode : input.gstin !== undefined && input.gstin ? null : (current?.stateCode ?? null);
    const place = resolvePartyState({ gstin, state: stateInput, stateCode: codeInput });
    out.state = place.state;
    out.stateCode = place.stateCode;
  }
  if (input.gstin && !input.pan && !(current?.pan && current.gstin === input.gstin)) out.pan = panFromGstin(input.gstin);
  if (input.accountManagerId !== undefined) {
    if (input.accountManagerId === null) out.accountManagerName = null;
    else {
      const users = await deps.host.users(actor).catch(() => []);
      const user = users.find((u) => u.userId === input.accountManagerId);
      if (!user) throw conflict("That account manager isn't a member of this business");
      out.accountManagerName = user.name ?? user.email ?? `User ${user.userId}`;
    }
  }
  if (input.tags !== undefined) out.tags = [...new Set(input.tags)].join(", ").slice(0, 255) || null;
  if (input.openingBalance === null) out.openingBalance = 0;
  return out;
}

async function assertUniqueGstin(db: Queryable, tenantId: number, gstin: string | null | undefined, exceptId: string | null): Promise<void> {
  if (!gstin) return;
  const dupe = await one<{ id: string; name: string }>(db, `SELECT id, name FROM ims_parties WHERE tenant_id = :tenantId AND gstin = :gstin AND active = 1 AND id <> :exceptId LIMIT 1`, {
    tenantId,
    gstin,
    exceptId: exceptId ?? "",
  });
  if (dupe) throw conflict(`GSTIN ${gstin} is already saved for ${dupe.name}`);
}

/** Creating a supplier from a PO (po) or a customer from an invoice (sales) is allowed without full party rights. */
function requireCreatePerm(res: Response, kind: PartyKind): void {
  if (can(res, "suppliers")) return;
  if ((kind === "supplier" || kind === "both") && can(res, "po")) return;
  if ((kind === "customer" || kind === "both") && can(res, "sales")) return;
  throw forbidden("Your IMS role doesn't allow adding parties (suppliers). Ask an owner to update Settings → Role permissions.");
}

async function insertParty(db: Queryable, actor: ImsActor, values: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const cols = ["id", "tenant_id", "created_by"];
  const vals = [":id", ":tenantId", ":createdBy"];
  const params: Record<string, unknown> = { id, tenantId: actor.tenantId, createdBy: actor.userId };
  for (const [k, v] of Object.entries(values)) {
    if (!COLUMN[k] || v === undefined) continue;
    cols.push(COLUMN[k]);
    vals.push(`:${k}`);
    params[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  await exec(db, `INSERT INTO ims_parties (${cols.join(", ")}) VALUES (${vals.join(", ")})`, params);
  return id;
}

async function updateParty(db: Queryable, tenantId: number, id: string, values: Record<string, unknown>): Promise<string[]> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { tenantId, id };
  for (const [k, v] of Object.entries(values)) {
    if (!COLUMN[k] || v === undefined) continue;
    sets.push(`${COLUMN[k]} = :${k}`);
    params[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  if (sets.length) await exec(db, `UPDATE ims_parties SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
  return Object.keys(values).filter((k) => COLUMN[k]);
}

/** Spreadsheet headers people actually use → API field names. */
const IMPORT_ALIASES: Record<string, keyof PartyInputT> = {
  name: "name",
  partyname: "name",
  suppliername: "name",
  customername: "name",
  company: "name",
  kind: "kind",
  type: "kind",
  contact: "contactPerson",
  contactperson: "contactPerson",
  mobile: "mobile",
  phone: "mobile",
  email: "email",
  gstin: "gstin",
  gst: "gstin",
  gstno: "gstin",
  pan: "pan",
  address: "address",
  city: "city",
  state: "state",
  statecode: "stateCode",
  paymenttermsdays: "paymentTermsDays",
  paymentterms: "paymentTermsDays",
  creditdays: "paymentTermsDays",
  creditlimit: "creditLimit",
  openingbalance: "openingBalance",
  tags: "tags",
  notes: "notes",
};

function importRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = IMPORT_ALIASES[k.toLowerCase().replace(/[^a-z]/g, "")];
    if (!key || v === null || v === undefined) continue;
    let value: unknown = typeof v === "string" ? v.trim() : v;
    if (key === "kind" && typeof value === "string") {
      const s = value.toLowerCase();
      value = s.startsWith("both") ? "both" : s.startsWith("cust") ? "customer" : s.startsWith("vend") || s.startsWith("supp") ? "supplier" : value;
    }
    if (typeof value === "number" && (key === "mobile" || key === "gstin" || key === "pan" || key === "stateCode")) value = String(value);
    out[key] = value;
  }
  return out;
}

export function registerParties(router: Router, deps: ImsDeps): void {
  /** Pickers + the parties screen. `stats=1` adds per-party aggregates. */
  router.get("/parties", async (req, res) => {
    const actor = actorOf(res);
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const kind = qstr(req.query.kind, 10);
    if (kind === "supplier" || kind === "customer") {
      where.push("kind IN (:kind, 'both')");
      params.kind = kind;
    } else if (kind === "both") where.push("kind = 'both'");
    if (req.query.includeInactive !== "1") where.push("active = 1");
    const q = qstr(req.query.q);
    if (q) {
      where.push("(name LIKE :q OR contact_person LIKE :q OR mobile LIKE :q OR gstin LIKE :q OR city LIKE :q OR tags LIKE :q)");
      params.q = likeOf(q);
    }
    const list = (await rows<PartyRow>(deps.db, `SELECT * FROM ims_parties WHERE ${where.join(" AND ")} ORDER BY name LIMIT 5000`, params)).map(mapParty);
    if (req.query.stats !== "1") {
      res.json({ parties: list });
      return;
    }
    const stats = await partyStats(
      deps.db,
      actor.tenantId,
      list.map((p) => p.id),
      new Map(list.map((p) => [p.id, p.openingBalance])),
    );
    res.json({ parties: list.map((p) => ({ ...p, stats: stats.get(p.id)! })), truncated: list.length >= 5000 });
  });

  /** Everything (incl. archived) with aggregates, for CSV / Excel export. */
  router.get("/parties/export", async (_req, res) => {
    const actor = actorOf(res);
    const list = (await rows<PartyRow>(deps.db, `SELECT * FROM ims_parties WHERE tenant_id = :tenantId ORDER BY name LIMIT 20000`, { tenantId: actor.tenantId })).map(mapParty);
    const stats = await partyStats(
      deps.db,
      actor.tenantId,
      list.map((p) => p.id),
      new Map(list.map((p) => [p.id, p.openingBalance])),
    );
    res.json({ parties: list.map((p) => ({ ...p, stats: stats.get(p.id)! })) });
  });

  router.get("/parties/:id", async (req, res) => {
    const actor = actorOf(res);
    const party = await loadParty(deps.db, actor.tenantId, req.params.id);
    if (!party) throw notFound("Party");
    const p = { tenantId: actor.tenantId, id: party.id };
    const [stats, pos, invoices, bills, movements, items] = await Promise.all([
      partyStats(deps.db, actor.tenantId, [party.id], new Map([[party.id, party.openingBalance]])),
      rows<{ id: string; po_no: string; status: string; order_date: string; expected_date: string | null; grand_total: string; lines: unknown }>(
        deps.db,
        `SELECT id, po_no, status, order_date, expected_date, grand_total, JSON_LENGTH(\`lines\`) AS \`lines\` FROM ims_purchase_orders WHERE tenant_id = :tenantId AND supplier_id = :id ORDER BY order_date DESC, created_at DESC LIMIT 25`,
        p,
      ),
      rows<{ id: string; invoice_no: string; status: string; invoice_date: string; due_date: string | null; grand_total: string; amount_paid: string }>(
        deps.db,
        `SELECT id, invoice_no, status, invoice_date, due_date, grand_total, amount_paid FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :id ORDER BY invoice_date DESC, created_at DESC LIMIT 25`,
        p,
      ),
      rows<{ id: string; bill_no: string; supplier_bill_no: string | null; status: string; bill_date: string; due_date: string | null; grand_total: string; amount_paid: string; po_no: string | null }>(
        deps.db,
        `SELECT id, bill_no, supplier_bill_no, status, bill_date, due_date, grand_total, amount_paid, po_no FROM ims_bills WHERE tenant_id = :tenantId AND supplier_id = :id ORDER BY bill_date DESC, created_at DESC LIMIT 25`,
        p,
      ),
      rows<{ id: string; item_id: string; item_name: string; type: string; qty: string; value: string; ref_no: string | null; movement_date: string; actor_name: string | null; created_at: string }>(
        deps.db,
        `SELECT id, item_id, item_name, type, qty, value, ref_no, movement_date, actor_name, created_at FROM ims_movements WHERE tenant_id = :tenantId AND party_id = :id ORDER BY created_at DESC LIMIT 30`,
        p,
      ),
      rows<{ id: string; name: string; sku: string | null; unit: string; current_stock: string; min_stock: string; max_stock: string | null; purchase_price: string; gst_rate: string }>(
        deps.db,
        `SELECT id, name, sku, unit, current_stock, min_stock, max_stock, purchase_price, gst_rate FROM ims_items WHERE tenant_id = :tenantId AND supplier_id = :id AND active = 1 ORDER BY name LIMIT 500`,
        p,
      ),
    ]);
    res.json({
      party: { ...party, stats: stats.get(party.id)! },
      purchaseOrders: pos.map((r) => ({ id: r.id, poNo: r.po_no, status: r.status, orderDate: isoOf(r.order_date), expectedDate: r.expected_date ? isoOf(r.expected_date) : null, grandTotal: round2(money(r.grand_total)), lineCount: Number(r.lines) || 0 })),
      invoices: invoices.map((r) => ({
        id: r.id,
        invoiceNo: r.invoice_no,
        status: r.status,
        invoiceDate: isoOf(r.invoice_date),
        dueDate: r.due_date ? isoOf(r.due_date) : null,
        grandTotal: round2(money(r.grand_total)),
        amountPaid: round2(money(r.amount_paid)),
      })),
      bills: bills.map((r) => ({
        id: r.id,
        billNo: r.bill_no,
        supplierBillNo: r.supplier_bill_no,
        status: r.status,
        billDate: isoOf(r.bill_date),
        dueDate: r.due_date ? isoOf(r.due_date) : null,
        grandTotal: round2(money(r.grand_total)),
        amountPaid: round2(money(r.amount_paid)),
        poNo: r.po_no,
      })),
      movements: movements.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        itemName: r.item_name,
        type: r.type,
        qty: round3(money(r.qty)),
        value: round2(money(r.value)),
        refNo: r.ref_no,
        date: isoOf(r.movement_date),
        actorName: r.actor_name,
        createdAt: tsOf(r.created_at),
      })),
      items: items.map((r) => {
        const current = round3(money(r.current_stock));
        const min = round3(money(r.min_stock));
        return {
          id: r.id,
          name: r.name,
          sku: r.sku,
          unit: r.unit,
          currentStock: current,
          minStock: min,
          purchasePrice: round2(money(r.purchase_price)),
          gstRate: money(r.gst_rate),
          status: stockStatus(current, min, r.max_stock == null ? null : money(r.max_stock)),
        };
      }),
    });
  });

  router.post("/parties", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(PartyInput, req.body);
    requireCreatePerm(res, input.kind);
    const values = await normalizeParty(deps, actor, input, null);
    await assertUniqueGstin(deps.db, actor.tenantId, input.gstin, null);
    const id = await insertParty(deps.db, actor, values);
    await recordEvent(deps, actor, { type: "party.created", entityType: "party", entityId: id, summary: `Added ${input.kind === "both" ? "supplier & customer" : input.kind} ${input.name}` });
    res.status(201).json({ party: await loadParty(deps.db, actor.tenantId, id) });
  });

  /** Upserts by GSTIN, then by exact name. */
  router.post("/parties/bulk", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "suppliers");
    const body = parse(z.object({ parties: z.array(z.record(z.string(), z.unknown())).min(1).max(5000), defaultKind: z.enum(PARTY_KINDS).optional() }), req.body);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    for (const [idx, raw] of body.parties.entries()) {
      const mapped = importRow(raw);
      if (!mapped.kind && body.defaultKind) mapped.kind = body.defaultKind;
      const result = PartyInput.safeParse(mapped);
      if (!result.success) {
        errors.push(`Row ${idx + 2}: ${result.error.issues.map((i) => `${i.path.join(".") || "row"} ${i.message}`).join(", ")}`);
        continue;
      }
      const input = result.data;
      try {
        const existing =
          (input.gstin ? await one<PartyRow>(deps.db, `SELECT * FROM ims_parties WHERE tenant_id = :tenantId AND gstin = :gstin LIMIT 1`, { tenantId: actor.tenantId, gstin: input.gstin }) : null) ??
          (await one<PartyRow>(deps.db, `SELECT * FROM ims_parties WHERE tenant_id = :tenantId AND LOWER(name) = LOWER(:name) LIMIT 1`, { tenantId: actor.tenantId, name: input.name }));
        if (existing) {
          const current = mapParty(existing);
          const sent = Object.fromEntries(Object.entries(input).filter(([k]) => mapped[k] !== undefined)) as Partial<PartyInputT>;
          if (sent.kind && sent.kind !== current.kind && current.kind !== "both") sent.kind = "both";
          await updateParty(deps.db, actor.tenantId, current.id, { ...(await normalizeParty(deps, actor, sent, current)), active: true });
          updated += 1;
        } else {
          await insertParty(deps.db, actor, await normalizeParty(deps, actor, input, null));
          created += 1;
        }
      } catch (err) {
        errors.push(`Row ${idx + 2}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    await recordEvent(deps, actor, {
      type: "party.imported",
      entityType: "party",
      entityId: "bulk",
      summary: `Imported parties: ${created} new, ${updated} updated${errors.length ? `, ${errors.length} skipped` : ""}`,
    });
    res.json({ created, updated, errors: errors.slice(0, 100) });
  });

  router.patch("/parties/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "suppliers");
    const current = await loadParty(deps.db, actor.tenantId, req.params.id);
    if (!current) throw notFound("Party");
    const patch = parsePatch(PartyInput, req.body);
    const values = await normalizeParty(deps, actor, patch, current);
    if (patch.gstin) await assertUniqueGstin(deps.db, actor.tenantId, patch.gstin, current.id);
    const fields = await updateParty(deps.db, actor.tenantId, current.id, values);
    if (fields.length) {
      const restored = patch.active === true && !current.active;
      const archived = patch.active === false && current.active;
      await recordEvent(deps, actor, {
        type: restored ? "party.restored" : archived ? "party.archived" : "party.updated",
        entityType: "party",
        entityId: current.id,
        summary: `${restored ? "Restored" : archived ? "Archived" : "Updated"} ${patch.name ?? current.name}`,
        payload: { fields },
      });
    }
    res.json({ party: await loadParty(deps.db, actor.tenantId, current.id) });
  });

  /** Parties with any history are archived (kept for documents and reports); unused ones are deleted. */
  router.delete("/parties/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "suppliers");
    const party = await loadParty(deps.db, actor.tenantId, req.params.id);
    if (!party) throw notFound("Party");
    const p = { tenantId: actor.tenantId, id: party.id };
    const used = await one<{ n: number }>(
      deps.db,
      `SELECT
         (SELECT COUNT(*) FROM ims_items WHERE tenant_id = :tenantId AND supplier_id = :id) +
         (SELECT COUNT(*) FROM ims_purchase_orders WHERE tenant_id = :tenantId AND supplier_id = :id) +
         (SELECT COUNT(*) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :id) +
         (SELECT COUNT(*) FROM ims_bills WHERE tenant_id = :tenantId AND supplier_id = :id) +
         (SELECT COUNT(*) FROM ims_movements WHERE tenant_id = :tenantId AND party_id = :id) +
         (SELECT COUNT(*) FROM ims_payments WHERE tenant_id = :tenantId AND party_id = :id) AS n`,
      p,
    );
    if (Number(used?.n) > 0 || party.openingBalance !== 0) {
      await exec(deps.db, `UPDATE ims_parties SET active = 0 WHERE tenant_id = :tenantId AND id = :id`, p);
      await recordEvent(deps, actor, { type: "party.archived", entityType: "party", entityId: party.id, summary: `Archived ${party.name}` });
      res.json({ archived: true });
      return;
    }
    await tx(deps.db, async (conn) => {
      await exec(conn, `DELETE FROM ims_links WHERE tenant_id = :tenantId AND target_type = 'party' AND target_id = :id`, p);
      await exec(conn, `DELETE FROM ims_parties WHERE tenant_id = :tenantId AND id = :id`, p);
    });
    await recordEvent(deps, actor, { type: "party.deleted", entityType: "party", entityId: party.id, summary: `Deleted ${party.name}` });
    res.status(204).end();
  });
}
