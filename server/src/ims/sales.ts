import type { Response, Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, can, isoDate, optText, parse, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { ImsError, badRequest, conflict, notFound, type ImsActor } from "./host.js";
import {
  PAY_METHODS,
  addDaysISO,
  agingBucket,
  allocateFifo,
  arPriority,
  arStatus,
  buildAgingBuckets,
  computeTotals,
  daysBetween,
  dsoDays,
  dueDateFor,
  formatINR,
  gstStateName,
  hsnSummary,
  intraStateFor,
  invoiceBalance,
  invoiceDisplayStatus,
  invoiceNeedsApproval,
  invoiceSkipsStock,
  isArTaxInvoice,
  monthStartISO,
  periodRange,
  posChange,
  reminderLink,
  reminderRuleFor,
  reminderRulesFromOffsets,
  renderTemplate,
  round2,
  todayISO,
  withShippingTotals,
  type ArPriority,
  type ImsLine,
  type InvoiceDocKind,
  type PayMethod,
  type ReminderChannel,
  type ReminderRuleKey,
} from "./logic.js";
import { GspError, buildIrnPayload, cancelIrn, pushIrn, type IrnResult } from "./einvoice/gsp.js";
import { loadGsp, logSync, noteGspOutcome } from "./integrations.js";
import { getSettings, listMembers, type ImsSettings } from "./settings.js";
import { nextDocNo, postMovement } from "./stock.js";
import { allocateInvoicePlanPayment, cancelInvoicePlan, deallocateInvoicePlanPayment, lastDunningByCustomer } from "./wave6-db.js";
import { resolveFx } from "./wave6-logic.js";

/** Invoice ↔ DC links (table in 050). Kept local to avoid a bom ↔ sales import cycle. */
async function listInvoiceDcIds(db: Queryable, tenantId: number, invoiceId: string): Promise<string[]> {
  const list = await rows<{ dc_id: string }>(
    db,
    `SELECT dc_id FROM ims_invoice_dc_links WHERE tenant_id = :tenantId AND invoice_id = :invoiceId`,
    { tenantId, invoiceId },
  );
  return list.map((r) => r.dc_id);
}

/** Invoice ↔ sales-order DC links (table in 059). Same role as {@link listInvoiceDcIds} for SO delivery challans. */
async function listInvoiceSoDcIds(db: Queryable, tenantId: number, invoiceId: string): Promise<string[]> {
  const list = await rows<{ so_dc_id: string }>(
    db,
    `SELECT so_dc_id FROM ims_invoice_so_dc_links WHERE tenant_id = :tenantId AND invoice_id = :invoiceId`,
    { tenantId, invoiceId },
  );
  return list.map((r) => r.so_dc_id);
}

/** Live (non-cancelled) DCs on a BOM — invoice must not also post stock while these exist. */
async function bomHasLiveDcsLocal(db: Queryable, tenantId: number, bomDocId: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM ims_bom_dcs
     WHERE tenant_id = :tenantId AND bom_doc_id = :bomDocId AND status IN ('draft','verified','approved')`,
    { tenantId, bomDocId },
  );
  return Number(row?.n ?? 0) > 0;
}

/* ---------- Shared finance helpers (also used by payables.ts and ledger.ts) ---------- */

export const DRAFT_PREFIX = "DRAFT-";

/** `12 Oct 2026` for message templates (timezone-safe). */
export function dateText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Writes are refused for a business day that has been closed in Daily Closing. */
export async function assertDayOpen(db: Queryable, tenantId: number, date: string): Promise<void> {
  const closed = await one<{ id: string }>(db, `SELECT id FROM ims_daily_closings WHERE tenant_id = :tenantId AND closing_date = :date AND status = 'closed' LIMIT 1`, { tenantId, date });
  if (closed) throw conflict(`${dateText(date)} is closed in Daily Closing. An owner can reopen the day to make changes.`);
}

export type PaymentRow = {
  id: string;
  direction: string;
  party_id: string | null;
  party_name: string;
  doc_type: string;
  doc_id: string | null;
  doc_no: string | null;
  amount: string;
  method: string;
  reference: string | null;
  paid_on: unknown;
  run_id: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
};

export const mapPayment = (r: PaymentRow) => ({
  id: r.id,
  direction: r.direction as "in" | "out",
  partyId: r.party_id,
  partyName: r.party_name,
  docType: r.doc_type as "invoice" | "bill" | "on_account",
  docId: r.doc_id,
  docNo: r.doc_no,
  amount: round2(money(r.amount)),
  method: r.method,
  reference: r.reference,
  paidOn: isoOf(r.paid_on),
  runId: r.run_id,
  notes: r.notes,
  createdByName: r.created_by_name,
  createdAt: tsOf(r.created_at),
});

export type PaymentInsert = {
  direction: "in" | "out";
  partyId: string | null;
  partyName: string;
  docType: "invoice" | "bill" | "on_account";
  docId: string | null;
  docNo: string | null;
  amount: number;
  method: PayMethod;
  reference?: string | null;
  paidOn: string;
  runId?: string | null;
  notes?: string | null;
};

export async function insertPayment(conn: Queryable, actor: ImsActor, p: PaymentInsert): Promise<string> {
  const id = randomUUID();
  await exec(
    conn,
    `INSERT INTO ims_payments (id, tenant_id, direction, party_id, party_name, doc_type, doc_id, doc_no, amount, method, reference, paid_on, run_id, notes, created_by, created_by_name)
     VALUES (:id, :tenantId, :direction, :partyId, :partyName, :docType, :docId, :docNo, :amount, :method, :reference, :paidOn, :runId, :notes, :userId, :userName)`,
    {
      id,
      tenantId: actor.tenantId,
      direction: p.direction,
      partyId: p.partyId,
      partyName: p.partyName.slice(0, 200),
      docType: p.docType,
      docId: p.docId,
      docNo: p.docNo,
      amount: round2(p.amount),
      method: p.method,
      reference: p.reference ?? null,
      paidOn: p.paidOn,
      runId: p.runId ?? null,
      notes: p.notes ?? null,
      userId: actor.userId,
      userName: actorName(actor),
    },
  );
  return id;
}

export const PaymentInput = z.object({
  amount: z.coerce.number().positive("Amount must be more than zero").max(1e12),
  date: isoDate.optional(),
  method: z.enum(PAY_METHODS).default("cash"),
  reference: optText(80),
  notes: optText(500),
});

/* ---------- Invoices ---------- */

export type InvoiceRow = {
  id: string;
  invoice_no: string;
  doc_kind?: string;
  against_invoice_id?: string | null;
  against_invoice_no?: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string;
  customer_gstin: string | null;
  customer_address: string | null;
  customer_mobile: string | null;
  customer_po_no?: string | null;
  ship_to_name?: string | null;
  ship_to_gstin?: string | null;
  ship_to_address?: string | null;
  ship_to_state?: string | null;
  ship_to_mobile?: string | null;
  place_of_supply: string | null;
  intra_state: number;
  invoice_date: unknown;
  due_date: unknown;
  lines: unknown;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  cgst: string;
  sgst: string;
  igst: string;
  shipping_charges?: string | number | null;
  shipping_gst_rate?: string | number | null;
  shipping_tax?: string | number | null;
  round_off: string;
  grand_total: string;
  amount_paid: string;
  credit_applied?: string | number | null;
  advance_applied?: string | number | null;
  approved_by?: number | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  approval_note?: string | null;
  pay_mode: string | null;
  stock_posted: number;
  account_manager_id: number | null;
  account_manager_name: string | null;
  promise_date: unknown;
  promise_amount: string | null;
  disputed: number;
  dispute_reason?: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
  auto_reminder?: number;
  round_to_rupee?: number;
  source_tool: string | null;
  source_ref: string | null;
  /** Joined BOM doc_no (or other human label) when available. */
  source_label?: string | null;
  notes: string | null;
  terms: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  issued_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  einv_status?: string | null;
  currency_code?: string | null;
  fx_rate?: string | number | null;
  fx_base_total?: string | number | null;
  portal_token?: string | null;
  irn?: string | null;
  ack_no?: string | null;
  ack_at?: string | null;
  signed_qr?: string | null;
  eway_bill_no?: string | null;
  eway_valid_upto?: string | null;
  party_mobile?: string | null;
  party_email?: string | null;
  party_state?: string | null;
  last_reminder_channel?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Business-facing source document number — never expose raw UUIDs on papers/UI. */
function invoiceSourceLabel(r: Pick<InvoiceRow, "source_tool" | "source_ref" | "source_label">): string | null {
  const joined = r.source_label?.trim() || null;
  if (joined) return joined;
  const ref = r.source_ref?.trim() || null;
  if (!ref) return null;
  if (r.source_tool === "pos") return ref;
  if (UUID_RE.test(ref)) return null;
  return ref;
}

export type InvoiceMapOpts = {
  withLines?: boolean;
  agingBreaks?: ReadonlyArray<number>;
  arPriority?: import("./logic.js").ArPriorityThresholds;
};

export function invoiceMapOptsFromSettings(settings: ImsSettings, withLines = false): InvoiceMapOpts {
  return { withLines, agingBreaks: settings.agingBreaks, arPriority: settings.arPriority };
}

export function mapInvoice(r: InvoiceRow, today: string, opts: boolean | InvoiceMapOpts = false) {
  const o: InvoiceMapOpts = typeof opts === "boolean" ? { withLines: opts } : opts;
  const withLines = Boolean(o.withLines);
  const grandTotal = round2(money(r.grand_total));
  const amountPaid = round2(money(r.amount_paid));
  const creditApplied = round2(money(r.credit_applied ?? 0));
  const advanceApplied = round2(money(r.advance_applied ?? 0));
  const retentionAmount = round2(money((r as { retention_amount?: string | number }).retention_amount ?? 0));
  const retentionPct = round2(money((r as { retention_pct?: string | number }).retention_pct ?? 0));
  const docKind = (r.doc_kind || "tax_invoice") as InvoiceDocKind;
  const dueDate = r.due_date ? isoOf(r.due_date) : null;
  const base = { status: r.status, grandTotal, amountPaid, dueDate, creditApplied, advanceApplied, retentionAmount, docKind };
  const balance = invoiceBalance(base);
  const open = isArTaxInvoice(docKind) && r.status === "issued" && balance > 0.005;
  const daysOverdue = open && dueDate ? Math.max(0, daysBetween(dueDate, today)) : 0;
  const invoiceDate = isoOf(r.invoice_date);
  const subtotal = round2(money(r.subtotal));
  const discountTotal = round2(money(r.discount_total));
  const lines = json<ImsLine[]>(r.lines, []);
  const promiseDate = r.promise_date ? isoOf(r.promise_date) : null;
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    isDraftNo: r.invoice_no.startsWith(DRAFT_PREFIX),
    docKind,
    againstInvoiceId: r.against_invoice_id ?? null,
    againstInvoiceNo: r.against_invoice_no ?? null,
    status: r.status as "draft" | "pending_approval" | "issued" | "cancelled",
    displayStatus: invoiceDisplayStatus(base, today),
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerGstin: r.customer_gstin,
    customerAddress: r.customer_address,
    customerMobile: r.customer_mobile || r.party_mobile || null,
    customerEmail: r.party_email ?? null,
    customerPoNo: r.customer_po_no ?? null,
    shipToName: r.ship_to_name ?? null,
    shipToGstin: r.ship_to_gstin ?? null,
    shipToAddress: r.ship_to_address ?? null,
    shipToState: r.ship_to_state ?? null,
    shipToMobile: r.ship_to_mobile ?? null,
    placeOfSupply: r.place_of_supply,
    intraState: Boolean(r.intra_state),
    invoiceDate,
    dueDate,
    subtotal,
    discountTotal,
    taxable: round2(subtotal - discountTotal),
    taxTotal: round2(money(r.tax_total)),
    cgst: round2(money(r.cgst)),
    sgst: round2(money(r.sgst)),
    igst: round2(money(r.igst)),
    shippingCharges: round2(money(r.shipping_charges ?? 0)),
    shippingGstRate: round2(money(r.shipping_gst_rate ?? 0)),
    shippingTax: round2(money(r.shipping_tax ?? 0)),
    retentionPct,
    retentionAmount,
    progressPct: (() => {
      const raw = (r as { progress_pct?: string | number | null }).progress_pct;
      if (raw == null || raw === "") return null;
      return round2(money(raw));
    })(),
    progressLabel: (r as { progress_label?: string | null }).progress_label ?? null,
    recurringId: (r as { recurring_id?: string | null }).recurring_id ?? null,
    roundOff: round2(money(r.round_off)),
    roundToRupee: Boolean(r.round_to_rupee),
    grandTotal,
    currencyCode: r.currency_code || "INR",
    fxRate: r.fx_rate == null ? 1 : Number(money(r.fx_rate).toFixed(8)),
    fxBaseTotal: r.fx_base_total == null ? grandTotal : round2(money(r.fx_base_total)),
    portalEnabled: Boolean(r.portal_token),
    amountPaid,
    creditApplied,
    advanceApplied,
    balance,
    payMode: r.pay_mode,
    approvedBy: r.approved_by == null ? null : Number(r.approved_by),
    approvedByName: r.approved_by_name ?? null,
    approvedAt: tsOf(r.approved_at),
    approvalNote: r.approval_note ?? null,
    stockPosted: Boolean(r.stock_posted),
    accountManagerId: r.account_manager_id == null ? null : Number(r.account_manager_id),
    accountManagerName: r.account_manager_name,
    promiseDate,
    promiseAmount: r.promise_amount == null ? null : round2(money(r.promise_amount)),
    disputed: Boolean(r.disputed),
    disputeReason: r.dispute_reason ?? null,
    lastReminderAt: tsOf(r.last_reminder_at),
    lastReminderChannel: r.last_reminder_channel ?? null,
    reminderCount: Number(r.reminder_count) || 0,
    autoReminder: r.auto_reminder === undefined ? true : Boolean(r.auto_reminder),
    sourceTool: r.source_tool,
    sourceRef: r.source_ref,
    sourceLabel: invoiceSourceLabel(r),
    notes: r.notes,
    terms: r.terms,
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    issuedAt: tsOf(r.issued_at),
    cancelledAt: tsOf(r.cancelled_at),
    cancelReason: r.cancel_reason ?? null,
    einvStatus: r.einv_status ?? null,
    irn: r.irn ?? null,
    ackNo: r.ack_no ?? null,
    ackAt: tsOf(r.ack_at),
    signedQr: r.signed_qr ?? null,
    ewayBillNo: r.eway_bill_no ?? null,
    ewayValidUpto: tsOf(r.eway_valid_upto),
    daysOverdue,
    ageDays: Math.max(0, daysBetween(invoiceDate, today)),
    agingBucket: agingBucket(daysOverdue, o.agingBreaks),
    priority: arPriority(daysOverdue, o.arPriority) as ArPriority,
    arStatus: arStatus({ disputed: Boolean(r.disputed), promiseDate, dueDate, amountPaid: amountPaid + creditApplied + advanceApplied }, today),
    lineCount: lines.length,
    ...(withLines ? { lines } : {}),
  };
}

export type ImsInvoice = ReturnType<typeof mapInvoice>;

export const INVOICE_SELECT = `SELECT i.*, p.mobile AS party_mobile, p.email AS party_email, p.state AS party_state,
  CASE
    WHEN i.source_tool = 'ims_bom' THEN b.doc_no
    WHEN i.source_tool = 'pos' THEN i.source_ref
    ELSE NULL
  END AS source_label
  FROM ims_invoices i
  LEFT JOIN ims_parties p ON p.id = i.customer_id AND p.tenant_id = i.tenant_id
  LEFT JOIN ims_bom_docs b ON i.source_tool = 'ims_bom' AND b.id = i.source_ref AND b.tenant_id = i.tenant_id`;

export async function loadInvoiceRow(db: Queryable, tenantId: number, id: string, lock = false): Promise<InvoiceRow> {
  const r = lock
    ? await one<InvoiceRow>(db, `SELECT * FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`, { tenantId, id })
    : await one<InvoiceRow>(db, `${INVOICE_SELECT} WHERE i.tenant_id = :tenantId AND i.id = :id LIMIT 1`, { tenantId, id });
  if (!r) throw notFound("Invoice");
  return r;
}

type ActivityRow = {
  id: string;
  party_id: string | null;
  party_name: string | null;
  invoice_id: string | null;
  kind: string;
  channel: string | null;
  template_key: string | null;
  message: string | null;
  promise_date: unknown;
  promise_amount: string | null;
  status: string | null;
  created_by_name: string | null;
  created_at: string;
};

const mapActivity = (r: ActivityRow) => ({
  id: r.id,
  partyId: r.party_id,
  partyName: r.party_name,
  invoiceId: r.invoice_id,
  kind: r.kind,
  channel: r.channel,
  templateKey: r.template_key,
  message: r.message,
  promiseDate: r.promise_date ? isoOf(r.promise_date) : null,
  promiseAmount: r.promise_amount == null ? null : round2(money(r.promise_amount)),
  status: r.status,
  createdByName: r.created_by_name,
  createdAt: tsOf(r.created_at),
});

export async function addActivity(
  db: Queryable,
  actor: ImsActor,
  a: { invoiceId: string | null; partyId: string | null; partyName: string | null; kind: string; channel?: string | null; templateKey?: string | null; message?: string | null; promiseDate?: string | null; promiseAmount?: number | null; status?: string | null },
): Promise<void> {
  await exec(
    db,
    `INSERT INTO ims_ar_activity (id, tenant_id, party_id, party_name, invoice_id, kind, channel, template_key, message, promise_date, promise_amount, status, created_by, created_by_name)
     VALUES (:id, :tenantId, :partyId, :partyName, :invoiceId, :kind, :channel, :templateKey, :message, :promiseDate, :promiseAmount, :status, :userId, :userName)`,
    {
      id: randomUUID(),
      tenantId: actor.tenantId,
      partyId: a.partyId,
      partyName: a.partyName,
      invoiceId: a.invoiceId,
      kind: a.kind,
      channel: a.channel ?? null,
      templateKey: a.templateKey ?? null,
      message: a.message ?? null,
      promiseDate: a.promiseDate ?? null,
      promiseAmount: a.promiseAmount ?? null,
      status: a.status ?? null,
      userId: actor.userId,
      userName: actorName(actor),
    },
  );
}

export async function invoiceDetail(deps: ImsDeps, tenantId: number, id: string) {
  const today = todayISO();
  const [r, settings] = await Promise.all([loadInvoiceRow(deps.db, tenantId, id), getSettings(deps, tenantId)]);
  const invoice = mapInvoice(r, today, invoiceMapOptsFromSettings(settings, true));
  const [payments, activity, dcLinkRows] = await Promise.all([
    rows<PaymentRow>(deps.db, `SELECT * FROM ims_payments WHERE tenant_id = :tenantId AND doc_type = 'invoice' AND doc_id = :id ORDER BY paid_on DESC, created_at DESC`, { tenantId, id }),
    rows<ActivityRow>(deps.db, `SELECT * FROM ims_ar_activity WHERE tenant_id = :tenantId AND invoice_id = :id ORDER BY created_at DESC LIMIT 200`, { tenantId, id }),
    rows<{ dc_id: string; doc_no: string; status: string; stock_posted: number }>(
      deps.db,
      `SELECT l.dc_id, d.doc_no, d.status, d.stock_posted
       FROM ims_invoice_dc_links l
       INNER JOIN ims_bom_dcs d ON d.id = l.dc_id AND d.tenant_id = l.tenant_id
       WHERE l.tenant_id = :tenantId AND l.invoice_id = :id
       ORDER BY d.doc_no ASC`,
      { tenantId, id },
    ),
  ]);
  const dcLinks = dcLinkRows.map((d) => ({
    id: d.dc_id,
    docNo: d.doc_no,
    status: d.status,
    stockPosted: Boolean(d.stock_posted),
  }));
  return {
    invoice: { ...invoice, dcIds: dcLinks.map((d) => d.id), dcLinks, portalToken: r.portal_token ?? null },
    hsn: hsnSummary(invoice.lines ?? []),
    payments: payments.map(mapPayment),
    activity: activity.map(mapActivity),
  };
}

export const LineInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Every line needs a description").max(200),
  sku: optText(64),
  hsn: optText(20),
  unit: optText(20),
  qty: z.coerce.number().positive("Quantity must be more than zero").max(1e9),
  rate: z.coerce.number().min(0).max(1e10),
  discountPct: z.coerce.number().min(0).max(100).optional(),
  gstRate: z.coerce.number().min(0).max(100),
});

const InvoiceInput = z.object({
  customerId: z.string().uuid().nullable().optional(),
  customerName: z.string().trim().min(1, "Pick a customer or type a name").max(200),
  customerGstin: optText(20),
  customerAddress: optText(500),
  customerMobile: optText(40),
  customerPoNo: optText(64),
  shipToName: optText(200),
  shipToGstin: optText(20),
  shipToAddress: optText(500),
  shipToState: optText(80),
  shipToMobile: optText(40),
  placeOfSupply: optText(80),
  invoiceDate: isoDate,
  dueDate: isoDate.nullable().optional(),
  docKind: z.enum(["tax_invoice", "proforma", "credit_note", "debit_note", "retainer"]).optional(),
  shippingCharges: z.coerce.number().min(0).max(1e10).optional(),
  shippingGstRate: z.coerce.number().min(0).max(100).optional(),
  retentionPct: z.coerce.number().min(0).max(100).optional(),
  progressPct: z.coerce.number().min(0).max(100).nullable().optional(),
  progressLabel: optText(120),
  accountManagerId: z.coerce.number().int().positive().nullable().optional(),
  accountManagerName: optText(120),
  /** Document currency (ISO-4217). Defaults to the business base currency. */
  currencyCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code (e.g. USD)")
    .optional(),
  /** Locked FX rate vs base currency (units of base per 1 unit of document currency). Forced to 1 when currency = base. */
  fxRate: z.coerce.number().positive("FX rate must be more than zero").max(1e9).optional(),
  lines: z.array(LineInput).min(1, "Add at least one line").max(300),
  roundToRupee: z.boolean().default(false),
  notes: optText(4000),
  terms: optText(4000),
});
type InvoiceInputT = z.infer<typeof InvoiceInput>;

type PartyLite = {
  id: string;
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  mobile: string | null;
  payment_terms_days: number | null;
  account_manager_id: number | null;
  account_manager_name: string | null;
};

async function partyLite(db: Queryable, tenantId: number, id: string | null | undefined): Promise<PartyLite | null> {
  if (!id) return null;
  const p = await one<PartyLite>(
    db,
    `SELECT id, name, gstin, address, city, state, mobile, payment_terms_days, account_manager_id, account_manager_name FROM ims_parties WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
    { tenantId, id },
  );
  if (!p) throw notFound("Customer");
  return p;
}

/** Carries a source document's currency + locked rate onto a derived draft (duplicate, credit/debit note, proforma). */
function srcFx(src: Pick<InvoiceRow, "currency_code" | "fx_rate">): { currencyCode: string; fxRate: number } {
  return { currencyCode: src.currency_code || "INR", fxRate: money(src.fx_rate ?? 1) || 1 };
}

/** Column values for an invoice from the editor input (GST split, totals, due date from terms). */
async function invoiceValues(db: Queryable, actor: ImsActor, settings: ImsSettings, input: InvoiceInputT) {
  const party = await partyLite(db, actor.tenantId, input.customerId);
  const gstin = input.customerGstin?.trim().toUpperCase() || party?.gstin || null;
  const placeOfSupply = input.placeOfSupply?.trim() || party?.state || gstStateName(gstin) || settings.state || null;
  const intra = intraStateFor(settings, placeOfSupply);
  const baseTotals = computeTotals(input.lines, intra, false);
  const totals = withShippingTotals(baseTotals, {
    shippingCharges: input.shippingCharges ?? 0,
    shippingGstRate: input.shippingGstRate ?? 0,
    intraState: intra,
    roundToRupee: input.roundToRupee,
  });
  const dueDate = input.dueDate ?? dueDateFor(input.invoiceDate, party?.payment_terms_days ?? null, settings.paymentTermsDays);
  if (dueDate < input.invoiceDate) throw badRequest("The due date can't be before the invoice date");
  const address = input.customerAddress?.trim() || [party?.address, party?.city].filter(Boolean).join(", ") || null;
  const docKind = (input.docKind ?? "tax_invoice") as InvoiceDocKind;
  const fx = resolveFx({ currencyCode: input.currencyCode, fxRate: input.fxRate, baseCurrency: settings.baseCurrency, grandTotal: totals.grandTotal });
  return {
    currencyCode: fx.currencyCode,
    fxRate: fx.fxRate,
    fxBaseTotal: fx.fxBaseTotal,
    customerId: party?.id ?? null,
    customerName: input.customerName.trim(),
    customerGstin: gstin,
    customerAddress: address,
    customerMobile: input.customerMobile?.trim() || party?.mobile || null,
    customerPoNo: input.customerPoNo?.trim() || null,
    shipToName: input.shipToName?.trim() || null,
    shipToGstin: input.shipToGstin?.trim().toUpperCase() || null,
    shipToAddress: input.shipToAddress?.trim() || null,
    shipToState: input.shipToState?.trim() || null,
    shipToMobile: input.shipToMobile?.trim() || null,
    placeOfSupply,
    intraState: intra ? 1 : 0,
    invoiceDate: input.invoiceDate,
    dueDate,
    docKind,
    lines: JSON.stringify(totals.lines),
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    shippingCharges: totals.shippingCharges,
    shippingGstRate: totals.shippingGstRate,
    shippingTax: totals.shippingTax,
    retentionPct: Math.max(0, Math.min(100, Number(input.retentionPct) || 0)),
    retentionAmount: (() => {
      const pct = Math.max(0, Math.min(100, Number(input.retentionPct) || 0));
      return pct > 0 ? round2((totals.grandTotal * pct) / 100) : 0;
    })(),
    progressPct: input.progressPct == null ? null : Math.max(0, Math.min(100, Number(input.progressPct) || 0)),
    progressLabel: input.progressLabel?.trim() || null,
    roundOff: totals.roundOff,
    grandTotal: totals.grandTotal,
    roundToRupee: input.roundToRupee ? 1 : 0,
    accountManagerId: input.accountManagerId !== undefined ? input.accountManagerId : (party?.account_manager_id ?? null),
    accountManagerName:
      input.accountManagerId !== undefined
        ? input.accountManagerName?.trim() || null
        : (party?.account_manager_name ?? null),
    notes: input.notes ?? null,
    terms: input.terms ?? settings.terms ?? null,
  };
}

async function insertInvoice(
  db: Queryable,
  actor: ImsActor,
  id: string,
  values: Awaited<ReturnType<typeof invoiceValues>>,
  extra: {
    sourceTool?: string | null;
    sourceRef?: string | null;
    againstInvoiceId?: string | null;
    againstInvoiceNo?: string | null;
    docKind?: InvoiceDocKind;
  } = {},
) {
  const docKind = extra.docKind ?? values.docKind ?? "tax_invoice";
  await exec(
    db,
    `INSERT INTO ims_invoices
       (id, tenant_id, invoice_no, doc_kind, against_invoice_id, against_invoice_no, status, customer_id, customer_name, customer_gstin, customer_address, customer_mobile,
        customer_po_no, ship_to_name, ship_to_gstin, ship_to_address, ship_to_state, ship_to_mobile, place_of_supply, intra_state,
        invoice_date, due_date, \`lines\`, subtotal, discount_total, tax_total, cgst, sgst, igst, shipping_charges, shipping_gst_rate, shipping_tax,
        retention_pct, retention_amount, progress_pct, progress_label, round_off, grand_total, currency_code, fx_rate, fx_base_total, round_to_rupee,
        account_manager_id, account_manager_name, source_tool, source_ref, notes, terms, created_by, created_by_name)
     VALUES
       (:id, :tenantId, :invoiceNo, :docKind, :againstInvoiceId, :againstInvoiceNo, 'draft', :customerId, :customerName, :customerGstin, :customerAddress, :customerMobile,
        :customerPoNo, :shipToName, :shipToGstin, :shipToAddress, :shipToState, :shipToMobile, :placeOfSupply, :intraState,
        :invoiceDate, :dueDate, :lines, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :shippingCharges, :shippingGstRate, :shippingTax,
        :retentionPct, :retentionAmount, :progressPct, :progressLabel, :roundOff, :grandTotal, :currencyCode, :fxRate, :fxBaseTotal, :roundToRupee,
        :accountManagerId, :accountManagerName, :sourceTool, :sourceRef, :notes, :terms, :userId, :userName)`,
    {
      ...values,
      id,
      tenantId: actor.tenantId,
      invoiceNo: `${DRAFT_PREFIX}${id.slice(0, 8).toUpperCase()}`,
      docKind,
      againstInvoiceId: extra.againstInvoiceId ?? null,
      againstInvoiceNo: extra.againstInvoiceNo ?? null,
      sourceTool: extra.sourceTool ?? null,
      sourceRef: extra.sourceRef ?? null,
      userId: actor.userId,
      userName: actorName(actor),
    },
  );
}

/** Create a draft (or draft+issue) invoice from another IMS module (e.g. BOM). */
export async function createLinkedInvoice(
  deps: ImsDeps,
  actor: ImsActor,
  input: InvoiceInputT & { issue?: boolean; sourceTool?: string | null; sourceRef?: string | null },
  hooks?: {
    /** Runs inside the invoice transaction before insert (use FOR UPDATE locks here). */
    before?: (conn: PoolConnection) => Promise<void>;
    /** After insert, before optional issue — e.g. link delivery challans so issue skips stock OUT. */
    afterInsert?: (conn: PoolConnection, invoiceId: string) => Promise<void>;
    /** Runs inside the same transaction after insert/issue so callers can link source rows atomically. */
    after?: (conn: PoolConnection, invoiceId: string) => Promise<void>;
  },
) {
  const settings = await getSettings(deps, actor.tenantId);
  const id = randomUUID();
  const values = await invoiceValues(deps.db, actor, settings, input);
  const invoiceNo = await tx(deps.db, async (conn) => {
    await hooks?.before?.(conn);
    await insertInvoice(conn, actor, id, values, { sourceTool: input.sourceTool ?? null, sourceRef: input.sourceRef ?? null });
    await hooks?.afterInsert?.(conn, id);
    const issuedNo = input.issue ? (await issueDraft(conn, actor, settings, id, "invoice")).invoiceNo : null;
    await hooks?.after?.(conn, id);
    return issuedNo;
  });
  await recordEvent(deps, actor, {
    type: input.issue ? "invoice.issued" : "invoice.created",
    entityType: "invoice",
    entityId: id,
    summary: input.issue
      ? `Issued invoice ${invoiceNo} to ${values.customerName} (${formatINR(values.grandTotal)})`
      : `Saved draft invoice for ${values.customerName} (${formatINR(values.grandTotal)})`,
  });
  if (input.issue) await autoPushIrn(deps, actor, id);
  return invoiceDetail(deps, actor.tenantId, id);
}

/**
 * Issue a draft in the caller's transaction: number it, post an OUT movement for every item-linked
 * line (respecting the negative-stock rule) and mark stock as posted.
 * When the invoice links one or more delivery challans, stock was already moved on DC approve — skip OUT.
 */
async function issueDraft(
  conn: PoolConnection,
  actor: ImsActor,
  settings: ImsSettings,
  id: string,
  refType: "invoice" | "pos",
  opts: { fromApproval?: boolean } = {},
): Promise<{ invoiceNo: string; row: InvoiceRow; pendingApproval?: boolean }> {
  const row = await loadInvoiceRow(conn, actor.tenantId, id, true);
  const fromApproval = opts.fromApproval === true;
  if (fromApproval) {
    if (row.status !== "pending_approval") throw conflict("Only invoices waiting for approval can be approved");
  } else if (row.status === "pending_approval") {
    throw conflict("This invoice is waiting for approval — ask an approver, or withdraw it first");
  } else if (row.status !== "draft") {
    throw conflict("Only draft invoices can be issued");
  }
  const lines = json<ImsLine[]>(row.lines, []);
  if (!lines.length) throw badRequest("Add at least one line before issuing");
  if (money(row.grand_total) <= 0) throw badRequest("The invoice total must be more than zero");
  if (!row.customer_name.trim()) throw badRequest("Pick a customer before issuing");
  const invoiceDate = isoOf(row.invoice_date);
  await assertDayOpen(conn, actor.tenantId, invoiceDate);

  const docKind = (row.doc_kind || "tax_invoice") as InvoiceDocKind;
  if (docKind === "credit_note" && !row.against_invoice_id) {
    throw badRequest("A credit note must be linked to the original tax invoice");
  }

  // Gate tax invoices / debit notes / retainers over the approval limit (POS never queues).
  const approvalEligible = docKind === "tax_invoice" || docKind === "debit_note" || docKind === "retainer";
  if (
    !fromApproval &&
    refType === "invoice" &&
    approvalEligible &&
    invoiceNeedsApproval(money(row.grand_total), settings.invoiceApprovalLimit)
  ) {
    await exec(
      conn,
      `UPDATE ims_invoices SET status = 'pending_approval', approval_note = NULL, approved_by = NULL, approved_by_name = NULL, approved_at = NULL
       WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
      { tenantId: actor.tenantId, id },
    );
    await addActivity(conn, actor, {
      invoiceId: id,
      partyId: row.customer_id,
      partyName: row.customer_name,
      kind: "approval",
      message: `Submitted for approval (≥ ${formatINR(settings.invoiceApprovalLimit)} limit)`,
      status: "pending",
    });
    return { invoiceNo: row.invoice_no, row: { ...row, status: "pending_approval" }, pendingApproval: true };
  }

  /** Tally drafts keep the original voucher number (source_ref, or parsed from notes if an older import stored a GUID). */
  let invoiceNo: string | null = null;
  if (row.source_tool === "tally") {
    let tallyNo = row.source_ref?.trim() || null;
    if (tallyNo && (UUID_RE.test(tallyNo) || tallyNo.length > 48)) tallyNo = null;
    if (!tallyNo && row.notes) {
      const fromNotes = /Tally invoice\s+([^·\n]+)/i.exec(row.notes);
      if (fromNotes) tallyNo = fromNotes[1].trim().slice(0, 48) || null;
    }
    if (tallyNo) {
      const taken = await one<{ id: string; invoice_no: string }>(
        conn,
        `SELECT id, invoice_no FROM ims_invoices WHERE tenant_id = :tenantId AND invoice_no = :no AND id <> :id LIMIT 1`,
        { tenantId: actor.tenantId, no: tallyNo, id },
      );
      if (taken) throw conflict(`Tally voucher number ${tallyNo} is already used by another IMS invoice — resolve the duplicate before issuing`);
      invoiceNo = tallyNo;
    }
  }
  if (!invoiceNo) {
    const prefix =
      docKind === "credit_note"
        ? settings.cnPrefix
        : docKind === "debit_note"
          ? settings.dnPrefix
          : docKind === "proforma"
            ? settings.proformaPrefix
            : docKind === "retainer"
              ? settings.retainerPrefix
              : settings.invoicePrefix;
    const seqKey =
      docKind === "credit_note"
        ? "credit_note"
        : docKind === "debit_note"
          ? "debit_note"
          : docKind === "proforma"
            ? "proforma"
            : docKind === "retainer"
              ? "retainer"
              : "invoice";
    invoiceNo = await nextDocNo(conn, actor.tenantId, seqKey, prefix, invoiceDate, settings.businessName);
  }

  /** Credit notes, debit notes, proformas and retainers never post sales stock OUT. */
  const nonStockDoc = invoiceSkipsStock(docKind);

  const dcIds = await listInvoiceDcIds(conn, actor.tenantId, id);
  const soDcIds = await listInvoiceSoDcIds(conn, actor.tenantId, id);
  let stockViaDc = false;
  if (nonStockDoc && (dcIds.length || soDcIds.length)) {
    throw conflict("Credit notes, debit notes and proformas cannot link delivery challans");
  }
  if (dcIds.length && soDcIds.length) {
    throw conflict("An invoice can't link both BOM and sales-order delivery challans");
  }
  if (dcIds.length) {
    // Re-validate under lock — reverse/return may have invalidated links between draft and issue.
    if (!(row.source_tool === "ims_bom" && row.source_ref)) {
      throw conflict("Delivery challan links are only valid on invoices created from a BOM. Remove the links before issuing.");
    }
    for (const dcId of dcIds) {
      const dc = await one<{ status: string; stock_posted: number; bom_doc_id: string; doc_no: string }>(
        conn,
        `SELECT status, stock_posted, bom_doc_id, doc_no FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: dcId },
      );
      if (!dc || dc.status !== "approved" || !dc.stock_posted) {
        throw conflict(
          `Linked delivery challan ${dc?.doc_no ?? dcId} must stay approved with stock posted. Unlink it or re-approve before issuing.`,
        );
      }
      if (dc.bom_doc_id !== row.source_ref) {
        throw conflict(`Linked delivery challan ${dc.doc_no} belongs to a different BOM`);
      }
    }
    stockViaDc = true;
  } else if (soDcIds.length) {
    // Sales-order DCs: stock already left on DC approve, so the invoice must not post a second OUT.
    if (!(row.source_tool === "ims_so" && row.source_ref)) {
      throw conflict("Sales-order delivery challan links are only valid on invoices created from a sales order. Remove the links before issuing.");
    }
    for (const dcId of soDcIds) {
      const dc = await one<{ status: string; stock_posted: number; sales_order_id: string; doc_no: string }>(
        conn,
        `SELECT status, stock_posted, sales_order_id, doc_no FROM ims_so_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: dcId },
      );
      if (!dc || dc.status !== "approved" || !dc.stock_posted) {
        throw conflict(
          `Linked delivery challan ${dc?.doc_no ?? dcId} must stay approved with stock posted. Unlink it or re-approve before issuing.`,
        );
      }
      if (dc.sales_order_id !== row.source_ref) {
        throw conflict(`Linked delivery challan ${dc.doc_no} belongs to a different sales order`);
      }
    }
    stockViaDc = true;
  } else if (row.source_tool === "ims_bom" && row.source_ref) {
    // Lump-sum (or unlinked) issue must not leave approved DCs returnable under a live invoice.
    const approved = await one<{ n: number }>(
      conn,
      `SELECT COUNT(*) AS n FROM ims_bom_dcs
       WHERE tenant_id = :tenantId AND bom_doc_id = :bomId AND status = 'approved' AND stock_posted = 1`,
      { tenantId: actor.tenantId, bomId: row.source_ref },
    );
    if (Number(approved?.n ?? 0) > 0) {
      throw conflict(
        "This BOM has approved delivery challans. Link them on the invoice before issuing so stock stays on the DCs and return/reverse stay blocked while billed.",
      );
    }
  }

  /** Tally imports are an accounting mirror — stock already moved in Tally (or not tracked here). */
  const tallyImport = row.source_tool === "tally";
  const skipStock = stockViaDc || tallyImport || nonStockDoc;

  // BOM explode invoices: refuse a second OUT and keep stock_issued_at in sync. Lump-sum never owns the BOM stock flag.
  // Skip when DCs already own stock movements.
  const bomStockItems = !skipStock && row.source_tool === "ims_bom" && row.source_ref ? [...new Set(lines.filter((l) => l.itemId && l.qty > 0).map((l) => l.itemId!))] : [];
  let bomExplode = false;
  if (!skipStock && row.source_tool === "ims_bom" && row.source_ref && bomStockItems.length) {
    if (await bomHasLiveDcsLocal(conn, actor.tenantId, row.source_ref)) {
      throw conflict(
        "This BOM has delivery challans. Link approved DCs to the invoice (so stock stays on the DCs), or cancel open DCs before issuing stock from the invoice.",
      );
    }
    const bom = await one<{ stock_issued_at: string | null; invoice_convert_mode: string | null }>(
      conn,
      `SELECT stock_issued_at, invoice_convert_mode FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
      { tenantId: actor.tenantId, id: row.source_ref },
    );
    bomExplode = bom?.invoice_convert_mode === "explode_lines";
    if (bomExplode && bom?.stock_issued_at) {
      throw conflict("Materials for this BOM were already issued. Use a lump-sum invoice, link approved delivery challans, or reverse stock before issuing this explode invoice.");
    }
  }

  if (!skipStock) {
    for (const l of lines) {
      if (!l.itemId || !(l.qty > 0)) continue;
      try {
        await postMovement(
          conn,
          actor,
          {
            itemId: l.itemId,
            type: "OUT",
            qty: l.qty,
            unitPrice: l.qty ? round2(l.taxable / l.qty) : l.rate,
            refType,
            refId: id,
            refNo: invoiceNo,
            partyId: row.customer_id,
            partyName: row.customer_name,
            date: invoiceDate,
          },
          { allowNegative: settings.allowNegativeStock },
        );
      } catch (err) {
        if (err instanceof ImsError && err.status === 404) throw badRequest(`“${l.name}” is no longer in your items. Remove the line or pick the item again.`);
        throw err;
      }
    }
  }
  // stock_posted=1 when invoice moved stock, or when linked DCs already covered stock. Tally / CN / PF stay 0.
  const stockPosted = tallyImport || nonStockDoc ? 0 : 1;
  // B2B tax invoices / credit notes with a GSTIN are IRP-eligible — mark Yet-to-be-pushed until a GSP connector lands.
  const einvEligible =
    (docKind === "tax_invoice" || docKind === "credit_note" || docKind === "debit_note") && Boolean(row.customer_gstin?.trim());
  const einvStatus = einvEligible && !row.irn ? "yet_to_push" : row.einv_status ?? null;
  await exec(
    conn,
    `UPDATE ims_invoices SET status = 'issued', invoice_no = :invoiceNo, stock_posted = :stockPosted, issued_at = CURRENT_TIMESTAMP,
       einv_status = COALESCE(einv_status, :einvStatus)
       ${fromApproval ? ", approved_by = :userId, approved_by_name = :userName, approved_at = CURRENT_TIMESTAMP" : ""}
     WHERE tenant_id = :tenantId AND id = :id`,
    {
      tenantId: actor.tenantId,
      id,
      invoiceNo,
      stockPosted,
      einvStatus,
      ...(fromApproval ? { userId: actor.userId, userName: actorName(actor) } : {}),
    },
  );

  // Credit note: apply to the original tax invoice's AR balance (FIFO credit_applied).
  if (docKind === "credit_note" && row.against_invoice_id) {
    const against = await loadInvoiceRow(conn, actor.tenantId, row.against_invoice_id, true);
    if (against.status !== "issued" || !isArTaxInvoice(against.doc_kind)) {
      throw conflict("Credit notes can only be applied against an issued tax invoice");
    }
    const cnTotal = round2(money(row.grand_total));
    const bal = invoiceBalance({
      status: against.status,
      grandTotal: money(against.grand_total),
      amountPaid: money(against.amount_paid),
      creditApplied: money(against.credit_applied ?? 0),
      advanceApplied: money(against.advance_applied ?? 0),
      retentionAmount: money((against as { retention_amount?: string | number }).retention_amount ?? 0),
      docKind: against.doc_kind || "tax_invoice",
    });
    const apply = Math.min(cnTotal, bal);
    if (apply > 0.005) {
      await exec(
        conn,
        `UPDATE ims_invoices SET credit_applied = ROUND(credit_applied + :apply, 2) WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id: against.id, apply },
      );
    }
    await addActivity(conn, actor, {
      invoiceId: against.id,
      partyId: against.customer_id,
      partyName: against.customer_name,
      kind: "credit_note",
      message: `Credit note ${invoiceNo} applied ${formatINR(apply)}${apply + 0.005 < cnTotal ? ` of ${formatINR(cnTotal)}` : ""}`,
      status: "applied",
    });
    await addActivity(conn, actor, {
      invoiceId: id,
      partyId: row.customer_id,
      partyName: row.customer_name,
      kind: "credit_note",
      message: `Issued against ${against.invoice_no} · applied ${formatINR(apply)}`,
      status: "issued",
    });
  }

  if (!skipStock && row.source_tool === "ims_bom" && row.source_ref && bomExplode && bomStockItems.length) {
    await exec(
      conn,
      `UPDATE ims_bom_docs SET stock_issued_at = CURRENT_TIMESTAMP, stock_issue_count = :n
       WHERE tenant_id = :tenantId AND id = :id AND stock_issued_at IS NULL`,
      { tenantId: actor.tenantId, id: row.source_ref, n: bomStockItems.length },
    );
    // Mark each stock line fully issued so BOM→DC remaining treats invoice explode as consumed.
    await exec(
      conn,
      `UPDATE ims_bom_doc_lines SET issued_qty = qty
       WHERE tenant_id = :tenantId AND doc_id = :docId
         AND line_kind = 'stock' AND item_id IS NOT NULL AND qty > 0 AND issued_qty = 0`,
      { tenantId: actor.tenantId, docId: row.source_ref },
    );
  }
  return { invoiceNo, row };
}

/** Puts back the stock an issued invoice took out. Skips when stock came from linked delivery challans. */
async function reverseInvoiceStock(conn: PoolConnection, actor: ImsActor, row: InvoiceRow, reason: string): Promise<void> {
  if (!row.stock_posted) return;
  const dcIds = await listInvoiceDcIds(conn, actor.tenantId, row.id);
  if (dcIds.length) return;
  // Sales-order DCs keep the stock OUT (and any return) on the challan, not the invoice.
  if ((await listInvoiceSoDcIds(conn, actor.tenantId, row.id)).length) return;
  for (const l of json<ImsLine[]>(row.lines, [])) {
    if (!l.itemId || !(l.qty > 0)) continue;
    const exists = await one<{ id: string }>(conn, `SELECT id FROM ims_items WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: l.itemId });
    if (!exists) continue;
    await postMovement(
      conn,
      actor,
      {
        itemId: l.itemId,
        type: "RETURN_IN",
        qty: l.qty,
        unitPrice: l.qty ? round2(l.taxable / l.qty) : l.rate,
        refType: "invoice",
        refId: row.id,
        refNo: row.invoice_no,
        partyId: row.customer_id,
        partyName: row.customer_name,
        reason,
        date: todayISO(),
      },
      { allowNegative: true },
    );
  }
}

/** Records money received against one invoice inside the caller's transaction. */
async function applyInvoicePayment(conn: PoolConnection, actor: ImsActor, row: InvoiceRow, p: { amount: number; method: PayMethod; reference?: string | null; notes?: string | null; date: string }): Promise<void> {
  const grandTotal = money(row.grand_total);
  const paid = round2(money(row.amount_paid) + p.amount);
  await insertPayment(conn, actor, {
    direction: "in",
    partyId: row.customer_id,
    partyName: row.customer_name,
    docType: "invoice",
    docId: row.id,
    docNo: row.invoice_no,
    amount: p.amount,
    method: p.method,
    reference: p.reference,
    paidOn: p.date,
    notes: p.notes,
  });
  const settled = paid + 0.005 >= grandTotal;
  await exec(
    conn,
    `UPDATE ims_invoices SET amount_paid = :paid, pay_mode = :method ${settled ? ", promise_date = NULL, promise_amount = NULL" : ""} WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId: actor.tenantId, id: row.id, paid, method: p.method },
  );
  if (settled) {
    await exec(conn, `UPDATE ims_ar_activity SET status = 'kept' WHERE tenant_id = :tenantId AND invoice_id = :id AND kind = 'promise' AND status = 'open'`, { tenantId: actor.tenantId, id: row.id });
  }
  // Payment plan: money goes to the earliest pending installments first.
  await allocateInvoicePlanPayment(conn, actor.tenantId, row.id, p.amount);
}

const requireSalesRead = (res: Response) => requireAnyPerm(res, ["sales", "receivables"]);

/* ---------- Receivables ---------- */

const ChannelEnum = z.enum(["whatsapp", "sms", "email"]);

/** Template best suited to an auto-reminder rule. */
function templateForRule(rule: ReminderRuleKey, templates: ImsSettings["reminders"]["templates"]): string {
  const want = rule === "3b" || rule === "due" ? "gentle" : rule === "60d" || rule === "90d" ? "final" : "overdue";
  return (templates.find((t) => t.key === want) ?? templates[0])?.key ?? "gentle";
}

const PRIORITY_RANK: Record<ArPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

const EINV_KINDS = new Set(["tax_invoice", "credit_note", "debit_note"]);
const EINV_PUSHABLE = new Set(["yet_to_push", "failed"]);

const einvEligible = (row: Pick<InvoiceRow, "doc_kind" | "customer_gstin">) => EINV_KINDS.has(row.doc_kind || "tax_invoice") && Boolean(row.customer_gstin?.trim());

/**
 * Generate the IRN through the connected GSP (sandbox or live) and store it like a manual association.
 * A GSP failure is recorded on the invoice (einv_status = failed + activity) and then rethrown.
 */
async function pushInvoiceIrn(deps: ImsDeps, actor: ImsActor, id: string, ip?: string): Promise<void> {
  const row = await loadInvoiceRow(deps.db, actor.tenantId, id);
  if (row.status !== "issued") throw conflict("Only issued documents can be pushed to the IRP");
  if (!einvEligible(row)) throw conflict("Only B2B tax invoices, credit notes and debit notes with a customer GSTIN can be e-Invoiced");
  if (row.irn) throw conflict("This document already has an IRN");
  if (row.einv_status && !EINV_PUSHABLE.has(row.einv_status)) throw conflict(`e-Invoice status is “${row.einv_status}” — only yet-to-push or failed documents can be pushed`);
  const gsp = await loadGsp(deps.db, actor.tenantId);
  if (!gsp.enabled || !gsp.config) throw conflict("GSP e-Invoice is switched off — enable it under Integrations → GSP / e-Invoice first");
  const config = gsp.config;
  const settings = await getSettings(deps, actor.tenantId);
  const against = row.against_invoice_id ? await one<{ invoice_date: unknown }>(deps.db, `SELECT invoice_date FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.against_invoice_id }) : null;

  let result: IrnResult;
  try {
    const payload = buildIrnPayload(
      {
        invoiceNo: row.invoice_no,
        docKind: row.doc_kind || "tax_invoice",
        invoiceDate: isoOf(row.invoice_date),
        customerName: row.customer_name,
        customerGstin: row.customer_gstin,
        customerAddress: row.customer_address,
        placeOfSupply: row.place_of_supply,
        intraState: Boolean(row.intra_state),
        lines: json<ImsLine[]>(row.lines, []),
        subtotal: money(row.subtotal),
        discountTotal: money(row.discount_total),
        cgst: money(row.cgst),
        sgst: money(row.sgst),
        igst: money(row.igst),
        shippingCharges: money(row.shipping_charges ?? 0),
        roundOff: money(row.round_off),
        grandTotal: money(row.grand_total),
        againstInvoiceNo: row.against_invoice_no ?? null,
        againstInvoiceDate: against ? isoOf(against.invoice_date) : null,
      },
      settings,
      { gstin: config.gstin },
    );
    result = await pushIrn(config, payload);
  } catch (err) {
    if (!(err instanceof GspError)) throw err;
    await tx(deps.db, async (conn) => {
      await exec(conn, `UPDATE ims_invoices SET einv_status = 'failed' WHERE tenant_id = :tenantId AND id = :id AND irn IS NULL`, { tenantId: actor.tenantId, id: row.id });
      await addActivity(conn, actor, { invoiceId: row.id, partyId: row.customer_id, partyName: row.customer_name, kind: "e_invoice", message: `IRP push failed (${config.mode}): ${err.message}`.slice(0, 480), status: "failed" });
    });
    await logSync(deps.db, actor, { provider: "gsp", direction: "export", entity: "irn-push", status: "failed", records: 0, message: `${row.invoice_no}: ${err.message}` });
    await noteGspOutcome(deps.db, actor.tenantId, "failed");
    await recordEvent(deps, actor, { type: "invoice.einvoice.failed", entityType: "invoice", entityId: row.id, summary: `IRP push failed for ${row.invoice_no}: ${err.message}`, payload: { mode: config.mode, details: err.details }, ip });
    throw new ImsError(err.status, err.message, err.details.length ? err.details : undefined);
  }

  const stored = await tx(deps.db, async (conn) => {
    const cur = await loadInvoiceRow(conn, actor.tenantId, id, true);
    if (cur.irn) return false;
    await exec(
      conn,
      `UPDATE ims_invoices SET irn = :irn, ack_no = :ackNo, ack_at = FROM_UNIXTIME(:ackEpoch), signed_qr = :signedQr, einv_status = 'pushed'
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: row.id, irn: result.irn, ackNo: result.ackNo || null, ackEpoch: Math.floor(Date.parse(result.ackAt) / 1000), signedQr: result.signedQr || null },
    );
    await addActivity(conn, actor, {
      invoiceId: row.id,
      partyId: row.customer_id,
      partyName: row.customer_name,
      kind: "e_invoice",
      message: `IRN generated via GSP (${result.mode})${result.ackNo ? ` · Ack ${result.ackNo}` : ""}${result.mode === "sandbox" ? " — simulated, not registered with the IRP" : ""}`,
      status: "pushed",
    });
    return true;
  });
  if (!stored) return;
  await logSync(deps.db, actor, { provider: "gsp", direction: "export", entity: "irn-push", status: "success", records: 1, message: `${row.invoice_no} → IRN ${result.irn.slice(0, 12)}… (${result.mode})` });
  await noteGspOutcome(deps.db, actor.tenantId, "success");
  await recordEvent(deps, actor, {
    type: "invoice.einvoice",
    entityType: "invoice",
    entityId: row.id,
    summary: `Pushed ${row.invoice_no} to the IRP via GSP (${result.mode})`,
    payload: { irn: result.irn, ackNo: result.ackNo, mode: result.mode },
    ip,
  });
}

/** Push right after issue when the tenant opted in. Never throws — a failure leaves the invoice issued and marked for retry. */
async function autoPushIrn(deps: ImsDeps, actor: ImsActor, id: string, ip?: string): Promise<void> {
  try {
    const gsp = await loadGsp(deps.db, actor.tenantId);
    if (!gsp.enabled || !gsp.config?.autoPushOnIssue) return;
    const row = await loadInvoiceRow(deps.db, actor.tenantId, id);
    if (row.status !== "issued" || row.irn || !einvEligible(row)) return;
    await pushInvoiceIrn(deps, actor, id, ip);
  } catch (err) {
    console.warn("[ims] e-invoice auto-push failed", err instanceof Error ? err.message : err);
  }
}

export function registerSales(router: Router, deps: ImsDeps): void {
  /* Invoice list with status tabs, KPIs and filters. */
  router.get("/invoices", async (req, res) => {
    const actor = actorOf(res);
    requireSalesRead(res);
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const period = qstr(req.query.period, 12) || "all";
    const range = period === "all" ? null : periodRange(period, today, settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) });
    const where = ["i.tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, limit: qint(req.query.limit, 1000, 1, 5000) };
    if (range) {
      where.push("i.invoice_date BETWEEN :from AND :to");
      Object.assign(params, range);
    }
    const customerId = qstr(req.query.customerId, 36);
    if (customerId) {
      where.push("i.customer_id = :customerId");
      params.customerId = customerId;
    }
    const source = qstr(req.query.source, 20);
    if (source === "pos") where.push("i.source_tool = 'pos'");
    else if (source === "bom") where.push("i.source_tool = 'ims_bom'");
    else if (source === "tally") where.push("i.source_tool = 'tally'");
    else if (source === "quotation") where.push("i.source_tool IS NOT NULL AND i.source_tool NOT IN ('pos', 'ims_bom', 'tally')");
    const docKind = qstr(req.query.docKind, 16);
    if (docKind === "tax_invoice" || docKind === "proforma" || docKind === "credit_note" || docKind === "debit_note" || docKind === "retainer") {
      where.push("COALESCE(i.doc_kind, 'tax_invoice') = :docKind");
      params.docKind = docKind;
    } else if (docKind === "notes") {
      where.push("COALESCE(i.doc_kind, 'tax_invoice') IN ('credit_note', 'debit_note')");
    }
    const statusFilter = qstr(req.query.status, 24);
    if (statusFilter === "pending_approval") where.push("i.status = 'pending_approval'");
    else if (statusFilter === "draft") where.push("i.status = 'draft'");
    else if (statusFilter === "cancelled") where.push("i.status = 'cancelled'");
    else if (statusFilter === "issued") where.push("i.status = 'issued'");
    const q = qstr(req.query.q);
    if (q) {
      where.push(
        "(i.invoice_no LIKE :q OR i.customer_name LIKE :q OR i.customer_gstin LIKE :q OR i.customer_mobile LIKE :q OR b.doc_no LIKE :q OR (i.source_tool = 'pos' AND i.source_ref LIKE :q))",
      );
      params.q = likeOf(q);
    }
    const list = (await rows<InvoiceRow>(deps.db, `${INVOICE_SELECT} WHERE ${where.join(" AND ")} ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT :limit`, params)).map((r) =>
      mapInvoice(r, today, invoiceMapOptsFromSettings(settings)),
    );
    const counts: Record<string, number> = { all: list.length, draft: 0, pending_approval: 0, unpaid: 0, partial: 0, paid: 0, overdue: 0, cancelled: 0 };
    for (const inv of list) counts[inv.displayStatus] = (counts[inv.displayStatus] ?? 0) + 1;
    const status = qstr(req.query.status, 24);
    const shown =
      status && status !== "all"
        ? list.filter((i) =>
            status === "open"
              ? i.balance > 0.005
              : status === "pending_approval"
                ? i.status === "pending_approval" || i.displayStatus === "pending_approval"
                : i.displayStatus === status,
          )
        : list;

    const monthStart = monthStartISO(today);
    const lmStart = monthStartISO(addDaysISO(monthStart, -1));
    const dayOfMonth = Number(today.slice(8, 10));
    const lmEnd = addDaysISO(lmStart, Math.min(dayOfMonth, Number(addDaysISO(monthStart, -1).slice(8, 10))) - 1);
    const k = await one<{ sales_mtd: string | null; count_mtd: string | null; sales_lm: string | null; outstanding: string | null; overdue: string | null; overdue_count: string | null }>(
      deps.db,
      `SELECT
         SUM(CASE WHEN invoice_date >= :monthStart THEN grand_total ELSE 0 END) AS sales_mtd,
         SUM(CASE WHEN invoice_date >= :monthStart THEN 1 ELSE 0 END) AS count_mtd,
         SUM(CASE WHEN invoice_date BETWEEN :lmStart AND :lmEnd THEN grand_total ELSE 0 END) AS sales_lm,
         SUM(GREATEST(grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0), 0)) AS outstanding,
         SUM(CASE WHEN due_date < :today AND grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) > 0.005 THEN grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) ELSE 0 END) AS overdue,
         SUM(CASE WHEN due_date < :today AND grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) > 0.005 THEN 1 ELSE 0 END) AS overdue_count
       FROM ims_invoices
       WHERE tenant_id = :tenantId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note')`,
      { tenantId: actor.tenantId, monthStart, lmStart, lmEnd, today },
    );
    const issued = list.filter((i) => i.status === "issued" && isArTaxInvoice(i.docKind));
    res.json({
      range,
      invoices: shown,
      counts,
      kpis: {
        salesMtd: round2(money(k?.sales_mtd)),
        salesLastMonthToDate: round2(money(k?.sales_lm)),
        invoicesMtd: Number(k?.count_mtd ?? 0),
        outstanding: round2(money(k?.outstanding)),
        overdue: round2(money(k?.overdue)),
        overdueCount: Number(k?.overdue_count ?? 0),
        periodSales: round2(issued.reduce((s, i) => s + i.grandTotal, 0)),
        avgInvoice: issued.length ? round2(issued.reduce((s, i) => s + i.grandTotal, 0) / issued.length) : 0,
        periodCount: issued.length,
      },
    });
  });

  /* Outstanding for one customer (credit-limit warning in the editor). */
  router.get("/invoices/customer-summary", async (req, res) => {
    const actor = actorOf(res);
    requireSalesRead(res);
    const customerId = qstr(req.query.customerId, 36);
    if (!customerId) throw badRequest("customerId is required");
    const today = todayISO();
    const r = await one<{ outstanding: string | null; overdue: string | null; open_count: string | null; last_date: unknown; credit_limit: string | null }>(
      deps.db,
      `SELECT
         (SELECT SUM(GREATEST(grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0), 0)) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :customerId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note')) AS outstanding,
         (SELECT SUM(grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0)) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :customerId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note') AND due_date < :today AND grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) > 0.005) AS overdue,
         (SELECT COUNT(*) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :customerId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note') AND grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) > 0.005) AS open_count,
         (SELECT MAX(invoice_date) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :customerId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note')) AS last_date,
         (SELECT credit_limit FROM ims_parties WHERE tenant_id = :tenantId AND id = :customerId) AS credit_limit`,
      { tenantId: actor.tenantId, customerId, today },
    );
    res.json({
      outstanding: round2(money(r?.outstanding)),
      overdue: round2(money(r?.overdue)),
      openCount: Number(r?.open_count ?? 0),
      lastInvoiceDate: r?.last_date ? isoOf(r.last_date) : null,
      creditLimit: r?.credit_limit == null ? null : round2(money(r.credit_limit)),
    });
  });

  router.get("/invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    requireSalesRead(res);
    res.json(await invoiceDetail(deps, actor.tenantId, req.params.id));
  });

  /* Create a draft, or create + issue in one step with `issue: true`. */
  router.post("/invoices", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(InvoiceInput.extend({ issue: z.boolean().optional() }), req.body);
    // Credit notes must go through /invoices/:id/credit-note so against_invoice is set.
    if (input.docKind === "credit_note" || input.docKind === "debit_note") {
      throw badRequest("Create credit notes from an issued invoice (Credit note action). Debit notes land in Wave 2.");
    }
    const created = await createLinkedInvoice(deps, actor, {
      ...input,
      sourceTool: null,
      sourceRef: null,
    });
    res.status(201).json(created);
  });

  /* Edit a draft (full replace of the editable fields). */
  router.patch("/invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(InvoiceInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const v = await invoiceValues(deps.db, actor, settings, input);
    await tx(deps.db, async (conn) => {
      const existing = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (existing.status !== "draft") throw conflict("Issued invoices can't be edited. Cancel it and issue a corrected one.");
      // DC-linked drafts skip invoice stock OUT — freeze lines so extras cannot bypass stock.
      const linkedDcs = await listInvoiceDcIds(conn, actor.tenantId, existing.id);
      if (linkedDcs.length) {
        const prevLines = json<ImsLine[]>(existing.lines, []);
        const nextLines = input.lines ?? [];
        const sameShape =
          prevLines.length === nextLines.length &&
          prevLines.every((p, i) => {
            const n = nextLines[i]!;
            return p.itemId === (n.itemId ?? null) && Math.abs(Number(p.qty) - Number(n.qty)) < 1e-9;
          });
        if (!sameShape) {
          throw conflict(
            "This draft links delivery challans — stock stays on those DCs. Unlink the DCs before changing item lines or quantities.",
          );
        }
      }
      const updated = await exec(
        conn,
        `UPDATE ims_invoices SET customer_id = :customerId, customer_name = :customerName, customer_gstin = :customerGstin, customer_address = :customerAddress,
           customer_mobile = :customerMobile, customer_po_no = :customerPoNo,
           ship_to_name = :shipToName, ship_to_gstin = :shipToGstin, ship_to_address = :shipToAddress, ship_to_state = :shipToState, ship_to_mobile = :shipToMobile,
           place_of_supply = :placeOfSupply, intra_state = :intraState, invoice_date = :invoiceDate, due_date = :dueDate,
           \`lines\` = :lines, subtotal = :subtotal, discount_total = :discountTotal, tax_total = :taxTotal, cgst = :cgst, sgst = :sgst, igst = :igst,
           shipping_charges = :shippingCharges, shipping_gst_rate = :shippingGstRate, shipping_tax = :shippingTax,
           retention_pct = :retentionPct, retention_amount = :retentionAmount,
           progress_pct = :progressPct, progress_label = :progressLabel,
           round_off = :roundOff, grand_total = :grandTotal, currency_code = :currencyCode, fx_rate = :fxRate, fx_base_total = :fxBaseTotal, round_to_rupee = :roundToRupee,
           account_manager_id = :accountManagerId, account_manager_name = :accountManagerName,
           notes = :notes, terms = :terms
         WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
        { ...v, tenantId: actor.tenantId, id: existing.id },
      );
      if (!updated.affectedRows) throw conflict("This draft was issued or changed by someone else — refresh and try again.");
    });
    await recordEvent(deps, actor, {
      type: "invoice.updated",
      entityType: "invoice",
      entityId: req.params.id,
      summary: `Updated draft invoice for ${v.customerName} (${formatINR(v.grandTotal)})`,
    });
    res.json(await invoiceDetail(deps, actor.tenantId, req.params.id));
  });

  router.post("/invoices/:id/issue", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const settings = await getSettings(deps, actor.tenantId);
    const { invoiceNo, row, pendingApproval } = await tx(deps.db, (conn) => issueDraft(conn, actor, settings, req.params.id, "invoice"));
    if (pendingApproval) {
      await recordEvent(deps, actor, {
        type: "invoice.pending_approval",
        entityType: "invoice",
        entityId: row.id,
        summary: `Submitted invoice for ${row.customer_name} (${formatINR(money(row.grand_total))}) for approval`,
      });
    } else {
      await recordEvent(deps, actor, {
        type: "invoice.issued",
        entityType: "invoice",
        entityId: row.id,
        summary: `Issued invoice ${invoiceNo} to ${row.customer_name} (${formatINR(money(row.grand_total))})${row.source_tool && row.source_tool !== "pos" ? ` · from ${row.source_tool}` : ""}`,
      });
      await autoPushIrn(deps, actor, row.id, req.ip);
    }
    res.json(await invoiceDetail(deps, actor.tenantId, row.id));
  });

  router.post("/invoices/:id/approve", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const settings = await getSettings(deps, actor.tenantId);
    const note = parse(z.object({ note: optText(255) }), req.body).note ?? null;
    const { invoiceNo, row } = await tx(deps.db, async (conn) => {
      if (note) {
        await exec(conn, `UPDATE ims_invoices SET approval_note = :note WHERE tenant_id = :tenantId AND id = :id AND status = 'pending_approval'`, {
          tenantId: actor.tenantId,
          id: req.params.id,
          note,
        });
      }
      return issueDraft(conn, actor, settings, req.params.id, "invoice", { fromApproval: true });
    });
    await recordEvent(deps, actor, {
      type: "invoice.approved",
      entityType: "invoice",
      entityId: row.id,
      summary: `Approved and issued ${invoiceNo} to ${row.customer_name} (${formatINR(money(row.grand_total))})${note ? ` — ${note}` : ""}`,
    });
    await autoPushIrn(deps, actor, row.id, req.ip);
    res.json(await invoiceDetail(deps, actor.tenantId, row.id));
  });

  router.post("/invoices/:id/reject", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const input = parse(z.object({ reason: z.string().trim().min(3, "Give a short reason").max(255) }), req.body);
    await tx(deps.db, async (conn) => {
      const row = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (row.status !== "pending_approval") throw conflict("Only invoices waiting for approval can be rejected");
      await exec(
        conn,
        `UPDATE ims_invoices SET status = 'draft', approval_note = :note, approved_by = NULL, approved_by_name = NULL, approved_at = NULL
         WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id: row.id, note: input.reason },
      );
      await addActivity(conn, actor, {
        invoiceId: row.id,
        partyId: row.customer_id,
        partyName: row.customer_name,
        kind: "approval",
        message: `Rejected — ${input.reason}`,
        status: "rejected",
      });
    });
    await recordEvent(deps, actor, {
      type: "invoice.rejected",
      entityType: "invoice",
      entityId: req.params.id,
      summary: `Rejected invoice — ${input.reason}`,
    });
    res.json(await invoiceDetail(deps, actor.tenantId, req.params.id));
  });

  router.post("/invoices/:id/withdraw-approval", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    await tx(deps.db, async (conn) => {
      const row = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (row.status !== "pending_approval") throw conflict("Only invoices waiting for approval can be withdrawn");
      await exec(
        conn,
        `UPDATE ims_invoices SET status = 'draft', approval_note = NULL, approved_by = NULL, approved_by_name = NULL, approved_at = NULL
         WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id: row.id },
      );
      await addActivity(conn, actor, {
        invoiceId: row.id,
        partyId: row.customer_id,
        partyName: row.customer_name,
        kind: "approval",
        message: "Withdrawn from approval",
        status: "withdrawn",
      });
    });
    await recordEvent(deps, actor, {
      type: "invoice.withdrawn",
      entityType: "invoice",
      entityId: req.params.id,
      summary: "Withdrew invoice from approval queue",
    });
    res.json(await invoiceDetail(deps, actor.tenantId, req.params.id));
  });

  /** Apply paid retainer/advance credit onto an issued tax invoice. */
  router.post("/invoices/:id/apply-advance", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["sales", "receivables"]);
    const input = parse(
      z.object({
        retainerId: z.string().uuid(),
        amount: z.coerce.number().positive().max(1e12).optional(),
      }),
      req.body,
    );
    await tx(deps.db, async (conn) => {
      const tax = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (tax.status !== "issued" || !isArTaxInvoice(tax.doc_kind) || tax.doc_kind === "retainer") {
        throw conflict("Advances can only be applied to an issued tax invoice or debit note");
      }
      const retainer = await loadInvoiceRow(conn, actor.tenantId, input.retainerId, true);
      if (retainer.doc_kind !== "retainer" || retainer.status !== "issued") throw conflict("Pick an issued retainer invoice");
      if (retainer.customer_id && tax.customer_id && retainer.customer_id !== tax.customer_id) {
        throw conflict("Retainer and tax invoice must be for the same customer");
      }
      if (!retainer.customer_id && retainer.customer_name.trim().toLowerCase() !== tax.customer_name.trim().toLowerCase()) {
        throw conflict("Retainer and tax invoice must be for the same customer");
      }
      const available = round2(money(retainer.amount_paid) - money(retainer.credit_applied ?? 0));
      if (available <= 0.005) throw conflict("No unapplied advance left on this retainer");
      const taxBal = invoiceBalance({
        status: tax.status,
        grandTotal: money(tax.grand_total),
        amountPaid: money(tax.amount_paid),
        creditApplied: money(tax.credit_applied ?? 0),
        advanceApplied: money(tax.advance_applied ?? 0),
        retentionAmount: money((tax as { retention_amount?: string | number }).retention_amount ?? 0),
        docKind: tax.doc_kind || "tax_invoice",
      });
      if (taxBal <= 0.005) throw conflict("This invoice is already settled");
      const apply = round2(Math.min(input.amount ?? available, available, taxBal));
      if (apply <= 0.005) throw badRequest("Nothing to apply");
      await exec(
        conn,
        `UPDATE ims_invoices SET advance_applied = ROUND(advance_applied + :apply, 2) WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id: tax.id, apply },
      );
      await exec(
        conn,
        `UPDATE ims_invoices SET credit_applied = ROUND(credit_applied + :apply, 2) WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id: retainer.id, apply },
      );
      await addActivity(conn, actor, {
        invoiceId: tax.id,
        partyId: tax.customer_id,
        partyName: tax.customer_name,
        kind: "advance",
        message: `Applied ${formatINR(apply)} from retainer ${retainer.invoice_no}`,
        status: "applied",
      });
      await addActivity(conn, actor, {
        invoiceId: retainer.id,
        partyId: retainer.customer_id,
        partyName: retainer.customer_name,
        kind: "advance",
        message: `Applied ${formatINR(apply)} to ${tax.invoice_no}`,
        status: "applied",
      });
    });
    await recordEvent(deps, actor, {
      type: "invoice.advance_applied",
      entityType: "invoice",
      entityId: req.params.id,
      summary: `Applied advance from retainer`,
    });
    res.json(await invoiceDetail(deps, actor.tenantId, req.params.id));
  });

  router.post("/invoices/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(z.object({ reason: z.string().trim().min(3, "Give a short reason").max(255) }), req.body);
    const outcome = await tx(deps.db, async (conn) => {
      const r = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (r.status !== "issued") throw conflict(r.status === "draft" ? "Drafts are deleted, not cancelled" : "This invoice is already cancelled");
      if (money(r.amount_paid) > 0.005) throw conflict(`${formatINR(money(r.amount_paid))} has been received against this invoice. Void those payments first, then cancel.`);
      const dcIds = await listInvoiceDcIds(conn, actor.tenantId, r.id);
      const stockViaDc = dcIds.length > 0;
      const hadStock = Boolean(r.stock_posted);
      await reverseInvoiceStock(conn, actor, r, "Invoice cancelled");
      await exec(conn, `UPDATE ims_invoices SET status = 'cancelled', stock_posted = 0, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = :reason WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: r.id,
        reason: input.reason,
      });
      await cancelInvoicePlan(conn, actor.tenantId, r.id);
      // Drop links so the same DCs can attach to a new invoice (unique dc_id). Stock messaging uses cancel event / BOM source.
      await exec(conn, `DELETE FROM ims_invoice_dc_links WHERE tenant_id = :tenantId AND invoice_id = :id`, {
        tenantId: actor.tenantId,
        id: r.id,
      });
      await exec(conn, `DELETE FROM ims_invoice_so_dc_links WHERE tenant_id = :tenantId AND invoice_id = :id`, {
        tenantId: actor.tenantId,
        id: r.id,
      });
      // Free the BOM so convert can run again. Only clear stock flags when this invoice owned the OUT (not DCs).
      if (r.source_tool === "ims_bom" && r.source_ref) {
        const bom = await one<{ invoice_convert_mode: string | null }>(
          conn,
          `SELECT invoice_convert_mode FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
          { tenantId: actor.tenantId, id: r.source_ref },
        );
        const clearStock = !stockViaDc && bom?.invoice_convert_mode === "explode_lines" && hadStock;
        await exec(
          conn,
          clearStock
            ? `UPDATE ims_bom_docs
               SET invoice_id = NULL, invoice_convert_mode = NULL, stock_issued_at = NULL, stock_issue_count = 0
               WHERE tenant_id = :tenantId AND id = :bomId AND invoice_id = :invoiceId`
            : `UPDATE ims_bom_docs
               SET invoice_id = NULL, invoice_convert_mode = NULL
               WHERE tenant_id = :tenantId AND id = :bomId AND invoice_id = :invoiceId`,
          { tenantId: actor.tenantId, bomId: r.source_ref, invoiceId: r.id },
        );
        if (clearStock) {
          await exec(conn, `UPDATE ims_bom_doc_lines SET issued_qty = 0 WHERE tenant_id = :tenantId AND doc_id = :bomId`, {
            tenantId: actor.tenantId,
            bomId: r.source_ref,
          });
        }
      }
      await addActivity(conn, actor, {
        invoiceId: r.id,
        partyId: r.customer_id,
        partyName: r.customer_name,
        kind: "note",
        message: stockViaDc
          ? "Invoice cancelled — stock remains on delivery challans"
          : "Invoice cancelled — stock returned to inventory",
      });
      return { row: r, stockViaDc };
    });
    await recordEvent(deps, actor, {
      type: "invoice.cancelled",
      entityType: "invoice",
      entityId: outcome.row.id,
      summary: outcome.stockViaDc
        ? `Cancelled invoice ${outcome.row.invoice_no} (${formatINR(money(outcome.row.grand_total))}) — stock remains on delivery challans`
        : `Cancelled invoice ${outcome.row.invoice_no} (${formatINR(money(outcome.row.grand_total))}) — stock returned`,
      payload: { reason: input.reason, stockViaDc: outcome.stockViaDc },
    });
    res.json(await invoiceDetail(deps, actor.tenantId, outcome.row.id));
  });

  router.post("/invoices/:id/duplicate", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const src = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const lines = json<ImsLine[]>(src.lines, []);
    const values = await invoiceValues(deps.db, actor, settings, {
      customerId: src.customer_id,
      customerName: src.customer_name,
      customerGstin: src.customer_gstin,
      customerAddress: src.customer_address,
      customerMobile: src.customer_mobile,
      customerPoNo: src.customer_po_no ?? null,
      shipToName: src.ship_to_name ?? null,
      shipToGstin: src.ship_to_gstin ?? null,
      shipToAddress: src.ship_to_address ?? null,
      shipToState: src.ship_to_state ?? null,
      shipToMobile: src.ship_to_mobile ?? null,
      placeOfSupply: src.place_of_supply,
      invoiceDate: today,
      dueDate: null,
      docKind: "tax_invoice",
      lines: lines.map((l) => ({ itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })),
      roundToRupee: Boolean(src.round_to_rupee),
      notes: src.notes,
      terms: src.terms,
      ...srcFx(src),
    });
    const id = randomUUID();
    await insertInvoice(deps.db, actor, id, values, { docKind: "tax_invoice" });
    await recordEvent(deps, actor, { type: "invoice.created", entityType: "invoice", entityId: id, summary: `Duplicated ${src.invoice_no} as a new draft for ${src.customer_name}` });
    res.status(201).json(await invoiceDetail(deps, actor.tenantId, id));
  });

  /** Offline fallback: associate IRN / Ack details generated outside IMS (GST portal or another GSP). */
  router.post("/invoices/:id/e-invoice/associate", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["sales", "integrations", "audit"]);
    const input = parse(
      z.object({
        irn: z.string().trim().min(8, "IRN looks too short").max(64),
        ackNo: optText(64),
        ackAt: isoDate.nullable().optional(),
        signedQr: optText(8000),
        ewayBillNo: optText(24),
        ewayValidUpto: isoDate.nullable().optional(),
      }),
      req.body,
    );
    await tx(deps.db, async (conn) => {
      const row = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (row.status !== "issued") throw conflict("Only issued documents can carry an IRN");
      const kind = row.doc_kind || "tax_invoice";
      if (kind === "proforma") throw conflict("Proforma invoices are not e-Invoice eligible");
      await exec(
        conn,
        `UPDATE ims_invoices SET irn = :irn, ack_no = :ackNo, ack_at = COALESCE(:ackAt, ack_at, CURRENT_TIMESTAMP),
           signed_qr = COALESCE(:signedQr, signed_qr), eway_bill_no = COALESCE(:ewayBillNo, eway_bill_no),
           eway_valid_upto = COALESCE(:ewayValidUpto, eway_valid_upto), einv_status = 'pushed'
         WHERE tenant_id = :tenantId AND id = :id`,
        {
          tenantId: actor.tenantId,
          id: row.id,
          irn: input.irn,
          ackNo: input.ackNo ?? null,
          ackAt: input.ackAt ?? null,
          signedQr: input.signedQr ?? null,
          ewayBillNo: input.ewayBillNo ?? null,
          ewayValidUpto: input.ewayValidUpto ?? null,
        },
      );
      await addActivity(conn, actor, {
        invoiceId: row.id,
        partyId: row.customer_id,
        partyName: row.customer_name,
        kind: "e_invoice",
        message: `IRN associated${input.ackNo ? ` · Ack ${input.ackNo}` : ""}`,
        status: "pushed",
      });
    });
    await recordEvent(deps, actor, {
      type: "invoice.einvoice",
      entityType: "invoice",
      entityId: req.params.id,
      summary: `Associated IRN on invoice`,
      payload: { irn: input.irn, ackNo: input.ackNo },
    });
    res.json(await invoiceDetail(deps, actor.tenantId, req.params.id));
  });

  /** Generate the IRN through the connected GSP (sandbox or live). Needs Integrations → GSP / e-Invoice enabled. */
  router.post("/invoices/:id/e-invoice/push", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["sales", "integrations", "audit"]);
    await pushInvoiceIrn(deps, actor, req.params.id, req.ip);
    res.json(await invoiceDetail(deps, actor.tenantId, req.params.id));
  });

  router.post("/invoices/:id/e-invoice/mark-cancelled", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["sales", "integrations", "audit"]);
    const input = parse(z.object({ reason: optText(255) }), req.body ?? {});
    // With a GSP connected, try the IRP cancel first; the local status is updated either way.
    let gspNote: string | null = null;
    const pre = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    const gsp = pre.irn && pre.einv_status !== "marked_cancelled" ? await loadGsp(deps.db, actor.tenantId) : null;
    if (pre.irn && gsp?.enabled && gsp.config) {
      try {
        const out = await cancelIrn(gsp.config, pre.irn, input.reason || "Cancelled in IMS");
        gspNote = out.mode === "live" ? "Cancelled with the IRP via GSP." : "Sandbox cancel recorded (simulated).";
        await logSync(deps.db, actor, { provider: "gsp", direction: "export", entity: "irn-cancel", status: "success", records: 1, message: `${pre.invoice_no} (${out.mode})` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "GSP cancel failed";
        gspNote = `GSP cancel failed: ${msg}. Cancel on the GST portal if still active.`;
        await logSync(deps.db, actor, { provider: "gsp", direction: "export", entity: "irn-cancel", status: "failed", records: 0, message: `${pre.invoice_no}: ${msg}` });
      }
    }
    await tx(deps.db, async (conn) => {
      const row = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (!row.irn) throw conflict("No IRN is associated with this document");
      await exec(conn, `UPDATE ims_invoices SET einv_status = 'marked_cancelled' WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: row.id,
      });
      await addActivity(conn, actor, {
        invoiceId: row.id,
        partyId: row.customer_id,
        partyName: row.customer_name,
        kind: "e_invoice",
        message: `e-Invoice marked cancelled in IMS${input.reason ? ` — ${input.reason}` : ""}. ${gspNote ?? "Cancel on the GST portal if still active."}`,
        status: "marked_cancelled",
      });
    });
    res.json(await invoiceDetail(deps, actor.tenantId, req.params.id));
  });

  /** Convert an issued proforma into a new tax-invoice draft (same lines / parties). */
  router.post("/invoices/:id/convert-proforma", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const src = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    if ((src.doc_kind || "tax_invoice") !== "proforma") throw conflict("Only proforma invoices can be converted");
    if (src.status === "cancelled") throw conflict("Cancelled proformas can't be converted");
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const lines = json<ImsLine[]>(src.lines, []);
    const values = await invoiceValues(deps.db, actor, settings, {
      customerId: src.customer_id,
      customerName: src.customer_name,
      customerGstin: src.customer_gstin,
      customerAddress: src.customer_address,
      customerMobile: src.customer_mobile,
      customerPoNo: src.customer_po_no ?? null,
      shipToName: src.ship_to_name ?? null,
      shipToGstin: src.ship_to_gstin ?? null,
      shipToAddress: src.ship_to_address ?? null,
      shipToState: src.ship_to_state ?? null,
      shipToMobile: src.ship_to_mobile ?? null,
      placeOfSupply: src.place_of_supply,
      invoiceDate: today,
      dueDate: null,
      docKind: "tax_invoice",
      shippingCharges: Number(src.shipping_charges ?? 0),
      shippingGstRate: Number(src.shipping_gst_rate ?? 0),
      lines: lines.map((l) => ({ itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })),
      roundToRupee: Boolean(src.round_to_rupee),
      notes: src.notes,
      terms: src.terms,
      accountManagerId: src.account_manager_id,
      accountManagerName: src.account_manager_name,
      ...srcFx(src),
    });
    const id = randomUUID();
    await insertInvoice(deps.db, actor, id, values, { docKind: "tax_invoice", sourceTool: "proforma", sourceRef: src.id });
    await recordEvent(deps, actor, {
      type: "invoice.created",
      entityType: "invoice",
      entityId: id,
      summary: `Converted proforma ${src.invoice_no} to tax invoice draft`,
    });
    res.status(201).json(await invoiceDetail(deps, actor.tenantId, id));
  });

  /** Debit note draft against an issued tax invoice (value increase / recovery). */
  router.post("/invoices/:id/debit-note", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const body = parse(z.object({ notes: optText(4000) }), req.body ?? {});
    const src = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    if (src.status !== "issued") throw conflict("Debit notes can only be created from issued invoices");
    if (!isArTaxInvoice(src.doc_kind)) throw conflict("Debit notes can only be created from tax invoices");
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const srcLines = json<ImsLine[]>(src.lines, []);
    const values = await invoiceValues(deps.db, actor, settings, {
      customerId: src.customer_id,
      customerName: src.customer_name,
      customerGstin: src.customer_gstin,
      customerAddress: src.customer_address,
      customerMobile: src.customer_mobile,
      customerPoNo: src.customer_po_no ?? null,
      placeOfSupply: src.place_of_supply,
      invoiceDate: today,
      dueDate: today,
      docKind: "debit_note",
      lines: srcLines.map((l) => ({
        itemId: l.itemId ?? null,
        name: l.name,
        sku: l.sku ?? null,
        hsn: l.hsn ?? null,
        unit: l.unit ?? null,
        qty: l.qty,
        rate: l.rate,
        discountPct: l.discountPct,
        gstRate: l.gstRate,
      })),
      roundToRupee: Boolean(src.round_to_rupee),
      notes: body.notes ?? `Debit note against ${src.invoice_no}`,
      terms: src.terms,
      ...srcFx(src),
    });
    const id = randomUUID();
    await insertInvoice(deps.db, actor, id, values, {
      docKind: "debit_note",
      againstInvoiceId: src.id,
      againstInvoiceNo: src.invoice_no,
    });
    await recordEvent(deps, actor, {
      type: "invoice.created",
      entityType: "invoice",
      entityId: id,
      summary: `Draft debit note against ${src.invoice_no} for ${src.customer_name}`,
    });
    res.status(201).json(await invoiceDetail(deps, actor.tenantId, id));
  });

  /** Create a draft credit note from an issued tax invoice (lines copied; edit then issue to apply AR credit). */
  router.post("/invoices/:id/credit-note", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const body = parse(
      z.object({
        restock: z.boolean().optional(),
        notes: optText(4000),
        lines: z.array(LineInput).min(1).max(300).optional(),
      }),
      req.body ?? {},
    );
    const src = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    if (src.status !== "issued") throw conflict("Credit notes can only be created from issued invoices");
    if (!isArTaxInvoice(src.doc_kind)) throw conflict("Credit notes can only be created from tax invoices");
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const srcLines = json<ImsLine[]>(src.lines, []);
    const lineInputs =
      body.lines ??
      srcLines.map((l) => ({
        itemId: l.itemId ?? null,
        name: l.name,
        sku: l.sku ?? null,
        hsn: l.hsn ?? null,
        unit: l.unit ?? null,
        qty: l.qty,
        rate: l.rate,
        discountPct: l.discountPct,
        gstRate: l.gstRate,
      }));
    const values = await invoiceValues(deps.db, actor, settings, {
      customerId: src.customer_id,
      customerName: src.customer_name,
      customerGstin: src.customer_gstin,
      customerAddress: src.customer_address,
      customerMobile: src.customer_mobile,
      customerPoNo: src.customer_po_no ?? null,
      shipToName: src.ship_to_name ?? null,
      shipToGstin: src.ship_to_gstin ?? null,
      shipToAddress: src.ship_to_address ?? null,
      shipToState: src.ship_to_state ?? null,
      shipToMobile: src.ship_to_mobile ?? null,
      placeOfSupply: src.place_of_supply,
      invoiceDate: today,
      dueDate: today,
      docKind: "credit_note",
      lines: lineInputs,
      roundToRupee: Boolean(src.round_to_rupee),
      notes: body.notes ?? `Credit note against ${src.invoice_no}${body.restock ? " · restock on issue (stock IN handled via Returns)" : ""}`,
      terms: src.terms,
      ...srcFx(src),
    });
    const id = randomUUID();
    await insertInvoice(deps.db, actor, id, values, {
      docKind: "credit_note",
      againstInvoiceId: src.id,
      againstInvoiceNo: src.invoice_no,
    });
    await recordEvent(deps, actor, {
      type: "invoice.created",
      entityType: "invoice",
      entityId: id,
      summary: `Draft credit note against ${src.invoice_no} for ${src.customer_name} (${formatINR(values.grandTotal)})`,
    });
    res.status(201).json(await invoiceDetail(deps, actor.tenantId, id));
  });

  router.delete("/invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const row = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "draft") throw conflict("Only drafts can be deleted. Cancel an issued invoice instead.");
    await tx(deps.db, async (conn) => {
      await exec(conn, `DELETE FROM ims_ar_activity WHERE tenant_id = :tenantId AND invoice_id = :id`, { tenantId: actor.tenantId, id: row.id });
      await exec(conn, `DELETE FROM ims_invoice_dc_links WHERE tenant_id = :tenantId AND invoice_id = :id`, { tenantId: actor.tenantId, id: row.id });
      await exec(conn, `DELETE FROM ims_invoice_so_dc_links WHERE tenant_id = :tenantId AND invoice_id = :id`, { tenantId: actor.tenantId, id: row.id });
      await exec(conn, `DELETE FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`, { tenantId: actor.tenantId, id: row.id });
      if (row.source_tool && row.source_ref) {
        await exec(conn, `DELETE FROM ims_links WHERE tenant_id = :tenantId AND target_type = 'invoice' AND target_id = :id`, { tenantId: actor.tenantId, id: row.id });
      }
      // Free the BOM so the dealer can convert again after discarding a draft invoice.
      if (row.source_tool === "ims_bom" && row.source_ref) {
        await exec(
          conn,
          `UPDATE ims_bom_docs
           SET invoice_id = NULL, invoice_convert_mode = NULL
           WHERE tenant_id = :tenantId AND id = :bomId AND invoice_id = :invoiceId`,
          { tenantId: actor.tenantId, bomId: row.source_ref, invoiceId: row.id },
        );
      }
    });
    await recordEvent(deps, actor, { type: "invoice.deleted", entityType: "invoice", entityId: row.id, summary: `Deleted draft invoice for ${row.customer_name}` });
    res.status(204).end();
  });

  /* Money received against one invoice. */
  router.post("/invoices/:id/payments", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["sales", "receivables"]);
    const input = parse(PaymentInput, req.body);
    const date = input.date ?? todayISO();
    const row = await tx(deps.db, async (conn) => {
      const r = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (r.status !== "issued") throw conflict("Payments can only be recorded against issued invoices");
      if (!isArTaxInvoice(r.doc_kind)) throw conflict("Payments can only be recorded against tax invoices");
      const balance = invoiceBalance({
        status: r.status,
        grandTotal: money(r.grand_total),
        amountPaid: money(r.amount_paid),
        creditApplied: money(r.credit_applied ?? 0),
        docKind: r.doc_kind || "tax_invoice",
      });
      if (input.amount > balance + 0.005) throw badRequest(`That's more than the balance due (${formatINR(balance)})`);
      await assertDayOpen(conn, actor.tenantId, date);
      await applyInvoicePayment(conn, actor, r, { ...input, date });
      return r;
    });
    await recordEvent(deps, actor, {
      type: "invoice.payment",
      entityType: "invoice",
      entityId: row.id,
      summary: `Received ${formatINR(input.amount)} (${input.method.toUpperCase()}) from ${row.customer_name} against ${row.invoice_no}`,
      payload: { amount: input.amount, method: input.method, reference: input.reference },
    });
    res.status(201).json(await invoiceDetail(deps, actor.tenantId, row.id));
  });

  /* A lump-sum receipt from a customer, spread over open invoices oldest-first; any excess stays on account. */
  router.post("/receipts", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["sales", "receivables"]);
    const input = parse(
      PaymentInput.extend({
        partyId: z.string().uuid().nullable().optional(),
        partyName: z.string().trim().min(1, "Pick a customer").max(200),
        invoiceIds: z.array(z.string().uuid()).max(500).optional(),
      }),
      req.body,
    );
    const date = input.date ?? todayISO();
    const result = await tx(deps.db, async (conn) => {
      await assertDayOpen(conn, actor.tenantId, date);
      const open = await rows<InvoiceRow>(
        conn,
        `SELECT * FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note')
           AND grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) > 0.005
           AND ${input.partyId ? "customer_id = :partyId" : "customer_id IS NULL AND customer_name = :partyName"}
         ORDER BY COALESCE(due_date, invoice_date), invoice_date, created_at FOR UPDATE`,
        { tenantId: actor.tenantId, partyId: input.partyId ?? null, partyName: input.partyName },
      );
      const ordered = input.invoiceIds?.length ? input.invoiceIds.map((id) => open.find((o) => o.id === id)).filter((o): o is InvoiceRow => Boolean(o)) : open;
      const { allocations, remainder } = allocateFifo(
        input.amount,
        ordered.map((o) => ({
          id: o.id,
          balance: round2(
            money(o.grand_total) - money(o.amount_paid) - money(o.credit_applied ?? 0) - money(o.advance_applied ?? 0) - money((o as { retention_amount?: string | number }).retention_amount ?? 0),
          ),
        })),
      );
      const applied: Array<{ invoiceId: string; invoiceNo: string; amount: number }> = [];
      for (const a of allocations) {
        const r = ordered.find((o) => o.id === a.id)!;
        await applyInvoicePayment(conn, actor, r, { amount: a.amount, method: input.method, reference: input.reference, notes: input.notes, date });
        applied.push({ invoiceId: r.id, invoiceNo: r.invoice_no, amount: a.amount });
      }
      if (remainder > 0) {
        await insertPayment(conn, actor, {
          direction: "in",
          partyId: input.partyId ?? null,
          partyName: input.partyName,
          docType: "on_account",
          docId: null,
          docNo: null,
          amount: remainder,
          method: input.method,
          reference: input.reference,
          paidOn: date,
          notes: input.notes ?? "Advance / on account",
        });
      }
      return { applied, onAccount: remainder };
    });
    await recordEvent(deps, actor, {
      type: "receipt.recorded",
      entityType: "party",
      entityId: input.partyId ?? input.partyName,
      summary: `Received ${formatINR(input.amount)} from ${input.partyName} — ${result.applied.length} invoice${result.applied.length === 1 ? "" : "s"} settled${result.onAccount > 0 ? `, ${formatINR(result.onAccount)} on account` : ""}`,
      payload: result,
    });
    res.status(201).json(result);
  });

  /* Void a payment (in or out): the document's paid amount goes back down. */
  router.delete("/payments/:id", async (req, res) => {
    const actor = actorOf(res);
    const p = await one<PaymentRow>(deps.db, `SELECT * FROM ims_payments WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!p) throw notFound("Payment");
    if (p.direction === "in") requireAnyPerm(res, ["sales", "receivables"]);
    else requirePerm(res, "payables");
    await tx(deps.db, async (conn) => {
      await assertDayOpen(conn, actor.tenantId, isoOf(p.paid_on));
      if (p.doc_type === "invoice" && p.doc_id) {
        await exec(conn, `UPDATE ims_invoices SET amount_paid = GREATEST(0, amount_paid - :amount) WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: p.doc_id, amount: money(p.amount) });
        await deallocateInvoicePlanPayment(conn, actor.tenantId, p.doc_id, money(p.amount), p.created_at ?? null);
      } else if (p.doc_type === "bill" && p.doc_id) {
        await exec(conn, `UPDATE ims_bills SET amount_paid = GREATEST(0, amount_paid - :amount) WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: p.doc_id, amount: money(p.amount) });
      }
      await exec(conn, `DELETE FROM ims_payments WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: p.id });
    });
    await recordEvent(deps, actor, {
      type: "payment.voided",
      entityType: p.doc_type === "bill" ? "bill" : p.doc_type === "invoice" ? "invoice" : "payment",
      entityId: p.doc_id ?? p.id,
      summary: `Voided ${p.direction === "in" ? "receipt" : "payment"} of ${formatINR(money(p.amount))} ${p.direction === "in" ? "from" : "to"} ${p.party_name}${p.doc_no ? ` (${p.doc_no})` : ""}`,
    });
    res.status(204).end();
  });

  /* ---------- POS counter ---------- */

  router.post("/pos/sale", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(
      z.object({
        customerId: z.string().uuid().nullable().optional(),
        customerName: optText(200),
        customerMobile: optText(40),
        customerGstin: optText(20),
        lines: z.array(LineInput).min(1, "The cart is empty").max(300),
        method: z.enum(["cash", "upi", "card"]),
        tendered: z.coerce.number().min(0).max(1e12).nullable().optional(),
        reference: optText(80),
        roundToRupee: z.boolean().default(true),
      }),
      req.body,
    );
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const values = await invoiceValues(deps.db, actor, settings, {
      customerId: input.customerId ?? null,
      customerName: input.customerName?.trim() || "Walk-in customer",
      customerGstin: input.customerGstin,
      customerMobile: input.customerMobile,
      invoiceDate: today,
      dueDate: today,
      lines: input.lines,
      roundToRupee: input.roundToRupee,
      notes: "Counter sale",
      terms: null,
    });
    const change = input.method === "cash" && input.tendered != null ? posChange(values.grandTotal, input.tendered) : null;
    if (input.method === "cash" && input.tendered != null && change === null) throw badRequest(`Cash received is less than the bill (${formatINR(values.grandTotal)})`);
    const id = randomUUID();
    const invoiceNo = await tx(deps.db, async (conn) => {
      await insertInvoice(conn, actor, id, values, { sourceTool: "pos" });
      const { invoiceNo: no } = await issueDraft(conn, actor, settings, id, "pos");
      const row = await loadInvoiceRow(conn, actor.tenantId, id, true);
      await applyInvoicePayment(conn, actor, row, { amount: values.grandTotal, method: input.method, reference: input.reference, date: today, notes: change ? `Change returned ${formatINR(change)}` : null });
      return no;
    });
    await recordEvent(deps, actor, {
      type: "pos.sale",
      entityType: "invoice",
      entityId: id,
      summary: `Counter sale ${invoiceNo} · ${formatINR(values.grandTotal)} by ${input.method.toUpperCase()}${values.customerName !== "Walk-in customer" ? ` · ${values.customerName}` : ""}`,
    });
    res.status(201).json({ ...(await invoiceDetail(deps, actor.tenantId, id)), change });
  });

  router.get("/pos/today", async (_req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const today = todayISO();
    const list = await rows<{ id: string; invoice_no: string; customer_name: string; grand_total: string; pay_mode: string | null; status: string; created_at: string }>(
      deps.db,
      `SELECT id, invoice_no, customer_name, grand_total, pay_mode, status, created_at FROM ims_invoices
       WHERE tenant_id = :tenantId AND source_tool = 'pos' AND invoice_date = :today ORDER BY created_at DESC LIMIT 300`,
      { tenantId: actor.tenantId, today },
    );
    const byMethod: Record<string, number> = { cash: 0, upi: 0, card: 0 };
    let total = 0;
    for (const b of list) {
      if (b.status !== "issued") continue;
      const amt = money(b.grand_total);
      total += amt;
      const m = b.pay_mode ?? "cash";
      byMethod[m] = round2((byMethod[m] ?? 0) + amt);
    }
    res.json({
      today,
      bills: list.map((b) => ({ id: b.id, invoiceNo: b.invoice_no, customerName: b.customer_name, grandTotal: round2(money(b.grand_total)), payMode: b.pay_mode, status: b.status, createdAt: tsOf(b.created_at) })),
      total: round2(total),
      count: list.filter((b) => b.status === "issued").length,
      byMethod,
    });
  });

  /* ---------- Receivables ---------- */

  router.get("/receivables", async (_req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "receivables");
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const monthStart = monthStartISO(today);
    const [openRows, collected, sales90, members] = await Promise.all([
      rows<InvoiceRow>(
        deps.db,
        `SELECT i.*, p.mobile AS party_mobile, p.email AS party_email, p.state AS party_state,
           (SELECT a.channel FROM ims_ar_activity a WHERE a.tenant_id = i.tenant_id AND a.invoice_id = i.id AND a.kind = 'reminder' ORDER BY a.created_at DESC LIMIT 1) AS last_reminder_channel
         FROM ims_invoices i LEFT JOIN ims_parties p ON p.id = i.customer_id AND p.tenant_id = i.tenant_id
         WHERE i.tenant_id = :tenantId AND i.status = 'issued' AND COALESCE(i.doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note')
           AND i.grand_total - i.amount_paid - COALESCE(i.credit_applied, 0) - COALESCE(i.advance_applied, 0) - COALESCE(i.retention_amount, 0) > 0.005
         ORDER BY i.due_date ASC, i.invoice_date ASC LIMIT 3000`,
        { tenantId: actor.tenantId },
      ),
      one<{ total: string | null; n: string | null }>(deps.db, `SELECT SUM(amount) AS total, COUNT(*) AS n FROM ims_payments WHERE tenant_id = :tenantId AND direction = 'in' AND paid_on >= :monthStart`, {
        tenantId: actor.tenantId,
        monthStart,
      }),
      one<{ total: string | null }>(deps.db, `SELECT SUM(grand_total) AS total FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note') AND invoice_date >= :since`, {
        tenantId: actor.tenantId,
        since: addDaysISO(today, -89),
      }),
      listMembers(deps, actor).catch(() => []),
    ]);
    const mapOpts = invoiceMapOptsFromSettings(settings);
    const invoices = openRows.map((r) => mapInvoice(r, today, mapOpts));
    const sum = (list: ImsInvoice[], pick: (i: ImsInvoice) => number = (i) => i.balance) => round2(list.reduce((s, i) => s + pick(i), 0));
    const overdue = invoices.filter((i) => i.dueDate && i.dueDate < today);
    const weekEnd = addDaysISO(today, 7);
    const dueWeek = invoices.filter((i) => i.dueDate && i.dueDate >= today && i.dueDate <= weekEnd);
    const promises = invoices.filter((i) => i.promiseDate && i.promiseDate <= today);
    const missed = invoices.filter((i) => i.promiseDate && i.promiseDate < today);
    const totalOutstanding = sum(invoices);
    const agingBuckets = buildAgingBuckets(settings.agingBreaks);
    const aging = agingBuckets.map((b) => {
      const inBucket = overdue.filter((i) => i.agingBucket === b.key);
      return { key: b.key, label: b.label, color: b.color, amount: sum(inBucket), count: inBucket.length, customers: new Set(inBucket.map((i) => i.customerId ?? i.customerName)).size };
    });
    const notDueList = invoices.filter((i) => !i.dueDate || i.dueDate >= today);

    type CustomerAr = {
      key: string;
      customerId: string | null;
      name: string;
      mobile: string | null;
      email: string | null;
      accountManagerName: string | null;
      openCount: number;
      outstanding: number;
      overdue: number;
      oldestDaysOverdue: number;
      priority: ArPriority;
      disputedCount: number;
      promiseCount: number;
      lastReminderAt: string | null;
      invoiceIds: string[];
    };
    const byCustomer = new Map<string, CustomerAr>();
    for (const i of invoices) {
      const key = i.customerId ?? `name:${i.customerName.toLowerCase()}`;
      const c = byCustomer.get(key) ?? {
        key,
        customerId: i.customerId,
        name: i.customerName,
        mobile: i.customerMobile,
        email: i.customerEmail,
        accountManagerName: i.accountManagerName,
        openCount: 0,
        outstanding: 0,
        overdue: 0,
        oldestDaysOverdue: 0,
        priority: "LOW" as ArPriority,
        disputedCount: 0,
        promiseCount: 0,
        lastReminderAt: null,
        invoiceIds: [],
      };
      c.openCount += 1;
      c.outstanding = round2(c.outstanding + i.balance);
      if (i.daysOverdue > 0) c.overdue = round2(c.overdue + i.balance);
      c.oldestDaysOverdue = Math.max(c.oldestDaysOverdue, i.daysOverdue);
      if (PRIORITY_RANK[i.priority] > PRIORITY_RANK[c.priority]) c.priority = i.priority;
      if (i.disputed) c.disputedCount += 1;
      if (i.promiseDate) c.promiseCount += 1;
      if (i.lastReminderAt && (!c.lastReminderAt || i.lastReminderAt > c.lastReminderAt)) c.lastReminderAt = i.lastReminderAt;
      c.mobile ??= i.customerMobile;
      c.email ??= i.customerEmail;
      c.accountManagerName ??= i.accountManagerName;
      c.invoiceIds.push(i.id);
      byCustomer.set(key, c);
    }

    const ruleOn = settings.reminders.rules;
    const ruleCatalogue = reminderRulesFromOffsets(settings.reminders.offsets);
    const ruleMatches = invoices
      .filter((i) => i.autoReminder && !i.disputed && i.dueDate && !(i.lastReminderAt && i.lastReminderAt.slice(0, 10) === today))
      .map((i) => ({ invoice: i, rule: reminderRuleFor(i.dueDate as string, today, settings.reminders.offsets) }))
      .filter((m): m is { invoice: ImsInvoice; rule: ReminderRuleKey } => m.rule !== null && ruleOn[m.rule])
      .map((m) => ({
        invoiceId: m.invoice.id,
        rule: m.rule,
        ruleLabel: ruleCatalogue.find((r) => r.key === m.rule)?.label ?? m.rule,
        templateKey: templateForRule(m.rule, settings.reminders.templates),
      }));

    res.json({
      today,
      businessName: settings.businessName,
      invoices,
      kpis: {
        totalOutstanding,
        openCount: invoices.length,
        customerCount: byCustomer.size,
        overdue: sum(overdue),
        overdueCount: overdue.length,
        overdue90: sum(overdue.filter((i) => i.daysOverdue >= settings.arPriority.critical)),
        dueThisWeek: sum(dueWeek),
        dueThisWeekCount: dueWeek.length,
        collectedThisMonth: round2(money(collected?.total)),
        collectedThisMonthCount: Number(collected?.n ?? 0),
        expectedThisMonth: sum(invoices.filter((i) => i.dueDate && i.dueDate.slice(0, 7) === today.slice(0, 7))),
        dso: dsoDays(totalOutstanding, round2(money(sales90?.total)), 90),
        promisesDue: sum(promises, (i) => i.promiseAmount ?? i.balance),
        promisesDueCount: promises.length,
        promisesMissedCount: missed.length,
        disputed: sum(invoices.filter((i) => i.disputed)),
        disputedCount: invoices.filter((i) => i.disputed).length,
      },
      aging,
      notDue: { amount: sum(notDueList), count: notDueList.length },
      customers: [...byCustomer.values()].sort((a, b) => b.outstanding - a.outstanding),
      managers: members.filter((m) => m.active).map((m) => ({ userId: m.userId, name: m.name ?? m.email ?? `User ${m.userId}`, isAccountManager: m.isAccountManager })),
      reminders: settings.reminders,
      ruleMatches,
      dunning: { levels: settings.dunningSequences, last: await lastDunningByCustomer(deps.db, actor.tenantId) },
    });
  });

  /* Log reminders and hand back click-to-send links (delivery happens in the user's own WhatsApp / SMS / mail app). */
  router.post("/receivables/reminders", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "receivables");
    const input = parse(
      z.object({
        invoiceIds: z.array(z.string().uuid()).min(1, "Pick at least one invoice").max(500),
        channel: ChannelEnum,
        templateKey: optText(40),
        message: optText(4000),
        subject: optText(200),
        rule: optText(8),
      }),
      req.body,
    );
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const template = settings.reminders.templates.find((t) => t.key === input.templateKey) ?? settings.reminders.templates.find((t) => t.channel === input.channel) ?? settings.reminders.templates[0];
    const list = (
      await rows<InvoiceRow>(deps.db, `${INVOICE_SELECT} WHERE i.tenant_id = :tenantId AND i.id IN (:ids) AND i.status = 'issued'`, { tenantId: actor.tenantId, ids: input.invoiceIds })
    ).map((r) => mapInvoice(r, today, invoiceMapOptsFromSettings(settings)));
    if (!list.length) throw notFound("Open invoice");
    const sent: Array<{ invoiceId: string; invoiceNo: string; customerName: string; channel: ReminderChannel; to: string | null; message: string; subject: string | null; link: string }> = [];
    await tx(deps.db, async (conn) => {
      for (const inv of list) {
        if (inv.balance <= 0.005) continue;
        const vars = {
          customer: inv.customerName,
          invoice: inv.invoiceNo,
          amount: formatINR(inv.balance),
          balance: formatINR(inv.balance),
          total: formatINR(inv.grandTotal),
          due: dateText(inv.dueDate),
          days: inv.daysOverdue,
          business: settings.businessName || "Accounts team",
        };
        const message = renderTemplate(input.message ?? template?.body ?? "", vars);
        const subject = input.channel === "email" ? renderTemplate(input.subject ?? template?.subject ?? `Payment reminder: invoice ${inv.invoiceNo}`, vars) : null;
        const to = input.channel === "email" ? inv.customerEmail : inv.customerMobile;
        await addActivity(conn, actor, {
          invoiceId: inv.id,
          partyId: inv.customerId,
          partyName: inv.customerName,
          kind: "reminder",
          channel: input.channel,
          templateKey: template?.key ?? null,
          message: message.slice(0, 4000),
          status: input.rule ? "auto" : "sent",
        });
        await exec(conn, `UPDATE ims_invoices SET reminder_count = reminder_count + 1, last_reminder_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: inv.id });
        sent.push({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, customerName: inv.customerName, channel: input.channel, to, message, subject, link: reminderLink(input.channel, to, message, subject) });
      }
    });
    await recordEvent(deps, actor, {
      type: "ar.reminder",
      entityType: sent.length === 1 ? "invoice" : "receivables",
      entityId: sent.length === 1 ? sent[0].invoiceId : "bulk",
      summary: sent.length === 1 ? `Sent ${input.channel} reminder for ${sent[0].invoiceNo} to ${sent[0].customerName}` : `Sent ${sent.length} ${input.channel} reminders`,
      payload: { channel: input.channel, template: template?.key, rule: input.rule, invoices: sent.map((s) => s.invoiceNo) },
    });
    res.json({ sent });
  });

  router.post("/invoices/:id/promise", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "receivables");
    const input = parse(z.object({ date: isoDate.nullable().optional(), amount: z.coerce.number().min(0).max(1e12).nullable().optional(), note: optText(500), clear: z.boolean().optional() }), req.body);
    const row = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "issued") throw conflict("Promises can only be logged on issued invoices");
    if (!input.clear && !input.date) throw badRequest("Pick the promised payment date");
    const balance = invoiceBalance({ status: row.status, grandTotal: money(row.grand_total), amountPaid: money(row.amount_paid) });
    const amount = input.clear ? null : round2(Math.min(input.amount && input.amount > 0 ? input.amount : balance, balance));
    await tx(deps.db, async (conn) => {
      await exec(conn, `UPDATE ims_ar_activity SET status = :status WHERE tenant_id = :tenantId AND invoice_id = :id AND kind = 'promise' AND status = 'open'`, {
        tenantId: actor.tenantId,
        id: row.id,
        status: input.clear ? "broken" : "replaced",
      });
      await exec(conn, `UPDATE ims_invoices SET promise_date = :date, promise_amount = :amount WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: row.id,
        date: input.clear ? null : input.date,
        amount,
      });
      await addActivity(conn, actor, {
        invoiceId: row.id,
        partyId: row.customer_id,
        partyName: row.customer_name,
        kind: "promise",
        message: input.clear ? `Promise cleared${input.note ? ` — ${input.note}` : ""}` : (input.note ?? null),
        promiseDate: input.clear ? null : (input.date ?? null),
        promiseAmount: amount,
        status: input.clear ? "broken" : "open",
      });
    });
    await recordEvent(deps, actor, {
      type: "ar.promise",
      entityType: "invoice",
      entityId: row.id,
      summary: input.clear ? `Cleared promise to pay on ${row.invoice_no}` : `${row.customer_name} promised ${formatINR(amount ?? 0)} by ${dateText(input.date)} on ${row.invoice_no}`,
    });
    res.json(await invoiceDetail(deps, actor.tenantId, row.id));
  });

  router.post("/invoices/:id/dispute", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "receivables");
    const input = parse(z.object({ disputed: z.boolean(), reason: optText(255) }), req.body);
    if (input.disputed && !input.reason?.trim()) throw badRequest("Say what the customer is disputing");
    const row = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    await tx(deps.db, async (conn) => {
      await exec(conn, `UPDATE ims_invoices SET disputed = :disputed, dispute_reason = :reason WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: row.id,
        disputed: input.disputed ? 1 : 0,
        reason: input.disputed ? input.reason : null,
      });
      await addActivity(conn, actor, {
        invoiceId: row.id,
        partyId: row.customer_id,
        partyName: row.customer_name,
        kind: "dispute",
        message: input.disputed ? `Disputed: ${input.reason}` : `Dispute resolved${input.reason ? ` — ${input.reason}` : ""}`,
        status: input.disputed ? "open" : "resolved",
      });
    });
    await recordEvent(deps, actor, {
      type: "ar.dispute",
      entityType: "invoice",
      entityId: row.id,
      summary: input.disputed ? `Marked ${row.invoice_no} as disputed (${input.reason})` : `Resolved the dispute on ${row.invoice_no}`,
    });
    res.json(await invoiceDetail(deps, actor.tenantId, row.id));
  });

  router.post("/invoices/:id/notes", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["receivables", "sales"]);
    const input = parse(z.object({ kind: z.enum(["note", "call", "escalation"]).default("note"), channel: z.enum(["call", "visit", "whatsapp", "sms", "email"]).nullable().optional(), message: z.string().trim().min(1, "Write a note").max(2000) }), req.body);
    const row = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    await addActivity(deps.db, actor, { invoiceId: row.id, partyId: row.customer_id, partyName: row.customer_name, kind: input.kind, channel: input.channel ?? null, message: input.message });
    await recordEvent(deps, actor, { type: "ar.note", entityType: "invoice", entityId: row.id, summary: `Added a ${input.kind} on ${row.invoice_no}` });
    res.status(201).json(await invoiceDetail(deps, actor.tenantId, row.id));
  });

  router.post("/receivables/assign", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "receivables");
    const input = parse(z.object({ invoiceIds: z.array(z.string().uuid()).min(1).max(2000), managerId: z.coerce.number().int().positive().nullable(), applyToCustomer: z.boolean().default(false) }), req.body);
    let managerName: string | null = null;
    if (input.managerId) {
      const m = (await listMembers(deps, actor)).find((x) => x.userId === input.managerId);
      if (!m) throw badRequest("That person isn't a member of this business");
      managerName = m.name ?? m.email ?? `User ${m.userId}`;
    }
    const params = { tenantId: actor.tenantId, ids: input.invoiceIds, managerId: input.managerId, managerName };
    await tx(deps.db, async (conn) => {
      await exec(conn, `UPDATE ims_invoices SET account_manager_id = :managerId, account_manager_name = :managerName WHERE tenant_id = :tenantId AND id IN (:ids)`, params);
      if (input.applyToCustomer) {
        await exec(
          conn,
          `UPDATE ims_parties SET account_manager_id = :managerId, account_manager_name = :managerName
           WHERE tenant_id = :tenantId AND id IN (SELECT customer_id FROM (SELECT DISTINCT customer_id FROM ims_invoices WHERE tenant_id = :tenantId AND id IN (:ids) AND customer_id IS NOT NULL) x)`,
          params,
        );
      }
    });
    await recordEvent(deps, actor, {
      type: "ar.assigned",
      entityType: "receivables",
      entityId: "assign",
      summary: managerName ? `Assigned ${input.invoiceIds.length} invoice${input.invoiceIds.length === 1 ? "" : "s"} to ${managerName}` : `Cleared the account manager on ${input.invoiceIds.length} invoice(s)`,
    });
    res.json({ ok: true, managerName });
  });

  router.post("/receivables/auto-reminder", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "receivables");
    const input = parse(z.object({ invoiceIds: z.array(z.string().uuid()).min(1).max(2000), enabled: z.boolean() }), req.body);
    await exec(deps.db, `UPDATE ims_invoices SET auto_reminder = :enabled WHERE tenant_id = :tenantId AND id IN (:ids)`, { tenantId: actor.tenantId, ids: input.invoiceIds, enabled: input.enabled ? 1 : 0 });
    await recordEvent(deps, actor, { type: "ar.auto_reminder", entityType: "receivables", entityId: "auto", summary: `Turned auto reminders ${input.enabled ? "on" : "off"} for ${input.invoiceIds.length} invoice(s)` });
    res.json({ ok: true });
  });

  /* Who may see cost / write here (lets the UI gate without guessing). */
  router.get("/sales/meta", async (_req, res) => {
    const actor = actorOf(res);
    requireSalesRead(res);
    const settings = await getSettings(deps, actor.tenantId);
    res.json({
      canWrite: can(res, "sales"),
      canCollect: can(res, "sales") || can(res, "receivables"),
      allowNegativeStock: settings.allowNegativeStock,
      paymentTermsDays: settings.paymentTermsDays,
      invoicePrefix: settings.invoicePrefix,
    });
  });
}
