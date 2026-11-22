import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, isoDate, optText, parse, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, notFound, type ImsActor } from "./host.js";
import { computeTotals, formatINR, gstStateName, intraStateFor, round2, todayISO, type ImsLine } from "./logic.js";
import { loadParty } from "./parties.js";
import { assertDayOpen, createLinkedInvoice, LineInput } from "./sales.js";
import { getSettings, type ImsSettings } from "./settings.js";
import {
  SO_OPEN_STATUSES,
  SO_STATUSES,
  mergeQtys,
  planFromRemaining,
  soDerivedStatus,
  soProgress,
  soSummary,
  type SoLineProgress,
  type SoQty,
  type SoStatus,
} from "./so-logic.js";
import { nextDocNo, postMovement } from "./stock.js";

/* ---------- Shapes ---------- */

type SoRow = {
  id: string;
  so_no: string;
  status: string;
  customer_id: string | null;
  customer_name: string;
  customer_gstin: string | null;
  customer_email: string | null;
  customer_mobile: string | null;
  bill_to_address: string | null;
  ship_to_address: string | null;
  customer_po_ref: string | null;
  order_date: unknown;
  delivery_date: unknown;
  currency_code: string | null;
  lines: unknown;
  subtotal: string;
  tax_total: string;
  grand_total: string;
  notes: string | null;
  terms: string | null;
  created_by: number | null;
  created_by_name: string | null;
  confirmed_at: unknown;
  cancelled_at: unknown;
  cancel_reason: string | null;
  created_at: unknown;
  updated_at: unknown;
};

type DcRow = {
  id: string;
  sales_order_id: string;
  doc_no: string;
  status: string;
  doc_date: unknown;
  ship_to: string | null;
  transporter: string | null;
  vehicle_no: string | null;
  notes: string | null;
  lines: unknown;
  stock_posted: number;
  approved_by_name: string | null;
  approved_at: unknown;
  created_by_name: string | null;
  created_at: unknown;
};

type InvRow = {
  id: string;
  sales_order_id: string;
  invoice_no: string;
  status: string;
  invoice_date: unknown;
  grand_total: string;
  amount_paid: string;
  lines: unknown;
};

export type SoDcLine = { lineIndex: number; itemId: string | null; name: string; sku: string | null; hsn: string | null; unit: string | null; qty: number };

const statusOf = (v: string): SoStatus => ((SO_STATUSES as readonly string[]).includes(v) ? (v as SoStatus) : "draft");

function mapSo(r: SoRow, intra = true) {
  const lines = json<ImsLine[]>(r.lines, []);
  const t = computeTotals(lines, intra);
  return {
    id: r.id,
    soNo: r.so_no,
    status: statusOf(r.status),
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerGstin: r.customer_gstin,
    customerEmail: r.customer_email,
    customerMobile: r.customer_mobile,
    billToAddress: r.bill_to_address,
    shipToAddress: r.ship_to_address,
    customerPoRef: r.customer_po_ref,
    orderDate: isoOf(r.order_date),
    deliveryDate: r.delivery_date ? isoOf(r.delivery_date) : null,
    currencyCode: r.currency_code || "INR",
    intraState: intra,
    lines: t.lines,
    lineCount: lines.length,
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    taxable: t.taxable,
    taxTotal: t.taxTotal,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    grandTotal: round2(money(r.grand_total)),
    notes: r.notes,
    terms: r.terms,
    createdBy: r.created_by == null ? null : Number(r.created_by),
    createdByName: r.created_by_name,
    confirmedAt: tsOf(r.confirmed_at),
    cancelledAt: tsOf(r.cancelled_at),
    cancelReason: r.cancel_reason,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
  };
}
export type ImsSalesOrder = ReturnType<typeof mapSo>;

type DcView = {
  id: string;
  salesOrderId: string;
  docNo: string;
  status: string;
  docDate: string;
  shipTo: string | null;
  transporter: string | null;
  vehicleNo: string | null;
  notes: string | null;
  lines: SoDcLine[];
  stockPosted: boolean;
  approvedByName: string | null;
  approvedAt: string | null;
  createdByName: string | null;
  createdAt: string | null;
  invoiceId: string | null;
};

type InvView = {
  id: string;
  salesOrderId: string;
  invoiceNo: string;
  status: string;
  invoiceDate: string;
  grandTotal: number;
  amountPaid: number;
  dcIds: string[];
  lines: Array<{ itemId?: string | null; name: string; sku?: string | null; qty: number }>;
};

const mapDc = (r: DcRow, invoiceId: string | null): DcView => ({
  id: r.id,
  salesOrderId: r.sales_order_id,
  docNo: r.doc_no,
  status: r.status,
  docDate: isoOf(r.doc_date),
  shipTo: r.ship_to,
  transporter: r.transporter,
  vehicleNo: r.vehicle_no,
  notes: r.notes,
  lines: json<SoDcLine[]>(r.lines, []).map((l) => ({ ...l, qty: Number(l.qty) || 0 })),
  stockPosted: Boolean(r.stock_posted),
  approvedByName: r.approved_by_name,
  approvedAt: tsOf(r.approved_at),
  createdByName: r.created_by_name,
  createdAt: tsOf(r.created_at),
  invoiceId,
});

const inList = (prefix: string, ids: ReadonlyArray<string>, params: Record<string, unknown>): string =>
  ids
    .map((id, i) => {
      params[`${prefix}${i}`] = id;
      return `:${prefix}${i}`;
    })
    .join(", ");

/** DCs and invoices of the given orders (one query each, never per order). */
async function loadActivity(db: Queryable, tenantId: number, soIds: ReadonlyArray<string>): Promise<Map<string, { dcs: DcView[]; invoices: InvView[] }>> {
  const out = new Map<string, { dcs: DcView[]; invoices: InvView[] }>();
  for (const id of soIds) out.set(id, { dcs: [], invoices: [] });
  if (!soIds.length) return out;
  const params: Record<string, unknown> = { tenantId };
  const inSo = inList("s", soIds, params);
  const [dcRows, invRows] = await Promise.all([
    rows<DcRow>(db, `SELECT * FROM ims_so_dcs WHERE tenant_id = :tenantId AND sales_order_id IN (${inSo}) ORDER BY doc_date ASC, created_at ASC`, params),
    rows<InvRow>(
      db,
      `SELECT id, sales_order_id, invoice_no, status, invoice_date, grand_total, amount_paid, \`lines\`
       FROM ims_invoices WHERE tenant_id = :tenantId AND sales_order_id IN (${inSo}) ORDER BY created_at ASC`,
      params,
    ),
  ]);
  const links = new Map<string, string[]>(); // invoice → dc ids
  const dcInvoice = new Map<string, string>(); // dc → invoice
  if (invRows.length) {
    const lp: Record<string, unknown> = { tenantId };
    const inInv = inList("i", invRows.map((i) => i.id), lp);
    const linkRows = await rows<{ invoice_id: string; so_dc_id: string }>(db, `SELECT invoice_id, so_dc_id FROM ims_invoice_so_dc_links WHERE tenant_id = :tenantId AND invoice_id IN (${inInv})`, lp);
    for (const l of linkRows) {
      links.set(l.invoice_id, [...(links.get(l.invoice_id) ?? []), l.so_dc_id]);
      dcInvoice.set(l.so_dc_id, l.invoice_id);
    }
  }
  for (const r of dcRows) out.get(r.sales_order_id)?.dcs.push(mapDc(r, dcInvoice.get(r.id) ?? null));
  for (const r of invRows) {
    out.get(r.sales_order_id)?.invoices.push({
      id: r.id,
      salesOrderId: r.sales_order_id,
      invoiceNo: r.invoice_no,
      status: r.status,
      invoiceDate: isoOf(r.invoice_date),
      grandTotal: round2(money(r.grand_total)),
      amountPaid: round2(money(r.amount_paid)),
      dcIds: links.get(r.id) ?? [],
      lines: json<InvView["lines"]>(r.lines, []),
    });
  }
  return out;
}

/** Progress of one order: DC-covered qty plus direct (no-DC) live invoices. */
function progressOf(lines: ReadonlyArray<ImsLine>, act: { dcs: DcView[]; invoices: InvView[] }, exceptDcId?: string): SoLineProgress[] {
  return soProgress(
    lines,
    act.dcs.filter((d) => d.id !== exceptDcId).map((d) => ({ status: d.status, invoiced: Boolean(d.invoiceId), lines: d.lines })),
    act.invoices.filter((i) => !i.dcIds.length).map((i) => ({ status: i.status, lines: i.lines })),
  );
}

type SoContext = { row: SoRow; lines: ImsLine[]; act: { dcs: DcView[]; invoices: InvView[] }; progress: SoLineProgress[] };

async function loadRow(db: Queryable, tenantId: number, id: string, lock = false): Promise<SoRow> {
  const r = await one<SoRow>(db, `SELECT * FROM ims_sales_orders WHERE tenant_id = :tenantId AND id = :id LIMIT 1${lock ? " FOR UPDATE" : ""}`, { tenantId, id });
  if (!r) throw notFound("Sales order");
  return r;
}

async function loadContext(db: Queryable, tenantId: number, id: string, lock = false): Promise<SoContext> {
  const row = await loadRow(db, tenantId, id, lock);
  const lines = json<ImsLine[]>(row.lines, []);
  const act = (await loadActivity(db, tenantId, [id])).get(id) ?? { dcs: [], invoices: [] };
  return { row, lines, act, progress: progressOf(lines, act) };
}

/** Persists the derived confirmed / partial / fulfilled status. Returns the status now stored. */
async function syncStatus(db: Queryable, tenantId: number, ctx: SoContext): Promise<SoStatus> {
  const from = statusOf(ctx.row.status);
  const next = soDerivedStatus(from, ctx.progress);
  if (next !== from && from !== "draft" && from !== "cancelled") {
    await exec(db, `UPDATE ims_sales_orders SET status = :next WHERE tenant_id = :tenantId AND id = :id AND status = :from`, { tenantId, id: ctx.row.id, next, from });
  }
  return next;
}

/** Reloads and re-syncs an order inside a transaction (after a DC or invoice changed it). */
async function resync(conn: PoolConnection, tenantId: number, id: string): Promise<SoStatus> {
  return syncStatus(conn, tenantId, await loadContext(conn, tenantId, id));
}

async function detailOf(deps: ImsDeps, tenantId: number, id: string) {
  const ctx = await loadContext(deps.db, tenantId, id);
  const status = await syncStatus(deps.db, tenantId, ctx);
  const settings = await getSettings(deps, tenantId);
  const party = ctx.row.customer_id ? await loadParty(deps.db, tenantId, ctx.row.customer_id) : null;
  const gstin = ctx.row.customer_gstin?.trim().toUpperCase() || party?.gstin || null;
  const place = party?.state || gstStateName(gstin) || settings.state || null;
  const order = mapSo({ ...ctx.row, status }, intraStateFor(settings, place));
  return {
    order,
    progress: ctx.progress,
    summary: soSummary(ctx.progress),
    dcs: ctx.act.dcs,
    invoices: ctx.act.invoices.map(({ lines: _lines, ...inv }) => inv),
  };
}

/* ---------- Input ---------- */

const SoInput = z.object({
  customerId: z.string().uuid().nullable().optional(),
  customerName: z.string().trim().max(200).optional(),
  customerGstin: optText(20),
  customerEmail: optText(120),
  customerMobile: optText(20),
  billToAddress: optText(500),
  shipToAddress: optText(500),
  customerPoRef: optText(80),
  orderDate: isoDate.optional(),
  deliveryDate: isoDate.nullable().optional(),
  lines: z.array(LineInput).min(1, "Add at least one line").max(300),
  notes: optText(4000),
  terms: optText(4000),
});
type SoInputT = z.infer<typeof SoInput>;

const QtyPick = z.object({ lineIndex: z.coerce.number().int().min(0).max(299), qty: z.coerce.number().positive("Quantity must be more than zero").max(1e9) });

const DcInput = z.object({
  lines: z.array(QtyPick).max(300).optional(),
  shipTo: optText(500),
  transporter: optText(200),
  vehicleNo: optText(40),
  notes: optText(2000),
  docDate: isoDate.optional(),
});

const InvoiceFromSoInput = z.object({
  issue: z.boolean().optional(),
  dcIds: z.array(z.string().uuid()).max(100).optional(),
  lines: z.array(QtyPick).max(300).optional(),
  invoiceDate: isoDate.optional(),
  dueDate: isoDate.nullable().optional(),
});

async function buildSo(deps: ImsDeps, actor: ImsActor, input: SoInputT, settings: ImsSettings) {
  const party = input.customerId ? await loadParty(deps.db, actor.tenantId, input.customerId) : null;
  if (input.customerId && !party) throw badRequest("Pick an existing customer");
  if (party && !party.active) throw badRequest("Pick an active customer");
  if (party?.kind === "supplier") throw badRequest(`${party.name} is saved as a supplier — mark them as a customer first`);
  const customerName = party?.name ?? input.customerName?.trim() ?? "";
  if (!customerName) throw badRequest("Pick a customer or type a name", ["customerId: Choose a customer"]);
  const orderDate = input.orderDate ?? todayISO();
  const deliveryDate = input.deliveryDate ?? null;
  if (deliveryDate && deliveryDate < orderDate) throw badRequest("Delivery date can't be before the order date", ["deliveryDate: Must be on or after the order date"]);

  const itemIds = [...new Set(input.lines.map((l) => l.itemId).filter((v): v is string => Boolean(v)))];
  if (itemIds.length) {
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const found = await rows<{ id: string }>(deps.db, `SELECT id FROM ims_items WHERE tenant_id = :tenantId AND id IN (${inList("i", itemIds, params)})`, params);
    const known = new Set(found.map((f) => f.id));
    const missing = input.lines.filter((l) => l.itemId && !known.has(l.itemId));
    if (missing.length) throw badRequest(`Some items no longer exist: ${missing.map((m) => m.name).join(", ")}`);
  }

  const gstin = input.customerGstin?.trim().toUpperCase() || party?.gstin || null;
  const place = party?.state || gstStateName(gstin) || settings.state || null;
  const intra = intraStateFor(settings, place);
  const totals = computeTotals(input.lines, intra);
  return {
    customerId: party?.id ?? null,
    customerName,
    customerGstin: gstin,
    customerEmail: input.customerEmail?.trim() || party?.email || null,
    customerMobile: input.customerMobile?.trim() || party?.mobile || null,
    billToAddress: input.billToAddress?.trim() || [party?.address, party?.city].filter(Boolean).join(", ") || null,
    shipToAddress: input.shipToAddress?.trim() || null,
    customerPoRef: input.customerPoRef?.trim() || null,
    orderDate,
    deliveryDate,
    lines: JSON.stringify(totals.lines),
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
    notes: input.notes?.trim() || null,
    terms: input.terms === undefined ? settings.terms : input.terms?.trim() || null,
  };
}

/* ---------- Routes ---------- */

const READ_PERMS = ["sales", "receivables"] as const;
const BILLABLE = new Set<string>([...SO_OPEN_STATUSES, "fulfilled"]);

export function registerSalesOrders(router: Router, deps: ImsDeps): void {
  router.get("/sales-orders", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, READ_PERMS);
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const status = qstr(req.query.status, 24);
    if (status === "open") where.push("status IN ('confirmed', 'partial')");
    else if ((SO_STATUSES as readonly string[]).includes(status)) {
      where.push("status = :status");
      params.status = status;
    }
    const customerId = qstr(req.query.customerId, 36);
    if (customerId) {
      where.push("customer_id = :customerId");
      params.customerId = customerId;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(so_no LIKE :q OR customer_name LIKE :q OR customer_po_ref LIKE :q OR notes LIKE :q)");
      params.q = likeOf(q);
    }
    const list = await rows<SoRow>(deps.db, `SELECT * FROM ims_sales_orders WHERE ${where.join(" AND ")} ORDER BY order_date DESC, created_at DESC LIMIT 500`, params);
    const [activity, byStatus] = await Promise.all([
      loadActivity(deps.db, actor.tenantId, list.filter((r) => r.status !== "draft" && r.status !== "cancelled").map((r) => r.id)),
      rows<{ status: string; n: number; v: string }>(deps.db, `SELECT status, COUNT(*) AS n, SUM(grand_total) AS v FROM ims_sales_orders WHERE tenant_id = :tenantId GROUP BY status`, { tenantId: actor.tenantId }),
    ]);
    const orders = list.map((r) => {
      const lines = json<ImsLine[]>(r.lines, []);
      const act = activity.get(r.id);
      const progress = act ? progressOf(lines, act) : [];
      const status2 = act ? soDerivedStatus(r.status, progress) : statusOf(r.status);
      const sum = soSummary(progress);
      return {
        ...mapSo({ ...r, status: status2 }),
        deliveredPct: sum.deliveredPct,
        remainingQty: act ? sum.remainingQty : lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
        dcCount: act ? act.dcs.filter((d) => d.status !== "cancelled").length : 0,
        invoiceCount: act ? act.invoices.filter((i) => i.status !== "cancelled").length : 0,
      };
    });
    const counts = Object.fromEntries(SO_STATUSES.map((s) => [s, 0])) as Record<SoStatus, number>;
    let openValue = 0;
    for (const s of byStatus) {
      const key = statusOf(s.status);
      counts[key] += Number(s.n);
      if (key === "confirmed" || key === "partial") openValue += money(s.v);
    }
    res.json({
      orders,
      summary: { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), openValue: round2(openValue) },
    });
  });

  router.get("/sales-orders/dcs/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, READ_PERMS);
    const r = await one<DcRow>(deps.db, `SELECT * FROM ims_so_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId: actor.tenantId, id: req.params.id });
    if (!r) throw notFound("Delivery challan");
    const act = (await loadActivity(deps.db, actor.tenantId, [r.sales_order_id])).get(r.sales_order_id);
    const so = await loadRow(deps.db, actor.tenantId, r.sales_order_id);
    res.json({ dc: act?.dcs.find((d) => d.id === r.id) ?? mapDc(r, null), order: { id: so.id, soNo: so.so_no, customerName: so.customer_name, status: statusOf(so.status) } });
  });

  router.get("/sales-orders/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, READ_PERMS);
    res.json(await detailOf(deps, actor.tenantId, req.params.id));
  });

  router.post("/sales-orders", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(SoInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const built = await buildSo(deps, actor, input, settings);
    const id = randomUUID();
    const soNo = await nextDocNo(deps.db, actor.tenantId, "sales_order", settings.soPrefix, built.orderDate, settings.businessName);
    await exec(
      deps.db,
      `INSERT INTO ims_sales_orders
         (id, tenant_id, so_no, status, customer_id, customer_name, customer_gstin, customer_email, customer_mobile, bill_to_address, ship_to_address,
          customer_po_ref, order_date, delivery_date, \`lines\`, subtotal, tax_total, grand_total, notes, terms, created_by, created_by_name)
       VALUES
         (:id, :tenantId, :soNo, 'draft', :customerId, :customerName, :customerGstin, :customerEmail, :customerMobile, :billToAddress, :shipToAddress,
          :customerPoRef, :orderDate, :deliveryDate, :lines, :subtotal, :taxTotal, :grandTotal, :notes, :terms, :userId, :userName)`,
      { ...built, id, tenantId: actor.tenantId, soNo, userId: actor.userId, userName: actorName(actor) },
    );
    await recordEvent(deps, actor, { type: "so.created", entityType: "sales_order", entityId: id, summary: `Drafted ${soNo} for ${built.customerName} · ${formatINR(built.grandTotal)}` });
    res.status(201).json(await detailOf(deps, actor.tenantId, id));
  });

  router.put("/sales-orders/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const row = await loadRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "draft") throw conflict("Only draft sales orders can be edited");
    const input = parse(SoInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const built = await buildSo(deps, actor, input, settings);
    const out = await exec(
      deps.db,
      `UPDATE ims_sales_orders SET
         customer_id = :customerId, customer_name = :customerName, customer_gstin = :customerGstin, customer_email = :customerEmail, customer_mobile = :customerMobile,
         bill_to_address = :billToAddress, ship_to_address = :shipToAddress, customer_po_ref = :customerPoRef, order_date = :orderDate, delivery_date = :deliveryDate,
         \`lines\` = :lines, subtotal = :subtotal, tax_total = :taxTotal, grand_total = :grandTotal, notes = :notes, terms = :terms
       WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
      { ...built, id: row.id, tenantId: actor.tenantId },
    );
    if (!out.affectedRows) throw conflict("This sales order changed in the meantime — reload and try again");
    await recordEvent(deps, actor, { type: "so.updated", entityType: "sales_order", entityId: row.id, summary: `Updated ${row.so_no} · ${formatINR(built.grandTotal)}` });
    res.json(await detailOf(deps, actor.tenantId, row.id));
  });

  router.post("/sales-orders/:id/confirm", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const row = await loadRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "draft") throw conflict(`A ${row.status} sales order can't be confirmed`);
    if (!json<ImsLine[]>(row.lines, []).length) throw badRequest("Add at least one line before confirming");
    if (!row.customer_name.trim()) throw badRequest("Pick a customer before confirming");
    const out = await exec(deps.db, `UPDATE ims_sales_orders SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`, {
      tenantId: actor.tenantId,
      id: row.id,
    });
    if (!out.affectedRows) throw conflict("This sales order changed in the meantime — reload and try again");
    await recordEvent(deps, actor, { type: "so.confirmed", entityType: "sales_order", entityId: row.id, summary: `Confirmed ${row.so_no} for ${row.customer_name} · ${formatINR(money(row.grand_total))}` });
    res.json(await detailOf(deps, actor.tenantId, row.id));
  });

  router.post("/sales-orders/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, "Give a short reason").max(500) }), req.body);
    const soNo = await tx(deps.db, async (conn) => {
      const ctx = await loadContext(conn, actor.tenantId, req.params.id, true);
      if (ctx.row.status !== "draft" && ctx.row.status !== "confirmed") {
        throw conflict(
          ctx.row.status === "cancelled"
            ? "This sales order is already cancelled"
            : "This order has deliveries or invoices. Cancel those first (or leave the order open for the rest).",
        );
      }
      if (ctx.act.dcs.some((d) => d.status === "approved")) throw conflict("This order has approved delivery challans — stock already left, so the order can't be cancelled.");
      if (ctx.act.invoices.some((i) => i.status !== "cancelled")) throw conflict("This order has a live invoice. Cancel or delete the invoice first.");
      await exec(conn, `UPDATE ims_so_dcs SET status = 'cancelled' WHERE tenant_id = :tenantId AND sales_order_id = :id AND status = 'draft'`, { tenantId: actor.tenantId, id: ctx.row.id });
      const out = await exec(
        conn,
        `UPDATE ims_sales_orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = :reason WHERE tenant_id = :tenantId AND id = :id AND status IN ('draft', 'confirmed')`,
        { tenantId: actor.tenantId, id: ctx.row.id, reason },
      );
      if (!out.affectedRows) throw conflict("This sales order changed in the meantime — reload and try again");
      return ctx.row.so_no;
    });
    await recordEvent(deps, actor, { type: "so.cancelled", entityType: "sales_order", entityId: req.params.id, summary: `Cancelled ${soNo} — ${reason}` });
    res.json(await detailOf(deps, actor.tenantId, req.params.id));
  });

  router.delete("/sales-orders/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const row = await loadRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "draft") throw conflict("Only drafts can be deleted — cancel the sales order instead");
    await tx(deps.db, async (conn) => {
      await exec(conn, `DELETE FROM ims_so_dcs WHERE tenant_id = :tenantId AND sales_order_id = :id AND status <> 'approved'`, { tenantId: actor.tenantId, id: row.id });
      await exec(conn, `DELETE FROM ims_sales_orders WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`, { tenantId: actor.tenantId, id: row.id });
    });
    await recordEvent(deps, actor, { type: "so.deleted", entityType: "sales_order", entityId: row.id, summary: `Deleted draft ${row.so_no}` });
    res.status(204).end();
  });

  /* ----- Delivery challans ----- */

  router.post("/sales-orders/:id/dcs", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(DcInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const docDate = input.docDate ?? todayISO();
    if (docDate > todayISO()) throw badRequest("The challan date can't be in the future");
    const created = await tx(deps.db, async (conn) => {
      const ctx = await loadContext(conn, actor.tenantId, req.params.id, true);
      if (!SO_OPEN_STATUSES.includes(statusOf(ctx.row.status))) {
        throw conflict(ctx.row.status === "draft" ? "Confirm the sales order before creating a delivery challan" : `A ${ctx.row.status} sales order can't take a delivery challan`);
      }
      const plan = planFromRemaining(ctx.progress, input.lines as SoQty[] | undefined, "Nothing left to deliver on this order");
      if (plan.error) throw conflict(plan.error);
      const lines: SoDcLine[] = plan.lines.map((p) => {
        const l = ctx.lines[p.lineIndex];
        return { lineIndex: p.lineIndex, itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: p.qty };
      });
      const id = randomUUID();
      const docNo = await nextDocNo(conn, actor.tenantId, "so_dc", settings.soDcPrefix, docDate, settings.businessName);
      await exec(
        conn,
        `INSERT INTO ims_so_dcs (id, tenant_id, sales_order_id, doc_no, status, doc_date, ship_to, transporter, vehicle_no, notes, \`lines\`, created_by, created_by_name)
         VALUES (:id, :tenantId, :soId, :docNo, 'draft', :docDate, :shipTo, :transporter, :vehicleNo, :notes, :lines, :userId, :userName)`,
        {
          id,
          tenantId: actor.tenantId,
          soId: ctx.row.id,
          docNo,
          docDate,
          shipTo: input.shipTo?.trim() || ctx.row.ship_to_address || ctx.row.bill_to_address || null,
          transporter: input.transporter?.trim() || null,
          vehicleNo: input.vehicleNo?.trim() || null,
          notes: input.notes?.trim() || null,
          lines: JSON.stringify(lines),
          userId: actor.userId,
          userName: actorName(actor),
        },
      );
      return { id, docNo, soNo: ctx.row.so_no };
    });
    await recordEvent(deps, actor, { type: "so.dc.created", entityType: "sales_order", entityId: req.params.id, summary: `Drafted delivery challan ${created.docNo} for ${created.soNo}` });
    const detail = await detailOf(deps, actor.tenantId, req.params.id);
    res.status(201).json({ dc: detail.dcs.find((d) => d.id === created.id) ?? null, ...detail });
  });

  /** Posts stock OUT for every item-linked line (same negative-stock rule as invoices) and marks the challan approved. */
  router.post("/sales-orders/dcs/:id/approve", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const body = parse(z.object({ date: isoDate.optional() }), req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const date = body.date ?? todayISO();
    if (date > todayISO()) throw badRequest("Stock date can't be in the future");
    const dcId = String(req.params.id);
    const first = await one<{ sales_order_id: string }>(deps.db, `SELECT sales_order_id FROM ims_so_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId: actor.tenantId, id: dcId });
    if (!first) throw notFound("Delivery challan");
    const done = await tx(deps.db, async (conn) => {
      // Lock order: order, then challan — the same everywhere, so two approvals can't deadlock.
      const ctx = await loadContext(conn, actor.tenantId, first.sales_order_id, true);
      const dcRow = await one<DcRow>(conn, `SELECT * FROM ims_so_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`, { tenantId: actor.tenantId, id: dcId });
      if (!dcRow) throw notFound("Delivery challan");
      if (dcRow.status !== "draft") throw conflict(dcRow.status === "approved" ? "This delivery challan is already approved" : `A ${dcRow.status} delivery challan can't be approved`);
      if (dcRow.stock_posted) throw conflict("Stock was already posted for this delivery challan");
      if (!SO_OPEN_STATUSES.includes(statusOf(ctx.row.status))) throw conflict(`A ${ctx.row.status} sales order can't ship goods`);
      const dc = mapDc(dcRow, null);
      if (!dc.lines.length) throw conflict("This delivery challan has no lines");
      // Re-check quantities under the lock: other challans or direct invoices may have taken the qty since drafting.
      const others = progressOf(ctx.lines, ctx.act, dc.id);
      for (const l of dc.lines) {
        const p = others[l.lineIndex];
        if (!p || l.qty > p.remaining + 1e-6) throw conflict(`“${l.name}”: only ${p?.remaining ?? 0} left on the order — edit or cancel this challan.`);
      }
      await assertDayOpen(conn, actor.tenantId, date);
      const movements = [];
      for (const l of dc.lines) {
        if (!l.itemId || !(l.qty > 0)) continue;
        const src = ctx.lines[l.lineIndex];
        movements.push(
          await postMovement(
            conn,
            actor,
            {
              itemId: l.itemId,
              type: "OUT",
              qty: l.qty,
              unitPrice: src && src.qty ? round2(src.taxable / src.qty) : (src?.rate ?? null),
              refType: "dc",
              refId: dc.id,
              refNo: dc.docNo,
              partyId: ctx.row.customer_id,
              partyName: ctx.row.customer_name,
              reason: "Delivery challan (sales order)",
              notes: ctx.row.so_no,
              date,
            },
            { allowNegative: settings.allowNegativeStock },
          ),
        );
      }
      const claimed = await exec(
        conn,
        `UPDATE ims_so_dcs SET status = 'approved', stock_posted = 1, approved_by = :userId, approved_by_name = :userName, approved_at = CURRENT_TIMESTAMP
         WHERE tenant_id = :tenantId AND id = :id AND status = 'draft' AND stock_posted = 0`,
        { tenantId: actor.tenantId, id: dc.id, userId: actor.userId, userName: actorName(actor) },
      );
      if (!claimed.affectedRows) throw conflict("Delivery challan was already approved");
      await resync(conn, actor.tenantId, ctx.row.id);
      return { soId: ctx.row.id, soNo: ctx.row.so_no, docNo: dc.docNo, count: movements.length };
    });
    await recordEvent(deps, actor, {
      type: "so.dc.approved",
      entityType: "sales_order",
      entityId: done.soId,
      summary: `Approved delivery challan ${done.docNo} for ${done.soNo} — stock out (${done.count} item${done.count === 1 ? "" : "s"})`,
      payload: { dcId, count: done.count },
    });
    const detail = await detailOf(deps, actor.tenantId, done.soId);
    res.json({ dc: detail.dcs.find((d) => d.id === dcId) ?? null, ...detail });
  });

  router.post("/sales-orders/dcs/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const dcId = String(req.params.id);
    const first = await one<{ sales_order_id: string }>(deps.db, `SELECT sales_order_id FROM ims_so_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId: actor.tenantId, id: dcId });
    if (!first) throw notFound("Delivery challan");
    const info = await tx(deps.db, async (conn) => {
      const ctx = await loadContext(conn, actor.tenantId, first.sales_order_id, true);
      const dcRow = await one<DcRow>(conn, `SELECT * FROM ims_so_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`, { tenantId: actor.tenantId, id: dcId });
      if (!dcRow) throw notFound("Delivery challan");
      if (dcRow.status === "cancelled") throw conflict("This delivery challan is already cancelled");
      if (dcRow.status === "approved") throw conflict("Stock already left on this challan — it can't be cancelled here");
      const out = await exec(conn, `UPDATE ims_so_dcs SET status = 'cancelled' WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`, { tenantId: actor.tenantId, id: dcId });
      if (!out.affectedRows) throw conflict("This delivery challan changed in the meantime — reload and try again");
      await resync(conn, actor.tenantId, ctx.row.id);
      return { soId: ctx.row.id, docNo: dcRow.doc_no };
    });
    await recordEvent(deps, actor, { type: "so.dc.cancelled", entityType: "sales_order", entityId: info.soId, summary: `Cancelled delivery challan ${info.docNo}` });
    const detail = await detailOf(deps, actor.tenantId, info.soId);
    res.json({ dc: detail.dcs.find((d) => d.id === dcId) ?? null, ...detail });
  });

  /* ----- Invoice ----- */

  /**
   * Invoice from remaining qty (posts stock OUT itself when issued) or from approved, unbilled DCs
   * (links them — stock stays on the DCs, so issuing skips stock).
   */
  router.post("/sales-orders/:id/invoice", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(InvoiceFromSoInput, req.body);
    const soId = String(req.params.id);
    const ctx = await loadContext(deps.db, actor.tenantId, soId);
    if (!BILLABLE.has(ctx.row.status)) throw conflict(ctx.row.status === "draft" ? "Confirm the sales order before invoicing it" : `A ${ctx.row.status} sales order can't be invoiced`);

    const dcIds = [...new Set(input.dcIds ?? [])];
    if (dcIds.length && input.lines?.length) throw badRequest("Bill either delivery challans or remaining lines — not both");

    /** Quantities to bill, validated against the order as it is right now. */
    const resolve = (c: SoContext): SoQty[] => {
      if (dcIds.length) {
        const picked = dcIds.map((id) => {
          const dc = c.act.dcs.find((d) => d.id === id);
          if (!dc) throw badRequest("A selected delivery challan is not on this order");
          if (dc.status !== "approved" || !dc.stockPosted) throw conflict(`Delivery challan ${dc.docNo} must be approved before it can be billed`);
          if (dc.invoiceId) throw conflict(`Delivery challan ${dc.docNo} is already billed`);
          return dc;
        });
        return mergeQtys(picked.map((d) => d.lines.map((l) => ({ lineIndex: l.lineIndex, qty: l.qty }))));
      }
      const plan = planFromRemaining(c.progress, input.lines as SoQty[] | undefined, "Nothing left to invoice directly — approved challans are billed by linking them");
      if (plan.error) throw conflict(plan.error);
      return plan.lines;
    };
    const qtys = resolve(ctx);
    const so = ctx.row;
    const invoiceLines = qtys.map((q) => {
      const l = ctx.lines[q.lineIndex];
      return { itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: q.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate };
    });

    const detail = await createLinkedInvoice(
      deps,
      actor,
      {
        customerId: so.customer_id,
        customerName: so.customer_name,
        customerGstin: so.customer_gstin,
        customerAddress: so.bill_to_address,
        customerMobile: so.customer_mobile,
        customerPoNo: so.customer_po_ref,
        shipToAddress: so.ship_to_address,
        invoiceDate: input.invoiceDate ?? todayISO(),
        dueDate: input.dueDate ?? null,
        docKind: "tax_invoice",
        lines: invoiceLines,
        roundToRupee: false,
        notes: `Sales order ${so.so_no}${so.customer_po_ref ? ` · Customer PO ${so.customer_po_ref}` : ""}`,
        terms: so.terms,
        issue: input.issue === true,
        sourceTool: "ims_so",
        sourceRef: so.id,
      },
      {
        // Re-validate under the order lock — another tab may have delivered or billed in the meantime.
        before: async (conn) => {
          const fresh = await loadContext(conn, actor.tenantId, soId, true);
          if (!BILLABLE.has(fresh.row.status)) throw conflict(`A ${fresh.row.status} sales order can't be invoiced`);
          const again = resolve(fresh);
          if (JSON.stringify(again) !== JSON.stringify(qtys)) throw conflict("This order changed in the meantime — reload and try again");
        },
        afterInsert: async (conn, invoiceId) => {
          await exec(conn, `UPDATE ims_invoices SET sales_order_id = :soId WHERE tenant_id = :tenantId AND id = :invoiceId`, { tenantId: actor.tenantId, soId, invoiceId });
          for (const dcId of dcIds) {
            try {
              await exec(conn, `INSERT INTO ims_invoice_so_dc_links (tenant_id, invoice_id, so_dc_id) VALUES (:tenantId, :invoiceId, :dcId)`, { tenantId: actor.tenantId, invoiceId, dcId });
            } catch (err) {
              if ((err as { code?: string }).code === "ER_DUP_ENTRY") throw conflict("A selected delivery challan is already billed on another invoice");
              throw err;
            }
          }
        },
        after: async (conn) => {
          await resync(conn, actor.tenantId, soId);
        },
      },
    );
    await recordEvent(deps, actor, {
      type: "so.invoiced",
      entityType: "sales_order",
      entityId: soId,
      summary: `${input.issue ? "Issued" : "Drafted"} invoice ${detail.invoice.invoiceNo} from ${so.so_no}${dcIds.length ? ` (${dcIds.length} challan${dcIds.length === 1 ? "" : "s"})` : ""}`,
      payload: { invoiceId: detail.invoice.id, dcIds },
    });
    const order = await detailOf(deps, actor.tenantId, soId);
    res.status(201).json({ invoice: { id: detail.invoice.id, invoiceNo: detail.invoice.invoiceNo, status: detail.invoice.status, grandTotal: detail.invoice.grandTotal }, ...order });
  });
}
