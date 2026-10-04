/**
 * Pure BOS business rules (no I/O). Everything money- or date-related that the
 * API persists goes through here so it is unit-tested and identical everywhere.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Finite number or fallback (blank / NaN → fallback). */
export function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/* ---------- Invoices ---------- */

export type BosLineInput = {
  description: string;
  hsn?: string | null;
  unit?: string | null;
  quantity: number;
  /** Negative rates are allowed (buy-back / credit lines). */
  rate: number;
  discountPct?: number;
  taxRate: number;
};

export type BosLine = BosLineInput & {
  gross: number;
  discount: number;
  taxable: number;
  tax: number;
  amount: number;
};

export type BosInvoiceTotals = {
  lines: BosLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
};

/** GST invoice totals. Intra-state tax splits evenly into CGST + SGST, inter-state is IGST. */
export function computeInvoiceTotals(input: ReadonlyArray<BosLineInput>, intraState: boolean): BosInvoiceTotals {
  const lines = input.map<BosLine>((l) => {
    const quantity = Math.max(0, num(l.quantity));
    const rate = num(l.rate);
    const discountPct = clamp(num(l.discountPct), 0, 100);
    const taxRate = clamp(num(l.taxRate), 0, 100);
    const gross = round2(quantity * rate);
    const discount = round2((gross * discountPct) / 100);
    const taxable = round2(gross - discount);
    const tax = round2((taxable * taxRate) / 100);
    return {
      description: String(l.description ?? "").trim(),
      hsn: l.hsn ? String(l.hsn) : null,
      unit: l.unit ? String(l.unit) : null,
      quantity,
      rate,
      discountPct,
      taxRate,
      gross,
      discount,
      taxable,
      tax,
      amount: round2(taxable + tax),
    };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.gross, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discount, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.tax, 0));
  const cgst = intraState ? round2(taxTotal / 2) : 0;
  const sgst = intraState ? round2(taxTotal - cgst) : 0;
  const igst = intraState ? 0 : taxTotal;
  return { lines, subtotal, discountTotal, taxTotal, cgst, sgst, igst, grandTotal: round2(subtotal - discountTotal + taxTotal) };
}

export const INVOICE_STATUSES = ["draft", "sent", "partial", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceDisplayStatus = InvoiceStatus | "overdue";

/** Stored status after a payment change. Drafts stay drafts until issued; void is terminal. */
export function settleStatus(current: InvoiceStatus, grandTotal: number, amountPaid: number): InvoiceStatus {
  if (current === "void") return "void";
  if (grandTotal > 0 && amountPaid >= grandTotal - 0.005) return "paid";
  if (amountPaid > 0) return "partial";
  return current === "draft" ? "draft" : "sent";
}

export function outstanding(inv: { grandTotal: number; amountPaid: number; status: string }): number {
  if (inv.status === "void" || inv.status === "draft") return 0;
  return Math.max(0, round2(inv.grandTotal - inv.amountPaid));
}

/** What the user sees: open invoices past their due date read as overdue. */
export function displayStatus(
  inv: { status: string; dueDate: string; grandTotal: number; amountPaid: number },
  today: string,
): InvoiceDisplayStatus {
  const status = (INVOICE_STATUSES as readonly string[]).includes(inv.status) ? (inv.status as InvoiceStatus) : "draft";
  if ((status === "sent" || status === "partial") && inv.dueDate < today && outstanding(inv) > 0) return "overdue";
  return status;
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

/** Indian GST: same state (or unknown) → CGST + SGST. Compares names or 2-digit codes, case-insensitively. */
export function isIntraState(sellerState?: string | null, placeOfSupply?: string | null): boolean {
  const a = String(sellerState ?? "").trim().toLowerCase();
  const b = String(placeOfSupply ?? "").trim().toLowerCase();
  if (!a || !b) return true;
  return a === b;
}

/* ---------- Dates (ISO `YYYY-MM-DD`, timezone-safe) ---------- */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

const toUTC = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDaysISO(iso: string, days: number): string {
  return fromUTC(toUTC(iso) + days * 86_400_000);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / 86_400_000);
}

/** Today in the business timezone (default India), not the server's. */
export function todayISO(now: Date = new Date(), timeZone = process.env.BOS_TIMEZONE || "Asia/Kolkata"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function weekdayOf(iso: string): number {
  return new Date(toUTC(iso)).getUTCDay();
}

export function eachDate(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  for (let t = toUTC(fromISO), end = toUTC(toISO); t <= end && out.length < 400; t += 86_400_000) out.push(fromUTC(t));
  return out;
}

/** `26-27` for the fiscal year containing `iso` (April start by default). */
export function fiscalYearLabel(iso: string, startMonth = 4): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= startMonth ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return startMonth === 1 ? String(start) : `${two(start)}-${two(start + 1)}`;
}

export function formatDocNo(prefix: string, period: string, seq: number, pad = 4): string {
  const p = String(prefix || "DOC").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12) || "DOC";
  return `${p}/${period}/${String(seq).padStart(pad, "0")}`;
}

/* ---------- HR ---------- */

export const LEAVE_TYPES = ["casual", "sick", "earned", "lop"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export type LeavePolicy = Record<LeaveType, number>;

/** Annual allowance in days. LOP (loss of pay) is unlimited and tracked only. */
export const DEFAULT_LEAVE_POLICY: LeavePolicy = { casual: 12, sick: 12, earned: 15, lop: 0 };

export function normalizeLeavePolicy(raw: unknown): LeavePolicy {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LEAVE_POLICY };
  for (const t of LEAVE_TYPES) {
    const v = num(src[t], NaN);
    if (Number.isFinite(v) && v >= 0) out[t] = Math.min(366, v);
  }
  return out;
}

/** Working days in a leave span, skipping weekend days and holidays. A half day counts 0.5. */
export function countLeaveDays(
  fromISO: string,
  toISO: string,
  opts: { halfDay?: boolean; weekendDays?: ReadonlyArray<number>; holidays?: ReadonlySet<string> } = {},
): number {
  if (!isISODate(fromISO) || !isISODate(toISO) || toISO < fromISO) return 0;
  const weekend = new Set(opts.weekendDays ?? [0]);
  const days = eachDate(fromISO, toISO).filter((d) => !weekend.has(weekdayOf(d)) && !opts.holidays?.has(d)).length;
  if (opts.halfDay) return days > 0 ? 0.5 : 0;
  return days;
}

export function parseWeekendDays(raw: unknown): number[] {
  const list = String(raw ?? "0")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return list.length ? [...new Set(list)] : [0];
}

export type LeaveBalance = { type: LeaveType; allowed: number; used: number; remaining: number };

export function leaveBalances(policy: LeavePolicy, used: Partial<Record<string, number>>): LeaveBalance[] {
  return LEAVE_TYPES.map((type) => {
    const u = round2(num(used[type]));
    const allowed = policy[type];
    return { type, allowed, used: u, remaining: type === "lop" ? 0 : Math.max(0, round2(allowed - u)) };
  });
}

/* ---------- Display helpers ---------- */

export function maskAccount(acct: unknown): string {
  const digits = String(acct ?? "").replace(/\s+/g, "");
  if (!digits) return "";
  return `•••• •••• ${digits.slice(-4)}`;
}

export function initialsOf(name: string): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}

export function phoneKey(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}
