import type { Response, Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, can, isoDate, optText, parse, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { ImsError, badRequest, conflict, notFound, type ImsActor } from "./host.js";
import {
  AGING_BUCKETS,
  PAY_METHODS,
  REMINDER_RULES,
  addDaysISO,
  agingBucket,
  allocateFifo,
  arPriority,
  arStatus,
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
  monthStartISO,
  periodRange,
  posChange,
  reminderLink,
  reminderRuleFor,
  renderTemplate,
  round2,
  todayISO,
  type ArPriority,
  type ImsLine,
  type PayMethod,
  type ReminderChannel,
  type ReminderRuleKey,
} from "./logic.js";
import { getSettings, listMembers, type ImsSettings } from "./settings.js";
import { nextDocNo, postMovement } from "./stock.js";

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
  status: string;
  customer_id: string | null;
  customer_name: string;
  customer_gstin: string | null;
  customer_address: string | null;
  customer_mobile: string | null;
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
  round_off: string;
  grand_total: string;
  amount_paid: string;
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
  notes: string | null;
  terms: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  issued_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  party_mobile?: string | null;
  party_email?: string | null;
  party_state?: string | null;
  last_reminder_channel?: string | null;
};

export function mapInvoice(r: InvoiceRow, today: string, withLines = false) {
  const grandTotal = round2(money(r.grand_total));
  const amountPaid = round2(money(r.amount_paid));
  const dueDate = r.due_date ? isoOf(r.due_date) : null;
  const base = { status: r.status, grandTotal, amountPaid, dueDate };
  const balance = invoiceBalance(base);
  const open = r.status === "issued" && balance > 0.005;
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
    status: r.status as "draft" | "issued" | "cancelled",
    displayStatus: invoiceDisplayStatus(base, today),
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerGstin: r.customer_gstin,
    customerAddress: r.customer_address,
    customerMobile: r.customer_mobile || r.party_mobile || null,
    customerEmail: r.party_email ?? null,
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
    roundOff: round2(money(r.round_off)),
    roundToRupee: Boolean(r.round_to_rupee),
    grandTotal,
    amountPaid,
    balance,
    payMode: r.pay_mode,
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
    notes: r.notes,
    terms: r.terms,
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    issuedAt: tsOf(r.issued_at),
    cancelledAt: tsOf(r.cancelled_at),
    cancelReason: r.cancel_reason ?? null,
    daysOverdue,
    ageDays: Math.max(0, daysBetween(invoiceDate, today)),
    agingBucket: agingBucket(daysOverdue),
    priority: arPriority(daysOverdue) as ArPriority,
    arStatus: arStatus({ disputed: Boolean(r.disputed), promiseDate, dueDate, amountPaid }, today),
    lineCount: lines.length,
    ...(withLines ? { lines } : {}),
  };
}

export type ImsInvoice = ReturnType<typeof mapInvoice>;

const INVOICE_SELECT = `SELECT i.*, p.mobile AS party_mobile, p.email AS party_email, p.state AS party_state
  FROM ims_invoices i LEFT JOIN ims_parties p ON p.id = i.customer_id AND p.tenant_id = i.tenant_id`;

async function loadInvoiceRow(db: Queryable, tenantId: number, id: string, lock = false): Promise<InvoiceRow> {
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

async function addActivity(
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
  const r = await loadInvoiceRow(deps.db, tenantId, id);
  const invoice = mapInvoice(r, today, true);
  const [payments, activity] = await Promise.all([
    rows<PaymentRow>(deps.db, `SELECT * FROM ims_payments WHERE tenant_id = :tenantId AND doc_type = 'invoice' AND doc_id = :id ORDER BY paid_on DESC, created_at DESC`, { tenantId, id }),
    rows<ActivityRow>(deps.db, `SELECT * FROM ims_ar_activity WHERE tenant_id = :tenantId AND invoice_id = :id ORDER BY created_at DESC LIMIT 200`, { tenantId, id }),
  ]);
  return { invoice, hsn: hsnSummary(invoice.lines ?? []), payments: payments.map(mapPayment), activity: activity.map(mapActivity) };
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
  placeOfSupply: optText(80),
  invoiceDate: isoDate,
  dueDate: isoDate.nullable().optional(),
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

/** Column values for an invoice from the editor input (GST split, totals, due date from terms). */
async function invoiceValues(db: Queryable, actor: ImsActor, settings: ImsSettings, input: InvoiceInputT) {
  const party = await partyLite(db, actor.tenantId, input.customerId);
  const gstin = input.customerGstin?.trim().toUpperCase() || party?.gstin || null;
  const placeOfSupply = input.placeOfSupply?.trim() || party?.state || gstStateName(gstin) || settings.state || null;
  const intra = intraStateFor(settings, placeOfSupply);
  const totals = computeTotals(input.lines, intra, input.roundToRupee);
  const dueDate = input.dueDate ?? dueDateFor(input.invoiceDate, party?.payment_terms_days ?? null, settings.paymentTermsDays);
  if (dueDate < input.invoiceDate) throw badRequest("The due date can't be before the invoice date");
  const address = input.customerAddress?.trim() || [party?.address, party?.city].filter(Boolean).join(", ") || null;
  return {
    customerId: party?.id ?? null,
    customerName: input.customerName.trim(),
    customerGstin: gstin,
    customerAddress: address,
    customerMobile: input.customerMobile?.trim() || party?.mobile || null,
    placeOfSupply,
    intraState: intra ? 1 : 0,
    invoiceDate: input.invoiceDate,
    dueDate,
    lines: JSON.stringify(totals.lines),
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    roundOff: totals.roundOff,
    grandTotal: totals.grandTotal,
    roundToRupee: input.roundToRupee ? 1 : 0,
    accountManagerId: party?.account_manager_id ?? null,
    accountManagerName: party?.account_manager_name ?? null,
    notes: input.notes ?? null,
    terms: input.terms ?? settings.terms ?? null,
  };
}

async function insertInvoice(db: Queryable, actor: ImsActor, id: string, values: Awaited<ReturnType<typeof invoiceValues>>, extra: { sourceTool?: string | null; sourceRef?: string | null } = {}) {
  await exec(
    db,
    `INSERT INTO ims_invoices
       (id, tenant_id, invoice_no, status, customer_id, customer_name, customer_gstin, customer_address, customer_mobile, place_of_supply, intra_state,
        invoice_date, due_date, \`lines\`, subtotal, discount_total, tax_total, cgst, sgst, igst, round_off, grand_total, round_to_rupee,
        account_manager_id, account_manager_name, source_tool, source_ref, notes, terms, created_by, created_by_name)
     VALUES
       (:id, :tenantId, :invoiceNo, 'draft', :customerId, :customerName, :customerGstin, :customerAddress, :customerMobile, :placeOfSupply, :intraState,
        :invoiceDate, :dueDate, :lines, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :roundOff, :grandTotal, :roundToRupee,
        :accountManagerId, :accountManagerName, :sourceTool, :sourceRef, :notes, :terms, :userId, :userName)`,
    {
      ...values,
      id,
      tenantId: actor.tenantId,
      invoiceNo: `${DRAFT_PREFIX}${id.slice(0, 8).toUpperCase()}`,
      sourceTool: extra.sourceTool ?? null,
      sourceRef: extra.sourceRef ?? null,
      userId: actor.userId,
      userName: actorName(actor),
    },
  );
}

/**
 * Issue a draft in the caller's transaction: number it, post an OUT movement for every item-linked
 * line (respecting the negative-stock rule) and mark stock as posted.
 */
async function issueDraft(conn: PoolConnection, actor: ImsActor, settings: ImsSettings, id: string, refType: "invoice" | "pos"): Promise<{ invoiceNo: string; row: InvoiceRow }> {
  const row = await loadInvoiceRow(conn, actor.tenantId, id, true);
  if (row.status !== "draft") throw conflict("Only draft invoices can be issued");
  const lines = json<ImsLine[]>(row.lines, []);
  if (!lines.length) throw badRequest("Add at least one line before issuing");
  if (money(row.grand_total) <= 0) throw badRequest("The invoice total must be more than zero");
  if (!row.customer_name.trim()) throw badRequest("Pick a customer before issuing");
  const invoiceDate = isoOf(row.invoice_date);
  await assertDayOpen(conn, actor.tenantId, invoiceDate);
  const invoiceNo = await nextDocNo(conn, actor.tenantId, "invoice", settings.invoicePrefix, invoiceDate, settings.fiscalYearStart);
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
  await exec(conn, `UPDATE ims_invoices SET status = 'issued', invoice_no = :invoiceNo, stock_posted = 1, issued_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`, {
    tenantId: actor.tenantId,
    id,
    invoiceNo,
  });
  return { invoiceNo, row };
}

/** Puts back the stock an issued invoice took out. */
async function reverseInvoiceStock(conn: PoolConnection, actor: ImsActor, row: InvoiceRow, reason: string): Promise<void> {
  if (!row.stock_posted) return;
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
    else if (source === "quotation") where.push("i.source_tool IS NOT NULL AND i.source_tool <> 'pos'");
    const q = qstr(req.query.q);
    if (q) {
      where.push("(i.invoice_no LIKE :q OR i.customer_name LIKE :q OR i.customer_gstin LIKE :q OR i.customer_mobile LIKE :q OR i.source_ref LIKE :q)");
      params.q = likeOf(q);
    }
    const list = (await rows<InvoiceRow>(deps.db, `${INVOICE_SELECT} WHERE ${where.join(" AND ")} ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT :limit`, params)).map((r) => mapInvoice(r, today));
    const counts = { all: list.length, draft: 0, unpaid: 0, partial: 0, paid: 0, overdue: 0, cancelled: 0 };
    for (const inv of list) counts[inv.displayStatus] += 1;
    const status = qstr(req.query.status, 12);
    const shown = status && status !== "all" ? list.filter((i) => (status === "open" ? i.balance > 0.005 : i.displayStatus === status)) : list;

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
         SUM(GREATEST(grand_total - amount_paid, 0)) AS outstanding,
         SUM(CASE WHEN due_date < :today AND grand_total - amount_paid > 0.005 THEN grand_total - amount_paid ELSE 0 END) AS overdue,
         SUM(CASE WHEN due_date < :today AND grand_total - amount_paid > 0.005 THEN 1 ELSE 0 END) AS overdue_count
       FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued'`,
      { tenantId: actor.tenantId, monthStart, lmStart, lmEnd, today },
    );
    const issued = list.filter((i) => i.status === "issued");
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
         (SELECT SUM(GREATEST(grand_total - amount_paid, 0)) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :customerId AND status = 'issued') AS outstanding,
         (SELECT SUM(grand_total - amount_paid) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :customerId AND status = 'issued' AND due_date < :today AND grand_total - amount_paid > 0.005) AS overdue,
         (SELECT COUNT(*) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :customerId AND status = 'issued' AND grand_total - amount_paid > 0.005) AS open_count,
         (SELECT MAX(invoice_date) FROM ims_invoices WHERE tenant_id = :tenantId AND customer_id = :customerId AND status = 'issued') AS last_date,
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
    const settings = await getSettings(deps, actor.tenantId);
    const id = randomUUID();
    const values = await invoiceValues(deps.db, actor, settings, input);
    const invoiceNo = await tx(deps.db, async (conn) => {
      await insertInvoice(conn, actor, id, values);
      return input.issue ? (await issueDraft(conn, actor, settings, id, "invoice")).invoiceNo : null;
    });
    await recordEvent(deps, actor, {
      type: input.issue ? "invoice.issued" : "invoice.created",
      entityType: "invoice",
      entityId: id,
      summary: input.issue ? `Issued invoice ${invoiceNo} to ${values.customerName} (${formatINR(values.grandTotal)})` : `Saved draft invoice for ${values.customerName} (${formatINR(values.grandTotal)})`,
    });
    res.status(201).json(await invoiceDetail(deps, actor.tenantId, id));
  });

  /* Edit a draft (full replace of the editable fields). */
  router.patch("/invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const existing = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    if (existing.status !== "draft") throw conflict("Issued invoices can't be edited. Cancel it and issue a corrected one.");
    const input = parse(InvoiceInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const v = await invoiceValues(deps.db, actor, settings, input);
    await exec(
      deps.db,
      `UPDATE ims_invoices SET customer_id = :customerId, customer_name = :customerName, customer_gstin = :customerGstin, customer_address = :customerAddress,
         customer_mobile = :customerMobile, place_of_supply = :placeOfSupply, intra_state = :intraState, invoice_date = :invoiceDate, due_date = :dueDate,
         \`lines\` = :lines, subtotal = :subtotal, discount_total = :discountTotal, tax_total = :taxTotal, cgst = :cgst, sgst = :sgst, igst = :igst,
         round_off = :roundOff, grand_total = :grandTotal, round_to_rupee = :roundToRupee,
         account_manager_id = COALESCE(account_manager_id, :accountManagerId), account_manager_name = COALESCE(account_manager_name, :accountManagerName),
         notes = :notes, terms = :terms
       WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
      { ...v, tenantId: actor.tenantId, id: existing.id },
    );
    await recordEvent(deps, actor, { type: "invoice.updated", entityType: "invoice", entityId: existing.id, summary: `Updated draft invoice for ${v.customerName} (${formatINR(v.grandTotal)})` });
    res.json(await invoiceDetail(deps, actor.tenantId, existing.id));
  });

  router.post("/invoices/:id/issue", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const settings = await getSettings(deps, actor.tenantId);
    const { invoiceNo, row } = await tx(deps.db, (conn) => issueDraft(conn, actor, settings, req.params.id, "invoice"));
    await recordEvent(deps, actor, {
      type: "invoice.issued",
      entityType: "invoice",
      entityId: row.id,
      summary: `Issued invoice ${invoiceNo} to ${row.customer_name} (${formatINR(money(row.grand_total))})${row.source_tool && row.source_tool !== "pos" ? ` · from ${row.source_tool}` : ""}`,
    });
    res.json(await invoiceDetail(deps, actor.tenantId, row.id));
  });

  router.post("/invoices/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(z.object({ reason: z.string().trim().min(3, "Give a short reason").max(255) }), req.body);
    const row = await tx(deps.db, async (conn) => {
      const r = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (r.status !== "issued") throw conflict(r.status === "draft" ? "Drafts are deleted, not cancelled" : "This invoice is already cancelled");
      if (money(r.amount_paid) > 0.005) throw conflict(`${formatINR(money(r.amount_paid))} has been received against this invoice. Void those payments first, then cancel.`);
      await reverseInvoiceStock(conn, actor, r, "Invoice cancelled");
      await exec(conn, `UPDATE ims_invoices SET status = 'cancelled', stock_posted = 0, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = :reason WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: r.id,
        reason: input.reason,
      });
      return r;
    });
    await recordEvent(deps, actor, {
      type: "invoice.cancelled",
      entityType: "invoice",
      entityId: row.id,
      summary: `Cancelled invoice ${row.invoice_no} (${formatINR(money(row.grand_total))}) — stock returned`,
      payload: { reason: input.reason },
    });
    res.json(await invoiceDetail(deps, actor.tenantId, row.id));
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
      placeOfSupply: src.place_of_supply,
      invoiceDate: today,
      dueDate: null,
      lines: lines.map((l) => ({ itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })),
      roundToRupee: Boolean(src.round_to_rupee),
      notes: src.notes,
      terms: src.terms,
    });
    const id = randomUUID();
    await insertInvoice(deps.db, actor, id, values);
    await recordEvent(deps, actor, { type: "invoice.created", entityType: "invoice", entityId: id, summary: `Duplicated ${src.invoice_no} as a new draft for ${src.customer_name}` });
    res.status(201).json(await invoiceDetail(deps, actor.tenantId, id));
  });

  router.delete("/invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const row = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "draft") throw conflict("Only drafts can be deleted. Cancel an issued invoice instead.");
    await tx(deps.db, async (conn) => {
      await exec(conn, `DELETE FROM ims_ar_activity WHERE tenant_id = :tenantId AND invoice_id = :id`, { tenantId: actor.tenantId, id: row.id });
      await exec(conn, `DELETE FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`, { tenantId: actor.tenantId, id: row.id });
      if (row.source_tool && row.source_ref) {
        await exec(conn, `DELETE FROM ims_links WHERE tenant_id = :tenantId AND target_type = 'invoice' AND target_id = :id`, { tenantId: actor.tenantId, id: row.id });
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
      const balance = invoiceBalance({ status: r.status, grandTotal: money(r.grand_total), amountPaid: money(r.amount_paid) });
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
        `SELECT * FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND grand_total - amount_paid > 0.005
           AND ${input.partyId ? "customer_id = :partyId" : "customer_id IS NULL AND customer_name = :partyName"}
         ORDER BY COALESCE(due_date, invoice_date), invoice_date, created_at FOR UPDATE`,
        { tenantId: actor.tenantId, partyId: input.partyId ?? null, partyName: input.partyName },
      );
      const ordered = input.invoiceIds?.length ? input.invoiceIds.map((id) => open.find((o) => o.id === id)).filter((o): o is InvoiceRow => Boolean(o)) : open;
      const { allocations, remainder } = allocateFifo(
        input.amount,
        ordered.map((o) => ({ id: o.id, balance: round2(money(o.grand_total) - money(o.amount_paid)) })),
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
         WHERE i.tenant_id = :tenantId AND i.status = 'issued' AND i.grand_total - i.amount_paid > 0.005
         ORDER BY i.due_date ASC, i.invoice_date ASC LIMIT 3000`,
        { tenantId: actor.tenantId },
      ),
      one<{ total: string | null; n: string | null }>(deps.db, `SELECT SUM(amount) AS total, COUNT(*) AS n FROM ims_payments WHERE tenant_id = :tenantId AND direction = 'in' AND paid_on >= :monthStart`, {
        tenantId: actor.tenantId,
        monthStart,
      }),
      one<{ total: string | null }>(deps.db, `SELECT SUM(grand_total) AS total FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND invoice_date >= :since`, {
        tenantId: actor.tenantId,
        since: addDaysISO(today, -89),
      }),
      listMembers(deps, actor).catch(() => []),
    ]);
    const invoices = openRows.map((r) => mapInvoice(r, today));
    const sum = (list: ImsInvoice[], pick: (i: ImsInvoice) => number = (i) => i.balance) => round2(list.reduce((s, i) => s + pick(i), 0));
    const overdue = invoices.filter((i) => i.dueDate && i.dueDate < today);
    const weekEnd = addDaysISO(today, 7);
    const dueWeek = invoices.filter((i) => i.dueDate && i.dueDate >= today && i.dueDate <= weekEnd);
    const promises = invoices.filter((i) => i.promiseDate && i.promiseDate <= today);
    const missed = invoices.filter((i) => i.promiseDate && i.promiseDate < today);
    const totalOutstanding = sum(invoices);
    const aging = AGING_BUCKETS.map((b) => {
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
    const ruleMatches = invoices
      .filter((i) => i.autoReminder && !i.disputed && i.dueDate && !(i.lastReminderAt && i.lastReminderAt.slice(0, 10) === today))
      .map((i) => ({ invoice: i, rule: reminderRuleFor(i.dueDate as string, today) }))
      .filter((m): m is { invoice: ImsInvoice; rule: ReminderRuleKey } => m.rule !== null && ruleOn[m.rule])
      .map((m) => ({
        invoiceId: m.invoice.id,
        rule: m.rule,
        ruleLabel: REMINDER_RULES.find((r) => r.key === m.rule)?.label ?? m.rule,
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
        overdue90: sum(overdue.filter((i) => i.daysOverdue >= 91)),
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
    ).map((r) => mapInvoice(r, today));
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
