import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, featureOn, isoDate, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, json, money, nextSequence, one, rows, tx } from "./db.js";
import { addInvoicePayment, createInvoice, LineInput, type InvoiceInputT } from "./finance.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { addDaysISO, computeInvoiceTotals, fiscalYearLabel, formatDocNo, isIntraState, todayISO, type BosLine, type BosLineInput } from "./logic.js";
import {
  CHALLAN_REASONS,
  challanBlock,
  deliveredPct,
  deleteBlock,
  DOC_PREFIX,
  editBlock,
  invoiceBlock,
  ITEM_KINDS,
  orderBlock,
  POS_METHODS,
  posSummary,
  QUOTE_VALID_DAYS,
  remainingLines,
  SALES_KINDS,
  salesStage,
  salesTotals,
  type ChallanReason,
  type SalesKind,
} from "./sales-logic.js";
import { getSettings } from "./workspace.js";

const LIMIT = 2000;
const POS_LIST_LIMIT = 300;
const POS_SWITCH = "bos.sales.pos";
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const KIND_LABEL: Record<SalesKind, string> = { quotation: "quotation", order: "sales order", challan: "delivery challan" };
const SEQ_KEY: Record<SalesKind, string> = { quotation: "sales_quotation", order: "sales_order", challan: "sales_challan" };

/* ---------- Inputs ---------- */

const DocFields = z.object({
  partyId: z.string().max(36).nullable().optional(),
  partyName: z.string().trim().min(1, "Choose or enter a customer").max(200),
  partyGstin: optText(20),
  partyAddress: optText(500),
  placeOfSupply: optText(80),
  docDate: isoDate,
  validUntil: isoDate.nullable().optional(),
  deliveryOn: isoDate.nullable().optional(),
  customerRef: optText(80),
  lines: z.array(LineInput).min(1, "Add at least one line item").max(200),
  notes: optText(4000),
  shipTo: optText(500),
  challanReason: z.enum(CHALLAN_REASONS).optional(),
  transporter: optText(120),
  vehicleNo: optText(30),
});
type DocFieldsT = z.infer<typeof DocFields>;
const CreateDoc = DocFields.extend({ kind: z.enum(SALES_KINDS), send: z.boolean().default(false) });
const DecideInput = z.object({ decision: z.enum(["accepted", "declined"]), note: optText(500) });
const DispatchInput = z.object({ dispatchedOn: isoDate.optional(), transporter: optText(120), vehicleNo: optText(30) });
const DeliverInput = z.object({ deliveredOn: isoDate.optional(), receivedBy: optText(120) });

const ItemInput = z.object({
  name: z.string().trim().min(1, "Name the item").max(200),
  sku: optText(64),
  kind: z.enum(ITEM_KINDS).default("goods"),
  hsn: optText(20),
  unit: optText(20),
  rate: z.coerce.number().min(0).max(1e12),
  taxRate: z.coerce.number().min(0).max(100),
  active: z.boolean().default(true),
});

const PosInput = z.object({
  partyId: z.string().max(36).nullable().optional(),
  partyName: optText(200),
  partyGstin: optText(20),
  lines: z.array(LineInput).min(1, "Add at least one item").max(200),
  method: z.enum(POS_METHODS),
  reference: optText(120),
});

/* ---------- Rows ---------- */

type DocRow = {
  id: string;
  kind: SalesKind;
  doc_no: string;
  status: string;
  party_id: string | null;
  party_name: string;
  party_gstin: string | null;
  party_address: string | null;
  place_of_supply: string | null;
  intra_state: number;
  doc_date: string;
  valid_until: string | null;
  delivery_on: string | null;
  customer_ref: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  cgst: string | number;
  sgst: string | number;
  igst: string | number;
  grand_total: string | number;
  line_items: unknown;
  notes: string | null;
  ship_to: string | null;
  challan_reason: ChallanReason | null;
  transporter: string | null;
  vehicle_no: string | null;
  dispatched_on: string | null;
  delivered_on: string | null;
  received_by: string | null;
  decided_on: string | null;
  decision_note: string | null;
  source_id: string | null;
  invoice_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  invoice_no: string | null;
  invoice_status: string | null;
};

const DOC_SQL = `SELECT d.*, i.invoice_no, i.status AS invoice_status FROM bos_sales_docs d
  LEFT JOIN bos_invoices i ON i.id = d.invoice_id AND i.tenant_id = d.tenant_id
  WHERE d.tenant_id = :tenantId`;

/** A deleted or voided invoice no longer counts, so the document can be invoiced again. */
const liveInvoiceNo = (r: DocRow): string | null => (r.invoice_no && r.invoice_status !== "void" ? r.invoice_no : null);
const linesOf = (r: DocRow) => json<BosLine[]>(r.line_items, []);

/** The document as the app sees it: stage, links and what can happen next, worked out from its family. */
function view(r: DocRow, family: ReadonlyArray<DocRow>, today: string) {
  const lines = linesOf(r);
  const children = family.filter((c) => c.source_id === r.id);
  const parent = r.source_id ? (family.find((p) => p.id === r.source_id) ?? null) : null;
  const invoiceNo = liveInvoiceNo(r);
  const challans = r.kind === "order" ? children.map((c) => ({ status: c.status, lines: linesOf(c) })) : [];
  const liveChildren = children.filter((c) => c.status !== "cancelled");
  const hasOrder = r.kind === "quotation" && liveChildren.some((c) => c.kind === "order");
  const linkedInvoiced = r.kind === "order" ? children.some((c) => liveInvoiceNo(c)) : r.kind === "challan" ? Boolean(parent && liveInvoiceNo(parent)) : false;
  const remaining = r.kind === "order" ? remainingLines(lines, challans) : null;
  return {
    id: r.id,
    kind: r.kind,
    docNo: r.doc_no,
    status: r.status,
    stage: salesStage({ kind: r.kind, status: r.status, validUntil: r.valid_until, invoiced: Boolean(invoiceNo), hasOrder, challans, lines }, today),
    partyId: r.party_id,
    partyName: r.party_name,
    partyGstin: r.party_gstin,
    partyAddress: r.party_address,
    placeOfSupply: r.place_of_supply,
    intraState: Boolean(r.intra_state),
    docDate: r.doc_date,
    validUntil: r.valid_until,
    deliveryOn: r.delivery_on,
    customerRef: r.customer_ref,
    subtotal: money(r.subtotal),
    discountTotal: money(r.discount_total),
    taxTotal: money(r.tax_total),
    cgst: money(r.cgst),
    sgst: money(r.sgst),
    igst: money(r.igst),
    grandTotal: money(r.grand_total),
    itemCount: lines.length,
    lines,
    notes: r.notes,
    shipTo: r.ship_to,
    challanReason: r.challan_reason,
    transporter: r.transporter,
    vehicleNo: r.vehicle_no,
    dispatchedOn: r.dispatched_on,
    deliveredOn: r.delivered_on,
    receivedBy: r.received_by,
    decidedOn: r.decided_on,
    decisionNote: r.decision_note,
    sourceId: r.source_id,
    sourceNo: parent?.doc_no ?? null,
    sourceKind: parent?.kind ?? null,
    invoiceId: invoiceNo ? r.invoice_id : null,
    invoiceNo,
    deliveredPct: r.kind === "order" ? deliveredPct(lines, challans) : null,
    remaining,
    childCount: liveChildren.length,
    createdBy: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    blocks: {
      edit: editBlock({ kind: r.kind, status: r.status, invoiced: Boolean(invoiceNo), hasChildren: liveChildren.length > 0 }),
      invoice: invoiceBlock({ kind: r.kind, status: r.status, invoiceNo, hasOrder, linkedInvoiced }),
      order: r.kind === "quotation" ? orderBlock({ status: r.status, invoiced: Boolean(invoiceNo), hasOrder }) : null,
      challan: r.kind === "order" && remaining ? challanBlock({ status: r.status }, remaining) : null,
      delete: deleteBlock({ kind: r.kind, status: r.status, invoiceNo, children: children.length }),
    },
  };
}
type DocView = ReturnType<typeof view>;

const summary = ({ lines: _lines, remaining: _remaining, ...rest }: DocView) => rest;

async function loadDoc(deps: BosDeps, tenantId: number, id: string, conn?: PoolConnection) {
  const db = conn ?? deps.db;
  if (conn) await one(conn, `SELECT id FROM bos_sales_docs WHERE id = :id AND tenant_id = :tenantId FOR UPDATE`, { id, tenantId });
  const row = await one<DocRow>(db, `${DOC_SQL} AND d.id = :id`, { tenantId, id });
  if (!row) throw notFound("Sales document");
  const family = await rows<DocRow>(db, `${DOC_SQL} AND (d.id IN (:id, :sourceId) OR d.source_id IN (:id, :sourceId))`, { tenantId, id, sourceId: row.source_id ?? id });
  return view(row, family, todayISO());
}

async function detail(deps: BosDeps, tenantId: number, id: string) {
  const doc = await loadDoc(deps, tenantId, id);
  const children = await rows<DocRow>(deps.db, `${DOC_SQL} AND d.source_id = :id ORDER BY d.doc_date, d.doc_no`, { tenantId, id });
  const today = todayISO();
  const grandchildren = children.length
    ? await rows<DocRow>(deps.db, `${DOC_SQL} AND d.source_id IN (${children.map((_, i) => `:c${i}`).join(", ")})`, {
        tenantId,
        ...Object.fromEntries(children.map((c, i) => [`c${i}`, c.id])),
      })
    : [];
  return { doc, children: children.map((c) => summary(view(c, [...children, ...grandchildren], today))) };
}

/* ---------- Writes ---------- */

function checkDates(d: { docDate: string; validUntil?: string | null; deliveryOn?: string | null }): void {
  if (d.validUntil && d.validUntil < d.docDate) throw new BosError(400, "Valid until can't be before the quotation date");
  if (d.deliveryOn && d.deliveryOn < d.docDate) throw new BosError(400, "The delivery date can't be before the order date");
}

function notFuture(date: string, what: string): void {
  if (date > todayISO()) throw new BosError(400, `${what} can't be in the future`);
}

const bareLines = (lines: ReadonlyArray<BosLineInput>): BosLineInput[] =>
  lines.map((l) => ({ description: l.description, hsn: l.hsn ?? null, unit: l.unit ?? null, quantity: l.quantity, rate: l.rate, discountPct: l.discountPct ?? 0, taxRate: l.taxRate }));

/** Fields that only make sense for one kind are stored as NULL for the others. */
function kindFields(kind: SalesKind, d: Partial<DocFieldsT>) {
  return {
    validUntil: kind === "quotation" ? (d.validUntil ?? (d.docDate ? addDaysISO(d.docDate, QUOTE_VALID_DAYS) : null)) : null,
    deliveryOn: kind === "order" ? (d.deliveryOn ?? null) : null,
    customerRef: kind === "order" ? (d.customerRef ?? null) : null,
    shipTo: kind === "challan" ? (d.shipTo ?? null) : null,
    challanReason: kind === "challan" ? (d.challanReason ?? "supply") : null,
    transporter: kind === "challan" ? (d.transporter ?? null) : null,
    vehicleNo: kind === "challan" ? (d.vehicleNo ?? null) : null,
  };
}

async function priced(deps: BosDeps, tenantId: number, placeOfSupply: string | null | undefined, lines: ReadonlyArray<BosLineInput>) {
  const settings = await getSettings(deps, tenantId);
  const intra = isIntraState(settings.state, placeOfSupply);
  return { settings, intra, totals: computeInvoiceTotals(bareLines(lines), intra) };
}

async function insertDoc(
  deps: BosDeps,
  conn: PoolConnection,
  actor: BosActor,
  kind: SalesKind,
  status: string,
  d: DocFieldsT,
  sourceId: string | null,
): Promise<{ id: string; docNo: string; grandTotal: number }> {
  const { settings, intra, totals } = await priced(deps, actor.tenantId, d.placeOfSupply, d.lines);
  const fy = fiscalYearLabel(d.docDate, settings.fiscalYearStart);
  const docNo = formatDocNo(DOC_PREFIX[kind], fy, await nextSequence(conn, actor.tenantId, SEQ_KEY[kind], fy));
  const id = randomUUID();
  await exec(
    conn,
    `INSERT INTO bos_sales_docs (id, tenant_id, kind, doc_no, status, party_id, party_name, party_gstin, party_address, place_of_supply,
       intra_state, doc_date, valid_until, delivery_on, customer_ref, subtotal, discount_total, tax_total, cgst, sgst, igst, grand_total,
       line_items, notes, ship_to, challan_reason, transporter, vehicle_no, source_id, created_by, created_by_name)
     VALUES (:id, :tenantId, :kind, :docNo, :status, :partyId, :partyName, :partyGstin, :partyAddress, :placeOfSupply,
       :intra, :docDate, :validUntil, :deliveryOn, :customerRef, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :grandTotal,
       :lines, :notes, :shipTo, :challanReason, :transporter, :vehicleNo, :sourceId, :userId, :userName)`,
    {
      id,
      tenantId: actor.tenantId,
      kind,
      docNo,
      status,
      partyId: d.partyId ?? null,
      partyName: d.partyName,
      partyGstin: d.partyGstin ? d.partyGstin.toUpperCase() : null,
      partyAddress: d.partyAddress ?? null,
      placeOfSupply: d.placeOfSupply ?? null,
      intra: intra ? 1 : 0,
      docDate: d.docDate,
      ...kindFields(kind, d),
      ...totals,
      lines: JSON.stringify(totals.lines),
      notes: d.notes ?? null,
      sourceId,
      userId: actor.userId,
      userName: actor.name ?? actor.email ?? null,
    },
  );
  return { id, docNo, grandTotal: totals.grandTotal };
}

/** Copies a document's customer and lines into the fields of the next one in the chain. */
function carry(doc: DocView, lines: ReadonlyArray<BosLineInput>, docDate: string): DocFieldsT {
  return {
    partyId: doc.partyId,
    partyName: doc.partyName,
    partyGstin: doc.partyGstin,
    partyAddress: doc.partyAddress,
    placeOfSupply: doc.placeOfSupply,
    docDate,
    lines: bareLines(lines),
    notes: doc.notes,
    shipTo: doc.partyAddress,
  } as DocFieldsT;
}

/* ---------- Items ---------- */

type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  kind: string;
  hsn: string | null;
  unit: string | null;
  rate: string | number;
  tax_rate: string | number;
  active: number;
};

const mapItem = (r: ItemRow) => ({
  id: r.id,
  name: r.name,
  sku: r.sku,
  kind: r.kind,
  hsn: r.hsn,
  unit: r.unit,
  rate: money(r.rate),
  taxRate: money(r.tax_rate),
  active: Boolean(r.active),
});

async function saveItem(run: () => Promise<unknown>, sku: string | null | undefined): Promise<void> {
  try {
    await run();
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") throw new BosError(409, `Another item already uses SKU ${sku}`);
    throw err;
  }
}

/* ---------- POS ---------- */

const posEnabled = (deps: BosDeps, actor: BosActor) => featureOn(deps, actor, POS_SWITCH);

const POS_OFF = "POS counter billing is turned off. An administrator can turn it on in Admin → Tools → Justx BOS → Switches.";

type PosRow = { id: string; invoice_no: string; party_name: string; grand_total: string | number; status: string; created_at: string; method: string | null };

async function posToday(deps: BosDeps, tenantId: number) {
  const list = await rows<PosRow>(
    deps.db,
    `SELECT i.id, i.invoice_no, i.party_name, i.grand_total, i.status, i.created_at,
       (SELECT p.method FROM bos_payments p WHERE p.tenant_id = i.tenant_id AND p.invoice_id = i.id ORDER BY p.created_at LIMIT 1) AS method
     FROM bos_invoices i
     WHERE i.tenant_id = :tenantId AND i.source_tool = 'pos' AND i.issue_date = :today
     ORDER BY i.created_at DESC`,
    { tenantId, today: todayISO() },
  );
  const bills = list.map((b) => ({ id: b.id, invoiceNo: b.invoice_no, partyName: b.party_name, grandTotal: money(b.grand_total), status: b.status, method: b.method, createdAt: b.created_at }));
  return { bills: bills.slice(0, POS_LIST_LIMIT), truncated: bills.length > POS_LIST_LIMIT, ...posSummary(bills.filter((b) => b.status !== "void")) };
}

/* ---------- Routes ---------- */

export function registerSales(router: Router, deps: BosDeps): void {
  router.get("/sales/overview", async (_req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const [fetched, pos] = await Promise.all([
      rows<DocRow>(deps.db, `${DOC_SQL} ORDER BY d.doc_date DESC, d.doc_no DESC LIMIT ${LIMIT + 1}`, { tenantId: actor.tenantId }),
      posEnabled(deps, actor),
    ]);
    const all = fetched.slice(0, LIMIT);
    const docs = all.map((r) => summary(view(r, all, today)));
    const totals = salesTotals(
      docs.map((d) => ({ kind: d.kind, stage: d.stage, docDate: d.docDate, grandTotal: d.grandTotal, sourceId: d.sourceId, canInvoice: !d.blocks.invoice })),
      today,
    );
    const counter = pos ? await posToday(deps, actor.tenantId) : null;
    res.json({ docs, truncated: fetched.length > LIMIT, totals, pos: counter ? { enabled: true, count: counter.count, total: counter.total, byMethod: counter.byMethod } : { enabled: false } });
  });

  router.get("/sales/docs/:id", async (req, res) => {
    const actor = actorOf(res);
    res.json(await detail(deps, actor.tenantId, req.params.id));
  });

  router.post("/sales/docs", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(CreateDoc, req.body);
    checkDates(input);
    const status = input.kind === "quotation" ? (input.send ? "sent" : "draft") : input.kind === "order" ? "confirmed" : "draft";
    const made = await tx(deps.db, (conn) => insertDoc(deps, conn, actor, input.kind, status, input, null));
    await recordEvent(deps, actor, {
      type: `sales.${input.kind}.create`,
      entityType: "sales",
      entityId: made.id,
      summary: `${input.kind === "order" ? "Booked" : input.send ? "Sent" : "Drafted"} ${KIND_LABEL[input.kind]} ${made.docNo} for ${input.partyName} · ${inr(made.grandTotal)}`,
      ip: req.ip,
    });
    res.status(201).json(await detail(deps, actor.tenantId, made.id));
  });

  router.put("/sales/docs/:id", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(DocFields, req.body);
    checkDates(input);
    const doc = await loadDoc(deps, actor.tenantId, req.params.id);
    if (doc.blocks.edit) throw new BosError(409, doc.blocks.edit);
    const { intra, totals } = await priced(deps, actor.tenantId, input.placeOfSupply, input.lines);
    await exec(
      deps.db,
      `UPDATE bos_sales_docs SET party_id = :partyId, party_name = :partyName, party_gstin = :partyGstin, party_address = :partyAddress,
         place_of_supply = :placeOfSupply, intra_state = :intra, doc_date = :docDate, valid_until = :validUntil, delivery_on = :deliveryOn,
         customer_ref = :customerRef, subtotal = :subtotal, discount_total = :discountTotal, tax_total = :taxTotal, cgst = :cgst, sgst = :sgst,
         igst = :igst, grand_total = :grandTotal, line_items = :lines, notes = :notes, ship_to = :shipTo, challan_reason = :challanReason,
         transporter = :transporter, vehicle_no = :vehicleNo
       WHERE id = :id AND tenant_id = :tenantId`,
      {
        partyId: input.partyId ?? null,
        partyName: input.partyName,
        partyGstin: input.partyGstin ? input.partyGstin.toUpperCase() : null,
        partyAddress: input.partyAddress ?? null,
        placeOfSupply: input.placeOfSupply ?? null,
        intra: intra ? 1 : 0,
        docDate: input.docDate,
        ...kindFields(doc.kind, input),
        ...totals,
        lines: JSON.stringify(totals.lines),
        notes: input.notes ?? null,
        id: doc.id,
        tenantId: actor.tenantId,
      },
    );
    await recordEvent(deps, actor, { type: `sales.${doc.kind}.update`, entityType: "sales", entityId: doc.id, summary: `Updated ${doc.docNo} · ${inr(totals.grandTotal)}`, ip: req.ip });
    res.json(await detail(deps, actor.tenantId, doc.id));
  });

  router.post("/sales/docs/:id/send", async (req, res) => {
    const actor = actorOf(res);
    const doc = await loadDoc(deps, actor.tenantId, req.params.id);
    if (doc.kind !== "quotation" || doc.status !== "draft") throw new BosError(409, "Only draft quotations can be marked as sent");
    await exec(deps.db, `UPDATE bos_sales_docs SET status = 'sent' WHERE id = :id AND tenant_id = :tenantId`, { id: doc.id, tenantId: actor.tenantId });
    await recordEvent(deps, actor, { type: "sales.quotation.send", entityType: "sales", entityId: doc.id, summary: `Sent ${doc.docNo} to ${doc.partyName}`, ip: req.ip });
    res.json(await detail(deps, actor.tenantId, doc.id));
  });

  router.post("/sales/docs/:id/decide", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(DecideInput, req.body);
    const doc = await loadDoc(deps, actor.tenantId, req.params.id);
    if (doc.kind !== "quotation") throw new BosError(409, "Only quotations are accepted or declined");
    if (doc.stage === "converted") throw new BosError(409, "This quotation has already moved on to an order or invoice");
    await exec(deps.db, `UPDATE bos_sales_docs SET status = :status, decided_on = :today, decision_note = :note WHERE id = :id AND tenant_id = :tenantId`, {
      status: input.decision,
      today: todayISO(),
      note: input.note ?? null,
      id: doc.id,
      tenantId: actor.tenantId,
    });
    const accepted = input.decision === "accepted";
    await recordEvent(deps, actor, {
      type: `sales.quotation.${input.decision}`,
      entityType: "sales",
      entityId: doc.id,
      summary: `${doc.partyName} ${accepted ? "accepted" : "declined"} ${doc.docNo} · ${inr(doc.grandTotal)}`,
      notice: accepted ? { kind: "activity", title: "Quotation accepted", body: `${doc.docNo} · ${doc.partyName} · ${inr(doc.grandTotal)}`, path: `?ws=finance&m=salesbilling&open=${doc.id}` } : undefined,
      ip: req.ip,
    });
    res.json(await detail(deps, actor.tenantId, doc.id));
  });

  router.post("/sales/docs/:id/order", async (req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const out = await tx(deps.db, async (conn) => {
      const quote = await loadDoc(deps, actor.tenantId, req.params.id, conn);
      if (quote.kind !== "quotation") throw new BosError(409, "Sales orders are made from quotations");
      if (quote.blocks.order) throw new BosError(409, quote.blocks.order);
      if (quote.status !== "accepted") {
        await exec(conn, `UPDATE bos_sales_docs SET status = 'accepted', decided_on = :today WHERE id = :id`, { today, id: quote.id });
      }
      const order = await insertDoc(deps, conn, actor, "order", "confirmed", carry(quote, quote.lines, today), quote.id);
      return { quote, order };
    });
    await recordEvent(deps, actor, {
      type: "sales.order.create",
      entityType: "sales",
      entityId: out.order.id,
      summary: `Booked sales order ${out.order.docNo} from ${out.quote.docNo} · ${inr(out.order.grandTotal)}`,
      ip: req.ip,
    });
    res.status(201).json(await detail(deps, actor.tenantId, out.order.id));
  });

  router.post("/sales/docs/:id/challan", async (req, res) => {
    const actor = actorOf(res);
    const out = await tx(deps.db, async (conn) => {
      const order = await loadDoc(deps, actor.tenantId, req.params.id, conn);
      if (order.kind !== "order" || !order.remaining) throw new BosError(409, "Delivery challans are made from sales orders");
      if (order.blocks.challan) throw new BosError(409, order.blocks.challan);
      const lines = order.remaining.filter((l) => l.quantity > 0);
      const challan = await insertDoc(deps, conn, actor, "challan", "draft", carry(order, lines, todayISO()), order.id);
      return { order, challan };
    });
    await recordEvent(deps, actor, {
      type: "sales.challan.create",
      entityType: "sales",
      entityId: out.challan.id,
      summary: `Drafted delivery challan ${out.challan.docNo} for ${out.order.docNo}`,
      ip: req.ip,
    });
    res.status(201).json(await detail(deps, actor.tenantId, out.challan.id));
  });

  router.post("/sales/docs/:id/invoice", async (req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const out = await tx(deps.db, async (conn) => {
      const doc = await loadDoc(deps, actor.tenantId, req.params.id, conn);
      if (doc.blocks.invoice) throw new BosError(409, doc.blocks.invoice);
      const settings = await getSettings(deps, actor.tenantId);
      const input = {
        partyId: doc.partyId,
        partyName: doc.partyName,
        partyGstin: doc.partyGstin,
        partyAddress: doc.partyAddress,
        issueDate: today,
        dueDate: addDaysISO(today, settings.paymentTermsDays || 0),
        placeOfSupply: doc.placeOfSupply,
        lines: bareLines(doc.lines),
        sourceTool: "sales",
        sourceRef: doc.docNo,
      } as InvoiceInputT & { sourceTool: string; sourceRef: string };
      const invoice = await createInvoice(deps, actor, input, conn);
      await exec(
        conn,
        `UPDATE bos_sales_docs SET invoice_id = :invoiceId ${doc.kind === "quotation" && doc.status !== "accepted" ? ", status = 'accepted', decided_on = :today" : ""}
         WHERE id = :id`,
        { invoiceId: invoice.id, today, id: doc.id },
      );
      return { doc, invoice };
    });
    await recordEvent(deps, actor, {
      type: "invoice.create",
      entityType: "invoice",
      entityId: out.invoice.id,
      summary: `Drafted ${out.invoice.invoiceNo} from ${KIND_LABEL[out.doc.kind]} ${out.doc.docNo} · ${inr(out.doc.grandTotal)}`,
      ip: req.ip,
    });
    res.status(201).json({ ...(await detail(deps, actor.tenantId, out.doc.id)), invoice: out.invoice });
  });

  router.post("/sales/docs/:id/dispatch", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(DispatchInput, req.body);
    const on = input.dispatchedOn ?? todayISO();
    notFuture(on, "The dispatch date");
    const doc = await loadDoc(deps, actor.tenantId, req.params.id);
    if (doc.kind !== "challan" || doc.status !== "draft") throw new BosError(409, "Only draft delivery challans can be dispatched");
    if (on < doc.docDate) throw new BosError(400, "The dispatch date can't be before the challan date");
    await exec(
      deps.db,
      `UPDATE bos_sales_docs SET status = 'dispatched', dispatched_on = :on, transporter = :transporter, vehicle_no = :vehicleNo WHERE id = :id AND tenant_id = :tenantId`,
      { on, transporter: input.transporter ?? doc.transporter, vehicleNo: input.vehicleNo ?? doc.vehicleNo, id: doc.id, tenantId: actor.tenantId },
    );
    await recordEvent(deps, actor, { type: "sales.challan.dispatch", entityType: "sales", entityId: doc.id, summary: `Dispatched ${doc.docNo} to ${doc.partyName}`, ip: req.ip });
    res.json(await detail(deps, actor.tenantId, doc.id));
  });

  router.post("/sales/docs/:id/deliver", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(DeliverInput, req.body);
    const on = input.deliveredOn ?? todayISO();
    notFuture(on, "The delivery date");
    const doc = await loadDoc(deps, actor.tenantId, req.params.id);
    if (doc.kind !== "challan" || doc.status !== "dispatched") throw new BosError(409, "Only dispatched challans can be marked delivered");
    if (doc.dispatchedOn && on < doc.dispatchedOn) throw new BosError(400, "The delivery date can't be before dispatch");
    await exec(deps.db, `UPDATE bos_sales_docs SET status = 'delivered', delivered_on = :on, received_by = :receivedBy WHERE id = :id AND tenant_id = :tenantId`, {
      on,
      receivedBy: input.receivedBy ?? null,
      id: doc.id,
      tenantId: actor.tenantId,
    });
    await recordEvent(deps, actor, { type: "sales.challan.deliver", entityType: "sales", entityId: doc.id, summary: `Delivered ${doc.docNo} to ${doc.partyName}`, ip: req.ip });
    res.json(await detail(deps, actor.tenantId, doc.id));
  });

  router.post("/sales/docs/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const doc = await tx(deps.db, async (conn) => {
      const d = await loadDoc(deps, actor.tenantId, req.params.id, conn);
      if (d.kind === "quotation") throw new BosError(409, "Mark the quotation as declined instead");
      if (d.status === "cancelled") throw new BosError(409, "Already cancelled");
      if (d.invoiceNo) throw new BosError(409, `Void or delete invoice ${d.invoiceNo} first`);
      if (d.kind === "order") {
        const shipped = await one<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM bos_sales_docs WHERE tenant_id = :tenantId AND source_id = :id AND status IN ('dispatched','delivered')`, {
          tenantId: actor.tenantId,
          id: d.id,
        });
        if (Number(shipped?.n) > 0) throw new BosError(409, "Cancel its dispatched delivery challans first");
        await exec(conn, `UPDATE bos_sales_docs SET status = 'cancelled' WHERE tenant_id = :tenantId AND source_id = :id AND status = 'draft'`, { tenantId: actor.tenantId, id: d.id });
      }
      await exec(conn, `UPDATE bos_sales_docs SET status = 'cancelled' WHERE id = :id`, { id: d.id });
      return d;
    });
    await recordEvent(deps, actor, { type: `sales.${doc.kind}.cancel`, entityType: "sales", entityId: doc.id, summary: `Cancelled ${doc.docNo}`, ip: req.ip });
    res.json(await detail(deps, actor.tenantId, doc.id));
  });

  router.delete("/sales/docs/:id", async (req, res) => {
    const actor = actorOf(res);
    const doc = await loadDoc(deps, actor.tenantId, req.params.id);
    if (doc.blocks.delete) throw new BosError(409, doc.blocks.delete);
    if (doc.status !== "draft" && !isManager(actor)) throw forbidden("Only owners and admins can delete documents that have left draft");
    await exec(deps.db, `DELETE FROM bos_sales_docs WHERE id = :id AND tenant_id = :tenantId`, { id: doc.id, tenantId: actor.tenantId });
    await recordEvent(deps, actor, { type: `sales.${doc.kind}.delete`, entityType: "sales", entityId: doc.id, summary: `Deleted ${KIND_LABEL[doc.kind]} ${doc.docNo}`, ip: req.ip });
    res.status(204).end();
  });

  /* ----- Products & services ----- */

  router.get("/sales/items", async (_req, res) => {
    const actor = actorOf(res);
    const list = await rows<ItemRow>(deps.db, `SELECT * FROM bos_items WHERE tenant_id = :tenantId ORDER BY active DESC, name ASC LIMIT ${LIMIT}`, { tenantId: actor.tenantId });
    res.json({ items: list.map(mapItem) });
  });

  router.post("/sales/items", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const input = parse(ItemInput, req.body);
    const id = randomUUID();
    await saveItem(
      () =>
        exec(
          deps.db,
          `INSERT INTO bos_items (id, tenant_id, name, sku, kind, hsn, unit, rate, tax_rate, active, created_by)
           VALUES (:id, :tenantId, :name, :sku, :kind, :hsn, :unit, :rate, :taxRate, :active, :userId)`,
          { id, tenantId: actor.tenantId, ...input, sku: input.sku ?? null, hsn: input.hsn ?? null, unit: input.unit ?? null, active: input.active ? 1 : 0, userId: actor.userId },
        ),
      input.sku,
    );
    await recordEvent(deps, actor, { type: "sales.item.create", entityType: "sales_item", entityId: id, summary: `Added ${input.kind === "service" ? "service" : "product"} ${input.name}`, ip: req.ip });
    const row = await one<ItemRow>(deps.db, `SELECT * FROM bos_items WHERE id = :id`, { id });
    res.status(201).json({ item: mapItem(row!) });
  });

  router.patch("/sales/items/:id", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const input = parsePatch(ItemInput, req.body);
    const existing = await one<ItemRow>(deps.db, `SELECT * FROM bos_items WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!existing) throw notFound("Item");
    const merged = { ...mapItem(existing), ...input };
    await saveItem(
      () =>
        exec(
          deps.db,
          `UPDATE bos_items SET name = :name, sku = :sku, kind = :kind, hsn = :hsn, unit = :unit, rate = :rate, tax_rate = :taxRate, active = :active
           WHERE id = :id AND tenant_id = :tenantId`,
          { ...merged, sku: merged.sku ?? null, hsn: merged.hsn ?? null, unit: merged.unit ?? null, active: merged.active ? 1 : 0, id: existing.id, tenantId: actor.tenantId },
        ),
      merged.sku,
    );
    await recordEvent(deps, actor, { type: "sales.item.update", entityType: "sales_item", entityId: existing.id, summary: `Updated ${merged.name}`, ip: req.ip });
    const row = await one<ItemRow>(deps.db, `SELECT * FROM bos_items WHERE id = :id`, { id: existing.id });
    res.json({ item: mapItem(row!) });
  });

  router.delete("/sales/items/:id", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const existing = await one<ItemRow>(deps.db, `SELECT * FROM bos_items WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!existing) throw notFound("Item");
    await exec(deps.db, `DELETE FROM bos_items WHERE id = :id AND tenant_id = :tenantId`, { id: existing.id, tenantId: actor.tenantId });
    await recordEvent(deps, actor, { type: "sales.item.delete", entityType: "sales_item", entityId: existing.id, summary: `Removed ${existing.name}`, ip: req.ip });
    res.status(204).end();
  });

  /* ----- POS counter (admin switch) ----- */

  router.get("/sales/pos", async (_req, res) => {
    const actor = actorOf(res);
    if (!(await posEnabled(deps, actor))) {
      res.json({ enabled: false, bills: [], count: 0, total: 0, byMethod: { cash: 0, upi: 0, card: 0 } });
      return;
    }
    res.json({ enabled: true, ...(await posToday(deps, actor.tenantId)) });
  });

  router.post("/sales/pos", async (req, res) => {
    const actor = actorOf(res);
    if (!(await posEnabled(deps, actor))) {
      res.status(403).json({ error: POS_OFF, code: "FEATURE_OFF" });
      return;
    }
    const input = parse(PosInput, req.body);
    const today = todayISO();
    const settings = await getSettings(deps, actor.tenantId);
    const { grandTotal } = computeInvoiceTotals(bareLines(input.lines), true);
    if (grandTotal <= 0) throw new BosError(400, "The bill total must be more than zero");
    const out = await tx(deps.db, async (conn) => {
      const invoice = await createInvoice(
        deps,
        actor,
        {
          partyId: input.partyId ?? null,
          partyName: input.partyName || "Walk-in customer",
          partyGstin: input.partyGstin ?? null,
          partyAddress: null,
          issueDate: today,
          dueDate: today,
          placeOfSupply: settings.state ?? null,
          lines: bareLines(input.lines),
          notes: "Counter sale",
          issue: true,
          sourceTool: "pos",
          sourceRef: null,
        } as InvoiceInputT & { sourceTool: string; sourceRef: null },
        conn,
      );
      await addInvoicePayment(deps, conn, actor, invoice.id, { amount: grandTotal, paidOn: today, method: input.method, reference: input.reference ?? null, notes: null });
      return invoice;
    });
    await recordEvent(deps, actor, {
      type: "invoice.pos",
      entityType: "invoice",
      entityId: out.id,
      summary: `POS bill ${out.invoiceNo} · ${inr(grandTotal)} · ${input.method.toUpperCase()}`,
      payload: { amount: grandTotal, method: input.method },
      ip: req.ip,
    });
    res.status(201).json({ invoice: { id: out.id, invoiceNo: out.invoiceNo, grandTotal }, ...(await posToday(deps, actor.tenantId)) });
  });
}
