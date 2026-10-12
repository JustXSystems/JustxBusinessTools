import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, isOwner, isoDate, optText, parse, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, forbidden, notFound } from "./host.js";
import {
  LEDGER_ENTRY_TYPES,
  PAY_METHODS,
  dayFigures,
  daysBetween,
  formatINR,
  ledgerEntrySigned,
  periodRange,
  round2,
  runningBalance,
  todayISO,
  type DayExpense,
  type DayPayment,
} from "./logic.js";
import { assertDayOpen, dateText } from "./sales.js";
import { getSettings } from "./settings.js";

/* ---------- Party ledger ---------- */

const LEDGER_PERMS = ["receivables", "payables", "reports"] as const;
const LEDGER_WRITE = ["receivables", "payables"] as const;

type EntryRow = {
  id: string;
  party_id: string | null;
  party_name: string;
  entry_type: string;
  category: string;
  amount: string;
  entry_date: unknown;
  ref_no: string | null;
  notes: string | null;
  phone?: string | null;
  due_date?: unknown;
  settled_on?: unknown;
  settle_method?: string | null;
  settled_by_name?: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
};

const mapEntry = (r: EntryRow, today: string) => {
  const dueDate = r.due_date ? isoOf(r.due_date) : null;
  const settledOn = r.settled_on ? isoOf(r.settled_on) : null;
  return {
    id: r.id,
    partyId: r.party_id,
    partyName: r.party_name,
    type: r.entry_type as "credit" | "debit",
    category: r.category,
    amount: round2(money(r.amount)),
    date: isoOf(r.entry_date),
    dueDate,
    overdue: !settledOn && dueDate !== null && dueDate < today,
    daysOverdue: !settledOn && dueDate && dueDate < today ? daysBetween(dueDate, today) : 0,
    refNo: r.ref_no,
    phone: r.phone ?? null,
    notes: r.notes,
    status: settledOn ? ("settled" as const) : ("pending" as const),
    settledOn,
    settleMethod: r.settle_method ?? null,
    settledByName: r.settled_by_name ?? null,
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
  };
};

type PartyRow = { id: string; kind: string; name: string; mobile: string | null; email: string | null; gstin: string | null; address: string | null; city: string | null; state: string | null; opening_balance: string; credit_limit: string | null };

type Agg = { party_id: string | null; party_name: string; total: string | null; last_date: unknown };

const keyOf = (id: string | null, name: string) => (id ? `id:${id}` : `name:${name.trim().toLowerCase()}`);

type PartyBalance = {
  key: string;
  partyId: string | null;
  name: string;
  kind: string | null;
  mobile: string | null;
  opening: number;
  sales: number;
  received: number;
  purchases: number;
  paid: number;
  creditNotes: number;
  debitNotes: number;
  manual: number;
  balance: number;
  lastActivity: string | null;
};

/** Signed balance per party: positive = they owe you, negative = you owe them. */
async function partyBalances(db: Queryable, tenantId: number): Promise<PartyBalance[]> {
  const p = { tenantId };
  const [parties, sales, payIn, bills, payOut, custReturns, suppReturns, manual] = await Promise.all([
    rows<PartyRow>(db, `SELECT id, kind, name, mobile, email, gstin, address, city, state, opening_balance, credit_limit FROM ims_parties WHERE tenant_id = :tenantId`, p),
    rows<Agg>(db, `SELECT customer_id AS party_id, MAX(customer_name) AS party_name, SUM(grand_total) AS total, MAX(invoice_date) AS last_date FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' GROUP BY customer_id, CASE WHEN customer_id IS NULL THEN customer_name END`, p),
    rows<Agg>(db, `SELECT party_id, MAX(party_name) AS party_name, SUM(amount) AS total, MAX(paid_on) AS last_date FROM ims_payments WHERE tenant_id = :tenantId AND direction = 'in' GROUP BY party_id, CASE WHEN party_id IS NULL THEN party_name END`, p),
    rows<Agg>(db, `SELECT supplier_id AS party_id, MAX(supplier_name) AS party_name, SUM(grand_total) AS total, MAX(bill_date) AS last_date FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' GROUP BY supplier_id, CASE WHEN supplier_id IS NULL THEN supplier_name END`, p),
    rows<Agg>(db, `SELECT party_id, MAX(party_name) AS party_name, SUM(amount) AS total, MAX(paid_on) AS last_date FROM ims_payments WHERE tenant_id = :tenantId AND direction = 'out' GROUP BY party_id, CASE WHEN party_id IS NULL THEN party_name END`, p),
    rows<Agg>(
      db,
      `SELECT party_id, MAX(party_name) AS party_name, SUM(CASE WHEN refund_amount > 0 THEN refund_amount ELSE total END) AS total, MAX(return_date) AS last_date
       FROM ims_returns WHERE tenant_id = :tenantId AND kind = 'customer' AND status = 'completed' AND refund_status = 'credit_note' GROUP BY party_id, CASE WHEN party_id IS NULL THEN party_name END`,
      p,
    ),
    rows<Agg>(
      db,
      `SELECT party_id, MAX(party_name) AS party_name, SUM(CASE WHEN refund_amount > 0 THEN refund_amount ELSE total END) AS total, MAX(return_date) AS last_date
       FROM ims_returns WHERE tenant_id = :tenantId AND kind = 'supplier' AND status = 'completed' AND refund_status = 'credit_note' GROUP BY party_id, CASE WHEN party_id IS NULL THEN party_name END`,
      p,
    ),
    rows<Agg>(
      db,
      `SELECT party_id, MAX(party_name) AS party_name, SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) AS total, MAX(entry_date) AS last_date
       FROM ims_ledger_entries WHERE tenant_id = :tenantId AND settled_on IS NULL GROUP BY party_id, CASE WHEN party_id IS NULL THEN party_name END`,
      p,
    ),
  ]);
  const map = new Map<string, PartyBalance>();
  const get = (id: string | null, name: string) => {
    const key = keyOf(id, name);
    let b = map.get(key);
    if (!b) {
      b = { key, partyId: id, name, kind: null, mobile: null, opening: 0, sales: 0, received: 0, purchases: 0, paid: 0, creditNotes: 0, debitNotes: 0, manual: 0, balance: 0, lastActivity: null };
      map.set(key, b);
    }
    return b;
  };
  for (const pr of parties) {
    const b = get(pr.id, pr.name);
    b.name = pr.name;
    b.kind = pr.kind;
    b.mobile = pr.mobile;
    b.opening = round2(money(pr.opening_balance));
  }
  const fold = (list: Agg[], field: keyof Pick<PartyBalance, "sales" | "received" | "purchases" | "paid" | "creditNotes" | "debitNotes" | "manual">) => {
    for (const a of list) {
      const b = get(a.party_id, a.party_name);
      b[field] = round2(b[field] + money(a.total));
      const d = a.last_date ? isoOf(a.last_date) : null;
      if (d && (!b.lastActivity || d > b.lastActivity)) b.lastActivity = d;
    }
  };
  fold(sales, "sales");
  fold(payIn, "received");
  fold(bills, "purchases");
  fold(payOut, "paid");
  fold(custReturns, "creditNotes");
  fold(suppReturns, "debitNotes");
  fold(manual, "manual");
  for (const b of map.values()) {
    b.balance = round2(b.opening + b.sales - b.received - b.purchases + b.paid - b.creditNotes + b.debitNotes + b.manual);
  }
  return [...map.values()];
}

type StatementRow = {
  date: string;
  kind: "opening" | "invoice" | "receipt" | "bill" | "payment" | "credit_note" | "debit_note" | "entry" | "settlement";
  ref: string | null;
  description: string;
  debit: number;
  credit: number;
  module: "sales" | "payables" | "returns" | "ledger" | null;
  open: string | null;
  order: number;
};

/** Every transaction with one party, oldest first (debit = they owe more, credit = they owe less). */
async function partyTransactions(db: Queryable, tenantId: number, party: { id: string | null; name: string }): Promise<StatementRow[]> {
  const byParty = (idCol: string, nameCol: string) => (party.id ? `${idCol} = :partyId` : `${idCol} IS NULL AND ${nameCol} = :partyName`);
  const p = { tenantId, partyId: party.id, partyName: party.name };
  const [invoices, payments, bills, returns, entries] = await Promise.all([
    rows<{ id: string; invoice_no: string; invoice_date: unknown; grand_total: string; source_tool: string | null }>(
      db,
      `SELECT id, invoice_no, invoice_date, grand_total, source_tool FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND ${byParty("customer_id", "customer_name")}`,
      p,
    ),
    rows<{ id: string; direction: string; doc_type: string; doc_id: string | null; doc_no: string | null; amount: string; method: string; reference: string | null; paid_on: unknown }>(
      db,
      `SELECT id, direction, doc_type, doc_id, doc_no, amount, method, reference, paid_on FROM ims_payments WHERE tenant_id = :tenantId AND ${byParty("party_id", "party_name")}`,
      p,
    ),
    rows<{ id: string; bill_no: string; supplier_bill_no: string | null; bill_date: unknown; grand_total: string }>(
      db,
      `SELECT id, bill_no, supplier_bill_no, bill_date, grand_total FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' AND ${byParty("supplier_id", "supplier_name")}`,
      p,
    ),
    rows<{ id: string; return_no: string; kind: string; return_date: unknown; total: string; refund_amount: string }>(
      db,
      `SELECT id, return_no, kind, return_date, total, refund_amount FROM ims_returns WHERE tenant_id = :tenantId AND status = 'completed' AND refund_status = 'credit_note' AND ${byParty("party_id", "party_name")}`,
      p,
    ),
    rows<EntryRow>(db, `SELECT * FROM ims_ledger_entries WHERE tenant_id = :tenantId AND ${byParty("party_id", "party_name")}`, p),
  ]);
  const out: StatementRow[] = [];
  for (const i of invoices) {
    out.push({ date: isoOf(i.invoice_date), kind: "invoice", ref: i.invoice_no, description: i.source_tool === "pos" ? "Counter sale" : "Sales invoice", debit: round2(money(i.grand_total)), credit: 0, module: "sales", open: i.id, order: 1 });
  }
  for (const b of bills) {
    out.push({ date: isoOf(b.bill_date), kind: "bill", ref: b.bill_no, description: `Purchase bill${b.supplier_bill_no ? ` (${b.supplier_bill_no})` : ""}`, debit: 0, credit: round2(money(b.grand_total)), module: "payables", open: b.id, order: 1 });
  }
  for (const r of returns) {
    const amt = round2(money(r.refund_amount) > 0 ? money(r.refund_amount) : money(r.total));
    out.push(
      r.kind === "customer"
        ? { date: isoOf(r.return_date), kind: "credit_note", ref: r.return_no, description: "Credit note — customer return", debit: 0, credit: amt, module: "returns", open: r.id, order: 2 }
        : { date: isoOf(r.return_date), kind: "debit_note", ref: r.return_no, description: "Debit note — return to supplier", debit: amt, credit: 0, module: "returns", open: r.id, order: 2 },
    );
  }
  for (const pm of payments) {
    const amt = round2(money(pm.amount));
    const how = `${pm.method.toUpperCase()}${pm.reference ? ` · ${pm.reference}` : ""}`;
    out.push(
      pm.direction === "in"
        ? { date: isoOf(pm.paid_on), kind: "receipt", ref: pm.doc_no, description: `${pm.doc_type === "on_account" ? "Advance received" : "Payment received"} (${how})`, debit: 0, credit: amt, module: pm.doc_type === "invoice" ? "sales" : null, open: pm.doc_type === "invoice" ? pm.doc_id : null, order: 3 }
        : { date: isoOf(pm.paid_on), kind: "payment", ref: pm.doc_no, description: `Payment made (${how})`, debit: amt, credit: 0, module: pm.doc_type === "bill" ? "payables" : null, open: pm.doc_type === "bill" ? pm.doc_id : null, order: 3 },
    );
  }
  for (const e of entries) {
    const amt = round2(money(e.amount));
    const signed = ledgerEntrySigned(e.entry_type, amt);
    const label = e.entry_type === "credit" ? "Credit entry (they owe you)" : "Debit entry (you owe them)";
    out.push({ date: isoOf(e.entry_date), kind: "entry", ref: e.ref_no, description: `${label}${e.notes ? ` — ${e.notes}` : ""}`, debit: signed > 0 ? amt : 0, credit: signed < 0 ? amt : 0, module: "ledger", open: e.id, order: 2 });
    if (e.settled_on) {
      out.push({ date: isoOf(e.settled_on), kind: "settlement", ref: e.ref_no, description: `Settled${e.settle_method ? ` (${e.settle_method.toUpperCase()})` : ""}`, debit: signed < 0 ? amt : 0, credit: signed > 0 ? amt : 0, module: "ledger", open: e.id, order: 4 });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
}

/* ---------- Expenses & daily closing ---------- */

type ExpenseRow = { id: string; expense_date: unknown; category: string; description: string | null; amount: string; gst_amount: string; pay_method: string; vendor: string | null; reference: string | null; created_by_name: string | null; created_at: string };

const mapExpense = (r: ExpenseRow) => ({
  id: r.id,
  date: isoOf(r.expense_date),
  category: r.category,
  description: r.description,
  amount: round2(money(r.amount)),
  gstAmount: round2(money(r.gst_amount)),
  method: r.pay_method,
  vendor: r.vendor,
  reference: r.reference,
  createdByName: r.created_by_name,
  createdAt: tsOf(r.created_at),
});

type ClosingRow = {
  id: string;
  closing_date: unknown;
  status: string;
  opening_cash: string;
  expected_cash: string;
  counted_cash: string | null;
  variance: string;
  summary: unknown;
  notes: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

async function computeDay(db: Queryable, tenantId: number, date: string, openingCash: number) {
  const [payRows, expenseRows, salesRow, settlements] = await Promise.all([
    rows<{ direction: string; method: string; amount: string; same_day: number | null }>(
      db,
      `SELECT p.direction, p.method, p.amount, CASE WHEN p.doc_type = 'invoice' AND i.invoice_date = p.paid_on THEN 1 ELSE 0 END AS same_day
       FROM ims_payments p LEFT JOIN ims_invoices i ON i.id = p.doc_id AND i.tenant_id = p.tenant_id AND p.doc_type = 'invoice'
       WHERE p.tenant_id = :tenantId AND p.paid_on = :date`,
      { tenantId, date },
    ),
    rows<ExpenseRow>(db, `SELECT * FROM ims_expenses WHERE tenant_id = :tenantId AND expense_date = :date ORDER BY created_at DESC`, { tenantId, date }),
    one<{ n: string | null; total: string | null; pos_n: string | null; pos_total: string | null; credit: string | null; tax: string | null }>(
      db,
      `SELECT COUNT(*) AS n, SUM(grand_total) AS total,
         SUM(CASE WHEN source_tool = 'pos' THEN 1 ELSE 0 END) AS pos_n, SUM(CASE WHEN source_tool = 'pos' THEN grand_total ELSE 0 END) AS pos_total,
         SUM(GREATEST(grand_total - amount_paid, 0)) AS credit, SUM(tax_total) AS tax
       FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND invoice_date = :date`,
      { tenantId, date },
    ),
    rows<{ entry_type: string; amount: string; settle_method: string | null }>(
      db,
      `SELECT entry_type, amount, settle_method FROM ims_ledger_entries WHERE tenant_id = :tenantId AND settled_on = :date`,
      { tenantId, date },
    ),
  ]);
  const payments: DayPayment[] = [
    ...payRows.map((p) => ({ direction: p.direction === "out" ? ("out" as const) : ("in" as const), method: p.method, amount: money(p.amount), sameDaySale: Boolean(Number(p.same_day)) })),
    ...settlements.map((s) => ({ direction: s.entry_type === "credit" ? ("in" as const) : ("out" as const), method: s.settle_method ?? "cash", amount: money(s.amount), sameDaySale: false })),
  ];
  const expenses: DayExpense[] = expenseRows.map((e) => ({ method: e.pay_method, amount: money(e.amount) }));
  const figures = dayFigures(payments, expenses, openingCash);
  return {
    figures,
    sales: {
      count: Number(salesRow?.n ?? 0),
      total: round2(money(salesRow?.total)),
      posCount: Number(salesRow?.pos_n ?? 0),
      posTotal: round2(money(salesRow?.pos_total)),
      credit: round2(money(salesRow?.credit)),
      tax: round2(money(salesRow?.tax)),
    },
    expenses: expenseRows.map(mapExpense),
  };
}

const mapClosing = (r: ClosingRow) => ({
  id: r.id,
  date: isoOf(r.closing_date),
  status: r.status as "open" | "closed",
  openingCash: round2(money(r.opening_cash)),
  expectedCash: round2(money(r.expected_cash)),
  countedCash: r.counted_cash == null ? null : round2(money(r.counted_cash)),
  variance: round2(money(r.variance)),
  summary: json<Record<string, unknown> | null>(r.summary, null),
  notes: r.notes,
  closedByName: r.closed_by_name,
  closedAt: tsOf(r.closed_at),
  createdAt: tsOf(r.created_at),
  updatedAt: tsOf(r.updated_at),
});

async function lastClosedBefore(db: Queryable, tenantId: number, date: string) {
  return one<ClosingRow>(db, `SELECT * FROM ims_daily_closings WHERE tenant_id = :tenantId AND status = 'closed' AND closing_date < :date ORDER BY closing_date DESC LIMIT 1`, { tenantId, date });
}

const EntryInput = z.object({
  type: z.enum(LEDGER_ENTRY_TYPES),
  partyId: z.string().uuid().nullable().optional(),
  partyName: z.string().trim().min(1, "Party name is required").max(200),
  phone: optText(40),
  amount: z.coerce.number().positive("Amount must be more than zero").max(1e12),
  date: isoDate.optional(),
  dueDate: isoDate.nullable().optional(),
  category: z.enum(["udhaar", "credit_note", "debit_note", "opening", "adjustment"]).default("udhaar"),
  refNo: optText(64),
  notes: optText(500),
});

const ExpenseInput = z.object({
  date: isoDate.optional(),
  category: z.string().trim().min(1, "Pick a category").max(60),
  description: optText(255),
  amount: z.coerce.number().positive("Amount must be more than zero").max(1e12),
  gstAmount: z.coerce.number().min(0).max(1e12).default(0),
  method: z.enum(PAY_METHODS).default("cash"),
  vendor: optText(200),
  reference: optText(80),
});

export function registerLedger(router: Router, deps: ImsDeps): void {
  /* Party balances + manual entries ("udhaar" book). */
  router.get("/ledger", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, [...LEDGER_PERMS]);
    const today = todayISO();
    const balances = await partyBalances(deps.db, actor.tenantId);
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, limit: qint(req.query.limit, 1000, 1, 5000) };
    const type = qstr(req.query.type, 8);
    if (type === "credit" || type === "debit") {
      where.push("entry_type = :type");
      params.type = type;
    }
    const status = qstr(req.query.status, 8);
    if (status === "pending") where.push("settled_on IS NULL");
    if (status === "settled") where.push("settled_on IS NOT NULL");
    const partyId = qstr(req.query.partyId, 36);
    if (partyId) {
      where.push("party_id = :partyId");
      params.partyId = partyId;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(party_name LIKE :q OR notes LIKE :q OR ref_no LIKE :q OR phone LIKE :q)");
      params.q = likeOf(q);
    }
    const period = qstr(req.query.period, 12);
    if (period && period !== "all") {
      const settings = await getSettings(deps, actor.tenantId);
      Object.assign(params, periodRange(period, today, settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) }));
      where.push("entry_date BETWEEN :from AND :to");
    }
    const entries = (await rows<EntryRow>(deps.db, `SELECT * FROM ims_ledger_entries WHERE ${where.join(" AND ")} ORDER BY (settled_on IS NOT NULL), entry_date DESC, created_at DESC LIMIT :limit`, params)).map((r) => mapEntry(r, today));
    const pending = (await rows<{ entry_type: string; total: string | null; n: string | null; overdue: string | null }>(
      deps.db,
      `SELECT entry_type, SUM(amount) AS total, COUNT(*) AS n, SUM(CASE WHEN due_date < :today THEN amount ELSE 0 END) AS overdue FROM ims_ledger_entries WHERE tenant_id = :tenantId AND settled_on IS NULL GROUP BY entry_type`,
      { tenantId: actor.tenantId, today },
    )).reduce(
      (acc, r) => {
        acc[r.entry_type === "credit" ? "credit" : "debit"] = { total: round2(money(r.total)), count: Number(r.n ?? 0), overdue: round2(money(r.overdue)) };
        return acc;
      },
      { credit: { total: 0, count: 0, overdue: 0 }, debit: { total: 0, count: 0, overdue: 0 } } as Record<"credit" | "debit", { total: number; count: number; overdue: number }>,
    );
    const parties = balances.filter((b) => Math.abs(b.balance) > 0.005 || b.sales || b.purchases || b.manual).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    res.json({
      today,
      parties,
      summary: {
        receivable: round2(parties.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0)),
        payable: round2(parties.filter((b) => b.balance < 0).reduce((s, b) => s - b.balance, 0)),
        receivableParties: parties.filter((b) => b.balance > 0.005).length,
        payableParties: parties.filter((b) => b.balance < -0.005).length,
        manualCredit: pending.credit,
        manualDebit: pending.debit,
      },
      entries,
    });
  });

  /* Statement of account: opening balance, every transaction in the range with a running balance, closing balance. */
  router.get("/ledger/statement", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, [...LEDGER_PERMS]);
    const partyId = qstr(req.query.partyId, 36) || null;
    const partyName = qstr(req.query.partyName, 200);
    if (!partyId && !partyName) throw badRequest("Pick a party");
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const period = qstr(req.query.period, 12) || "fytd";
    const range = period === "all" ? { from: "1970-01-01", to: today } : periodRange(period, today, settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) });
    let party: PartyRow | null = null;
    if (partyId) {
      party = await one<PartyRow>(deps.db, `SELECT id, kind, name, mobile, email, gstin, address, city, state, opening_balance, credit_limit FROM ims_parties WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: partyId,
      });
      if (!party) throw notFound("Party");
    }
    const name = party?.name ?? partyName;
    const all = await partyTransactions(deps.db, actor.tenantId, { id: party?.id ?? null, name });
    const openingBase = round2(money(party?.opening_balance));
    const before = all.filter((t) => t.date < range.from);
    const inRange = all.filter((t) => t.date >= range.from && t.date <= range.to);
    const opening = round2(openingBase + before.reduce((s, t) => s + t.debit - t.credit, 0));
    const withBalance = runningBalance(opening, inRange);
    const totals = { debit: round2(inRange.reduce((s, t) => s + t.debit, 0)), credit: round2(inRange.reduce((s, t) => s + t.credit, 0)) };
    res.json({
      party: {
        id: party?.id ?? null,
        name,
        kind: party?.kind ?? null,
        mobile: party?.mobile ?? null,
        email: party?.email ?? null,
        gstin: party?.gstin ?? null,
        address: [party?.address, party?.city].filter(Boolean).join(", ") || null,
        state: party?.state ?? null,
        creditLimit: party?.credit_limit == null ? null : round2(money(party.credit_limit)),
      },
      range: period === "all" ? { from: all[0]?.date ?? today, to: today } : range,
      opening,
      rows: withBalance.map(({ order: _order, ...r }) => r),
      totals,
      closing: round2(opening + totals.debit - totals.credit),
    });
  });

  router.post("/ledger/entries", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, [...LEDGER_WRITE]);
    const input = parse(EntryInput, req.body);
    const date = input.date ?? todayISO();
    if (input.dueDate && input.dueDate < date) throw badRequest("The due date can't be before the entry date");
    if (input.partyId) {
      const p = await one<{ id: string }>(deps.db, `SELECT id FROM ims_parties WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: input.partyId });
      if (!p) throw notFound("Party");
    }
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO ims_ledger_entries (id, tenant_id, party_id, party_name, entry_type, category, amount, entry_date, ref_no, notes, phone, due_date, created_by, created_by_name)
       VALUES (:id, :tenantId, :partyId, :partyName, :type, :category, :amount, :date, :refNo, :notes, :phone, :dueDate, :userId, :userName)`,
      {
        id,
        tenantId: actor.tenantId,
        partyId: input.partyId ?? null,
        partyName: input.partyName,
        type: input.type,
        category: input.category,
        amount: round2(input.amount),
        date,
        refNo: input.refNo ?? null,
        notes: input.notes ?? null,
        phone: input.phone ?? null,
        dueDate: input.dueDate ?? null,
        userId: actor.userId,
        userName: actorName(actor),
      },
    );
    await recordEvent(deps, actor, {
      type: "ledger.entry",
      entityType: "ledger",
      entityId: id,
      summary: `${input.type === "credit" ? "Credit" : "Debit"} entry ${formatINR(input.amount)} — ${input.partyName} ${input.type === "credit" ? "owes you" : "is owed"}`,
    });
    const row = await one<EntryRow>(deps.db, `SELECT * FROM ims_ledger_entries WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    res.status(201).json({ entry: row ? mapEntry(row, todayISO()) : null });
  });

  router.post("/ledger/entries/:id/settle", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, [...LEDGER_WRITE]);
    const input = parse(z.object({ date: isoDate.optional(), method: z.enum(PAY_METHODS).default("cash") }), req.body);
    const row = await one<EntryRow>(deps.db, `SELECT * FROM ims_ledger_entries WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Entry");
    if (row.settled_on) throw conflict("This entry is already settled");
    const date = input.date ?? todayISO();
    if (date < isoOf(row.entry_date)) throw badRequest("Settlement can't be before the entry date");
    await assertDayOpen(deps.db, actor.tenantId, date);
    await exec(deps.db, `UPDATE ims_ledger_entries SET settled_on = :date, settle_method = :method, settled_by_name = :userName WHERE tenant_id = :tenantId AND id = :id`, {
      tenantId: actor.tenantId,
      id: row.id,
      date,
      method: input.method,
      userName: actorName(actor),
    });
    await recordEvent(deps, actor, { type: "ledger.settled", entityType: "ledger", entityId: row.id, summary: `Settled ${formatINR(money(row.amount))} with ${row.party_name} (${input.method.toUpperCase()})` });
    const next = await one<EntryRow>(deps.db, `SELECT * FROM ims_ledger_entries WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    res.json({ entry: next ? mapEntry(next, todayISO()) : null });
  });

  router.post("/ledger/entries/:id/reopen", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, [...LEDGER_WRITE]);
    const row = await one<EntryRow>(deps.db, `SELECT * FROM ims_ledger_entries WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Entry");
    if (!row.settled_on) throw conflict("This entry isn't settled");
    await assertDayOpen(deps.db, actor.tenantId, isoOf(row.settled_on));
    await exec(deps.db, `UPDATE ims_ledger_entries SET settled_on = NULL, settle_method = NULL, settled_by_name = NULL WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "ledger.reopened", entityType: "ledger", entityId: row.id, summary: `Marked the ${formatINR(money(row.amount))} entry with ${row.party_name} as pending again` });
    res.json({ ok: true });
  });

  router.delete("/ledger/entries/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, [...LEDGER_WRITE]);
    const row = await one<EntryRow>(deps.db, `SELECT * FROM ims_ledger_entries WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Entry");
    if (row.settled_on) throw conflict("Settled entries are kept for the record. Mark it pending first if it was settled by mistake.");
    if (!isOwner(res) && row.created_by !== actor.userId) throw forbidden("Only the person who added this entry or an owner can delete it");
    await exec(deps.db, `DELETE FROM ims_ledger_entries WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "ledger.deleted", entityType: "ledger", entityId: row.id, summary: `Deleted the ${formatINR(money(row.amount))} ${row.entry_type} entry for ${row.party_name}` });
    res.status(204).end();
  });

  /* ---------- Expenses ---------- */

  router.get("/expenses", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["closing", "reports"]);
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const date = qstr(req.query.date, 10);
    const range = date ? { from: date, to: date } : periodRange(qstr(req.query.period, 12) || "mtd", today, settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) });
    const where = ["tenant_id = :tenantId", "expense_date BETWEEN :from AND :to"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, ...range };
    const category = qstr(req.query.category, 60);
    if (category) {
      where.push("category = :category");
      params.category = category;
    }
    const list = (await rows<ExpenseRow>(deps.db, `SELECT * FROM ims_expenses WHERE ${where.join(" AND ")} ORDER BY expense_date DESC, created_at DESC LIMIT 2000`, params)).map(mapExpense);
    const byCategory = new Map<string, { category: string; amount: number; count: number }>();
    const byMethod: Record<string, number> = {};
    for (const e of list) {
      const c = byCategory.get(e.category) ?? { category: e.category, amount: 0, count: 0 };
      c.amount = round2(c.amount + e.amount);
      c.count += 1;
      byCategory.set(e.category, c);
      byMethod[e.method] = round2((byMethod[e.method] ?? 0) + e.amount);
    }
    res.json({
      range,
      expenses: list,
      totals: { total: round2(list.reduce((s, e) => s + e.amount, 0)), gst: round2(list.reduce((s, e) => s + e.gstAmount, 0)), byCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount), byMethod },
      categories: settings.taxonomy.expenseCategories,
    });
  });

  router.post("/expenses", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "closing");
    const input = parse(ExpenseInput, req.body);
    const date = input.date ?? todayISO();
    if (date > todayISO()) throw badRequest("Expenses can't be dated in the future");
    if (input.gstAmount > input.amount) throw badRequest("GST can't be more than the expense amount");
    await assertDayOpen(deps.db, actor.tenantId, date);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO ims_expenses (id, tenant_id, expense_date, category, description, amount, gst_amount, pay_method, vendor, reference, created_by, created_by_name)
       VALUES (:id, :tenantId, :date, :category, :description, :amount, :gst, :method, :vendor, :reference, :userId, :userName)`,
      {
        id,
        tenantId: actor.tenantId,
        date,
        category: input.category,
        description: input.description ?? null,
        amount: round2(input.amount),
        gst: round2(input.gstAmount),
        method: input.method,
        vendor: input.vendor ?? null,
        reference: input.reference ?? null,
        userId: actor.userId,
        userName: actorName(actor),
      },
    );
    await recordEvent(deps, actor, { type: "expense.added", entityType: "expense", entityId: id, summary: `Expense ${formatINR(input.amount)} · ${input.category}${input.description ? ` — ${input.description}` : ""} (${input.method.toUpperCase()})` });
    const row = await one<ExpenseRow>(deps.db, `SELECT * FROM ims_expenses WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    res.status(201).json({ expense: row ? mapExpense(row) : null });
  });

  router.delete("/expenses/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "closing");
    const row = await one<ExpenseRow>(deps.db, `SELECT * FROM ims_expenses WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Expense");
    await assertDayOpen(deps.db, actor.tenantId, isoOf(row.expense_date));
    await exec(deps.db, `DELETE FROM ims_expenses WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "expense.deleted", entityType: "expense", entityId: row.id, summary: `Deleted expense ${formatINR(money(row.amount))} · ${row.category}` });
    res.status(204).end();
  });

  /* ---------- Daily closing ---------- */

  router.get("/closing/day", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "closing");
    const today = todayISO();
    const date = qstr(req.query.date, 10) || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("Use a valid date (YYYY-MM-DD)");
    const existing = await one<ClosingRow>(deps.db, `SELECT * FROM ims_daily_closings WHERE tenant_id = :tenantId AND closing_date = :date`, { tenantId: actor.tenantId, date });
    const last = await lastClosedBefore(deps.db, actor.tenantId, date);
    const suggestedOpening = last ? round2(money(last.counted_cash ?? last.expected_cash)) : 0;
    const openingCash = existing ? round2(money(existing.opening_cash)) : suggestedOpening;
    const day = await computeDay(deps.db, actor.tenantId, date, openingCash);
    res.json({
      date,
      today,
      closing: existing ? mapClosing(existing) : null,
      lastClosing: last ? mapClosing(last) : null,
      suggestedOpening,
      openingCash,
      ...day,
      canReopen: isOwner(res),
    });
  });

  router.post("/closing", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "closing");
    const input = parse(
      z.object({
        date: isoDate.optional(),
        openingCash: z.coerce.number().min(0).max(1e12),
        countedCash: z.coerce.number().min(0).max(1e12),
        notes: optText(2000),
      }),
      req.body,
    );
    const date = input.date ?? todayISO();
    if (date > todayISO()) throw badRequest("You can't close a day that hasn't happened yet");
    const day = await computeDay(deps.db, actor.tenantId, date, input.openingCash);
    const expected = day.figures.expectedCash;
    const variance = round2(input.countedCash - expected);
    if (Math.abs(variance) >= 1 && !input.notes?.trim()) throw badRequest(`Cash is ${variance > 0 ? "over" : "short"} by ${formatINR(Math.abs(variance))}. Add a note explaining the difference.`);
    const summary = JSON.stringify({ ...day.figures, sales: day.sales, expenseCount: day.expenses.length, expenseTotal: day.figures.totals.expenses });
    const id = await tx(deps.db, async (conn) => {
      const existing = await one<ClosingRow>(conn, `SELECT * FROM ims_daily_closings WHERE tenant_id = :tenantId AND closing_date = :date FOR UPDATE`, { tenantId: actor.tenantId, date });
      if (existing?.status === "closed") throw conflict(`${dateText(date)} is already closed`);
      const rowId = existing?.id ?? randomUUID();
      const params = {
        id: rowId,
        tenantId: actor.tenantId,
        date,
        opening: round2(input.openingCash),
        expected,
        counted: round2(input.countedCash),
        variance,
        summary,
        notes: input.notes ?? null,
        userId: actor.userId,
        userName: actorName(actor),
      };
      if (existing) {
        await exec(
          conn,
          `UPDATE ims_daily_closings SET status = 'closed', opening_cash = :opening, expected_cash = :expected, counted_cash = :counted, variance = :variance, summary = :summary,
             notes = :notes, closed_by = :userId, closed_by_name = :userName, closed_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`,
          params,
        );
      } else {
        await exec(
          conn,
          `INSERT INTO ims_daily_closings (id, tenant_id, closing_date, status, opening_cash, expected_cash, counted_cash, variance, summary, notes, closed_by, closed_by_name, closed_at)
           VALUES (:id, :tenantId, :date, 'closed', :opening, :expected, :counted, :variance, :summary, :notes, :userId, :userName, CURRENT_TIMESTAMP)`,
          params,
        );
      }
      return rowId;
    });
    await recordEvent(deps, actor, {
      type: "closing.closed",
      entityType: "closing",
      entityId: id,
      summary: `Closed ${dateText(date)} — sales ${formatINR(day.sales.total)}, cash ${variance === 0 ? "matched" : `${variance > 0 ? "over" : "short"} by ${formatINR(Math.abs(variance))}`}`,
      notice: Math.abs(variance) >= 100 ? { kind: "alert", title: `Cash ${variance > 0 ? "excess" : "shortage"} on ${dateText(date)}`, body: `Counted ${formatINR(input.countedCash)} vs expected ${formatINR(expected)}`, path: `?m=closing&open=${id}` } : undefined,
    });
    const row = await one<ClosingRow>(deps.db, `SELECT * FROM ims_daily_closings WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    res.status(201).json({ closing: row ? mapClosing(row) : null });
  });

  router.post("/closing/:id/reopen", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "closing");
    if (!isOwner(res)) throw forbidden("Only an owner can reopen a closed day");
    const input = parse(z.object({ reason: z.string().trim().min(3, "Say why the day is being reopened").max(500) }), req.body);
    const row = await one<ClosingRow>(deps.db, `SELECT * FROM ims_daily_closings WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Closing");
    if (row.status !== "closed") throw conflict("This day is already open");
    await exec(
      deps.db,
      `UPDATE ims_daily_closings SET status = 'open', notes = CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n' END, :note) WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: row.id, note: `Reopened by ${actorName(actor) ?? "owner"}: ${input.reason}` },
    );
    await recordEvent(deps, actor, { type: "closing.reopened", entityType: "closing", entityId: row.id, summary: `Reopened ${dateText(isoOf(row.closing_date))} — ${input.reason}` });
    res.json({ ok: true });
  });

  router.get("/closing/history", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["closing", "reports", "audit"]);
    const list = await rows<ClosingRow>(deps.db, `SELECT * FROM ims_daily_closings WHERE tenant_id = :tenantId ORDER BY closing_date DESC LIMIT :limit`, {
      tenantId: actor.tenantId,
      limit: qint(req.query.limit, 90, 1, 1000),
    });
    const closings = list.map(mapClosing);
    const closed = closings.filter((c) => c.status === "closed");
    res.json({
      closings,
      stats: {
        days: closed.length,
        shortDays: closed.filter((c) => c.variance <= -1).length,
        overDays: closed.filter((c) => c.variance >= 1).length,
        netVariance: round2(closed.reduce((s, c) => s + c.variance, 0)),
      },
    });
  });

  router.get("/closing/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["closing", "reports", "audit"]);
    const row = await one<ClosingRow>(deps.db, `SELECT * FROM ims_daily_closings WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Closing");
    const date = isoOf(row.closing_date);
    const expenses = (await rows<ExpenseRow>(deps.db, `SELECT * FROM ims_expenses WHERE tenant_id = :tenantId AND expense_date = :date ORDER BY created_at`, { tenantId: actor.tenantId, date })).map(mapExpense);
    res.json({ closing: mapClosing(row), expenses });
  });
}
