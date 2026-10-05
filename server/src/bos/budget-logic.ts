/**
 * Budgeting rules: financial-year months, budget to date, budget vs actual and
 * how recorded spend is attributed to budget heads. Pure, so it is unit-tested.
 */
import { monthEndISO, monthsBetween, round2 } from "./logic.js";

export const BUDGET_BASES = ["category", "department"] as const;
export type BudgetBasis = (typeof BUDGET_BASES)[number];

export type HeadKind = "category" | "payroll" | "department" | "company";

/** Head kinds each basis accepts. Category budgets split spend by what it was for, department budgets by who spent it. */
export const HEAD_KINDS: Record<BudgetBasis, ReadonlyArray<HeadKind>> = {
  category: ["category", "payroll"],
  department: ["department", "company"],
};

export const PAYROLL_LABEL = "Payroll (employer cost)";
export const COMPANY_LABEL = "Company-wide";
export const UNCATEGORISED = "Uncategorised";

/** Bills and claims match a category head by name, ignoring case and spacing. Blank categories share one head. */
export function headKey(name: string | null | undefined): string {
  const key = String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return key || UNCATEGORISED.toLowerCase();
}

export const headId = (kind: HeadKind, key: string): string => `${kind}:${key}`;

/** The twelve `YYYY-MM` months of the financial year starting on `fyStart`. */
export function fyMonths(fyStart: string): string[] {
  const [y, m] = fyStart.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + 11, 1)).toISOString().slice(0, 10);
  return monthsBetween(fyStart, last);
}

export function fyEnd(fyStart: string): string {
  return monthEndISO(fyMonths(fyStart)[11]);
}

/** Stored month arrays are always twelve non-negative amounts. */
export function normaliseMonths(raw: unknown): number[] {
  const list = typeof raw === "string" ? safeJson(raw) : raw;
  const arr = Array.isArray(list) ? list : [];
  return Array.from({ length: 12 }, (_, i) => {
    const n = Number(arr[i]);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const sumMonths = (months: ReadonlyArray<number>): number => round2(months.reduce((s, v) => s + v, 0));

/** Budget for the months already behind us, with the current month counted by the days gone. */
export function budgetToDate(months: ReadonlyArray<number>, fyStart: string, today: string): number {
  const list = fyMonths(fyStart);
  const current = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const daysInMonth = Number(monthEndISO(current).slice(8, 10));
  let total = 0;
  list.forEach((ym, i) => {
    if (ym < current) total += months[i] ?? 0;
    else if (ym === current) total += ((months[i] ?? 0) * day) / daysInMonth;
  });
  return round2(total);
}

export type BudgetStatus = "ok" | "watch" | "over";

export type HeadFigures = {
  annual: number;
  toDate: number;
  actual: number;
  remaining: number;
  /** Share of the annual budget spent; null when nothing was budgeted. */
  usedPct: number | null;
  /** Spent so far plus the plan for the rest of the year. */
  projected: number;
  status: BudgetStatus;
};

/**
 * - over: spending has passed the annual budget (or there was no budget);
 * - watch: spending runs ahead of plan, so the year is projected to end more than 5% over, or 90% is already used;
 * - ok: otherwise.
 */
export function evaluateHead(budget: ReadonlyArray<number>, actual: ReadonlyArray<number>, fyStart: string, today: string): HeadFigures {
  const annual = sumMonths(budget);
  const spent = sumMonths(actual);
  const toDate = budgetToDate(budget, fyStart, today);
  const projected = round2(spent + Math.max(0, annual - toDate));
  const status: BudgetStatus = spent > annual + 0.5 ? "over" : projected > annual * 1.05 + 0.5 || (annual > 0 && spent >= annual * 0.9) ? "watch" : "ok";
  return {
    annual,
    toDate,
    actual: spent,
    remaining: round2(annual - spent),
    usedPct: annual > 0 ? Math.round((spent / annual) * 100) : null,
    projected,
    status,
  };
}

/** Last year's monthly pattern scaled by an uplift percentage, in whole rupees. */
export function seedMonths(months: ReadonlyArray<number>, upliftPct: number): number[] {
  const factor = 1 + upliftPct / 100;
  return Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round((months[i] ?? 0) * factor)));
}

/* ---------- Attributing spend ---------- */

export type ActualHead = { kind: HeadKind; key: string; label: string; months: number[] };

/** Spend per head and month for one financial year. */
export class ActualsBook {
  readonly heads = new Map<string, ActualHead>();
  private readonly index: Map<string, number>;

  constructor(readonly fyStart: string) {
    this.index = new Map(fyMonths(fyStart).map((ym, i) => [ym, i]));
  }

  add(kind: HeadKind, key: string, label: string, ym: string, amount: number): void {
    const i = this.index.get(ym);
    if (i === undefined || !amount) return;
    const id = headId(kind, key);
    const head = this.heads.get(id) ?? { kind, key, label, months: Array.from({ length: 12 }, () => 0) };
    head.months[i] = round2(head.months[i] + amount);
    this.heads.set(id, head);
  }

  months(kind: HeadKind, key: string): number[] {
    return this.heads.get(headId(kind, key))?.months ?? Array.from({ length: 12 }, () => 0);
  }

  get total(): number {
    return round2([...this.heads.values()].reduce((s, h) => s + sumMonths(h.months), 0));
  }
}

export type SpendRow = { ym: string; amount: number };

/**
 * Category basis: bills and claims by their category (the same name in both shares a head), payroll on its own head.
 * Department basis: claims by the claimant's department, payslips by the department they were calculated with;
 * vendor bills and anything without a known department are company-wide.
 */
export function attributeSpend(
  basis: BudgetBasis,
  fyStart: string,
  spend: {
    bills: ReadonlyArray<SpendRow & { category: string | null }>;
    expenses: ReadonlyArray<SpendRow & { category: string; departmentId: string | null }>;
    payroll: ReadonlyArray<SpendRow & { departmentName: string | null }>;
  },
  departments: ReadonlyArray<{ id: string; name: string }>,
): ActualsBook {
  const book = new ActualsBook(fyStart);
  if (basis === "category") {
    const labelOf = (c: string | null) => String(c ?? "").trim().replace(/\s+/g, " ") || UNCATEGORISED;
    for (const b of spend.bills) book.add("category", headKey(b.category), labelOf(b.category), b.ym, b.amount);
    for (const e of spend.expenses) book.add("category", headKey(e.category), labelOf(e.category), e.ym, e.amount);
    for (const p of spend.payroll) book.add("payroll", "", PAYROLL_LABEL, p.ym, p.amount);
    return book;
  }
  const byId = new Map(departments.map((d) => [d.id, d.name]));
  const byName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const toDepartment = (id: string | null | undefined, ym: string, amount: number) => {
    const name = id ? byId.get(id) : undefined;
    if (id && name) book.add("department", id, name, ym, amount);
    else book.add("company", "", COMPANY_LABEL, ym, amount);
  };
  for (const b of spend.bills) book.add("company", "", COMPANY_LABEL, b.ym, b.amount);
  for (const e of spend.expenses) toDepartment(e.departmentId, e.ym, e.amount);
  for (const p of spend.payroll) toDepartment(p.departmentName ? byName.get(p.departmentName.trim().toLowerCase()) : null, p.ym, p.amount);
  return book;
}
