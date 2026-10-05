/**
 * Double-entry view of BOS records. The ledger is derived on read: invoices, payments, bills, claims,
 * payroll, categorised bank lines and assets become balanced postings, alongside manual journals and
 * opening balances. Nothing here writes to the source tables.
 */
import { bookValue, depreciationSchedule, type DepreciableAsset } from "./asset-logic.js";
import { addDaysISO, monthEndISO, round2 } from "./logic.js";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Assets and expenses carry a debit balance; liabilities, equity and income a credit balance. */
export const DEBIT_NORMAL: Record<AccountType, boolean> = { asset: true, expense: true, liability: false, equity: false, income: false };

export const SYSTEM_ACCOUNTS = [
  { key: "cash", code: "1000", name: "Cash in hand", type: "asset" },
  { key: "bank", code: "1010", name: "Bank accounts", type: "asset" },
  { key: "transfers", code: "1050", name: "Transfers in transit", type: "asset" },
  { key: "receivables", code: "1100", name: "Accounts receivable", type: "asset" },
  { key: "input_gst", code: "1200", name: "GST input credit", type: "asset" },
  { key: "fixed_assets", code: "1500", name: "Fixed assets", type: "asset" },
  { key: "acc_depreciation", code: "1510", name: "Accumulated depreciation", type: "asset" },
  { key: "payables", code: "2000", name: "Accounts payable", type: "liability" },
  { key: "reimbursements", code: "2100", name: "Employee reimbursements payable", type: "liability" },
  { key: "salaries_payable", code: "2200", name: "Salaries payable", type: "liability" },
  { key: "statutory_payable", code: "2210", name: "PF, ESI, PT and TDS payable", type: "liability" },
  { key: "deductions_payable", code: "2250", name: "Other payroll deductions", type: "liability" },
  { key: "output_gst", code: "2300", name: "GST output tax", type: "liability" },
  { key: "loans", code: "2500", name: "Loans", type: "liability" },
  { key: "suspense", code: "2900", name: "Suspense", type: "liability" },
  { key: "capital", code: "3000", name: "Owner's capital", type: "equity" },
  { key: "drawings", code: "3100", name: "Owner's drawings", type: "equity" },
  { key: "retained_earnings", code: "3200", name: "Retained earnings", type: "equity" },
  { key: "opening_adjustment", code: "3900", name: "Opening balance adjustment", type: "equity" },
  { key: "sales", code: "4000", name: "Sales", type: "income" },
  { key: "interest_income", code: "4100", name: "Interest received", type: "income" },
  { key: "other_income", code: "4200", name: "Other income", type: "income" },
  { key: "disposal_gain", code: "4300", name: "Gain / loss on asset disposal", type: "income" },
  { key: "purchases", code: "5000", name: "Purchases", type: "expense" },
  { key: "employee_expenses", code: "5100", name: "Employee expenses", type: "expense" },
  { key: "salaries", code: "5200", name: "Salaries & wages", type: "expense" },
  { key: "employer_contributions", code: "5210", name: "Employer PF & ESI", type: "expense" },
  { key: "bank_charges", code: "5300", name: "Bank charges", type: "expense" },
  { key: "depreciation", code: "5400", name: "Depreciation", type: "expense" },
  { key: "other_expenses", code: "5900", name: "Other expenses", type: "expense" },
] as const satisfies ReadonlyArray<{ key: string; code: string; name: string; type: AccountType }>;
export type SystemKey = (typeof SYSTEM_ACCOUNTS)[number]["key"];

/** Where a categorised bank line lands; the other side is the bank or cash account it came from. */
export const BANK_CATEGORY_ACCOUNT: Readonly<Record<string, SystemKey>> = {
  "Bank charges": "bank_charges",
  "Interest received": "interest_income",
  "Transfer between accounts": "transfers",
  "Owner's contribution": "capital",
  "Owner's drawings": "drawings",
  "GST payment": "output_gst",
  "TDS / PF / ESI payment": "statutory_payable",
  Loan: "loans",
  "Other income": "other_income",
  "Other expense": "other_expenses",
};

/** Categories match by name, ignoring case and spacing (as in Budgeting). */
export const categoryKey = (name: string | null | undefined) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export const SOURCE_TYPES = ["opening", "journal", "invoice", "payment", "bill", "bill_payment", "expense", "reimbursement", "payroll", "payroll_payment", "bank", "asset", "depreciation", "disposal"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type PostingLine = { accountId: string; debit: number; credit: number };
/** `linkId` is the record to open when it isn't `sourceId` (a payment opens its invoice). */
export type Posting = { date: string; source: SourceType; sourceId: string; linkId?: string; ref: string; memo: string; lines: PostingLine[] };

export type AccountResolver = {
  system: Readonly<Record<SystemKey, string>>;
  /** Expense account per category key, for bills and claims routed away from the default account. */
  byCategory: ReadonlyMap<string, string>;
};

export type LedgerSources = {
  invoices: ReadonlyArray<{ id: string; no: string; date: string; party: string; tax: number; total: number }>;
  payments: ReadonlyArray<{ id: string; invoiceId: string; invoiceNo: string; party: string; date: string; amount: number; cash: boolean }>;
  bills: ReadonlyArray<{ id: string; no: string | null; party: string; date: string; category: string | null; tax: number; total: number; paidOn: string | null; paidCash: boolean }>;
  expenses: ReadonlyArray<{ id: string; claimant: string | null; category: string; date: string; amount: number; reimbursedOn: string | null; paidCash: boolean }>;
  payroll: ReadonlyArray<{ id: string; period: string; label: string; gross: number; employer: number; net: number; statutory: number; other: number; paidOn: string | null; paidCash: boolean }>;
  bankLines: ReadonlyArray<{ id: string; date: string; description: string; amount: number; category: string | null; cash: boolean }>;
  assets: ReadonlyArray<DepreciableAsset & { id: string; tag: string; name: string; billCategory: string | null; billPosted: boolean; disposalAmount: number }>;
};

const dr = (accountId: string, amount: number): PostingLine => ({ accountId, debit: round2(amount), credit: 0 });
const cr = (accountId: string, amount: number): PostingLine => ({ accountId, debit: 0, credit: round2(amount) });
/** A signed amount on the side it belongs: positive debits, negative credits. */
const side = (accountId: string, signed: number): PostingLine => (signed >= 0 ? dr(accountId, signed) : cr(accountId, -signed));

export const lineTotals = (lines: ReadonlyArray<PostingLine>) => ({
  debit: round2(lines.reduce((s, l) => s + l.debit, 0)),
  credit: round2(lines.reduce((s, l) => s + l.credit, 0)),
});

/** Drops empty lines and merges lines on the same account, netting debit against credit. */
function tidy(lines: ReadonlyArray<PostingLine>): PostingLine[] {
  const net = new Map<string, number>();
  for (const l of lines) net.set(l.accountId, round2((net.get(l.accountId) ?? 0) + l.debit - l.credit));
  return [...net].filter(([, v]) => Math.abs(v) >= 0.005).map(([id, v]) => side(id, v));
}

/**
 * Depreciation as postings up to `upTo`: one per financial year (dated its last day, or `upTo` / the disposal
 * date for the year in progress), split at each date in `cuts` so a books-start date falls between postings.
 */
export function depreciationPostings(asset: DepreciableAsset, upTo: string, fyStartMonth: number, cuts: ReadonlyArray<string> = []): Array<{ date: string; amount: number }> {
  const schedule = depreciationSchedule(asset, upTo, fyStartMonth);
  if (!schedule.length) return [];
  const end = asset.disposedOn && asset.disposedOn < upTo ? asset.disposedOn : upTo;
  const dates = new Set(schedule.map((r) => (r.fyEnd < end ? r.fyEnd : end)));
  for (const c of cuts) if (c >= asset.purchaseDate && c < end) dates.add(c);
  const out: Array<{ date: string; amount: number }> = [];
  let prev = asset.cost;
  for (const date of [...dates].sort()) {
    const book = bookValue(asset, date, fyStartMonth);
    const amount = round2(prev - book);
    if (amount > 0) out.push({ date, amount });
    prev = book;
  }
  return out;
}

/** Every source record as balanced postings, up to `upTo`. Date filtering for the books start is the caller's. */
export function buildPostings(src: LedgerSources, acc: AccountResolver, opts: { upTo: string; fyStartMonth: number; cuts?: ReadonlyArray<string> }): Posting[] {
  const s = acc.system;
  const money = (cash: boolean) => (cash ? s.cash : s.bank);
  const spendAccount = (category: string | null, fallback: string) => acc.byCategory.get(categoryKey(category)) ?? fallback;
  const out: Posting[] = [];
  const push = (p: Omit<Posting, "lines"> & { lines: PostingLine[] }) => {
    if (p.date > opts.upTo) return;
    const lines = tidy(p.lines);
    if (lines.length) out.push({ ...p, lines });
  };

  for (const i of src.invoices) {
    push({ date: i.date, source: "invoice", sourceId: i.id, ref: i.no, memo: `Invoice to ${i.party}`, lines: [dr(s.receivables, i.total), cr(s.output_gst, i.tax), cr(s.sales, i.total - i.tax)] });
  }
  for (const p of src.payments) {
    push({ date: p.date, source: "payment", sourceId: p.id, linkId: p.invoiceId, ref: p.invoiceNo, memo: `Payment from ${p.party}`, lines: [dr(money(p.cash), p.amount), cr(s.receivables, p.amount)] });
  }
  for (const b of src.bills) {
    const ref = b.no ?? "Bill";
    push({ date: b.date, source: "bill", sourceId: b.id, ref, memo: `Bill from ${b.party}`, lines: [dr(spendAccount(b.category, s.purchases), b.total - b.tax), dr(s.input_gst, b.tax), cr(s.payables, b.total)] });
    if (b.paidOn) push({ date: b.paidOn, source: "bill_payment", sourceId: b.id, ref, memo: `Paid ${b.party}`, lines: [dr(s.payables, b.total), cr(money(b.paidCash), b.total)] });
  }
  for (const e of src.expenses) {
    const who = e.claimant ?? "an employee";
    push({ date: e.date, source: "expense", sourceId: e.id, ref: e.category, memo: `Expense claim · ${who}`, lines: [dr(spendAccount(e.category, s.employee_expenses), e.amount), cr(s.reimbursements, e.amount)] });
    if (e.reimbursedOn) push({ date: e.reimbursedOn, source: "reimbursement", sourceId: e.id, ref: e.category, memo: `Reimbursed ${who}`, lines: [dr(s.reimbursements, e.amount), cr(money(e.paidCash), e.amount)] });
  }
  for (const r of src.payroll) {
    const residual = round2(r.gross + r.employer - r.net - r.statutory - r.other);
    push({
      date: monthEndISO(r.period),
      source: "payroll",
      sourceId: r.id,
      ref: r.period,
      memo: `Payroll · ${r.label}`,
      lines: [dr(s.salaries, r.gross), dr(s.employer_contributions, r.employer), cr(s.salaries_payable, r.net), cr(s.statutory_payable, r.statutory), side(s.deductions_payable, -(r.other + residual))],
    });
    if (r.paidOn) push({ date: r.paidOn, source: "payroll_payment", sourceId: r.id, ref: r.period, memo: `Salaries paid · ${r.label}`, lines: [dr(s.salaries_payable, r.net), cr(money(r.paidCash), r.net)] });
  }
  for (const l of src.bankLines) {
    const other = BANK_CATEGORY_ACCOUNT[l.category ?? ""] ?? "suspense";
    const cashSide = money(l.cash);
    const lines = l.amount >= 0 ? [dr(cashSide, l.amount), cr(s[other], l.amount)] : [dr(s[other], -l.amount), cr(cashSide, -l.amount)];
    push({ date: l.date, source: "bank", sourceId: l.id, ref: l.category ?? "Bank", memo: l.description, lines });
  }
  for (const a of src.assets) {
    const label = `${a.tag} · ${a.name}`;
    const fundedBy = a.billPosted ? spendAccount(a.billCategory, s.purchases) : s.suspense;
    push({ date: a.purchaseDate, source: "asset", sourceId: a.id, ref: a.tag, memo: `Asset added · ${a.name}`, lines: [dr(s.fixed_assets, a.cost), cr(fundedBy, a.cost)] });
    for (const d of depreciationPostings(a, opts.upTo, opts.fyStartMonth, opts.cuts)) {
      push({ date: d.date, source: "depreciation", sourceId: a.id, ref: a.tag, memo: `Depreciation · ${label}`, lines: [dr(s.depreciation, d.amount), cr(s.acc_depreciation, d.amount)] });
    }
    if (a.disposedOn) {
      const book = bookValue(a, a.disposedOn, opts.fyStartMonth);
      push({
        date: a.disposedOn,
        source: "disposal",
        sourceId: a.id,
        ref: a.tag,
        memo: `Disposed of · ${label}`,
        lines: [dr(s.acc_depreciation, a.cost - book), dr(s.suspense, a.disposalAmount), cr(s.fixed_assets, a.cost), side(s.disposal_gain, book - a.disposalAmount)],
      });
    }
  }
  return out;
}

/** Opening balances as one posting on the books-start date; any difference goes to the adjustment account. */
export function openingPosting(date: string, balances: ReadonlyArray<PostingLine>, adjustmentId: string): { posting: Posting | null; difference: number } {
  const lines = tidy(balances);
  const t = lineTotals(lines);
  const difference = round2(t.debit - t.credit);
  const all = tidy([...lines, side(adjustmentId, -difference)]);
  return { posting: all.length ? { date, source: "opening", sourceId: "opening", ref: "Opening", memo: "Opening balances", lines: all } : null, difference };
}

export type AccountMovement = { opening: number; debit: number; credit: number; closing: number };

/** Per account: net balance before `from` (debit positive), debits and credits in `from`..`to`, and the closing balance. */
export function movements(postings: ReadonlyArray<Posting>, from: string, to: string): Map<string, AccountMovement> {
  const map = new Map<string, AccountMovement>();
  for (const p of postings) {
    if (p.date > to) continue;
    for (const l of p.lines) {
      const m = map.get(l.accountId) ?? { opening: 0, debit: 0, credit: 0, closing: 0 };
      if (p.date < from) m.opening = round2(m.opening + l.debit - l.credit);
      else {
        m.debit = round2(m.debit + l.debit);
        m.credit = round2(m.credit + l.credit);
      }
      m.closing = round2(m.opening + m.debit - m.credit);
      map.set(l.accountId, m);
    }
  }
  return map;
}

/**
 * Suggested opening balances on `booksStart`: what the BOS records add up to the day before.
 * Income and expense balances roll into retained earnings, since a new period starts there.
 */
export function suggestOpening(postings: ReadonlyArray<Posting>, booksStart: string, accounts: ReadonlyArray<{ id: string; type: AccountType }>, retainedId: string): PostingLine[] {
  const before = movements(postings, "0000-01-01", addDaysISO(booksStart, -1));
  const types = new Map(accounts.map((a) => [a.id, a.type]));
  const lines: PostingLine[] = [];
  let profit = 0;
  for (const [id, m] of before) {
    const type = types.get(id);
    if (type === "income" || type === "expense") profit = round2(profit + m.closing);
    else lines.push(side(id, m.closing));
  }
  lines.push(side(retainedId, profit));
  return tidy(lines);
}

export type StatementTotals = { income: number; expense: number; net: number; assets: number; liabilities: number; equity: number; profitToDate: number; difference: number };

/**
 * Profit for the period from the movements, and the balance sheet at the end of it.
 * Profit to date is every income and expense balance so far (BOS doesn't close years), so assets equal
 * liabilities + equity + profit to date whenever every posting balances.
 */
export function statements(moves: ReadonlyMap<string, AccountMovement>, accounts: ReadonlyArray<{ id: string; type: AccountType }>): StatementTotals {
  const t = { income: 0, expense: 0, assets: 0, liabilities: 0, equity: 0, profitToDate: 0 };
  for (const a of accounts) {
    const m = moves.get(a.id);
    if (!m) continue;
    const period = round2(m.debit - m.credit);
    if (a.type === "income") {
      t.income = round2(t.income - period);
      t.profitToDate = round2(t.profitToDate - m.closing);
    } else if (a.type === "expense") {
      t.expense = round2(t.expense + period);
      t.profitToDate = round2(t.profitToDate - m.closing);
    } else if (a.type === "asset") t.assets = round2(t.assets + m.closing);
    else if (a.type === "liability") t.liabilities = round2(t.liabilities - m.closing);
    else t.equity = round2(t.equity - m.closing);
  }
  return { ...t, net: round2(t.income - t.expense), difference: round2(t.assets - t.liabilities - t.equity - t.profitToDate) };
}

export type JournalLineInput = { accountId: string; debit: number; credit: number };

/** A manual journal must have two or more lines, each a debit or a credit, adding up on both sides. */
export function journalProblem(lines: ReadonlyArray<JournalLineInput>): string | null {
  const used = lines.filter((l) => l.debit > 0 || l.credit > 0);
  if (used.length < 2) return "Add at least two lines";
  if (used.some((l) => l.debit > 0 && l.credit > 0)) return "Each line is either a debit or a credit";
  if (lines.some((l) => l.debit < 0 || l.credit < 0)) return "Amounts can't be negative";
  const t = lineTotals(used);
  if (Math.abs(t.debit - t.credit) >= 0.005) return `Debits (${t.debit.toFixed(2)}) and credits (${t.credit.toFixed(2)}) must be equal`;
  return null;
}
