import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, isoDate as iso, optText, parse, recordEvent, type BosDeps } from "./context.js";
import { exec, json, money, nextSequence, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import {
  addDaysISO,
  agingBucket,
  computeInvoiceTotals,
  daysBetween,
  displayStatus,
  fiscalYearLabel,
  formatDocNo,
  isIntraState,
  outstanding,
  phoneKey,
  round2,
  settleStatus,
  todayISO,
  type AgingBucket,
  type BosLine,
  type BosLineInput,
  type InvoiceStatus,
} from "./logic.js";
import { getSettings } from "./workspace.js";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/* =====================================================================
 * Parties (customers & vendors)
 * ===================================================================== */

export const PARTY_KINDS = ["customer", "vendor", "both"] as const;

export const PartyInput = z.object({
  kind: z.enum(PARTY_KINDS).default("customer"),
  name: z.string().trim().min(1, "Required").max(200),
  company: optText(200),
  gstin: optText(20),
  email: optText(180),
  phone: optText(40),
  address: optText(500),
  city: optText(120),
  state: optText(80),
  notes: optText(4000),
});
export type PartyInputT = z.infer<typeof PartyInput>;

type PartyRow = {
  id: string;
  kind: string;
  name: string;
  company: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  source_tool: string | null;
  source_ref: string | null;
  created_at: string;
};

const mapParty = (r: PartyRow) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  company: r.company,
  gstin: r.gstin,
  email: r.email,
  phone: r.phone,
  address: r.address,
  city: r.city,
  state: r.state,
  notes: r.notes,
  sourceTool: r.source_tool,
  sourceRef: r.source_ref,
  createdAt: r.created_at,
});

export async function createParty(
  deps: BosDeps,
  actor: BosActor,
  input: PartyInputT & { sourceTool?: string | null; sourceRef?: string | null },
  conn?: PoolConnection,
): Promise<string> {
  const id = randomUUID();
  await exec(
    conn ?? deps.db,
    `INSERT INTO bos_parties (id, tenant_id, kind, name, company, gstin, email, phone, address, city, state, notes, source_tool, source_ref, created_by)
     VALUES (:id, :tenantId, :kind, :name, :company, :gstin, :email, :phone, :address, :city, :state, :notes, :sourceTool, :sourceRef, :userId)`,
    {
      id,
      tenantId: actor.tenantId,
      kind: input.kind,
      name: input.name,
      company: input.company ?? null,
      gstin: input.gstin ? input.gstin.toUpperCase() : null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      notes: input.notes ?? null,
      sourceTool: input.sourceTool ?? null,
      sourceRef: input.sourceRef ?? null,
      userId: actor.userId,
    },
  );
  return id;
}

/** Existing party with the same phone (last 10 digits) or, failing that, the same name. */
export async function findParty(deps: BosDeps, tenantId: number, probe: { name: string; phone?: string | null }, conn?: PoolConnection): Promise<string | null> {
  const key = phoneKey(probe.phone);
  const candidates = await rows<{ id: string; name: string; phone: string | null }>(
    conn ?? deps.db,
    `SELECT id, name, phone FROM bos_parties
     WHERE tenant_id = :tenantId AND archived_at IS NULL AND (LOWER(name) = LOWER(:name) OR phone IS NOT NULL)
     LIMIT 5000`,
    { tenantId, name: probe.name },
  );
  if (key.length >= 10) {
    const byPhone = candidates.find((c) => phoneKey(c.phone) === key);
    if (byPhone) return byPhone.id;
  }
  return candidates.find((c) => c.name.toLowerCase() === probe.name.toLowerCase())?.id ?? null;
}

/* =====================================================================
 * Invoices & payments
 * ===================================================================== */

const LineInput = z.object({
  description: z.string().trim().max(500).default(""),
  hsn: optText(20),
  unit: optText(20),
  quantity: z.coerce.number().min(0).max(1e9),
  rate: z.coerce.number().min(-1e12).max(1e12),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  taxRate: z.coerce.number().min(0).max(100),
});

export const InvoiceInput = z.object({
  partyId: z.string().max(36).nullable().optional(),
  partyName: z.string().trim().min(1, "Choose or enter a customer").max(200),
  partyGstin: optText(20),
  partyAddress: optText(500),
  issueDate: iso,
  dueDate: iso,
  placeOfSupply: optText(80),
  lines: z.array(LineInput).min(1, "Add at least one line item").max(200),
  notes: optText(4000),
  issue: z.boolean().optional(),
});
export type InvoiceInputT = z.infer<typeof InvoiceInput>;

type InvoiceRow = {
  id: string;
  invoice_no: string;
  party_id: string | null;
  party_name: string;
  party_gstin: string | null;
  party_address: string | null;
  issue_date: string;
  due_date: string;
  status: string;
  place_of_supply: string | null;
  intra_state: number;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  cgst: string | number;
  sgst: string | number;
  igst: string | number;
  grand_total: string | number;
  amount_paid: string | number;
  line_items: unknown;
  notes: string | null;
  source_tool: string | null;
  source_ref: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapInvoice(r: InvoiceRow, today: string) {
  const grandTotal = money(r.grand_total);
  const amountPaid = money(r.amount_paid);
  const base = { status: r.status, dueDate: r.due_date, grandTotal, amountPaid };
  const shown = displayStatus(base, today);
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    partyId: r.party_id,
    partyName: r.party_name,
    partyGstin: r.party_gstin,
    partyAddress: r.party_address,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    status: r.status as InvoiceStatus,
    displayStatus: shown,
    placeOfSupply: r.place_of_supply,
    intraState: Boolean(r.intra_state),
    subtotal: money(r.subtotal),
    discountTotal: money(r.discount_total),
    taxTotal: money(r.tax_total),
    cgst: money(r.cgst),
    sgst: money(r.sgst),
    igst: money(r.igst),
    grandTotal,
    amountPaid,
    balance: outstanding(base),
    daysOverdue: shown === "overdue" ? daysBetween(r.due_date, today) : 0,
    lines: json<BosLine[]>(r.line_items, []),
    notes: r.notes,
    sourceTool: r.source_tool,
    sourceRef: r.source_ref,
    sentAt: r.sent_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export type BosInvoice = ReturnType<typeof mapInvoice>;

async function loadInvoice(deps: BosDeps, tenantId: number, id: string, conn?: PoolConnection): Promise<InvoiceRow> {
  const row = await one<InvoiceRow>(conn ?? deps.db, `SELECT * FROM bos_invoices WHERE id = :id AND tenant_id = :tenantId ${conn ? "FOR UPDATE" : ""}`, { id, tenantId });
  if (!row) throw notFound("Invoice");
  return row;
}

export async function createInvoice(
  deps: BosDeps,
  actor: BosActor,
  input: InvoiceInputT & { sourceTool?: string | null; sourceRef?: string | null },
  conn?: PoolConnection,
): Promise<{ id: string; invoiceNo: string }> {
  if (input.dueDate < input.issueDate) throw new BosError(400, "Due date cannot be before the invoice date");
  const settings = await getSettings(deps, actor.tenantId);
  const intra = isIntraState(settings.state, input.placeOfSupply);
  const totals = computeInvoiceTotals(input.lines as BosLineInput[], intra);
  const fy = fiscalYearLabel(input.issueDate, settings.fiscalYearStart);
  const db = conn ?? deps.db;
  const seq = await nextSequence(db, actor.tenantId, "invoice", fy);
  const invoiceNo = formatDocNo(settings.invoicePrefix, fy, seq);
  const id = randomUUID();
  await exec(
    db,
    `INSERT INTO bos_invoices (id, tenant_id, invoice_no, party_id, party_name, party_gstin, party_address, issue_date, due_date,
       status, place_of_supply, intra_state, subtotal, discount_total, tax_total, cgst, sgst, igst, grand_total, line_items, notes,
       source_tool, source_ref, created_by, sent_at)
     VALUES (:id, :tenantId, :invoiceNo, :partyId, :partyName, :partyGstin, :partyAddress, :issueDate, :dueDate,
       :status, :placeOfSupply, :intra, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :grandTotal, :lines, :notes,
       :sourceTool, :sourceRef, :userId, ${input.issue ? "CURRENT_TIMESTAMP" : "NULL"})`,
    {
      id,
      tenantId: actor.tenantId,
      invoiceNo,
      partyId: input.partyId ?? null,
      partyName: input.partyName,
      partyGstin: input.partyGstin ? input.partyGstin.toUpperCase() : null,
      partyAddress: input.partyAddress ?? null,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.issue ? "sent" : "draft",
      placeOfSupply: input.placeOfSupply ?? null,
      intra: intra ? 1 : 0,
      ...totals,
      lines: JSON.stringify(totals.lines),
      notes: input.notes ?? settings.invoiceNotes ?? null,
      sourceTool: input.sourceTool ?? null,
      sourceRef: input.sourceRef ?? null,
      userId: actor.userId,
    },
  );
  return { id, invoiceNo };
}

const PaymentInput = z.object({
  amount: z.coerce.number().positive("Must be more than zero").max(1e12),
  paidOn: iso,
  method: z.enum(["bank", "upi", "cash", "cheque", "card", "other"]).default("bank"),
  reference: optText(120),
  notes: optText(500),
});

/* =====================================================================
 * Bills (payables) & expenses
 * ===================================================================== */

const BillInput = z.object({
  partyId: z.string().max(36).nullable().optional(),
  partyName: z.string().trim().min(1, "Required").max(200),
  billNo: optText(64),
  billDate: iso,
  dueDate: iso,
  category: optText(80),
  amount: z.coerce.number().min(0).max(1e12),
  taxAmount: z.coerce.number().min(0).max(1e12).default(0),
  notes: optText(4000),
});

type BillRow = {
  id: string;
  bill_no: string | null;
  party_id: string | null;
  party_name: string;
  bill_date: string;
  due_date: string;
  category: string | null;
  amount: string | number;
  tax_amount: string | number;
  total: string | number;
  status: string;
  notes: string | null;
  decided_at: string | null;
  paid_on: string | null;
  created_at: string;
};

const mapBill = (r: BillRow, today: string) => ({
  id: r.id,
  billNo: r.bill_no,
  partyId: r.party_id,
  partyName: r.party_name,
  billDate: r.bill_date,
  dueDate: r.due_date,
  category: r.category,
  amount: money(r.amount),
  taxAmount: money(r.tax_amount),
  total: money(r.total),
  status: r.status,
  overdue: (r.status === "pending" || r.status === "approved") && r.due_date < today,
  notes: r.notes,
  decidedAt: r.decided_at,
  paidOn: r.paid_on,
  createdAt: r.created_at,
});

export const EXPENSE_CATEGORIES = ["Travel", "Meals", "Fuel", "Office", "Software", "Site materials", "Utilities", "Other"] as const;

const ExpenseInput = z.object({
  employeeId: z.string().max(36).nullable().optional(),
  claimantName: optText(120),
  category: z.string().trim().min(1, "Required").max(80),
  description: optText(500),
  amount: z.coerce.number().positive("Must be more than zero").max(1e10),
  spentOn: iso,
});

type ExpenseRow = {
  id: string;
  employee_id: string | null;
  claimant_name: string | null;
  category: string;
  description: string | null;
  amount: string | number;
  spent_on: string;
  status: string;
  decided_at: string | null;
  created_at: string;
};

const mapExpense = (r: ExpenseRow) => ({
  id: r.id,
  employeeId: r.employee_id,
  claimantName: r.claimant_name,
  category: r.category,
  description: r.description,
  amount: money(r.amount),
  spentOn: r.spent_on,
  status: r.status,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
});

const Decision = z.object({ decision: z.enum(["approved", "rejected"]), note: optText(500) });

/* =====================================================================
 * Reporting helpers
 * ===================================================================== */

function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

const MONTH_LABEL = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });

async function monthlySums(deps: BosDeps, sql: string, tenantId: number, from: string): Promise<Map<string, number>> {
  const list = await rows<{ ym: string; total: string | number }>(deps.db, sql, { tenantId, from });
  return new Map(list.map((r) => [r.ym, money(r.total)]));
}

/* =====================================================================
 * Routes
 * ===================================================================== */

export function registerFinance(router: Router, deps: BosDeps): void {
  /* ----- Parties ----- */

  router.get("/parties", async (req, res) => {
    const actor = actorOf(res);
    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const list = await rows<PartyRow & { invoiced: string | number; balance: string | number }>(
      deps.db,
      `SELECT p.*,
         COALESCE((SELECT SUM(i.grand_total) FROM bos_invoices i WHERE i.tenant_id = p.tenant_id AND i.party_id = p.id AND i.status NOT IN ('draft','void')), 0) AS invoiced,
         COALESCE((SELECT SUM(i.grand_total - i.amount_paid) FROM bos_invoices i WHERE i.tenant_id = p.tenant_id AND i.party_id = p.id AND i.status IN ('sent','partial')), 0) AS balance
       FROM bos_parties p
       WHERE p.tenant_id = :tenantId AND p.archived_at IS NULL
         ${kind === "customer" ? "AND p.kind IN ('customer','both')" : kind === "vendor" ? "AND p.kind IN ('vendor','both')" : ""}
         ${q ? "AND (p.name LIKE :like OR p.company LIKE :like OR p.phone LIKE :like OR p.gstin LIKE :like)" : ""}
       ORDER BY p.name ASC LIMIT 1000`,
      { tenantId: actor.tenantId, like: `%${q}%` },
    );
    res.json({ parties: list.map((r) => ({ ...mapParty(r), invoiced: money(r.invoiced), balance: money(r.balance) })) });
  });

  router.post("/parties", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(PartyInput, req.body);
    const id = await createParty(deps, actor, input);
    await recordEvent(deps, actor, { type: "party.create", entityType: "party", entityId: id, summary: `Added ${input.kind} ${input.name}`, ip: req.ip });
    const row = await one<PartyRow>(deps.db, `SELECT * FROM bos_parties WHERE id = :id`, { id });
    res.status(201).json({ party: mapParty(row!) });
  });

  router.patch("/parties/:id", async (req, res) => {
    const actor = actorOf(res);
    const existing = await one<PartyRow>(deps.db, `SELECT * FROM bos_parties WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!existing) throw notFound("Customer or vendor");
    const input = parse(PartyInput.partial(), req.body);
    const merged = { ...mapParty(existing), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    await exec(
      deps.db,
      `UPDATE bos_parties SET kind = :kind, name = :name, company = :company, gstin = :gstin, email = :email, phone = :phone,
         address = :address, city = :city, state = :state, notes = :notes WHERE id = :id AND tenant_id = :tenantId`,
      { ...merged, gstin: merged.gstin ? String(merged.gstin).toUpperCase() : null, id: existing.id, tenantId: actor.tenantId },
    );
    await recordEvent(deps, actor, { type: "party.update", entityType: "party", entityId: existing.id, summary: `Updated ${merged.name}`, ip: req.ip });
    const row = await one<PartyRow>(deps.db, `SELECT * FROM bos_parties WHERE id = :id`, { id: existing.id });
    res.json({ party: mapParty(row!) });
  });

  router.delete("/parties/:id", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const r = await exec(deps.db, `UPDATE bos_parties SET archived_at = CURRENT_TIMESTAMP WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!r.affectedRows) throw notFound("Customer or vendor");
    await recordEvent(deps, actor, { type: "party.archive", entityType: "party", entityId: req.params.id, summary: "Archived a customer/vendor", ip: req.ip });
    res.status(204).end();
  });

  /* ----- Invoices ----- */

  router.get("/invoices", async (req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const partyId = typeof req.query.partyId === "string" ? req.query.partyId : null;
    const list = await rows<InvoiceRow>(
      deps.db,
      `SELECT * FROM bos_invoices WHERE tenant_id = :tenantId ${partyId ? "AND party_id = :partyId" : ""}
       ORDER BY issue_date DESC, invoice_no DESC LIMIT 1000`,
      { tenantId: actor.tenantId, partyId },
    );
    res.json({ invoices: list.map((r) => mapInvoice(r, today)) });
  });

  router.get("/invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    const row = await loadInvoice(deps, actor.tenantId, req.params.id);
    const payments = await rows<Record<string, unknown>>(
      deps.db,
      `SELECT id, amount, paid_on, method, reference, notes, created_at FROM bos_payments
       WHERE tenant_id = :tenantId AND invoice_id = :id ORDER BY paid_on DESC, created_at DESC`,
      { tenantId: actor.tenantId, id: row.id },
    );
    res.json({
      invoice: mapInvoice(row, todayISO()),
      payments: payments.map((p) => ({
        id: p.id,
        amount: money(p.amount),
        paidOn: p.paid_on,
        method: p.method,
        reference: p.reference,
        notes: p.notes,
        createdAt: p.created_at,
      })),
    });
  });

  router.post("/invoices", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(InvoiceInput, req.body);
    const { id, invoiceNo } = await tx(deps.db, (conn) => createInvoice(deps, actor, input, conn));
    const row = await loadInvoice(deps, actor.tenantId, id);
    await recordEvent(deps, actor, {
      type: input.issue ? "invoice.issue" : "invoice.create",
      entityType: "invoice",
      entityId: id,
      summary: `${input.issue ? "Issued" : "Drafted"} ${invoiceNo} for ${input.partyName} · ${inr(money(row.grand_total))}`,
      notice: input.issue
        ? { kind: "activity", title: "Invoice issued", body: `${invoiceNo} · ${input.partyName} · ${inr(money(row.grand_total))}`, path: "?ws=finance&m=invoices" }
        : undefined,
      ip: req.ip,
    });
    res.status(201).json({ invoice: mapInvoice(row, todayISO()) });
  });

  router.put("/invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(InvoiceInput, req.body);
    if (input.dueDate < input.issueDate) throw new BosError(400, "Due date cannot be before the invoice date");
    const existing = await loadInvoice(deps, actor.tenantId, req.params.id);
    if (existing.status === "void" || existing.status === "paid" || money(existing.amount_paid) > 0) {
      throw new BosError(409, "Invoices with payments, paid or void invoices can't be edited");
    }
    const settings = await getSettings(deps, actor.tenantId);
    const intra = isIntraState(settings.state, input.placeOfSupply);
    const totals = computeInvoiceTotals(input.lines as BosLineInput[], intra);
    const issueNow = Boolean(input.issue) && existing.status === "draft";
    await exec(
      deps.db,
      `UPDATE bos_invoices SET party_id = :partyId, party_name = :partyName, party_gstin = :partyGstin, party_address = :partyAddress,
         issue_date = :issueDate, due_date = :dueDate, place_of_supply = :placeOfSupply, intra_state = :intra,
         subtotal = :subtotal, discount_total = :discountTotal, tax_total = :taxTotal, cgst = :cgst, sgst = :sgst, igst = :igst,
         grand_total = :grandTotal, line_items = :lines, notes = :notes
         ${issueNow ? ", status = 'sent', sent_at = CURRENT_TIMESTAMP" : ""}
       WHERE id = :id AND tenant_id = :tenantId`,
      {
        partyId: input.partyId ?? null,
        partyName: input.partyName,
        partyGstin: input.partyGstin ? input.partyGstin.toUpperCase() : null,
        partyAddress: input.partyAddress ?? null,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        placeOfSupply: input.placeOfSupply ?? null,
        intra: intra ? 1 : 0,
        ...totals,
        lines: JSON.stringify(totals.lines),
        notes: input.notes ?? null,
        id: existing.id,
        tenantId: actor.tenantId,
      },
    );
    await recordEvent(deps, actor, {
      type: issueNow ? "invoice.issue" : "invoice.update",
      entityType: "invoice",
      entityId: existing.id,
      summary: `${issueNow ? "Issued" : "Updated"} ${existing.invoice_no} · ${inr(totals.grandTotal)}`,
      notice: issueNow ? { kind: "activity", title: "Invoice issued", body: `${existing.invoice_no} · ${input.partyName} · ${inr(totals.grandTotal)}`, path: "?ws=finance&m=invoices" } : undefined,
      ip: req.ip,
    });
    res.json({ invoice: mapInvoice(await loadInvoice(deps, actor.tenantId, existing.id), todayISO()) });
  });

  router.post("/invoices/:id/issue", async (req, res) => {
    const actor = actorOf(res);
    const existing = await loadInvoice(deps, actor.tenantId, req.params.id);
    if (existing.status !== "draft") throw new BosError(409, "Only drafts can be issued");
    await exec(deps.db, `UPDATE bos_invoices SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = :id AND tenant_id = :tenantId`, { id: existing.id, tenantId: actor.tenantId });
    const total = inr(money(existing.grand_total));
    await recordEvent(deps, actor, {
      type: "invoice.issue",
      entityType: "invoice",
      entityId: existing.id,
      summary: `Issued ${existing.invoice_no} to ${existing.party_name} · ${total}`,
      notice: { kind: "activity", title: "Invoice issued", body: `${existing.invoice_no} · ${existing.party_name} · ${total}`, path: "?ws=finance&m=invoices" },
      ip: req.ip,
    });
    res.json({ invoice: mapInvoice(await loadInvoice(deps, actor.tenantId, existing.id), todayISO()) });
  });

  router.post("/invoices/:id/void", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const existing = await loadInvoice(deps, actor.tenantId, req.params.id);
    if (money(existing.amount_paid) > 0) throw new BosError(409, "Remove the payments before voiding this invoice");
    await exec(deps.db, `UPDATE bos_invoices SET status = 'void', voided_at = CURRENT_TIMESTAMP WHERE id = :id AND tenant_id = :tenantId`, { id: existing.id, tenantId: actor.tenantId });
    await recordEvent(deps, actor, { type: "invoice.void", entityType: "invoice", entityId: existing.id, summary: `Voided ${existing.invoice_no}`, ip: req.ip });
    res.json({ invoice: mapInvoice(await loadInvoice(deps, actor.tenantId, existing.id), todayISO()) });
  });

  router.delete("/invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    const existing = await loadInvoice(deps, actor.tenantId, req.params.id);
    if (existing.status !== "draft") throw new BosError(409, "Only drafts can be deleted — void issued invoices instead");
    await exec(deps.db, `DELETE FROM bos_invoices WHERE id = :id AND tenant_id = :tenantId`, { id: existing.id, tenantId: actor.tenantId });
    await exec(deps.db, `DELETE FROM bos_links WHERE tenant_id = :tenantId AND target_type = 'invoice' AND target_id = :id`, { tenantId: actor.tenantId, id: existing.id });
    await recordEvent(deps, actor, { type: "invoice.delete", entityType: "invoice", entityId: existing.id, summary: `Deleted draft ${existing.invoice_no}`, ip: req.ip });
    res.status(204).end();
  });

  router.post("/invoices/:id/payments", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(PaymentInput, req.body);
    const result = await tx(deps.db, async (conn) => {
      const inv = await loadInvoice(deps, actor.tenantId, req.params.id, conn);
      if (inv.status === "draft" || inv.status === "void") throw new BosError(409, "Issue the invoice before recording payments");
      const balance = round2(money(inv.grand_total) - money(inv.amount_paid));
      if (input.amount > balance + 0.5) throw new BosError(400, `Payment is more than the balance due (${inr(balance)})`);
      const paid = round2(money(inv.amount_paid) + input.amount);
      const status = settleStatus(inv.status as InvoiceStatus, money(inv.grand_total), paid);
      await exec(
        conn,
        `INSERT INTO bos_payments (id, tenant_id, invoice_id, amount, paid_on, method, reference, notes, created_by)
         VALUES (:id, :tenantId, :invoiceId, :amount, :paidOn, :method, :reference, :notes, :userId)`,
        { id: randomUUID(), tenantId: actor.tenantId, invoiceId: inv.id, ...input, reference: input.reference ?? null, notes: input.notes ?? null, userId: actor.userId },
      );
      await exec(conn, `UPDATE bos_invoices SET amount_paid = :paid, status = :status WHERE id = :id`, { paid, status, id: inv.id });
      return { inv, status };
    });
    await recordEvent(deps, actor, {
      type: "invoice.payment",
      entityType: "invoice",
      entityId: result.inv.id,
      summary: `Received ${inr(input.amount)} against ${result.inv.invoice_no}${result.status === "paid" ? " — fully paid" : ""}`,
      payload: { amount: input.amount, method: input.method },
      notice: { kind: "activity", title: "Payment received", body: `${inr(input.amount)} · ${result.inv.invoice_no} · ${result.inv.party_name}`, path: "?ws=finance&m=receivables" },
      ip: req.ip,
    });
    res.status(201).json({ invoice: mapInvoice(await loadInvoice(deps, actor.tenantId, result.inv.id), todayISO()) });
  });

  router.delete("/invoices/:id/payments/:paymentId", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const inv = await tx(deps.db, async (conn) => {
      const invoice = await loadInvoice(deps, actor.tenantId, req.params.id, conn);
      const payment = await one<{ amount: string | number }>(conn, `SELECT amount FROM bos_payments WHERE id = :pid AND invoice_id = :id AND tenant_id = :tenantId`, {
        pid: req.params.paymentId,
        id: invoice.id,
        tenantId: actor.tenantId,
      });
      if (!payment) throw notFound("Payment");
      const paid = Math.max(0, round2(money(invoice.amount_paid) - money(payment.amount)));
      const status = settleStatus(invoice.status === "paid" || invoice.status === "partial" ? "sent" : (invoice.status as InvoiceStatus), money(invoice.grand_total), paid);
      await exec(conn, `DELETE FROM bos_payments WHERE id = :pid`, { pid: req.params.paymentId });
      await exec(conn, `UPDATE bos_invoices SET amount_paid = :paid, status = :status WHERE id = :id`, { paid, status, id: invoice.id });
      return invoice;
    });
    await recordEvent(deps, actor, { type: "invoice.payment_remove", entityType: "invoice", entityId: inv.id, summary: `Removed a payment from ${inv.invoice_no}`, ip: req.ip });
    res.json({ invoice: mapInvoice(await loadInvoice(deps, actor.tenantId, inv.id), todayISO()) });
  });

  /* ----- Bills ----- */

  router.get("/bills", async (_req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const list = await rows<BillRow>(deps.db, `SELECT * FROM bos_bills WHERE tenant_id = :tenantId ORDER BY bill_date DESC LIMIT 1000`, { tenantId: actor.tenantId });
    res.json({ bills: list.map((r) => mapBill(r, today)) });
  });

  router.post("/bills", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(BillInput, req.body);
    if (input.dueDate < input.billDate) throw new BosError(400, "Due date cannot be before the bill date");
    const id = randomUUID();
    const total = round2(input.amount + input.taxAmount);
    await exec(
      deps.db,
      `INSERT INTO bos_bills (id, tenant_id, bill_no, party_id, party_name, bill_date, due_date, category, amount, tax_amount, total, notes, created_by)
       VALUES (:id, :tenantId, :billNo, :partyId, :partyName, :billDate, :dueDate, :category, :amount, :taxAmount, :total, :notes, :userId)`,
      { id, tenantId: actor.tenantId, ...input, billNo: input.billNo ?? null, partyId: input.partyId ?? null, category: input.category ?? null, notes: input.notes ?? null, total, userId: actor.userId },
    );
    await recordEvent(deps, actor, {
      type: "bill.create",
      entityType: "bill",
      entityId: id,
      summary: `Bill from ${input.partyName} · ${inr(total)} awaiting approval`,
      notice: { kind: "approval_requested", title: "Bill awaiting approval", body: `${input.partyName} · ${inr(total)} · due ${input.dueDate}`, path: "?ws=finance&m=payables", dedupeKey: `bos-bill:${id}` },
      ip: req.ip,
    });
    const row = await one<BillRow>(deps.db, `SELECT * FROM bos_bills WHERE id = :id`, { id });
    res.status(201).json({ bill: mapBill(row!, todayISO()) });
  });

  router.post("/bills/:id/decision", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins can approve bills");
    const { decision } = parse(Decision, req.body);
    const bill = await one<BillRow>(deps.db, `SELECT * FROM bos_bills WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!bill) throw notFound("Bill");
    if (bill.status !== "pending") throw new BosError(409, "This bill has already been decided");
    await exec(deps.db, `UPDATE bos_bills SET status = :decision, decided_by = :userId, decided_at = CURRENT_TIMESTAMP WHERE id = :id`, { decision, userId: actor.userId, id: bill.id });
    await recordEvent(deps, actor, { type: `bill.${decision}`, entityType: "bill", entityId: bill.id, summary: `${decision === "approved" ? "Approved" : "Rejected"} bill from ${bill.party_name} · ${inr(money(bill.total))}`, ip: req.ip });
    const row = await one<BillRow>(deps.db, `SELECT * FROM bos_bills WHERE id = :id`, { id: bill.id });
    res.json({ bill: mapBill(row!, todayISO()) });
  });

  router.post("/bills/:id/pay", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const { paidOn } = parse(z.object({ paidOn: iso }), req.body);
    const bill = await one<BillRow>(deps.db, `SELECT * FROM bos_bills WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!bill) throw notFound("Bill");
    if (bill.status !== "approved") throw new BosError(409, "Approve the bill before paying it");
    await exec(deps.db, `UPDATE bos_bills SET status = 'paid', paid_on = :paidOn WHERE id = :id`, { paidOn, id: bill.id });
    await recordEvent(deps, actor, { type: "bill.paid", entityType: "bill", entityId: bill.id, summary: `Paid ${bill.party_name} · ${inr(money(bill.total))}`, ip: req.ip });
    const row = await one<BillRow>(deps.db, `SELECT * FROM bos_bills WHERE id = :id`, { id: bill.id });
    res.json({ bill: mapBill(row!, todayISO()) });
  });

  router.delete("/bills/:id", async (req, res) => {
    const actor = actorOf(res);
    const r = await exec(deps.db, `DELETE FROM bos_bills WHERE id = :id AND tenant_id = :tenantId AND status IN ('pending','rejected')`, { id: req.params.id, tenantId: actor.tenantId });
    if (!r.affectedRows) throw new BosError(409, "Only pending or rejected bills can be deleted");
    await recordEvent(deps, actor, { type: "bill.delete", entityType: "bill", entityId: req.params.id, summary: "Deleted a bill", ip: req.ip });
    res.status(204).end();
  });

  /* ----- Expenses ----- */

  router.get("/expenses", async (_req, res) => {
    const actor = actorOf(res);
    const list = await rows<ExpenseRow>(deps.db, `SELECT * FROM bos_expenses WHERE tenant_id = :tenantId ORDER BY spent_on DESC, created_at DESC LIMIT 1000`, { tenantId: actor.tenantId });
    res.json({ expenses: list.map(mapExpense), categories: EXPENSE_CATEGORIES });
  });

  router.post("/expenses", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(ExpenseInput, req.body);
    let employeeId = input.employeeId ?? null;
    let claimant = input.claimantName ?? null;
    if (employeeId) {
      const emp = await one<{ first_name: string; last_name: string | null }>(deps.db, `SELECT first_name, last_name FROM bos_employees WHERE id = :id AND tenant_id = :tenantId`, { id: employeeId, tenantId: actor.tenantId });
      if (!emp) throw notFound("Employee");
      claimant = claimant || [emp.first_name, emp.last_name].filter(Boolean).join(" ");
    } else if (actor.userId) {
      const me = await one<{ id: string; first_name: string; last_name: string | null }>(deps.db, `SELECT id, first_name, last_name FROM bos_employees WHERE tenant_id = :tenantId AND user_id = :userId LIMIT 1`, { tenantId: actor.tenantId, userId: actor.userId });
      if (me) {
        employeeId = me.id;
        claimant = claimant || [me.first_name, me.last_name].filter(Boolean).join(" ");
      }
    }
    claimant = claimant || actor.name || actor.email || "Team member";
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_expenses (id, tenant_id, employee_id, claimant_name, category, description, amount, spent_on, created_by)
       VALUES (:id, :tenantId, :employeeId, :claimant, :category, :description, :amount, :spentOn, :userId)`,
      { id, tenantId: actor.tenantId, employeeId, claimant, category: input.category, description: input.description ?? null, amount: input.amount, spentOn: input.spentOn, userId: actor.userId },
    );
    await recordEvent(deps, actor, {
      type: "expense.submit",
      entityType: "expense",
      entityId: id,
      summary: `${claimant} claimed ${inr(input.amount)} · ${input.category}`,
      notice: { kind: "approval_requested", title: "Expense claim awaiting approval", body: `${claimant} · ${input.category} · ${inr(input.amount)}`, path: "?ws=finance&m=expenses", dedupeKey: `bos-expense:${id}` },
      ip: req.ip,
    });
    const row = await one<ExpenseRow>(deps.db, `SELECT * FROM bos_expenses WHERE id = :id`, { id });
    res.status(201).json({ expense: mapExpense(row!) });
  });

  router.post("/expenses/:id/decision", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins can approve expenses");
    const { decision } = parse(Decision, req.body);
    const exp = await one<ExpenseRow & { created_by: number | null }>(deps.db, `SELECT * FROM bos_expenses WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!exp) throw notFound("Expense");
    if (exp.status !== "submitted") throw new BosError(409, "This claim has already been decided");
    await exec(deps.db, `UPDATE bos_expenses SET status = :decision, decided_by = :userId, decided_at = CURRENT_TIMESTAMP WHERE id = :id`, { decision, userId: actor.userId, id: exp.id });
    await recordEvent(deps, actor, {
      type: `expense.${decision}`,
      entityType: "expense",
      entityId: exp.id,
      summary: `${decision === "approved" ? "Approved" : "Rejected"} ${exp.claimant_name}'s ${exp.category} claim · ${inr(money(exp.amount))}`,
      notice: exp.created_by && exp.created_by !== actor.userId
        ? { kind: "approval_decided", title: `Expense claim ${decision}`, body: `${exp.category} · ${inr(money(exp.amount))}`, path: "?ws=finance&m=expenses", targetUserId: exp.created_by }
        : undefined,
      ip: req.ip,
    });
    const row = await one<ExpenseRow>(deps.db, `SELECT * FROM bos_expenses WHERE id = :id`, { id: exp.id });
    res.json({ expense: mapExpense(row!) });
  });

  router.post("/expenses/:id/reimburse", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const r = await exec(deps.db, `UPDATE bos_expenses SET status = 'reimbursed' WHERE id = :id AND tenant_id = :tenantId AND status = 'approved'`, { id: req.params.id, tenantId: actor.tenantId });
    if (!r.affectedRows) throw new BosError(409, "Only approved claims can be reimbursed");
    await recordEvent(deps, actor, { type: "expense.reimburse", entityType: "expense", entityId: req.params.id, summary: "Reimbursed an expense claim", ip: req.ip });
    const row = await one<ExpenseRow>(deps.db, `SELECT * FROM bos_expenses WHERE id = :id`, { id: req.params.id });
    res.json({ expense: mapExpense(row!) });
  });

  /* ----- Dashboards & GST ----- */

  router.get("/finance/overview", async (_req, res) => {
    const actor = actorOf(res);
    const t = actor.tenantId;
    const today = todayISO();
    const monthStart = `${today.slice(0, 7)}-01`;
    const months = lastMonths(today, 6);
    const from = `${months[0]}-01`;

    const kpi = await one<Record<string, string | number | null>>(
      deps.db,
      `SELECT
         (SELECT COALESCE(SUM(grand_total),0) FROM bos_invoices WHERE tenant_id = :t AND status NOT IN ('draft','void') AND issue_date >= :monthStart) AS revenue_mtd,
         (SELECT COALESCE(SUM(amount),0) FROM bos_payments WHERE tenant_id = :t AND paid_on >= :monthStart) AS collected_mtd,
         (SELECT COALESCE(SUM(grand_total - amount_paid),0) FROM bos_invoices WHERE tenant_id = :t AND status IN ('sent','partial')) AS receivable,
         (SELECT COALESCE(SUM(grand_total - amount_paid),0) FROM bos_invoices WHERE tenant_id = :t AND status IN ('sent','partial') AND due_date < :today) AS overdue,
         (SELECT COUNT(*) FROM bos_invoices WHERE tenant_id = :t AND status IN ('sent','partial') AND due_date < :today) AS overdue_count,
         (SELECT COUNT(*) FROM bos_invoices WHERE tenant_id = :t AND status = 'draft') AS draft_count,
         (SELECT COALESCE(SUM(total),0) FROM bos_bills WHERE tenant_id = :t AND status IN ('pending','approved')) AS payable,
         (SELECT COUNT(*) FROM bos_bills WHERE tenant_id = :t AND status = 'pending') AS bills_pending,
         (SELECT COALESCE(SUM(amount),0) FROM bos_expenses WHERE tenant_id = :t AND status IN ('approved','reimbursed') AND spent_on >= :monthStart) AS expenses_mtd,
         (SELECT COUNT(*) FROM bos_expenses WHERE tenant_id = :t AND status = 'submitted') AS expenses_pending,
         (SELECT COALESCE(SUM(total),0) FROM bos_bills WHERE tenant_id = :t AND status <> 'rejected' AND bill_date >= :monthStart) AS bills_mtd`,
      { t, monthStart, today },
    );

    const [revenue, collected, expenses, bills] = await Promise.all([
      monthlySums(deps, `SELECT DATE_FORMAT(issue_date, '%Y-%m') AS ym, SUM(grand_total) AS total FROM bos_invoices WHERE tenant_id = :tenantId AND status NOT IN ('draft','void') AND issue_date >= :from GROUP BY ym`, t, from),
      monthlySums(deps, `SELECT DATE_FORMAT(paid_on, '%Y-%m') AS ym, SUM(amount) AS total FROM bos_payments WHERE tenant_id = :tenantId AND paid_on >= :from GROUP BY ym`, t, from),
      monthlySums(deps, `SELECT DATE_FORMAT(spent_on, '%Y-%m') AS ym, SUM(amount) AS total FROM bos_expenses WHERE tenant_id = :tenantId AND status IN ('approved','reimbursed') AND spent_on >= :from GROUP BY ym`, t, from),
      monthlySums(deps, `SELECT DATE_FORMAT(bill_date, '%Y-%m') AS ym, SUM(total) AS total FROM bos_bills WHERE tenant_id = :tenantId AND status <> 'rejected' AND bill_date >= :from GROUP BY ym`, t, from),
    ]);

    const open = await rows<InvoiceRow>(deps.db, `SELECT * FROM bos_invoices WHERE tenant_id = :t AND status IN ('sent','partial') ORDER BY due_date ASC LIMIT 2000`, { t });
    const aging: Record<AgingBucket, number> = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const openMapped = open.map((r) => mapInvoice(r, today));
    for (const inv of openMapped) aging[agingBucket(inv.daysOverdue)] += inv.balance;

    const spendByCategory = await rows<{ category: string; total: string | number }>(
      deps.db,
      `SELECT category, SUM(amount) AS total FROM bos_expenses WHERE tenant_id = :t AND status IN ('approved','reimbursed') AND spent_on >= :from GROUP BY category ORDER BY total DESC LIMIT 6`,
      { t, from },
    );

    const n = (k: string) => money(kpi?.[k]);
    res.json({
      today,
      kpis: {
        revenueMtd: n("revenue_mtd"),
        collectedMtd: n("collected_mtd"),
        receivable: n("receivable"),
        overdue: n("overdue"),
        overdueCount: n("overdue_count"),
        draftCount: n("draft_count"),
        payable: n("payable"),
        billsPending: n("bills_pending"),
        spendMtd: round2(n("expenses_mtd") + n("bills_mtd")),
        expensesPending: n("expenses_pending"),
      },
      series: months.map((ym) => ({
        month: ym,
        label: MONTH_LABEL(ym),
        revenue: revenue.get(ym) ?? 0,
        collected: collected.get(ym) ?? 0,
        spend: round2((expenses.get(ym) ?? 0) + (bills.get(ym) ?? 0)),
      })),
      aging,
      overdueInvoices: openMapped.filter((i) => i.displayStatus === "overdue").sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 6),
      spendByCategory: spendByCategory.map((s) => ({ category: s.category, total: money(s.total) })),
    });
  });

  router.get("/finance/gst", async (req, res) => {
    const actor = actorOf(res);
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : todayISO().slice(0, 7);
    const start = `${month}-01`;
    const end = addDaysISO(`${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10)}`, -1);
    const invoices = await rows<InvoiceRow>(
      deps.db,
      `SELECT * FROM bos_invoices WHERE tenant_id = :t AND status NOT IN ('draft','void') AND issue_date BETWEEN :start AND :end ORDER BY issue_date`,
      { t: actor.tenantId, start, end },
    );
    const byRate = new Map<number, { rate: number; taxable: number; tax: number }>();
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let taxable = 0;
    for (const inv of invoices) {
      cgst += money(inv.cgst);
      sgst += money(inv.sgst);
      igst += money(inv.igst);
      for (const l of json<BosLine[]>(inv.line_items, [])) {
        const slot = byRate.get(l.taxRate) ?? { rate: l.taxRate, taxable: 0, tax: 0 };
        slot.taxable = round2(slot.taxable + l.taxable);
        slot.tax = round2(slot.tax + l.tax);
        byRate.set(l.taxRate, slot);
        taxable += l.taxable;
      }
    }
    const input = await one<{ tax: string | number; count: number }>(
      deps.db,
      `SELECT COALESCE(SUM(tax_amount),0) AS tax, COUNT(*) AS count FROM bos_bills WHERE tenant_id = :t AND status <> 'rejected' AND bill_date BETWEEN :start AND :end`,
      { t: actor.tenantId, start, end },
    );
    const outputTax = round2(cgst + sgst + igst);
    const inputTax = money(input?.tax);
    res.json({
      month,
      invoiceCount: invoices.length,
      taxable: round2(taxable),
      cgst: round2(cgst),
      sgst: round2(sgst),
      igst: round2(igst),
      outputTax,
      inputTax,
      billCount: Number(input?.count ?? 0),
      netPayable: round2(outputTax - inputTax),
      byRate: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    });
  });
}
