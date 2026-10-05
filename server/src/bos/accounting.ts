import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ACCOUNT_TYPES,
  buildPostings,
  categoryKey,
  journalProblem,
  lineTotals,
  movements,
  openingPosting,
  statements,
  suggestOpening,
  SYSTEM_ACCOUNTS,
  type AccountType,
  type LedgerSources,
  type Posting,
  type PostingLine,
  type SystemKey,
} from "./accounting-logic.js";
import type { DepreciationMethod } from "./asset-logic.js";
import { actorOf, isoDate, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, json, money, nextSequence, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { addDaysISO, daysBetween, fiscalYearLabel, fiscalYearStart, formatDocNo, monthEndISO, round2, todayISO } from "./logic.js";
import { getSettings } from "./workspace.js";

const LEDGER_LIMIT = 5000;
const MAX_RANGE_DAYS = 366 * 5;

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const managerOnly = (actor: BosActor) => {
  if (!isManager(actor)) throw forbidden("Accounting is available to owners and admins");
};

/* ---------- Inputs ---------- */

const amount = z.coerce.number().min(0, "Can't be negative").max(1e12);
const AccountInput = z.object({
  code: z.string().trim().regex(/^[0-9A-Za-z-]{1,12}$/, "Use up to 12 letters, digits or dashes"),
  name: z.string().trim().min(1, "Required").max(120),
  type: z.enum(ACCOUNT_TYPES),
  categories: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  description: optText(300),
});
const AccountPatch = AccountInput.extend({ archived: z.boolean() });
const OpeningInput = z.object({
  booksStart: isoDate,
  lines: z.array(z.object({ accountId: z.string().min(1).max(36), debit: amount.default(0), credit: amount.default(0) })).max(500),
});
const JournalInput = z.object({
  date: isoDate,
  narration: z.string().trim().min(1, "Describe the entry").max(300),
  lines: z
    .array(z.object({ accountId: z.string().min(1).max(36), debit: amount.default(0), credit: amount.default(0), note: optText(200) }))
    .min(2, "Add at least two lines")
    .max(100),
});
const VoidInput = z.object({ reason: z.string().trim().min(1, "Say why it's being voided").max(300) });
const Range = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/* ---------- Chart of accounts ---------- */

type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  system_key: SystemKey | null;
  categories: unknown;
  description: string | null;
  archived_at: string | null;
};

const mapAccount = (a: AccountRow) => ({
  id: a.id,
  code: a.code,
  name: a.name,
  type: a.type,
  systemKey: a.system_key,
  categories: json<string[]>(a.categories, []),
  description: a.description,
  archived: Boolean(a.archived_at),
});

/** Adds any missing system account (first use, or a newer BOS); safe to run concurrently. */
async function ensureChart(db: BosDeps["db"], tenantId: number, userId: number | null): Promise<AccountRow[]> {
  const load = () => rows<AccountRow>(db, `SELECT * FROM bos_accounts WHERE tenant_id = :t ORDER BY code`, { t: tenantId });
  const list = await load();
  const have = new Set(list.map((a) => a.system_key));
  const missing = SYSTEM_ACCOUNTS.filter((a) => !have.has(a.key));
  if (!missing.length) return list;
  const codes = new Set(list.map((a) => a.code));
  for (const a of missing) {
    let code: string = a.code;
    for (let n = 1; codes.has(code); n++) code = `${a.code}-${n}`;
    codes.add(code);
    await exec(db, `INSERT IGNORE INTO bos_accounts (id, tenant_id, code, name, type, system_key, created_by) VALUES (:id, :t, :code, :name, :type, :key, :userId)`, {
      id: randomUUID(),
      t: tenantId,
      code,
      name: a.name,
      type: a.type,
      key: a.key,
      userId,
    });
  }
  return load();
}

/* ---------- Ledger ---------- */

type Book = {
  accounts: AccountRow[];
  booksStart: string | null;
  fyMonth: number;
  today: string;
  /** Postings from the books start (opening balances included) up to `upTo`. */
  postings: Posting[];
  /** Source postings before the books start, for suggesting opening balances. */
  before: Posting[];
  openingDifference: number;
  opening: PostingLine[];
};

/** `startAt` replaces the saved books start, to see what a different start date would leave before it. */
async function loadBook(deps: BosDeps, actor: BosActor, upTo: string, startAt?: string): Promise<Book> {
  const t = actor.tenantId;
  const db = deps.db;
  const [accounts, settings, bookSettings] = await Promise.all([
    ensureChart(db, t, actor.userId),
    getSettings(deps, t),
    one<{ books_start: string | null }>(db, `SELECT books_start FROM bos_accounting_settings WHERE tenant_id = :t`, { t }),
  ]);
  const booksStart = startAt ?? bookSettings?.books_start ?? null;
  const fyMonth = settings.fiscalYearStart;
  const p = { t, upTo };

  const [invoices, payments, bills, expenses, runs, bankLines, assets, matched, journalLines, openingRows] = await Promise.all([
    rows<{ id: string; invoice_no: string; issue_date: string; party_name: string; tax_total: string; grand_total: string }>(
      db,
      `SELECT id, invoice_no, issue_date, party_name, tax_total, grand_total FROM bos_invoices WHERE tenant_id = :t AND status NOT IN ('draft','void') AND issue_date <= :upTo`,
      p,
    ),
    rows<{ id: string; invoice_id: string; amount: string; paid_on: string; method: string; invoice_no: string; party_name: string }>(
      db,
      `SELECT p.id, p.invoice_id, p.amount, p.paid_on, p.method, i.invoice_no, i.party_name FROM bos_payments p JOIN bos_invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = :t AND p.paid_on <= :upTo`,
      p,
    ),
    rows<{ id: string; bill_no: string | null; party_name: string; bill_date: string; category: string | null; tax_amount: string; total: string; paid_on: string | null }>(
      db,
      `SELECT id, bill_no, party_name, bill_date, category, tax_amount, total, paid_on FROM bos_bills WHERE tenant_id = :t AND status IN ('approved','paid') AND bill_date <= :upTo`,
      p,
    ),
    rows<{ id: string; claimant_name: string | null; category: string; spent_on: string; amount: string; status: string; updated_at: string }>(
      db,
      `SELECT id, claimant_name, category, spent_on, amount, status, updated_at FROM bos_expenses WHERE tenant_id = :t AND status IN ('approved','reimbursed') AND spent_on <= :upTo`,
      p,
    ),
    rows<{ id: string; period: string; gross_total: string; net_total: string; employer_total: string; paid_on: string | null }>(
      db,
      `SELECT id, period, gross_total, net_total, employer_total, paid_on FROM bos_payroll_runs WHERE tenant_id = :t AND status IN ('finalized','paid') AND period <= :month`,
      { t, month: upTo.slice(0, 7) },
    ),
    rows<{ id: string; txn_date: string; description: string; amount: string; category: string | null; kind: string }>(
      db,
      `SELECT x.id, x.txn_date, x.description, x.amount, x.category, a.kind FROM bos_bank_txns x JOIN bos_bank_accounts a ON a.id = x.account_id
       WHERE x.tenant_id = :t AND x.status = 'categorized' AND x.txn_date <= :upTo`,
      p,
    ),
    rows<{ id: string; tag: string; name: string; cost: string; salvage_value: string; method: DepreciationMethod; rate: string; purchase_date: string; disposed_on: string | null; disposal_amount: string | null; bill_status: string | null; bill_category: string | null }>(
      db,
      `SELECT a.id, a.tag, a.name, a.cost, a.salvage_value, a.method, a.rate, a.purchase_date, a.disposed_on, a.disposal_amount, b.status AS bill_status, b.category AS bill_category
       FROM bos_assets a LEFT JOIN bos_bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
       WHERE a.tenant_id = :t AND a.purchase_date <= :upTo`,
      p,
    ),
    rows<{ match_type: string; match_id: string; txn_date: string; kind: string }>(
      db,
      `SELECT x.match_type, x.match_id, x.txn_date, a.kind FROM bos_bank_txns x JOIN bos_bank_accounts a ON a.id = x.account_id WHERE x.tenant_id = :t AND x.status = 'matched'`,
      { t },
    ),
    rows<{ journal_id: string; journal_no: string; entry_date: string; narration: string; account_id: string; debit: string; credit: string }>(
      db,
      `SELECT l.journal_id, j.journal_no, j.entry_date, j.narration, l.account_id, l.debit, l.credit FROM bos_journal_lines l JOIN bos_journals j ON j.id = l.journal_id
       WHERE j.tenant_id = :t AND j.status = 'posted' AND j.entry_date <= :upTo ORDER BY j.entry_date, j.journal_no, l.line_no`,
      p,
    ),
    rows<{ account_id: string; debit: string; credit: string }>(db, `SELECT account_id, debit, credit FROM bos_opening_balances WHERE tenant_id = :t`, { t }),
  ]);

  const slips = runs.length
    ? await rows<{ run_id: string; deductions: unknown; employer: unknown }>(db, `SELECT run_id, deductions, employer FROM bos_payslips WHERE tenant_id = :t AND run_id IN (:ids)`, { t, ids: runs.map((r) => r.id) })
    : [];
  const dues = new Map<string, { statutory: number; other: number }>();
  for (const s of slips) {
    const d = dues.get(s.run_id) ?? { statutory: 0, other: 0 };
    for (const l of json<Array<{ key: string; amount: number }>>(s.deductions, [])) {
      if (l.key === "other") d.other = round2(d.other + money(l.amount));
      else d.statutory = round2(d.statutory + money(l.amount));
    }
    for (const l of json<Array<{ amount: number }>>(s.employer, [])) d.statutory = round2(d.statutory + money(l.amount));
    dues.set(s.run_id, d);
  }

  const bank = new Map(matched.map((m) => [`${m.match_type}:${m.match_id}`, m]));
  const inCash = (type: string, id: string, fallback = false) => {
    const m = bank.get(`${type}:${id}`);
    return m ? m.kind === "cash" : fallback;
  };

  const sources: LedgerSources = {
    invoices: invoices.map((i) => ({ id: i.id, no: i.invoice_no, date: i.issue_date, party: i.party_name, tax: money(i.tax_total), total: money(i.grand_total) })),
    payments: payments.map((x) => ({ id: x.id, invoiceId: x.invoice_id, invoiceNo: x.invoice_no, party: x.party_name, date: x.paid_on, amount: money(x.amount), cash: inCash("payment", x.id, x.method === "cash") })),
    bills: bills.map((b) => ({ id: b.id, no: b.bill_no, party: b.party_name, date: b.bill_date, category: b.category, tax: money(b.tax_amount), total: money(b.total), paidOn: b.paid_on, paidCash: inCash("bill", b.id) })),
    expenses: expenses.map((e) => ({
      id: e.id,
      claimant: e.claimant_name,
      category: e.category,
      date: e.spent_on,
      amount: money(e.amount),
      reimbursedOn: e.status === "reimbursed" ? (bank.get(`expense:${e.id}`)?.txn_date ?? maxDate(e.spent_on, e.updated_at.slice(0, 10))) : null,
      paidCash: inCash("expense", e.id),
    })),
    payroll: runs.map((r) => ({
      id: r.id,
      period: r.period,
      label: monthName(r.period),
      gross: money(r.gross_total),
      employer: money(r.employer_total),
      net: money(r.net_total),
      statutory: dues.get(r.id)?.statutory ?? 0,
      other: dues.get(r.id)?.other ?? 0,
      paidOn: r.paid_on,
      paidCash: inCash("payroll", r.id),
    })),
    bankLines: bankLines.map((l) => ({ id: l.id, date: l.txn_date, description: l.description, amount: money(l.amount), category: l.category, cash: l.kind === "cash" })),
    assets: assets.map((a) => ({
      id: a.id,
      tag: a.tag,
      name: a.name,
      cost: money(a.cost),
      salvage: money(a.salvage_value),
      method: a.method,
      rate: money(a.rate),
      purchaseDate: a.purchase_date,
      disposedOn: a.disposed_on,
      disposalAmount: money(a.disposal_amount),
      billCategory: a.bill_category,
      billPosted: a.bill_status === "approved" || a.bill_status === "paid",
    })),
  };

  const system = Object.fromEntries(accounts.filter((a) => a.system_key).map((a) => [a.system_key, a.id])) as Record<SystemKey, string>;
  const byCategory = new Map<string, string>();
  for (const a of accounts) if (a.type === "expense" && !a.archived_at) for (const c of json<string[]>(a.categories, [])) byCategory.set(categoryKey(c), a.id);
  const cut = booksStart ? addDaysISO(booksStart, -1) : null;
  const all = buildPostings(sources, { system, byCategory }, { upTo, fyStartMonth: fyMonth, cuts: cut ? [cut] : [] });

  const journals = new Map<string, Posting>();
  for (const l of journalLines) {
    const j = journals.get(l.journal_id) ?? { date: l.entry_date, source: "journal" as const, sourceId: l.journal_id, ref: l.journal_no, memo: l.narration, lines: [] };
    j.lines.push({ accountId: l.account_id, debit: money(l.debit), credit: money(l.credit) });
    journals.set(l.journal_id, j);
  }
  all.push(...journals.values());

  const opening = openingRows.map((o) => ({ accountId: o.account_id, debit: money(o.debit), credit: money(o.credit) }));
  const postings = booksStart ? all.filter((x) => x.date >= booksStart) : all;
  let openingDifference = 0;
  if (booksStart && cut && cut <= upTo) {
    const o = openingPosting(cut, opening, system.opening_adjustment);
    openingDifference = o.difference;
    if (o.posting) postings.push(o.posting);
  }
  postings.sort((a, b) => (a.date === b.date ? SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] : a.date < b.date ? -1 : 1));
  return { accounts, booksStart, fyMonth, today: todayISO(), postings, before: booksStart ? all.filter((x) => x.date < booksStart) : [], openingDifference, opening };
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const SOURCE_ORDER: Record<Posting["source"], number> = {
  opening: 0,
  invoice: 1,
  bill: 2,
  expense: 3,
  payroll: 4,
  asset: 5,
  payment: 6,
  bill_payment: 7,
  reimbursement: 8,
  payroll_payment: 9,
  bank: 10,
  journal: 11,
  disposal: 12,
  depreciation: 13,
};

/** Defaults to this financial year so far; a missing `from` is the start of the financial year `to` falls in. */
async function rangeOf(deps: BosDeps, tenantId: number, query: unknown) {
  const r = parse(Range, query);
  if (r.from && r.to && r.to < r.from) throw new BosError(400, "The end date can't be before the start date");
  const to = r.to ?? todayISO();
  const from = r.from ?? fiscalYearStart(to, (await getSettings(deps, tenantId)).fiscalYearStart);
  if (to < from) throw new BosError(400, "The end date can't be before the start date");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BosError(400, "Pick a period of five years or less");
  return { from, to };
}

/* ---------- Routes ---------- */

export function registerAccounting(router: Router, deps: BosDeps): void {
  router.get("/accounting/overview", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const today = todayISO();
    const book = await loadBook(deps, actor, today);
    const fyStart = fiscalYearStart(today, book.fyMonth);
    const moves = movements(book.postings, fyStart, today);
    const totals = statements(moves, book.accounts);
    const balance = (key: SystemKey) => moves.get(book.accounts.find((a) => a.system_key === key)?.id ?? "")?.closing ?? 0;
    const used = new Set(book.postings.flatMap((p) => p.lines.map((l) => l.accountId)));
    const manual = await one<{ n: number }>(deps.db, `SELECT COUNT(*) AS n FROM bos_journals WHERE tenant_id = :t AND status = 'posted' AND entry_date BETWEEN :from AND :today`, {
      t: actor.tenantId,
      from: `${today.slice(0, 7)}-01`,
      today,
    });
    const names = new Map(book.accounts.map((a) => [a.id, a.name]));
    res.json({
      today,
      fiscalYearStart: book.fyMonth,
      fyStart,
      fyLabel: `FY ${fiscalYearLabel(today, book.fyMonth)}`,
      booksStart: book.booksStart,
      accounts: book.accounts.map((a) => ({ ...mapAccount(a), balance: moves.get(a.id)?.closing ?? 0, used: used.has(a.id) })),
      totals: {
        cashAndBank: round2(balance("cash") + balance("bank")),
        receivables: balance("receivables"),
        payables: round2(-balance("payables")),
        suspense: round2(-balance("suspense")),
        openingTotal: lineTotals(book.opening).debit,
        openingDifference: book.openingDifference,
        manualMtd: Number(manual?.n ?? 0),
        income: totals.income,
        expense: totals.expense,
        net: totals.net,
        difference: totals.difference,
      },
      recent: book.postings
        .filter((p) => p.source !== "opening")
        .slice(-12)
        .reverse()
        .map((p) => ({
          ...postingView(p),
          debit: p.lines.filter((l) => l.debit > 0).map((l) => names.get(l.accountId) ?? "—"),
          credit: p.lines.filter((l) => l.credit > 0).map((l) => names.get(l.accountId) ?? "—"),
        })),
    });
  });

  router.get("/accounting/ledger", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const accountId = typeof req.query.account === "string" ? req.query.account : "";
    const { from, to } = await rangeOf(deps, actor.tenantId, { from: req.query.from, to: req.query.to });
    const book = await loadBook(deps, actor, to);
    const account = book.accounts.find((a) => a.id === accountId);
    if (!account) throw notFound("Account");
    let running = 0;
    let debit = 0;
    let credit = 0;
    const lines: Array<ReturnType<typeof postingView> & { debit: number; credit: number; balance: number }> = [];
    for (const p of book.postings) {
      const mine = p.lines.filter((l) => l.accountId === account.id);
      if (!mine.length) continue;
      const d = round2(mine.reduce((s, l) => s + l.debit, 0));
      const c = round2(mine.reduce((s, l) => s + l.credit, 0));
      running = round2(running + d - c);
      if (p.date < from) continue;
      debit = round2(debit + d);
      credit = round2(credit + c);
      lines.push({ ...postingView(p), debit: d, credit: c, balance: running });
    }
    const closing = running;
    res.json({
      account: mapAccount(account),
      from,
      to,
      booksStart: book.booksStart,
      opening: round2(closing - debit + credit),
      debit,
      credit,
      closing,
      truncated: lines.length > LEDGER_LIMIT,
      lines: lines.slice(-LEDGER_LIMIT),
    });
  });

  router.get("/accounting/trial-balance", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { from, to } = await rangeOf(deps, actor.tenantId, req.query);
    const book = await loadBook(deps, actor, to);
    const moves = movements(book.postings, from, to);
    const list = book.accounts
      .map((a) => ({ ...mapAccount(a), ...(moves.get(a.id) ?? { opening: 0, debit: 0, credit: 0, closing: 0 }) }))
      .filter((r) => !r.archived || r.opening || r.debit || r.credit);
    const sum = (f: (r: (typeof list)[number]) => number) => round2(list.reduce((s, r) => s + f(r), 0));
    res.json({
      from,
      to,
      booksStart: book.booksStart,
      rows: list,
      totals: {
        debit: sum((r) => r.debit),
        credit: sum((r) => r.credit),
        closingDebit: sum((r) => Math.max(0, r.closing)),
        closingCredit: sum((r) => Math.max(0, -r.closing)),
      },
      statements: statements(moves, book.accounts),
    });
  });

  router.post("/accounting/accounts", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(AccountInput, req.body);
    const t = actor.tenantId;
    const accounts = await ensureChart(deps.db, t, actor.userId);
    checkAccount(accounts, null, input.code, input.type, input.categories);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_accounts (id, tenant_id, code, name, type, categories, description, created_by) VALUES (:id, :t, :code, :name, :type, :categories, :description, :userId)`,
      {
        id,
        t,
        code: input.code,
        name: input.name,
        type: input.type,
        categories: input.categories.length ? JSON.stringify(input.categories) : null,
        description: input.description ?? null,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: "account.create", entityType: "account", entityId: id, summary: `Added account ${input.code} · ${input.name}`, ip: req.ip });
    res.status(201).json({ account: mapAccount((await one<AccountRow>(deps.db, `SELECT * FROM bos_accounts WHERE id = :id`, { id }))!) });
  });

  router.patch("/accounting/accounts/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parsePatch(AccountPatch, req.body);
    const t = actor.tenantId;
    const accounts = await ensureChart(deps.db, t, actor.userId);
    const a = accounts.find((x) => x.id === req.params.id);
    if (!a) throw notFound("Account");
    if (a.system_key && input.type && input.type !== a.type) throw new BosError(409, "BOS posts to this account, so its type can't change");
    if (a.system_key && input.archived) throw new BosError(409, "BOS posts to this account, so it can't be archived");
    if (input.type && input.type !== a.type && (await accountInUse(deps.db, t, a.id))) throw new BosError(409, "This account has entries, so its type can't change");
    const type = input.type ?? a.type;
    const categories = input.categories ?? json<string[]>(a.categories, []);
    checkAccount(accounts, a.id, input.code ?? a.code, type, type === "expense" ? categories : []);
    await exec(
      deps.db,
      `UPDATE bos_accounts SET code = :code, name = :name, type = :type, categories = :categories, description = :description,
         archived_at = CASE WHEN :archive IS NULL THEN archived_at WHEN :archive = 1 THEN COALESCE(archived_at, CURRENT_TIMESTAMP) ELSE NULL END
       WHERE id = :id`,
      {
        id: a.id,
        code: input.code ?? a.code,
        name: input.name ?? a.name,
        type,
        categories: type === "expense" && categories.length ? JSON.stringify(categories) : null,
        description: input.description === undefined ? a.description : input.description,
        archive: input.archived === undefined ? null : input.archived ? 1 : 0,
      },
    );
    const summary = input.archived === true ? `Archived account ${a.code} · ${a.name}` : input.archived === false ? `Restored account ${a.code} · ${a.name}` : `Updated account ${input.code ?? a.code} · ${input.name ?? a.name}`;
    await recordEvent(deps, actor, { type: "account.update", entityType: "account", entityId: a.id, summary, ip: req.ip });
    res.json({ account: mapAccount((await one<AccountRow>(deps.db, `SELECT * FROM bos_accounts WHERE id = :id`, { id: a.id }))!) });
  });

  router.delete("/accounting/accounts/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const a = await one<AccountRow>(deps.db, `SELECT * FROM bos_accounts WHERE id = :id AND tenant_id = :t`, { id: req.params.id, t: actor.tenantId });
    if (!a) throw notFound("Account");
    if (a.system_key) throw new BosError(409, "BOS posts to this account, so it can't be deleted");
    if (await accountInUse(deps.db, actor.tenantId, a.id)) throw new BosError(409, "This account has entries or an opening balance — archive it instead");
    await exec(deps.db, `DELETE FROM bos_accounts WHERE id = :id`, { id: a.id });
    await recordEvent(deps, actor, { type: "account.delete", entityType: "account", entityId: a.id, summary: `Deleted account ${a.code} · ${a.name}`, ip: req.ip });
    res.status(204).end();
  });

  router.get("/accounting/opening", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const today = todayISO();
    const asked = typeof req.query.suggest === "string" ? req.query.suggest : null;
    if (asked !== null && (!isoDate.safeParse(asked).success || asked > today)) throw new BosError(400, "Pick a books-start date up to today");
    const book = await loadBook(deps, actor, today);
    let suggestion: PostingLine[] | null = null;
    if (asked) {
      const earlier = await loadBook(deps, actor, addDaysISO(asked, -1), asked);
      const retained = earlier.accounts.find((a) => a.system_key === "retained_earnings")!.id;
      suggestion = suggestOpening(earlier.before, asked, earlier.accounts, retained);
    }
    res.json({
      booksStart: book.booksStart,
      today,
      lines: book.opening.filter((l) => l.debit || l.credit),
      difference: book.openingDifference,
      suggestion,
    });
  });

  router.put("/accounting/opening", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(OpeningInput, req.body);
    const t = actor.tenantId;
    if (input.booksStart > todayISO()) throw new BosError(400, "The books-start date can't be in the future");
    const accounts = await ensureChart(deps.db, t, actor.userId);
    const ids = new Set(accounts.map((a) => a.id));
    const seen = new Set<string>();
    for (const l of input.lines) {
      if (!ids.has(l.accountId)) throw notFound("Account");
      if (seen.has(l.accountId)) throw new BosError(400, "Each account can have one opening balance");
      if (l.debit > 0 && l.credit > 0) throw new BosError(400, "An opening balance is either a debit or a credit");
      seen.add(l.accountId);
    }
    const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0);
    await tx(deps.db, async (conn) => {
      await exec(conn, `INSERT INTO bos_accounting_settings (tenant_id, books_start, updated_by) VALUES (:t, :start, :userId) ON DUPLICATE KEY UPDATE books_start = VALUES(books_start), updated_by = VALUES(updated_by)`, {
        t,
        start: input.booksStart,
        userId: actor.userId,
      });
      await exec(conn, `DELETE FROM bos_opening_balances WHERE tenant_id = :t`, { t });
      for (const l of lines) await exec(conn, `INSERT INTO bos_opening_balances (tenant_id, account_id, debit, credit) VALUES (:t, :a, :d, :c)`, { t, a: l.accountId, d: round2(l.debit), c: round2(l.credit) });
    });
    const totals = lineTotals(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })));
    await recordEvent(deps, actor, {
      type: "accounting.opening",
      entityType: "accounting",
      entityId: "opening",
      summary: `Set opening balances on ${input.booksStart} (${lines.length} account${lines.length === 1 ? "" : "s"}, ${inr(totals.debit)} Dr / ${inr(totals.credit)} Cr)`,
      ip: req.ip,
    });
    res.json({ booksStart: input.booksStart, difference: round2(totals.debit - totals.credit) });
  });

  router.get("/accounting/journals", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { from, to } = await rangeOf(deps, actor.tenantId, req.query);
    const list = await rows<JournalRow & { line_count: number }>(
      deps.db,
      `SELECT j.*, (SELECT COUNT(*) FROM bos_journal_lines l WHERE l.journal_id = j.id) AS line_count FROM bos_journals j
       WHERE j.tenant_id = :t AND j.entry_date BETWEEN :from AND :to ORDER BY j.entry_date DESC, j.journal_no DESC LIMIT 1000`,
      { t: actor.tenantId, from, to },
    );
    res.json({ from, to, journals: list.map((j) => ({ ...mapJournal(j), lineCount: Number(j.line_count) })) });
  });

  router.get("/accounting/journals/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const j = await one<JournalRow>(deps.db, `SELECT * FROM bos_journals WHERE id = :id AND tenant_id = :t`, { id: req.params.id, t: actor.tenantId });
    if (!j) throw notFound("Journal entry");
    const lines = await rows<{ id: string; account_id: string; code: string; name: string; debit: string; credit: string; note: string | null }>(
      deps.db,
      `SELECT l.id, l.account_id, a.code, a.name, l.debit, l.credit, l.note FROM bos_journal_lines l JOIN bos_accounts a ON a.id = l.account_id WHERE l.journal_id = :id ORDER BY l.line_no`,
      { id: j.id },
    );
    res.json({
      journal: mapJournal(j),
      lines: lines.map((l) => ({ id: l.id, accountId: l.account_id, code: l.code, name: l.name, debit: money(l.debit), credit: money(l.credit), note: l.note })),
    });
  });

  router.post("/accounting/journals", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(JournalInput, req.body);
    const t = actor.tenantId;
    const today = todayISO();
    if (input.date > monthEndISO(today.slice(0, 7))) throw new BosError(400, "Entries can be dated up to the end of this month");
    const problem = journalProblem(input.lines);
    if (problem) throw new BosError(400, problem);
    const [accounts, bookSettings, settings] = await Promise.all([
      ensureChart(deps.db, t, actor.userId),
      one<{ books_start: string | null }>(deps.db, `SELECT books_start FROM bos_accounting_settings WHERE tenant_id = :t`, { t }),
      getSettings(deps, t),
    ]);
    if (bookSettings?.books_start && input.date < bookSettings.books_start) throw new BosError(400, `Entries can't be dated before the books start (${bookSettings.books_start})`);
    const usable = new Map(accounts.filter((a) => !a.archived_at).map((a) => [a.id, a]));
    for (const l of input.lines) if (!usable.has(l.accountId)) throw new BosError(400, "Pick an active account on every line");
    const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0);
    const total = lineTotals(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit }))).debit;
    const id = randomUUID();
    const journalNo = await tx(deps.db, async (conn) => {
      const fy = fiscalYearLabel(input.date, settings.fiscalYearStart);
      const no = formatDocNo("JV", fy, await nextSequence(conn, t, "journal", fy));
      await exec(conn, `INSERT INTO bos_journals (id, tenant_id, journal_no, entry_date, narration, total, created_by) VALUES (:id, :t, :no, :date, :narration, :total, :userId)`, {
        id,
        t,
        no,
        date: input.date,
        narration: input.narration,
        total,
        userId: actor.userId,
      });
      let n = 0;
      for (const l of lines) {
        await exec(conn, `INSERT INTO bos_journal_lines (id, tenant_id, journal_id, line_no, account_id, debit, credit, note) VALUES (:id, :t, :journalId, :n, :accountId, :debit, :credit, :note)`, {
          id: randomUUID(),
          t,
          journalId: id,
          n: ++n,
          accountId: l.accountId,
          debit: round2(l.debit),
          credit: round2(l.credit),
          note: l.note ?? null,
        });
      }
      return no;
    });
    await recordEvent(deps, actor, { type: "journal.create", entityType: "journal", entityId: id, summary: `Posted ${journalNo} · ${input.narration} (${inr(total)})`, ip: req.ip });
    res.status(201).json({ journal: mapJournal((await one<JournalRow>(deps.db, `SELECT * FROM bos_journals WHERE id = :id`, { id }))!) });
  });

  router.post("/accounting/journals/:id/void", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(VoidInput, req.body);
    const j = await one<JournalRow>(deps.db, `SELECT * FROM bos_journals WHERE id = :id AND tenant_id = :t`, { id: req.params.id, t: actor.tenantId });
    if (!j) throw notFound("Journal entry");
    if (j.status === "void") throw new BosError(409, "This entry is already void");
    await exec(deps.db, `UPDATE bos_journals SET status = 'void', void_reason = :reason, voided_by = :userId, voided_at = CURRENT_TIMESTAMP WHERE id = :id`, { id: j.id, reason: input.reason, userId: actor.userId });
    await recordEvent(deps, actor, { type: "journal.void", entityType: "journal", entityId: j.id, summary: `Voided ${j.journal_no} · ${input.reason}`, ip: req.ip });
    res.json({ journal: mapJournal((await one<JournalRow>(deps.db, `SELECT * FROM bos_journals WHERE id = :id`, { id: j.id }))!) });
  });
}

type JournalRow = {
  id: string;
  journal_no: string;
  entry_date: string;
  narration: string;
  total: string;
  status: "posted" | "void";
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
};
const mapJournal = (j: JournalRow) => ({
  id: j.id,
  journalNo: j.journal_no,
  date: j.entry_date,
  narration: j.narration,
  total: money(j.total),
  status: j.status,
  voidReason: j.void_reason,
  voidedAt: j.voided_at,
  createdAt: j.created_at,
});

const postingView = (p: Posting) => ({ date: p.date, source: p.source, sourceId: p.sourceId, linkId: p.linkId ?? p.sourceId, ref: p.ref, memo: p.memo, amount: lineTotals(p.lines).debit });

async function accountInUse(db: BosDeps["db"], tenantId: number, accountId: string): Promise<boolean> {
  const hit = await one(
    db,
    `SELECT 1 FROM bos_journal_lines WHERE tenant_id = :t AND account_id = :a UNION ALL SELECT 1 FROM bos_opening_balances WHERE tenant_id = :t AND account_id = :a AND (debit <> 0 OR credit <> 0) LIMIT 1`,
    { t: tenantId, a: accountId },
  );
  return Boolean(hit);
}

/** Codes are unique; categories route bills and claims to one expense account only. */
function checkAccount(accounts: ReadonlyArray<AccountRow>, selfId: string | null, code: string, type: AccountType, categories: ReadonlyArray<string>) {
  if (accounts.some((a) => a.id !== selfId && a.code.toLowerCase() === code.toLowerCase())) throw new BosError(409, `Code ${code} is already used by another account`);
  if (categories.length && type !== "expense") throw new BosError(400, "Only expense accounts can collect bill and claim categories");
  const keys = new Set<string>();
  for (const c of categories) {
    const k = categoryKey(c);
    if (keys.has(k)) throw new BosError(400, `"${c}" is listed twice`);
    keys.add(k);
    const other = accounts.find((a) => a.id !== selfId && !a.archived_at && json<string[]>(a.categories, []).some((x) => categoryKey(x) === k));
    if (other) throw new BosError(409, `"${c}" already posts to ${other.code} · ${other.name}`);
  }
}
