import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, isoDate, optText, parse, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { ImsError, badRequest, conflict, notFound, type ImsActor } from "./host.js";
import {
  OPEN_PO_STATUSES,
  PO_STATUSES,
  addDaysISO,
  applyPoReceipt,
  canMovePo,
  computeTotals,
  dueDateFor,
  formatINR,
  isIntraStateSupply,
  monthStartISO,
  netUnitCost,
  periodRange,
  poNeedsApproval,
  poOverdue,
  poReceiptStatus,
  poRemaining,
  poShareText,
  receiptBillLines,
  reorderQty,
  round2,
  round3,
  todayISO,
  waNumber,
  type ImsLine,
  type ImsLineInput,
  type PoReceipt,
  type PoStatus,
} from "./logic.js";
import { loadParty, type ImsParty } from "./parties.js";
import { getSettings, type ImsSettings } from "./settings.js";
import { nextDocNo, postMovement, type PostedMovement } from "./stock.js";

/* ---------- Shapes ---------- */

type PoRow = {
  id: string;
  po_no: string;
  status: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_snapshot: unknown;
  business_snapshot: unknown;
  order_date: string;
  expected_date: string | null;
  delivery_address: string | null;
  payment_terms_days: number | null;
  intra_state: number;
  lines: unknown;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  cgst: string;
  sgst: string;
  igst: string;
  grand_total: string;
  terms: string | null;
  notes: string | null;
  approval_note: string | null;
  submitted_at: string | null;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  sent_at: string | null;
  sent_via: string | null;
  received_at: string | null;
  bill_id: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type PoPartySnapshot = {
  name: string;
  contactPerson?: string | null;
  mobile?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  phone?: string | null;
};

export type PoLine = ImsLine & { receivedQty: number };

const statusOf = (v: string): PoStatus => ((PO_STATUSES as readonly string[]).includes(v) ? (v as PoStatus) : "draft");

function mapPo(r: PoRow, today = todayISO()) {
  const lines = json<PoLine[]>(r.lines, []).map((l) => ({ ...l, receivedQty: round3(Number(l.receivedQty) || 0) }));
  const ordered = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const received = lines.reduce((s, l) => s + Math.min(Number(l.qty) || 0, l.receivedQty), 0);
  const receivedValue = round2(lines.reduce((s, l) => s + (Number(l.qty) > 0 ? (Number(l.amount) || 0) * Math.min(1, l.receivedQty / Number(l.qty)) : 0), 0));
  const expectedDate = r.expected_date ? isoOf(r.expected_date) : null;
  const status = statusOf(r.status);
  return {
    id: r.id,
    poNo: r.po_no,
    status,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplier: json<PoPartySnapshot>(r.supplier_snapshot, { name: r.supplier_name }),
    business: json<PoPartySnapshot>(r.business_snapshot, { name: "" }),
    orderDate: isoOf(r.order_date),
    expectedDate,
    deliveryAddress: r.delivery_address,
    paymentTermsDays: r.payment_terms_days == null ? null : Number(r.payment_terms_days),
    intraState: Boolean(r.intra_state),
    lines,
    lineCount: lines.length,
    subtotal: round2(money(r.subtotal)),
    discountTotal: round2(money(r.discount_total)),
    taxable: round2(money(r.subtotal) - money(r.discount_total)),
    taxTotal: round2(money(r.tax_total)),
    cgst: round2(money(r.cgst)),
    sgst: round2(money(r.sgst)),
    igst: round2(money(r.igst)),
    grandTotal: round2(money(r.grand_total)),
    receivedPct: ordered > 0 ? Math.round((received / ordered) * 100) : 0,
    receivedValue,
    overdue: poOverdue({ status, expectedDate }, today),
    terms: r.terms,
    notes: r.notes,
    approvalNote: r.approval_note,
    submittedAt: tsOf(r.submitted_at),
    decidedByName: r.decided_by_name,
    decidedAt: tsOf(r.decided_at),
    sentAt: tsOf(r.sent_at),
    sentVia: r.sent_via,
    receivedAt: tsOf(r.received_at),
    billId: r.bill_id,
    createdBy: r.created_by == null ? null : Number(r.created_by),
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
  };
}
export type ImsPurchaseOrder = ReturnType<typeof mapPo>;

async function loadPoRow(db: Queryable, tenantId: number, id: string, lock = false): Promise<PoRow> {
  const r = await one<PoRow>(db, `SELECT * FROM ims_purchase_orders WHERE tenant_id = :tenantId AND id = :id LIMIT 1${lock ? " FOR UPDATE" : ""}`, { tenantId, id });
  if (!r) throw notFound("Purchase order");
  return r;
}

async function getPo(db: Queryable, tenantId: number, id: string): Promise<ImsPurchaseOrder> {
  return mapPo(await loadPoRow(db, tenantId, id));
}

/* ---------- Input ---------- */

const LineInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Item name is required").max(200),
  sku: optText(64),
  hsn: optText(20),
  unit: optText(20),
  qty: z.coerce.number().positive("Quantity must be more than zero").max(1e9),
  rate: z.coerce.number().min(0).max(1e10),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  gstRate: z.coerce.number().min(0).max(100),
});

const PoInput = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  supplierName: z.string().trim().max(200).optional(),
  orderDate: isoDate.optional(),
  expectedDate: isoDate.nullable().optional(),
  deliveryAddress: optText(500),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  lines: z.array(LineInput).min(1, "Add at least one item").max(300),
  terms: optText(4000),
  notes: optText(2000),
  action: z.enum(["draft", "submit", "send"]).default("draft"),
});
type PoInputT = z.infer<typeof PoInput>;

const ReceiveInput = z.object({
  lines: z
    .array(
      z.object({
        lineIndex: z.coerce.number().int().min(0).optional(),
        itemId: z.string().uuid().optional(),
        qty: z.coerce.number().min(0).max(1e9),
        unitCost: z.coerce.number().min(0).max(1e10).nullable().optional(),
      }),
    )
    .min(1, "Enter what arrived")
    .max(300),
  date: isoDate.optional(),
  supplierBillNo: optText(64),
  supplierBillDate: isoDate.nullable().optional(),
  notes: optText(500),
  createBill: z.boolean().default(true),
});

/* ---------- Building a PO ---------- */

const businessSnapshot = (s: ImsSettings): PoPartySnapshot => ({
  name: s.businessName,
  gstin: s.gstin,
  address: s.address,
  state: s.state,
  stateCode: s.stateCode,
  phone: s.phone,
  email: s.email,
});

const supplierSnapshot = (p: ImsParty): PoPartySnapshot => ({
  name: p.name,
  contactPerson: p.contactPerson,
  mobile: p.mobile,
  email: p.email,
  gstin: p.gstin,
  address: p.address,
  city: p.city,
  state: p.state,
  stateCode: p.stateCode,
});

type BuiltPo = {
  supplierId: string | null;
  supplierName: string;
  supplier: PoPartySnapshot;
  business: PoPartySnapshot;
  orderDate: string;
  expectedDate: string | null;
  deliveryAddress: string | null;
  paymentTermsDays: number | null;
  intraState: boolean;
  lines: PoLine[];
  totals: ReturnType<typeof computeTotals>;
  terms: string | null;
  notes: string | null;
};

async function buildPo(deps: ImsDeps, actor: ImsActor, input: PoInputT, settings: ImsSettings, keepReceived?: ReadonlyArray<PoLine>): Promise<BuiltPo> {
  let party: ImsParty | null = null;
  if (input.supplierId) {
    party = await loadParty(deps.db, actor.tenantId, input.supplierId);
    if (!party || !party.active) throw badRequest("Pick an active supplier");
    if (party.kind === "customer") throw badRequest(`${party.name} is saved as a customer — mark them as a supplier first`);
  }
  const supplierName = party?.name ?? input.supplierName?.trim() ?? "";
  if (!supplierName) throw badRequest("Choose a supplier", ["supplierId: Choose a supplier"]);
  const orderDate = input.orderDate ?? todayISO();
  const expectedDate = input.expectedDate ?? null;
  if (expectedDate && expectedDate < orderDate) throw badRequest("Expected delivery can't be before the order date", ["expectedDate: Must be on or after the order date"]);

  const itemIds = [...new Set(input.lines.map((l) => l.itemId).filter((v): v is string => Boolean(v)))];
  if (itemIds.length) {
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const found = await rows<{ id: string }>(
      deps.db,
      `SELECT id FROM ims_items WHERE tenant_id = :tenantId AND id IN (${itemIds
        .map((id, i) => {
          params[`i${i}`] = id;
          return `:i${i}`;
        })
        .join(", ")})`,
      params,
    );
    const known = new Set(found.map((f) => f.id));
    const missing = input.lines.filter((l) => l.itemId && !known.has(l.itemId));
    if (missing.length) throw badRequest(`Some items no longer exist: ${missing.map((m) => m.name).join(", ")}`);
  }

  const supplier = party ? supplierSnapshot(party) : { name: supplierName };
  const intraState = isIntraStateSupply({ state: settings.state, stateCode: settings.stateCode }, { state: supplier.state, stateCode: supplier.stateCode });
  const lineInputs: ImsLineInput[] = input.lines.map((l, i) => ({ ...l, receivedQty: keepReceived?.[i]?.receivedQty ?? 0 }));
  const totals = computeTotals(lineInputs, intraState);
  return {
    supplierId: party?.id ?? null,
    supplierName,
    supplier,
    business: businessSnapshot(settings),
    orderDate,
    expectedDate,
    deliveryAddress: input.deliveryAddress?.trim() || settings.address || null,
    paymentTermsDays: input.paymentTermsDays ?? party?.paymentTermsDays ?? settings.paymentTermsDays,
    intraState,
    lines: totals.lines.map((l) => ({ ...l, receivedQty: l.receivedQty ?? 0 })),
    totals,
    terms: input.terms === undefined ? settings.terms : input.terms?.trim() || null,
    notes: input.notes?.trim() || null,
  };
}

const builtParams = (b: BuiltPo) => ({
  supplierId: b.supplierId,
  supplierName: b.supplierName,
  supplierSnapshot: JSON.stringify(b.supplier),
  businessSnapshot: JSON.stringify(b.business),
  orderDate: b.orderDate,
  expectedDate: b.expectedDate,
  deliveryAddress: b.deliveryAddress,
  paymentTermsDays: b.paymentTermsDays,
  intraState: b.intraState ? 1 : 0,
  lines: JSON.stringify(b.lines),
  subtotal: b.totals.subtotal,
  discountTotal: b.totals.discountTotal,
  taxTotal: b.totals.taxTotal,
  cgst: b.totals.cgst,
  sgst: b.totals.sgst,
  igst: b.totals.igst,
  grandTotal: b.totals.grandTotal,
  terms: b.terms,
  notes: b.notes,
});

/** Submit: below the approval limit a PO is approved straight away; at or above it waits for an approver. */
function submitOutcome(grandTotal: number, settings: ImsSettings): { status: "approved" | "pending_approval"; note: string | null } {
  if (poNeedsApproval(grandTotal, settings.poApprovalLimit)) return { status: "pending_approval", note: null };
  return { status: "approved", note: settings.poApprovalLimit > 0 ? `Auto-approved — below the ${formatINR(settings.poApprovalLimit)} approval limit` : "Auto-approved — no approval limit set" };
}

/** Moves a PO only if it is still in `from` (guards against two people acting at once). */
async function move(db: Queryable, tenantId: number, id: string, from: string, to: PoStatus, sets: string[] = [], params: Record<string, unknown> = {}): Promise<void> {
  if (!canMovePo(from, to)) throw conflict(`A ${from.replace(/_/g, " ")} purchase order can't be ${to.replace(/_/g, " ")}`);
  const res = await exec(db, `UPDATE ims_purchase_orders SET status = :to${sets.length ? `, ${sets.join(", ")}` : ""} WHERE tenant_id = :tenantId AND id = :id AND status = :from`, {
    ...params,
    tenantId,
    id,
    from,
    to,
  });
  if (!res.affectedRows) throw conflict("This purchase order changed in the meantime — reload and try again");
}

function share(po: ImsPurchaseOrder) {
  const text = poShareText({
    poNo: po.poNo,
    orderDate: po.orderDate,
    expectedDate: po.expectedDate,
    businessName: po.business.name,
    businessGstin: po.business.gstin,
    supplierName: po.supplierName,
    lines: po.lines,
    grandTotal: po.grandTotal,
    deliveryAddress: po.deliveryAddress,
    paymentTermsDays: po.paymentTermsDays,
  });
  const subject = `Purchase order ${po.poNo} from ${po.business.name || "us"}`;
  const wa = waNumber(po.supplier.mobile);
  return {
    text,
    subject,
    whatsappUrl: `https://wa.me/${wa ?? ""}?text=${encodeURIComponent(text)}`,
    mailto: `mailto:${encodeURIComponent(po.supplier.email ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
  };
}

/** Lazily deletes drafts nobody touched for `draftPoPurgeDays` (runs when the list loads). */
async function purgeStaleDrafts(deps: ImsDeps, actor: ImsActor, days: number): Promise<void> {
  if (!(days > 0)) return;
  const res = await exec(
    deps.db,
    `DELETE FROM ims_purchase_orders WHERE tenant_id = :tenantId AND status = 'draft' AND updated_at < (CURRENT_TIMESTAMP - INTERVAL :days DAY)`,
    { tenantId: actor.tenantId, days },
  );
  if (res.affectedRows) {
    await recordEvent(deps, actor, {
      type: "po.purged",
      entityType: "po",
      entityId: "drafts",
      summary: `Auto-deleted ${res.affectedRows} draft purchase order${res.affectedRows === 1 ? "" : "s"} older than ${days} days`,
    });
  }
}

type BillRow = { id: string; bill_no: string; supplier_bill_no: string | null; status: string; bill_date: string; due_date: string | null; grand_total: string; amount_paid: string; created_at: string };
const mapBill = (b: BillRow) => ({
  id: b.id,
  billNo: b.bill_no,
  supplierBillNo: b.supplier_bill_no,
  status: b.status,
  billDate: isoOf(b.bill_date),
  dueDate: b.due_date ? isoOf(b.due_date) : null,
  grandTotal: round2(money(b.grand_total)),
  amountPaid: round2(money(b.amount_paid)),
  createdAt: tsOf(b.created_at),
});

const READ_PERMS = ["po", "approvals", "stockIn", "payables", "reports"] as const;

export function registerPurchase(router: Router, deps: ImsDeps): void {
  router.get("/purchase-orders", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, READ_PERMS);
    const settings = await getSettings(deps, actor.tenantId);
    await purgeStaleDrafts(deps, actor, settings.draftPoPurgeDays).catch(() => undefined);
    const today = todayISO();
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const status = qstr(req.query.status, 24);
    if (status === "open") where.push(`status IN (${OPEN_PO_STATUSES.map((s) => `'${s}'`).join(", ")})`);
    else if (status === "overdue") {
      where.push("status IN ('approved', 'sent', 'partially_received') AND expected_date < :today");
      params.today = today;
    } else if ((PO_STATUSES as readonly string[]).includes(status)) {
      where.push("status = :status");
      params.status = status;
    }
    const supplierId = qstr(req.query.supplierId, 36);
    if (supplierId) {
      where.push("supplier_id = :supplierId");
      params.supplierId = supplierId;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(po_no LIKE :q OR supplier_name LIKE :q OR notes LIKE :q)");
      params.q = likeOf(q);
    }
    const period = qstr(req.query.period, 12);
    if (period && period !== "all") {
      const range = periodRange(period, today, settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) });
      where.push("order_date BETWEEN :from AND :to");
      Object.assign(params, range);
    }
    const list = await rows<PoRow>(deps.db, `SELECT * FROM ims_purchase_orders WHERE ${where.join(" AND ")} ORDER BY order_date DESC, created_at DESC LIMIT 1000`, params);

    const base = { tenantId: actor.tenantId, today, weekEnd: addDaysISO(today, 7), monthStart: monthStartISO(today) };
    const [byStatus, due, receivedMonth] = await Promise.all([
      rows<{ status: string; n: number; v: string }>(deps.db, `SELECT status, COUNT(*) AS n, SUM(grand_total) AS v FROM ims_purchase_orders WHERE tenant_id = :tenantId GROUP BY status`, base),
      one<{ week: number; overdue: number }>(
        deps.db,
        `SELECT
           SUM(CASE WHEN expected_date BETWEEN :today AND :weekEnd THEN 1 ELSE 0 END) AS week,
           SUM(CASE WHEN expected_date < :today THEN 1 ELSE 0 END) AS overdue
         FROM ims_purchase_orders WHERE tenant_id = :tenantId AND status IN ('approved', 'sent', 'partially_received')`,
        base,
      ),
      one<{ v: string | null; n: number }>(
        deps.db,
        `SELECT SUM(value) AS v, COUNT(DISTINCT ref_id) AS n FROM ims_movements WHERE tenant_id = :tenantId AND type = 'IN' AND ref_type = 'po' AND movement_date >= :monthStart`,
        base,
      ),
    ]);
    const counts = Object.fromEntries(PO_STATUSES.map((s) => [s, 0])) as Record<PoStatus, number>;
    let openValue = 0;
    let awaitingValue = 0;
    for (const s of byStatus) {
      const key = statusOf(s.status);
      counts[key] += Number(s.n);
      if ((OPEN_PO_STATUSES as readonly string[]).includes(key)) openValue += money(s.v);
      if (key === "pending_approval") awaitingValue += money(s.v);
    }
    res.json({
      orders: list.map((r) => mapPo(r, today)),
      summary: {
        counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        openValue: round2(openValue),
        awaitingApproval: counts.pending_approval,
        awaitingValue: round2(awaitingValue),
        dueThisWeek: Number(due?.week ?? 0),
        overdue: Number(due?.overdue ?? 0),
        receivedThisMonth: round2(money(receivedMonth?.v)),
        receivedPosThisMonth: Number(receivedMonth?.n ?? 0),
      },
      approvalLimit: settings.poApprovalLimit,
      draftPurgeDays: settings.draftPoPurgeDays,
    });
  });

  /** Suggested PO lines from low-stock items of one supplier (`none` = items without a preferred supplier). */
  router.get("/purchase-orders/reorder-draft", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["po", "approvals"]);
    const supplierId = qstr(req.query.supplierId, 36) || "none";
    const supplier = supplierId === "none" ? null : await loadParty(deps.db, actor.tenantId, supplierId);
    if (supplierId !== "none" && !supplier) throw notFound("Supplier");
    const items = await rows<{
      id: string;
      name: string;
      sku: string | null;
      hsn: string | null;
      unit: string;
      gst_rate: string;
      purchase_price: string;
      current_stock: string;
      min_stock: string;
      max_stock: string | null;
      reorder_qty: string | null;
    }>(
      deps.db,
      `SELECT id, name, sku, hsn, unit, gst_rate, purchase_price, current_stock, min_stock, max_stock, reorder_qty
       FROM ims_items WHERE tenant_id = :tenantId AND active = 1 AND current_stock <= min_stock AND ${supplier ? "supplier_id = :supplierId" : "supplier_id IS NULL"}
       ORDER BY current_stock / NULLIF(min_stock, 0), name LIMIT 300`,
      { tenantId: actor.tenantId, supplierId: supplier?.id ?? null },
    );
    const lines = items
      .map((i) => {
        const current = round3(money(i.current_stock));
        const qty = reorderQty({ current, min: money(i.min_stock), max: i.max_stock == null ? null : money(i.max_stock), reorderQty: i.reorder_qty == null ? null : money(i.reorder_qty) });
        return {
          itemId: i.id,
          name: i.name,
          sku: i.sku,
          hsn: i.hsn,
          unit: i.unit,
          qty: Math.max(1, Math.ceil(qty)),
          rate: round2(money(i.purchase_price)),
          discountPct: 0,
          gstRate: money(i.gst_rate),
          currentStock: current,
          minStock: round3(money(i.min_stock)),
        };
      })
      .filter((l) => l.qty > 0);
    res.json({ supplier, lines });
  });

  router.get("/purchase-orders/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, READ_PERMS);
    const order = await getPo(deps.db, actor.tenantId, req.params.id);
    const [bills, receipts] = await Promise.all([
      rows<BillRow>(
        deps.db,
        `SELECT id, bill_no, supplier_bill_no, status, bill_date, due_date, grand_total, amount_paid, created_at FROM ims_bills WHERE tenant_id = :tenantId AND po_id = :id ORDER BY created_at DESC`,
        { tenantId: actor.tenantId, id: order.id },
      ),
      rows<{ id: string; item_id: string; item_name: string; qty: string; unit_cost: string | null; value: string; movement_date: string; actor_name: string | null; created_at: string }>(
        deps.db,
        `SELECT id, item_id, item_name, qty, unit_cost, value, movement_date, actor_name, created_at FROM ims_movements WHERE tenant_id = :tenantId AND ref_type = 'po' AND ref_id = :id ORDER BY created_at DESC`,
        { tenantId: actor.tenantId, id: order.id },
      ),
    ]);
    const settings = await getSettings(deps, actor.tenantId);
    res.json({
      order,
      bills: bills.map(mapBill),
      receipts: receipts.map((m) => ({
        id: m.id,
        itemId: m.item_id,
        itemName: m.item_name,
        qty: round3(money(m.qty)),
        unitCost: m.unit_cost == null ? null : round2(money(m.unit_cost)),
        value: round2(money(m.value)),
        date: isoOf(m.movement_date),
        actorName: m.actor_name,
        createdAt: tsOf(m.created_at),
      })),
      share: share(order),
      approvalLimit: settings.poApprovalLimit,
    });
  });

  router.post("/purchase-orders", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "po");
    const input = parse(PoInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const built = await buildPo(deps, actor, input, settings);
    const id = randomUUID();
    const poNo = await nextDocNo(deps.db, actor.tenantId, "po", settings.poPrefix, built.orderDate, settings.fiscalYearStart);
    const outcome = input.action === "draft" ? null : submitOutcome(built.totals.grandTotal, settings);
    const status: PoStatus = !outcome ? "draft" : outcome.status === "approved" && input.action === "send" ? "sent" : outcome.status;
    await exec(
      deps.db,
      `INSERT INTO ims_purchase_orders
         (id, tenant_id, po_no, status, supplier_id, supplier_name, supplier_snapshot, business_snapshot, order_date, expected_date, delivery_address,
          payment_terms_days, intra_state, \`lines\`, subtotal, discount_total, tax_total, cgst, sgst, igst, grand_total, terms, notes, approval_note,
          submitted_at, decided_at, sent_at, sent_via, created_by, created_by_name)
       VALUES
         (:id, :tenantId, :poNo, :status, :supplierId, :supplierName, :supplierSnapshot, :businessSnapshot, :orderDate, :expectedDate, :deliveryAddress,
          :paymentTermsDays, :intraState, :lines, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :grandTotal, :terms, :notes, :approvalNote,
          ${outcome ? "CURRENT_TIMESTAMP" : "NULL"}, ${outcome?.status === "approved" ? "CURRENT_TIMESTAMP" : "NULL"}, ${status === "sent" ? "CURRENT_TIMESTAMP" : "NULL"}, :sentVia, :userId, :userName)`,
      {
        ...builtParams(built),
        id,
        tenantId: actor.tenantId,
        poNo,
        status,
        approvalNote: outcome?.note ?? null,
        sentVia: status === "sent" ? "manual" : null,
        userId: actor.userId,
        userName: actorName(actor),
      },
    );
    await recordEvent(deps, actor, {
      type: "po.created",
      entityType: "po",
      entityId: id,
      summary: `${status === "draft" ? "Drafted" : "Raised"} ${poNo} for ${built.supplierName} · ${formatINR(built.totals.grandTotal)}`,
      payload: { status, grandTotal: built.totals.grandTotal },
    });
    if (status === "pending_approval") await notifyApprovalRequested(deps, actor, id, poNo, built.supplierName, built.totals.grandTotal);
    const order = await getPo(deps.db, actor.tenantId, id);
    res.status(201).json({ order, share: status === "sent" ? share(order) : null });
  });

  /** Edits a draft or rejected PO (a rejected one goes back to draft unless re-submitted). */
  router.put("/purchase-orders/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "po");
    const row = await loadPoRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "draft" && row.status !== "rejected") throw conflict("Only draft or rejected purchase orders can be edited — duplicate it to raise a new one");
    const input = parse(PoInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const built = await buildPo(deps, actor, input, settings);
    const outcome = input.action === "draft" ? null : submitOutcome(built.totals.grandTotal, settings);
    const status: PoStatus = !outcome ? "draft" : outcome.status === "approved" && input.action === "send" ? "sent" : outcome.status;
    const res2 = await exec(
      deps.db,
      `UPDATE ims_purchase_orders SET
         status = :status, supplier_id = :supplierId, supplier_name = :supplierName, supplier_snapshot = :supplierSnapshot, business_snapshot = :businessSnapshot,
         order_date = :orderDate, expected_date = :expectedDate, delivery_address = :deliveryAddress, payment_terms_days = :paymentTermsDays, intra_state = :intraState,
         \`lines\` = :lines, subtotal = :subtotal, discount_total = :discountTotal, tax_total = :taxTotal, cgst = :cgst, sgst = :sgst, igst = :igst, grand_total = :grandTotal,
         terms = :terms, notes = :notes, approval_note = :approvalNote, decided_by = NULL, decided_by_name = NULL,
         submitted_at = ${outcome ? "CURRENT_TIMESTAMP" : "NULL"}, decided_at = ${outcome?.status === "approved" ? "CURRENT_TIMESTAMP" : "NULL"},
         sent_at = ${status === "sent" ? "CURRENT_TIMESTAMP" : "NULL"}, sent_via = :sentVia
       WHERE tenant_id = :tenantId AND id = :id AND status = :from`,
      {
        ...builtParams(built),
        id: row.id,
        tenantId: actor.tenantId,
        from: row.status,
        status,
        approvalNote: outcome?.note ?? null,
        sentVia: status === "sent" ? "manual" : null,
      },
    );
    if (!res2.affectedRows) throw conflict("This purchase order changed in the meantime — reload and try again");
    await recordEvent(deps, actor, {
      type: "po.updated",
      entityType: "po",
      entityId: row.id,
      summary: `Updated ${row.po_no}${status !== row.status ? ` → ${status.replace(/_/g, " ")}` : ""} · ${formatINR(built.totals.grandTotal)}`,
      payload: { status, grandTotal: built.totals.grandTotal },
    });
    if (status === "pending_approval") await notifyApprovalRequested(deps, actor, row.id, row.po_no, built.supplierName, built.totals.grandTotal);
    const order = await getPo(deps.db, actor.tenantId, row.id);
    res.json({ order, share: status === "sent" ? share(order) : null });
  });

  router.post("/purchase-orders/:id/submit", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "po");
    const row = await loadPoRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "draft" && row.status !== "rejected") throw conflict("Only drafts and rejected purchase orders can be submitted");
    const settings = await getSettings(deps, actor.tenantId);
    const outcome = submitOutcome(money(row.grand_total), settings);
    if (row.status === "rejected") await move(deps.db, actor.tenantId, row.id, "rejected", "draft");
    await move(deps.db, actor.tenantId, row.id, "draft", outcome.status, [
      "submitted_at = CURRENT_TIMESTAMP",
      "approval_note = :note",
      "decided_by = NULL",
      "decided_by_name = NULL",
      `decided_at = ${outcome.status === "approved" ? "CURRENT_TIMESTAMP" : "NULL"}`,
    ], { note: outcome.note });
    await recordEvent(deps, actor, {
      type: outcome.status === "approved" ? "po.auto_approved" : "po.submitted",
      entityType: "po",
      entityId: row.id,
      summary: outcome.status === "approved" ? `${row.po_no} approved automatically (below limit)` : `Sent ${row.po_no} for approval · ${formatINR(money(row.grand_total))}`,
    });
    if (outcome.status === "pending_approval") await notifyApprovalRequested(deps, actor, row.id, row.po_no, row.supplier_name, money(row.grand_total));
    res.json({ order: await getPo(deps.db, actor.tenantId, row.id) });
  });

  router.post("/purchase-orders/bulk-approve", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const { ids, note } = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(100), note: optText(500) }), req.body);
    let approved = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await decide(deps, actor, id, "approved", note ?? null);
        approved += 1;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "failed");
      }
    }
    res.json({ approved, errors });
  });

  router.post("/purchase-orders/:id/approve", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const { note } = parse(z.object({ note: optText(500) }), req.body);
    res.json({ order: await decide(deps, actor, req.params.id, "approved", note ?? null) });
  });

  router.post("/purchase-orders/:id/reject", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, "Give a short reason so the requester can fix it").max(500) }), req.body);
    res.json({ order: await decide(deps, actor, req.params.id, "rejected", reason) });
  });

  /** Marks an approved PO as sent (or records a re-send) and returns ready-to-share text. */
  router.post("/purchase-orders/:id/send", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "po");
    const { via } = parse(z.object({ via: z.enum(["whatsapp", "email", "print", "manual"]).default("manual") }), req.body);
    const row = await loadPoRow(deps.db, actor.tenantId, req.params.id);
    if (row.status === "approved") await move(deps.db, actor.tenantId, row.id, "approved", "sent", ["sent_at = CURRENT_TIMESTAMP", "sent_via = :via"], { via });
    else if (row.status === "sent" || row.status === "partially_received") {
      await exec(deps.db, `UPDATE ims_purchase_orders SET sent_at = CURRENT_TIMESTAMP, sent_via = :via WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id, via });
    } else throw conflict(row.status === "pending_approval" ? "This purchase order is still waiting for approval" : `A ${row.status.replace(/_/g, " ")} purchase order can't be sent`);
    await recordEvent(deps, actor, { type: "po.sent", entityType: "po", entityId: row.id, summary: `${row.status === "approved" ? "Sent" : "Re-sent"} ${row.po_no} to ${row.supplier_name} via ${via}` });
    const order = await getPo(deps.db, actor.tenantId, row.id);
    res.json({ order, share: share(order) });
  });

  router.post("/purchase-orders/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "po");
    const { reason } = parse(z.object({ reason: optText(500) }), req.body);
    const row = await loadPoRow(deps.db, actor.tenantId, req.params.id);
    if (row.status === "partially_received") throw conflict("Part of this order has arrived — it can't be cancelled. Close it by receiving the rest or raise a supplier return.");
    await move(deps.db, actor.tenantId, row.id, row.status, "cancelled", ["approval_note = COALESCE(:reason, approval_note)"], { reason: reason ? `Cancelled: ${reason}` : null });
    await recordEvent(deps, actor, { type: "po.cancelled", entityType: "po", entityId: row.id, summary: `Cancelled ${row.po_no}${reason ? ` — ${reason}` : ""}` });
    res.json({ order: await getPo(deps.db, actor.tenantId, row.id) });
  });

  router.post("/purchase-orders/:id/duplicate", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "po");
    const src = mapPo(await loadPoRow(deps.db, actor.tenantId, req.params.id));
    const settings = await getSettings(deps, actor.tenantId);
    const supplierStillActive = src.supplierId ? (await loadParty(deps.db, actor.tenantId, src.supplierId))?.active === true : false;
    const built = await buildPo(
      deps,
      actor,
      {
        supplierId: supplierStillActive ? src.supplierId : null,
        supplierName: src.supplierName,
        orderDate: todayISO(),
        expectedDate: null,
        deliveryAddress: src.deliveryAddress,
        paymentTermsDays: src.paymentTermsDays,
        lines: src.lines.map((l) => ({ itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })),
        terms: src.terms,
        notes: src.notes,
        action: "draft",
      },
      settings,
    );
    const id = randomUUID();
    const poNo = await nextDocNo(deps.db, actor.tenantId, "po", settings.poPrefix, built.orderDate, settings.fiscalYearStart);
    await exec(
      deps.db,
      `INSERT INTO ims_purchase_orders
         (id, tenant_id, po_no, status, supplier_id, supplier_name, supplier_snapshot, business_snapshot, order_date, expected_date, delivery_address,
          payment_terms_days, intra_state, \`lines\`, subtotal, discount_total, tax_total, cgst, sgst, igst, grand_total, terms, notes, created_by, created_by_name)
       VALUES
         (:id, :tenantId, :poNo, 'draft', :supplierId, :supplierName, :supplierSnapshot, :businessSnapshot, :orderDate, :expectedDate, :deliveryAddress,
          :paymentTermsDays, :intraState, :lines, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :grandTotal, :terms, :notes, :userId, :userName)`,
      { ...builtParams(built), id, tenantId: actor.tenantId, poNo, userId: actor.userId, userName: actorName(actor) },
    );
    await recordEvent(deps, actor, { type: "po.duplicated", entityType: "po", entityId: id, summary: `Duplicated ${src.poNo} as draft ${poNo}` });
    res.status(201).json({ order: await getPo(deps.db, actor.tenantId, id) });
  });

  router.delete("/purchase-orders/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "po");
    const row = await loadPoRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "draft") throw conflict("Only drafts can be deleted — cancel the purchase order instead");
    await exec(deps.db, `DELETE FROM ims_purchase_orders WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "po.deleted", entityType: "po", entityId: row.id, summary: `Deleted draft ${row.po_no}` });
    res.status(204).end();
  });

  /**
   * Goods receipt: one transaction posts stock IN for every linked line, updates received quantities and
   * the PO status, and raises an approved supplier bill for the received value.
   */
  router.post("/purchase-orders/:id/receive", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["stockIn", "po"]);
    const input = parse(ReceiveInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const date = input.date ?? todayISO();
    if (date > todayISO()) throw badRequest("The receipt date can't be in the future");

    const result = await tx(deps.db, async (conn) => {
      const row = await loadPoRow(conn, actor.tenantId, req.params.id, true);
      if (!["approved", "sent", "partially_received"].includes(row.status)) {
        throw conflict(row.status === "pending_approval" ? "This purchase order needs approval before goods can be received" : `Goods can't be received against a ${row.status.replace(/_/g, " ")} purchase order`);
      }
      const po = mapPo(row);
      const receipts = resolveReceipts(po.lines, input.lines);
      const applied = applyPoReceipt(po.lines, receipts);
      if (applied.errors.length) throw new ImsError(400, "Please check the received quantities", applied.errors);

      const movements: PostedMovement[] = [];
      for (const r of receipts) {
        const line = po.lines[r.lineIndex];
        if (!line.itemId) continue;
        movements.push(
          await postMovement(
            conn,
            actor,
            {
              itemId: line.itemId,
              type: "IN",
              qty: r.qty,
              unitCost: r.unitCost ?? netUnitCost(line),
              refType: "po",
              refId: po.id,
              refNo: po.poNo,
              partyId: po.supplierId,
              partyName: po.supplierName,
              notes: [input.supplierBillNo ? `Supplier bill ${input.supplierBillNo}` : null, input.notes].filter(Boolean).join(" · ") || null,
              date,
            },
            { allowNegative: settings.allowNegativeStock },
          ),
        );
      }

      const nextStatus = poReceiptStatus(applied.lines);
      await move(conn, actor.tenantId, po.id, po.status, nextStatus, ["`lines` = :lines", ...(nextStatus === "received" ? ["received_at = CURRENT_TIMESTAMP"] : [])], {
        lines: JSON.stringify(applied.lines),
      });

      let bill: ReturnType<typeof mapBill> | null = null;
      if (input.createBill) bill = await createReceiptBill(conn, actor, settings, po, receipts, { date, supplierBillNo: input.supplierBillNo ?? null, supplierBillDate: input.supplierBillDate ?? null, notes: input.notes ?? null });
      return { po, movements, bill, nextStatus, units: round3(receipts.reduce((s, r) => s + r.qty, 0)) };
    });

    await recordEvent(deps, actor, {
      type: "po.received",
      entityType: "po",
      entityId: result.po.id,
      summary: `Received ${result.units} units against ${result.po.poNo}${result.nextStatus === "received" ? " (complete)" : " (partial)"}${result.bill ? ` · bill ${result.bill.billNo} ${formatINR(result.bill.grandTotal)}` : ""}`,
      payload: { billId: result.bill?.id ?? null, movements: result.movements.map((m) => ({ itemId: m.itemId, qty: m.qty, after: m.after })) },
      notice:
        result.po.createdBy && result.po.createdBy !== actor.userId
          ? {
              kind: "activity",
              title: `Goods received — ${result.po.poNo}`,
              body: `${result.units} units from ${result.po.supplierName}${result.nextStatus === "received" ? ". The order is complete." : ". Part of the order is still pending."}`,
              path: `?m=purchase&open=${result.po.id}`,
              targetUserId: result.po.createdBy,
            }
          : undefined,
    });
    if (result.bill) {
      await recordEvent(deps, actor, {
        type: "bill.created",
        entityType: "bill",
        entityId: result.bill.id,
        summary: `Bill ${result.bill.billNo} raised from ${result.po.poNo} · ${formatINR(result.bill.grandTotal)}`,
      });
    }
    res.status(201).json({ order: await getPo(deps.db, actor.tenantId, result.po.id), bill: result.bill, movements: result.movements });
  });
}

/** Maps `{lineIndex | itemId, qty}` to concrete line indexes (an item id picks its first line with quantity still open). */
function resolveReceipts(lines: ReadonlyArray<PoLine>, input: ReadonlyArray<{ lineIndex?: number; itemId?: string; qty: number; unitCost?: number | null }>): PoReceipt[] {
  const out: PoReceipt[] = [];
  for (const r of input) {
    if (!(r.qty > 0)) continue;
    let idx = r.lineIndex;
    if (idx === undefined && r.itemId) {
      idx = lines.findIndex((l) => l.itemId === r.itemId && poRemaining(l) > 0);
      if (idx < 0) idx = lines.findIndex((l) => l.itemId === r.itemId);
    }
    if (idx === undefined || idx < 0) throw badRequest("Each received line needs a line number or an item on this purchase order");
    out.push({ lineIndex: idx, qty: round3(r.qty), unitCost: r.unitCost ?? null });
  }
  return out;
}

async function createReceiptBill(
  conn: PoolConnection,
  actor: ImsActor,
  settings: ImsSettings,
  po: ImsPurchaseOrder,
  receipts: ReadonlyArray<PoReceipt>,
  opts: { date: string; supplierBillNo: string | null; supplierBillDate: string | null; notes: string | null },
) {
  const billLines = receiptBillLines(po.lines, receipts);
  if (!billLines.length) return null;
  const totals = computeTotals(billLines, po.intraState);
  const supplierTerms = po.supplierId
    ? await one<{ payment_terms_days: number | null }>(conn, `SELECT payment_terms_days FROM ims_parties WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId: actor.tenantId, id: po.supplierId })
    : null;
  const billDate = opts.supplierBillDate ?? opts.date;
  const terms = supplierTerms?.payment_terms_days ?? po.paymentTermsDays;
  const dueDate = dueDateFor(billDate, terms == null ? null : Number(terms), settings.paymentTermsDays);
  const id = randomUUID();
  const billNo = await nextDocNo(conn, actor.tenantId, "bill", settings.billPrefix, billDate, settings.fiscalYearStart);
  await exec(
    conn,
    `INSERT INTO ims_bills
       (id, tenant_id, bill_no, supplier_bill_no, status, supplier_id, supplier_name, po_id, po_no, bill_date, due_date, \`lines\`,
        subtotal, tax_total, grand_total, amount_paid, decided_by, decided_by_name, decided_at, notes, created_by, created_by_name)
     VALUES
       (:id, :tenantId, :billNo, :supplierBillNo, 'approved', :supplierId, :supplierName, :poId, :poNo, :billDate, :dueDate, :lines,
        :subtotal, :taxTotal, :grandTotal, 0, :decidedBy, :decidedByName, CURRENT_TIMESTAMP, :notes, :userId, :userName)`,
    {
      id,
      tenantId: actor.tenantId,
      billNo,
      supplierBillNo: opts.supplierBillNo,
      supplierId: po.supplierId,
      supplierName: po.supplierName,
      poId: po.id,
      poNo: po.poNo,
      billDate,
      dueDate,
      lines: JSON.stringify(totals.lines),
      subtotal: totals.taxable,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      decidedBy: actor.userId,
      decidedByName: po.decidedByName ?? actorName(actor),
      notes: [`Raised from goods receipt against ${po.poNo} (approved PO)`, opts.notes].filter(Boolean).join(" — "),
      userId: actor.userId,
      userName: actorName(actor),
    },
  );
  await exec(conn, `UPDATE ims_purchase_orders SET bill_id = :billId WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: po.id, billId: id });
  return {
    id,
    billNo,
    supplierBillNo: opts.supplierBillNo,
    status: "approved",
    billDate,
    dueDate,
    grandTotal: totals.grandTotal,
    amountPaid: 0,
    createdAt: null,
  };
}

async function decide(deps: ImsDeps, actor: ImsActor, id: string, to: "approved" | "rejected", note: string | null): Promise<ImsPurchaseOrder> {
  const row = await loadPoRow(deps.db, actor.tenantId, id);
  if (row.status !== "pending_approval") throw conflict(`${row.po_no} isn't waiting for approval (it's ${row.status.replace(/_/g, " ")})`);
  await move(deps.db, actor.tenantId, row.id, "pending_approval", to, ["decided_by = :userId", "decided_by_name = :userName", "decided_at = CURRENT_TIMESTAMP", "approval_note = :note"], {
    userId: actor.userId,
    userName: actorName(actor),
    note,
  });
  const total = formatINR(money(row.grand_total));
  await recordEvent(deps, actor, {
    type: to === "approved" ? "po.approved" : "po.rejected",
    entityType: "po",
    entityId: row.id,
    summary: `${to === "approved" ? "Approved" : "Rejected"} ${row.po_no} · ${row.supplier_name} · ${total}${note ? ` — ${note}` : ""}`,
    payload: { note },
    notice:
      row.created_by && row.created_by !== actor.userId
        ? {
            kind: "approval_decided",
            title: `${row.po_no} ${to === "approved" ? "approved" : "rejected"}`,
            body: to === "approved" ? `${row.supplier_name} · ${total}. You can send it to the supplier now.` : `Reason: ${note}. Edit and resubmit it from Purchase Orders.`,
            path: `?m=purchase&open=${row.id}`,
            targetUserId: Number(row.created_by),
          }
        : undefined,
  });
  return getPo(deps.db, actor.tenantId, row.id);
}

async function notifyApprovalRequested(deps: ImsDeps, actor: ImsActor, id: string, poNo: string, supplierName: string, grandTotal: number): Promise<void> {
  await recordEvent(deps, actor, {
    type: "po.approval_requested",
    entityType: "po",
    entityId: id,
    summary: `${poNo} needs approval · ${supplierName} · ${formatINR(grandTotal)}`,
    notice: {
      kind: "approval_requested",
      title: `Approve ${poNo}`,
      body: `${actorName(actor) ?? "A teammate"} raised a purchase order for ${supplierName} worth ${formatINR(grandTotal)}.`,
      path: `?m=approvals&open=${id}`,
      dedupeKey: `ims-po-approval-${id}`,
    },
  });
}
