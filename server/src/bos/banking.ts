import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { BANK_CATEGORIES, bestSuggestion, fingerprintLines, scoreCandidates, type MatchCandidate, type MatchTarget, type ScoredCandidate } from "./banking-logic.js";
import { actorOf, isoDate, optText, parse, recordEvent, type BosDeps, type BosEventInput } from "./context.js";
import { exec, money, one, rows, tx } from "./db.js";
import { addInvoicePayment, billPaidEvent, invoicePaymentEvent, payBill, reimburseEvent, reimburseExpense } from "./finance.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { addDaysISO, todayISO } from "./logic.js";
import { payPayrollRun, payrollPaidEvent } from "./payroll.js";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const periodLabel = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const MAX_LINES = 5000;
const LIST_LIMIT = 2000;

const managerOnly = (actor: BosActor) => {
  if (!isManager(actor)) throw forbidden("Banking is available to owners and admins");
};

/** Blank strings from forms mean "not set". */
const blank = <S extends z.ZodType>(schema: S) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable().optional());

/* ---------- Inputs ---------- */

const AccountFields = {
  name: z.string().trim().min(1, "Required").max(120),
  kind: z.enum(["bank", "cash"]),
  bankName: blank(z.string().trim().max(120)),
  accountLast4: blank(z.string().trim().regex(/^\d{4}$/, "Enter the last 4 digits")),
  ifsc: blank(
    z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Use a valid IFSC, e.g. HDFC0001234")),
  ),
  openingBalance: z.coerce.number().min(-1e12).max(1e12),
  openingDate: isoDate,
};
const AccountInput = z.object({ ...AccountFields, kind: AccountFields.kind.default("bank"), openingBalance: AccountFields.openingBalance.default(0) });
const AccountPatch = z.object(AccountFields).partial().extend({ archived: z.boolean().optional() });

const amount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n) && n !== 0, "Amount can't be zero")
  .refine((n) => Math.abs(n) <= 1e12, "Amount is too large")
  .transform((n) => Math.round(n * 100) / 100);

const LineInput = z.object({
  date: isoDate,
  description: z.string().trim().min(1, "Required").max(300),
  reference: optText(120),
  amount,
  balance: z.coerce.number().min(-1e12).max(1e12).nullable().optional(),
});
const ImportInput = z.object({ lines: z.array(LineInput).min(1, "The statement has no lines").max(MAX_LINES, `Import up to ${MAX_LINES} lines at a time`) });
const EntryInput = LineInput.omit({ balance: true });

const note = optText(300);
const ReconcileInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("match"), type: z.enum(["payment", "bill", "expense", "payroll"]), id: z.string().min(1).max(36), note }),
  z.object({ action: z.literal("settle"), type: z.enum(["invoice", "bill", "expense", "payroll"]), id: z.string().min(1).max(36), note }),
  z.object({ action: z.literal("categorize"), category: z.string().trim().min(1, "Choose a category").max(80), note }),
  z.object({ action: z.literal("exclude"), note }),
]);

/* ---------- Rows ---------- */

type AccountRow = {
  id: string;
  name: string;
  kind: "bank" | "cash";
  bank_name: string | null;
  account_last4: string | null;
  ifsc: string | null;
  opening_balance: string | number;
  opening_date: string;
  archived_at: string | null;
  created_at: string;
  moved?: string | number | null;
  unreconciled?: string | number | null;
  txn_count?: string | number | null;
  last_txn?: string | null;
  statement_balance?: string | number | null;
  statement_date?: string | null;
};

type TxnStatus = "unmatched" | "matched" | "categorized" | "excluded";
type TxnRow = {
  id: string;
  account_id: string;
  txn_date: string;
  description: string;
  reference: string | null;
  amount: string | number;
  statement_balance: string | number | null;
  source: "import" | "manual";
  status: TxnStatus;
  match_type: MatchTarget | null;
  match_id: string | null;
  category: string | null;
  note: string | null;
  reconciled_at: string | null;
  created_at: string;
};

const ACCOUNT_SELECT = `
  SELECT a.*,
    (SELECT COALESCE(SUM(t.amount), 0) FROM bos_bank_txns t WHERE t.account_id = a.id AND t.txn_date >= a.opening_date) AS moved,
    (SELECT COUNT(*) FROM bos_bank_txns t WHERE t.account_id = a.id AND t.status = 'unmatched') AS unreconciled,
    (SELECT COUNT(*) FROM bos_bank_txns t WHERE t.account_id = a.id) AS txn_count,
    (SELECT MAX(t.txn_date) FROM bos_bank_txns t WHERE t.account_id = a.id) AS last_txn,
    (SELECT s.statement_balance FROM bos_bank_txns s WHERE s.account_id = a.id AND s.statement_balance IS NOT NULL
      ORDER BY s.txn_date DESC, s.created_at DESC, s.line_no DESC LIMIT 1) AS statement_balance,
    (SELECT s.txn_date FROM bos_bank_txns s WHERE s.account_id = a.id AND s.statement_balance IS NOT NULL
      ORDER BY s.txn_date DESC, s.created_at DESC, s.line_no DESC LIMIT 1) AS statement_date
  FROM bos_bank_accounts a`;

function mapAccount(r: AccountRow) {
  const openingBalance = money(r.opening_balance);
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    bankName: r.bank_name,
    accountLast4: r.account_last4,
    ifsc: r.ifsc,
    openingBalance,
    openingDate: r.opening_date,
    archived: Boolean(r.archived_at),
    balance: Math.round((openingBalance + money(r.moved)) * 100) / 100,
    statementBalance: r.statement_balance === null || r.statement_balance === undefined ? null : money(r.statement_balance),
    statementDate: r.statement_date ?? null,
    lastTxnDate: r.last_txn ?? null,
    txnCount: Number(r.txn_count ?? 0),
    unreconciled: Number(r.unreconciled ?? 0),
    createdAt: r.created_at,
  };
}
export type BosBankAccount = ReturnType<typeof mapAccount>;

const mapTxn = (r: TxnRow, extra: { matchLabel?: string | null; suggestion?: ScoredCandidate | null } = {}) => ({
  id: r.id,
  accountId: r.account_id,
  date: r.txn_date,
  description: r.description,
  reference: r.reference,
  amount: money(r.amount),
  statementBalance: r.statement_balance === null ? null : money(r.statement_balance),
  source: r.source,
  status: r.status,
  matchType: r.match_type,
  matchId: r.match_id,
  matchLabel: extra.matchLabel ?? null,
  category: r.category,
  note: r.note,
  reconciledAt: r.reconciled_at,
  suggestion: extra.suggestion ?? null,
});

async function loadAccount(db: BosDeps["db"] | PoolConnection, tenantId: number, id: string): Promise<AccountRow> {
  const row = await one<AccountRow>(db, `${ACCOUNT_SELECT} WHERE a.id = :id AND a.tenant_id = :t`, { id, t: tenantId });
  if (!row) throw notFound("Account");
  return row;
}

async function loadTxn(db: BosDeps["db"] | PoolConnection, tenantId: number, id: string, lock = false): Promise<TxnRow> {
  const row = await one<TxnRow>(db, `SELECT * FROM bos_bank_txns WHERE id = :id AND tenant_id = :t${lock ? " FOR UPDATE" : ""}`, { id, t: tenantId });
  if (!row) throw notFound("Statement line");
  return row;
}

/* ---------- Candidates ---------- */

/** Records a statement line could belong to, minus those already linked to another line. */
async function candidatePool(db: BosDeps["db"] | PoolConnection, tenantId: number, since: string): Promise<MatchCandidate[]> {
  const t = tenantId;
  const [linked, payments, invoices, bills, expenses, runs] = await Promise.all([
    rows<{ match_type: string; match_id: string }>(db, `SELECT match_type, match_id FROM bos_bank_txns WHERE tenant_id = :t AND status = 'matched'`, { t }),
    rows<{ id: string; amount: string | number; paid_on: string; reference: string | null; invoice_no: string; party_name: string }>(
      db,
      `SELECT p.id, p.amount, p.paid_on, p.reference, i.invoice_no, i.party_name
       FROM bos_payments p JOIN bos_invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = :t AND p.paid_on >= :since ORDER BY p.paid_on DESC LIMIT 3000`,
      { t, since },
    ),
    rows<{ id: string; invoice_no: string; party_name: string; issue_date: string; balance: string | number }>(
      db,
      `SELECT id, invoice_no, party_name, issue_date, grand_total - amount_paid AS balance
       FROM bos_invoices WHERE tenant_id = :t AND status IN ('sent','partial') AND grand_total - amount_paid > 0.5 LIMIT 3000`,
      { t },
    ),
    rows<{ id: string; bill_no: string | null; party_name: string; bill_date: string; paid_on: string | null; total: string | number; status: string }>(
      db,
      `SELECT id, bill_no, party_name, bill_date, paid_on, total, status FROM bos_bills
       WHERE tenant_id = :t AND (status = 'approved' OR (status = 'paid' AND paid_on >= :since)) LIMIT 3000`,
      { t, since },
    ),
    rows<{ id: string; claimant_name: string | null; category: string; spent_on: string; amount: string | number; status: string }>(
      db,
      `SELECT id, claimant_name, category, spent_on, amount, status FROM bos_expenses
       WHERE tenant_id = :t AND (status = 'approved' OR (status = 'reimbursed' AND spent_on >= :expenseSince)) LIMIT 3000`,
      { t, expenseSince: addDaysISO(since, -60) },
    ),
    rows<{ id: string; period: string; status: string; net_total: string | number; paid_on: string | null; employee_count: number }>(
      db,
      `SELECT id, period, status, net_total, paid_on, employee_count FROM bos_payroll_runs WHERE tenant_id = :t AND status IN ('finalized','paid') ORDER BY period DESC LIMIT 36`,
      { t },
    ),
  ]);
  const taken = new Set(linked.map((l) => `${l.match_type}:${l.match_id}`));
  const pool: MatchCandidate[] = [];
  for (const p of payments) {
    pool.push({ type: "payment", id: p.id, action: "match", label: `Payment · ${p.invoice_no}`, detail: `${p.party_name} · received ${p.paid_on}`, date: p.paid_on, amount: money(p.amount), keywords: [p.party_name, p.invoice_no, p.reference ?? ""] });
  }
  for (const i of invoices) {
    pool.push({ type: "invoice", id: i.id, action: "settle", label: i.invoice_no, detail: `${i.party_name} · ${inr(money(i.balance))} due`, date: i.issue_date, amount: money(i.balance), keywords: [i.party_name, i.invoice_no] });
  }
  for (const b of bills) {
    const paid = b.status === "paid";
    pool.push({
      type: "bill",
      id: b.id,
      action: paid ? "match" : "settle",
      label: `${b.party_name}${b.bill_no ? ` · ${b.bill_no}` : ""}`,
      detail: paid ? `Bill paid ${b.paid_on}` : `Approved bill · ${b.bill_date}`,
      date: paid ? (b.paid_on ?? b.bill_date) : b.bill_date,
      amount: money(b.total),
      keywords: [b.party_name, b.bill_no ?? ""],
    });
  }
  for (const e of expenses) {
    const done = e.status === "reimbursed";
    pool.push({
      type: "expense",
      id: e.id,
      action: done ? "match" : "settle",
      label: `${e.claimant_name ?? "Claim"} · ${e.category}`,
      detail: `${done ? "Reimbursed claim" : "Approved claim"} · spent ${e.spent_on}`,
      date: e.spent_on,
      amount: money(e.amount),
      keywords: [e.claimant_name ?? ""],
    });
  }
  for (const r of runs) {
    const paid = r.status === "paid";
    pool.push({
      type: "payroll",
      id: r.id,
      action: paid ? "match" : "settle",
      label: `Salaries · ${periodLabel(r.period)}`,
      detail: `${r.employee_count} employees · ${paid ? `paid ${r.paid_on}` : "finalised"}`,
      date: paid ? (r.paid_on ?? `${r.period}-01`) : `${r.period}-01`,
      amount: money(r.net_total),
      keywords: ["salary", "salaries", "payroll"],
    });
  }
  // An invoice can take several part-payments; everything else is matched once.
  return pool.filter((c) => c.type === "invoice" || !taken.has(`${c.type}:${c.id}`));
}

/** Human labels for the records matched lines point at. */
async function matchLabels(db: BosDeps["db"], tenantId: number, list: ReadonlyArray<TxnRow>): Promise<Map<string, string>> {
  const ids = (type: MatchTarget) => [...new Set(list.filter((r) => r.status === "matched" && r.match_type === type && r.match_id).map((r) => r.match_id!))];
  const labels = new Map<string, string>();
  const t = tenantId;
  const payments = ids("payment");
  const bills = ids("bill");
  const expenses = ids("expense");
  const runs = ids("payroll");
  await Promise.all([
    payments.length &&
      rows<{ id: string; invoice_no: string; party_name: string }>(db, `SELECT p.id, i.invoice_no, i.party_name FROM bos_payments p JOIN bos_invoices i ON i.id = p.invoice_id WHERE p.tenant_id = :t AND p.id IN (:ids)`, { t, ids: payments }).then((r) =>
        r.forEach((x) => labels.set(`payment:${x.id}`, `${x.invoice_no} · ${x.party_name}`)),
      ),
    bills.length &&
      rows<{ id: string; bill_no: string | null; party_name: string }>(db, `SELECT id, bill_no, party_name FROM bos_bills WHERE tenant_id = :t AND id IN (:ids)`, { t, ids: bills }).then((r) =>
        r.forEach((x) => labels.set(`bill:${x.id}`, `Bill · ${x.party_name}${x.bill_no ? ` · ${x.bill_no}` : ""}`)),
      ),
    expenses.length &&
      rows<{ id: string; claimant_name: string | null; category: string }>(db, `SELECT id, claimant_name, category FROM bos_expenses WHERE tenant_id = :t AND id IN (:ids)`, { t, ids: expenses }).then((r) =>
        r.forEach((x) => labels.set(`expense:${x.id}`, `Claim · ${x.claimant_name ?? ""} · ${x.category}`)),
      ),
    runs.length &&
      rows<{ id: string; period: string }>(db, `SELECT id, period FROM bos_payroll_runs WHERE tenant_id = :t AND id IN (:ids)`, { t, ids: runs }).then((r) => r.forEach((x) => labels.set(`payroll:${x.id}`, `Salaries · ${periodLabel(x.period)}`))),
  ]);
  return labels;
}

const lineOf = (r: TxnRow) => ({ date: r.txn_date, description: r.description, reference: r.reference, amount: money(r.amount) });
const sinceFor = (list: ReadonlyArray<TxnRow>) => addDaysISO(list.reduce((min, r) => (r.txn_date < min ? r.txn_date : min), todayISO()), -15);

/* ---------- Routes ---------- */

export function registerBanking(router: Router, deps: BosDeps): void {
  router.get("/banking/overview", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const today = todayISO();
    const monthStart = `${today.slice(0, 7)}-01`;
    const [accounts, month] = await Promise.all([
      rows<AccountRow>(deps.db, `${ACCOUNT_SELECT} WHERE a.tenant_id = :t ORDER BY a.archived_at IS NOT NULL, a.kind, a.name`, { t: actor.tenantId }),
      one<{ money_in: string | number | null; money_out: string | number | null }>(
        deps.db,
        `SELECT SUM(CASE WHEN t.amount > 0 THEN t.amount END) AS money_in, SUM(CASE WHEN t.amount < 0 THEN -t.amount END) AS money_out
         FROM bos_bank_txns t JOIN bos_bank_accounts a ON a.id = t.account_id
         WHERE t.tenant_id = :t AND a.archived_at IS NULL AND t.txn_date >= :monthStart AND t.txn_date <= :today
           AND NOT (t.status = 'categorized' AND t.category = 'Transfer between accounts')`,
        { t: actor.tenantId, monthStart, today },
      ),
    ]);
    const list = accounts.map(mapAccount);
    const active = list.filter((a) => !a.archived);
    res.json({
      today,
      accounts: list,
      categories: BANK_CATEGORIES,
      totals: {
        bank: active.filter((a) => a.kind === "bank").reduce((s, a) => s + a.balance, 0),
        cash: active.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0),
        unreconciled: active.reduce((s, a) => s + a.unreconciled, 0),
        moneyIn: money(month?.money_in),
        moneyOut: money(month?.money_out),
      },
    });
  });

  router.post("/banking/accounts", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(AccountInput, req.body);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_bank_accounts (id, tenant_id, name, kind, bank_name, account_last4, ifsc, opening_balance, opening_date, created_by)
       VALUES (:id, :t, :name, :kind, :bankName, :last4, :ifsc, :openingBalance, :openingDate, :userId)`,
      {
        id,
        t: actor.tenantId,
        name: input.name,
        kind: input.kind,
        bankName: input.kind === "cash" ? null : (input.bankName ?? null),
        last4: input.kind === "cash" ? null : (input.accountLast4 ?? null),
        ifsc: input.kind === "cash" ? null : (input.ifsc ?? null),
        openingBalance: input.openingBalance,
        openingDate: input.openingDate,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: "bank.account_create", entityType: "bank_account", entityId: id, summary: `Added ${input.kind === "cash" ? "cash account" : "bank account"} ${input.name}`, ip: req.ip });
    res.status(201).json({ account: mapAccount(await loadAccount(deps.db, actor.tenantId, id)) });
  });

  router.patch("/banking/accounts/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(AccountPatch, req.body);
    const acc = await loadAccount(deps.db, actor.tenantId, req.params.id);
    const sets: string[] = [];
    const params: Record<string, unknown> = { id: acc.id };
    const col = { name: "name", kind: "kind", bankName: "bank_name", accountLast4: "account_last4", ifsc: "ifsc", openingBalance: "opening_balance", openingDate: "opening_date" } as const;
    for (const [key, column] of Object.entries(col) as Array<[keyof typeof col, string]>) {
      if (input[key] === undefined) continue;
      sets.push(`${column} = :${key}`);
      params[key] = input[key];
    }
    if (input.archived !== undefined) sets.push(input.archived ? "archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)" : "archived_at = NULL");
    if (sets.length) await exec(deps.db, `UPDATE bos_bank_accounts SET ${sets.join(", ")} WHERE id = :id`, params);
    await recordEvent(deps, actor, {
      type: input.archived === true ? "bank.account_archive" : "bank.account_update",
      entityType: "bank_account",
      entityId: acc.id,
      summary: `${input.archived === true ? "Archived" : input.archived === false ? "Restored" : "Updated"} account ${input.name ?? acc.name}`,
      ip: req.ip,
    });
    res.json({ account: mapAccount(await loadAccount(deps.db, actor.tenantId, acc.id)) });
  });

  router.delete("/banking/accounts/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const acc = await loadAccount(deps.db, actor.tenantId, req.params.id);
    if (Number(acc.txn_count ?? 0) > 0) throw new BosError(409, "This account has statement lines — archive it instead");
    await exec(deps.db, `DELETE FROM bos_bank_accounts WHERE id = :id AND tenant_id = :t`, { id: acc.id, t: actor.tenantId });
    await recordEvent(deps, actor, { type: "bank.account_delete", entityType: "bank_account", entityId: acc.id, summary: `Deleted account ${acc.name}`, ip: req.ip });
    res.status(204).end();
  });

  router.get("/banking/accounts/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const acc = await loadAccount(deps.db, actor.tenantId, req.params.id);
    const list = await rows<TxnRow>(
      deps.db,
      `SELECT * FROM bos_bank_txns WHERE tenant_id = :t AND account_id = :id ORDER BY txn_date DESC, created_at DESC, line_no DESC LIMIT ${LIST_LIMIT}`,
      { t: actor.tenantId, id: acc.id },
    );
    const open = list.filter((r) => r.status === "unmatched");
    const [labels, pool] = await Promise.all([matchLabels(deps.db, actor.tenantId, list), open.length ? candidatePool(deps.db, actor.tenantId, sinceFor(open)) : Promise.resolve([])]);
    res.json({
      account: mapAccount(acc),
      categories: BANK_CATEGORIES,
      truncated: list.length === LIST_LIMIT,
      transactions: list.map((r) =>
        mapTxn(r, {
          matchLabel: r.match_type && r.match_id ? (labels.get(`${r.match_type}:${r.match_id}`) ?? null) : null,
          suggestion: r.status === "unmatched" ? bestSuggestion(scoreCandidates(lineOf(r), pool, 3)) : null,
        }),
      ),
    });
  });

  router.post("/banking/accounts/:id/import", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { lines } = parse(ImportInput, req.body);
    const acc = await loadAccount(deps.db, actor.tenantId, req.params.id);
    if (acc.archived_at) throw new BosError(409, "Restore the account before importing into it");
    const kept = lines.filter((l) => l.date >= acc.opening_date);
    const beforeOpening = lines.length - kept.length;
    const prints = fingerprintLines(kept.map((l) => ({ date: l.date, description: l.description, reference: l.reference ?? null, amount: l.amount })));
    const importId = randomUUID();
    let imported = 0;
    await tx(deps.db, async (conn) => {
      for (let start = 0; start < kept.length; start += 500) {
        const chunk = kept.slice(start, start + 500);
        const params: Record<string, unknown> = { t: actor.tenantId, a: acc.id, importId, userId: actor.userId };
        const values = chunk.map((l, i) => {
          const n = start + i;
          Object.assign(params, { [`id${n}`]: randomUUID(), [`d${n}`]: l.date, [`s${n}`]: l.description, [`r${n}`]: l.reference ?? null, [`m${n}`]: l.amount, [`b${n}`]: l.balance ?? null, [`f${n}`]: prints[n], [`n${n}`]: n });
          return `(:id${n}, :t, :a, :d${n}, :s${n}, :r${n}, :m${n}, :b${n}, 'import', :f${n}, :importId, :n${n}, :userId)`;
        });
        const r = await exec(
          conn,
          `INSERT IGNORE INTO bos_bank_txns (id, tenant_id, account_id, txn_date, description, reference, amount, statement_balance, source, fingerprint, import_id, line_no, created_by)
           VALUES ${values.join(", ")}`,
          params,
        );
        imported += Number(r.affectedRows) || 0;
      }
    });
    const skipped = kept.length - imported;
    await recordEvent(deps, actor, {
      type: "bank.import",
      entityType: "bank_account",
      entityId: acc.id,
      summary: `Imported ${imported} statement line${imported === 1 ? "" : "s"} into ${acc.name}${skipped ? ` · ${skipped} already there` : ""}`,
      payload: { importId, imported, skipped, beforeOpening },
      ip: req.ip,
    });
    res.status(201).json({ imported, skipped, beforeOpening, account: mapAccount(await loadAccount(deps.db, actor.tenantId, acc.id)) });
  });

  router.post("/banking/accounts/:id/transactions", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(EntryInput, req.body);
    const acc = await loadAccount(deps.db, actor.tenantId, req.params.id);
    if (acc.archived_at) throw new BosError(409, "Restore the account before adding entries");
    if (input.date < acc.opening_date) throw new BosError(400, `Entries can't be dated before the opening balance (${acc.opening_date})`);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_bank_txns (id, tenant_id, account_id, txn_date, description, reference, amount, source, fingerprint, created_by)
       VALUES (:id, :t, :a, :date, :description, :reference, :amount, 'manual', :fp, :userId)`,
      { id, t: actor.tenantId, a: acc.id, date: input.date, description: input.description, reference: input.reference ?? null, amount: input.amount, fp: createHash("sha1").update(`manual|${id}`).digest("hex"), userId: actor.userId },
    );
    await recordEvent(deps, actor, { type: "bank.entry", entityType: "bank_account", entityId: acc.id, summary: `Added ${input.amount > 0 ? "money in" : "money out"} ${inr(Math.abs(input.amount))} to ${acc.name}`, ip: req.ip });
    res.status(201).json({ transaction: mapTxn(await loadTxn(deps.db, actor.tenantId, id)) });
  });

  router.get("/banking/transactions/:id/candidates", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const txn = await loadTxn(deps.db, actor.tenantId, req.params.id);
    const pool = await candidatePool(deps.db, actor.tenantId, sinceFor([txn]));
    res.json({ transaction: mapTxn(txn), candidates: scoreCandidates(lineOf(txn), pool), categories: BANK_CATEGORIES });
  });

  router.post("/banking/transactions/:id/reconcile", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(ReconcileInput, req.body);
    const events: BosEventInput[] = [];
    const result = await tx(deps.db, async (conn) => {
      const txn = await loadTxn(conn, actor.tenantId, req.params.id, true);
      if (txn.status !== "unmatched") throw new BosError(409, "This line is already reconciled — undo it first");
      const amt = money(txn.amount);
      const abs = Math.abs(amt);
      let status: TxnStatus = "matched";
      let matchType: MatchTarget | null = null;
      let matchId: string | null = null;
      let category: string | null = null;
      let summary: string;

      const needDirection = (credit: boolean) => {
        if (credit !== amt > 0) throw new BosError(400, credit ? "Only money coming in can be matched to an invoice payment" : "Only money going out can be matched to a bill, claim or payroll");
      };
      const needAmount = (expected: number, what: string) => {
        if (Math.abs(expected - abs) > 0.5) throw new BosError(400, `The amount doesn't match the ${what} (${inr(expected)})`);
      };
      const ensureFree = async (type: MatchTarget, id: string) => {
        const other = await one<{ id: string }>(conn, `SELECT id FROM bos_bank_txns WHERE tenant_id = :t AND status = 'matched' AND match_type = :type AND match_id = :id AND id <> :self LIMIT 1`, {
          t: actor.tenantId,
          type,
          id,
          self: txn.id,
        });
        if (other) throw new BosError(409, "That record is already matched to another statement line");
      };

      if (input.action === "categorize") {
        status = "categorized";
        category = input.category;
        summary = `Categorised ${inr(abs)} as ${input.category}`;
      } else if (input.action === "exclude") {
        status = "excluded";
        summary = `Excluded a ${inr(abs)} statement line from reconciliation`;
      } else if (input.action === "match") {
        await ensureFree(input.type, input.id);
        if (input.type === "payment") {
          needDirection(true);
          const p = await one<{ amount: string | number; invoice_no: string }>(conn, `SELECT p.amount, i.invoice_no FROM bos_payments p JOIN bos_invoices i ON i.id = p.invoice_id WHERE p.id = :id AND p.tenant_id = :t`, { id: input.id, t: actor.tenantId });
          if (!p) throw notFound("Payment");
          needAmount(money(p.amount), "payment");
          summary = `Matched ${inr(abs)} to the payment on ${p.invoice_no}`;
        } else if (input.type === "bill") {
          needDirection(false);
          const b = await one<{ total: string | number; status: string; party_name: string }>(conn, `SELECT total, status, party_name FROM bos_bills WHERE id = :id AND tenant_id = :t`, { id: input.id, t: actor.tenantId });
          if (!b) throw notFound("Bill");
          if (b.status !== "paid") throw new BosError(409, "Only a paid bill can be matched — pay it from this line instead");
          needAmount(money(b.total), "bill");
          summary = `Matched ${inr(abs)} to the bill from ${b.party_name}`;
        } else if (input.type === "expense") {
          needDirection(false);
          const e = await one<{ amount: string | number; status: string; claimant_name: string | null }>(conn, `SELECT amount, status, claimant_name FROM bos_expenses WHERE id = :id AND tenant_id = :t`, { id: input.id, t: actor.tenantId });
          if (!e) throw notFound("Expense");
          if (e.status !== "reimbursed") throw new BosError(409, "Only a reimbursed claim can be matched — reimburse it from this line instead");
          needAmount(money(e.amount), "claim");
          summary = `Matched ${inr(abs)} to ${e.claimant_name ?? "a"}'s expense claim`;
        } else {
          needDirection(false);
          const r = await one<{ net_total: string | number; status: string; period: string }>(conn, `SELECT net_total, status, period FROM bos_payroll_runs WHERE id = :id AND tenant_id = :t`, { id: input.id, t: actor.tenantId });
          if (!r) throw notFound("Payroll run");
          if (r.status !== "paid") throw new BosError(409, "Only a paid payroll run can be matched — mark it paid from this line instead");
          needAmount(money(r.net_total), "net pay");
          summary = `Matched ${inr(abs)} to salaries for ${periodLabel(r.period)}`;
        }
        matchType = input.type;
        matchId = input.id;
      } else {
        const paidOn = txn.txn_date;
        if (input.type === "invoice") {
          needDirection(true);
          const pay = { amount: abs, paidOn, method: "bank" as const, reference: (txn.reference ?? txn.description).slice(0, 120), notes: "Recorded from the bank statement" };
          const r = await addInvoicePayment(deps, conn, actor, input.id, pay);
          events.push(invoicePaymentEvent(r, pay, req.ip));
          matchType = "payment";
          matchId = r.paymentId;
          summary = `Recorded ${inr(abs)} from the bank statement against ${r.invoiceNo}`;
        } else if (input.type === "bill") {
          needDirection(false);
          await ensureFree("bill", input.id);
          const b = await one<{ total: string | number }>(conn, `SELECT total FROM bos_bills WHERE id = :id AND tenant_id = :t`, { id: input.id, t: actor.tenantId });
          if (!b) throw notFound("Bill");
          needAmount(money(b.total), "bill");
          const bill = await payBill(conn, actor.tenantId, input.id, paidOn);
          events.push(billPaidEvent(bill, req.ip));
          matchType = "bill";
          matchId = bill.id;
          summary = `Paid the bill from ${bill.party_name} from the bank statement`;
        } else if (input.type === "expense") {
          needDirection(false);
          await ensureFree("expense", input.id);
          const e = await one<{ amount: string | number; claimant_name: string | null }>(conn, `SELECT amount, claimant_name FROM bos_expenses WHERE id = :id AND tenant_id = :t`, { id: input.id, t: actor.tenantId });
          if (!e) throw notFound("Expense");
          needAmount(money(e.amount), "claim");
          await reimburseExpense(conn, actor.tenantId, input.id);
          events.push(reimburseEvent(input.id, req.ip));
          matchType = "expense";
          matchId = input.id;
          summary = `Reimbursed ${e.claimant_name ?? "a"}'s claim from the bank statement`;
        } else {
          needDirection(false);
          await ensureFree("payroll", input.id);
          const r = await one<{ net_total: string | number }>(conn, `SELECT net_total FROM bos_payroll_runs WHERE id = :id AND tenant_id = :t`, { id: input.id, t: actor.tenantId });
          if (!r) throw notFound("Payroll run");
          needAmount(money(r.net_total), "net pay");
          const run = await payPayrollRun(conn, actor.tenantId, input.id, paidOn);
          events.push(payrollPaidEvent(run, req.ip));
          matchType = "payroll";
          matchId = run.id;
          summary = `Marked salaries for ${periodLabel(run.period)} paid from the bank statement`;
        }
      }
      await exec(
        conn,
        `UPDATE bos_bank_txns SET status = :status, match_type = :matchType, match_id = :matchId, category = :category, note = :note, reconciled_by = :userId, reconciled_at = CURRENT_TIMESTAMP WHERE id = :id`,
        { status, matchType, matchId, category, note: input.note ?? null, userId: actor.userId, id: txn.id },
      );
      return { id: txn.id, accountId: txn.account_id, summary };
    });
    for (const ev of events) await recordEvent(deps, actor, ev);
    await recordEvent(deps, actor, { type: `bank.${input.action}`, entityType: "bank_txn", entityId: result.id, summary: result.summary, payload: { accountId: result.accountId }, ip: req.ip });
    const row = await loadTxn(deps.db, actor.tenantId, result.id);
    const labels = await matchLabels(deps.db, actor.tenantId, [row]);
    res.json({ transaction: mapTxn(row, { matchLabel: row.match_type && row.match_id ? (labels.get(`${row.match_type}:${row.match_id}`) ?? null) : null }) });
  });

  router.post("/banking/transactions/:id/unreconcile", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const txn = await loadTxn(deps.db, actor.tenantId, req.params.id);
    if (txn.status === "unmatched") throw new BosError(409, "This line isn't reconciled");
    await exec(
      deps.db,
      `UPDATE bos_bank_txns SET status = 'unmatched', match_type = NULL, match_id = NULL, category = NULL, note = NULL, reconciled_by = NULL, reconciled_at = NULL WHERE id = :id AND tenant_id = :t`,
      { id: txn.id, t: actor.tenantId },
    );
    await recordEvent(deps, actor, { type: "bank.unreconcile", entityType: "bank_txn", entityId: txn.id, summary: `Undid the reconciliation of a ${inr(Math.abs(money(txn.amount)))} statement line`, payload: { accountId: txn.account_id, was: txn.status, matchType: txn.match_type, matchId: txn.match_id }, ip: req.ip });
    res.json({ transaction: mapTxn(await loadTxn(deps.db, actor.tenantId, txn.id)) });
  });

  router.delete("/banking/transactions/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const txn = await loadTxn(deps.db, actor.tenantId, req.params.id);
    const r = await exec(deps.db, `DELETE FROM bos_bank_txns WHERE id = :id AND tenant_id = :t AND status IN ('unmatched','excluded')`, { id: txn.id, t: actor.tenantId });
    if (!r.affectedRows) throw new BosError(409, "Undo the reconciliation before deleting this line");
    await recordEvent(deps, actor, { type: "bank.delete", entityType: "bank_txn", entityId: txn.id, summary: `Deleted a ${inr(Math.abs(money(txn.amount)))} statement line (${txn.description.slice(0, 60)})`, payload: { accountId: txn.account_id }, ip: req.ip });
    res.status(204).end();
  });
}
