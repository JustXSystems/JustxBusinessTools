/**
 * Pure presentation rules for the BOS app. Money math mirrors
 * `server/src/bos/logic.ts` so the invoice preview matches what the API stores.
 */
import type { BosBadgeTone } from "@/components/bos";
import type {
  AttendanceStatus,
  BillStatus,
  BosLineInput,
  EmployeeStatus,
  EmploymentType,
  ExpenseStatus,
  InvoiceDisplayStatus,
  LeaveStatus,
  LeaveType,
  ProjectStatus,
} from "./api";

/* ---------- Money ---------- */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** `₹1,57,000` (Indian grouping, whole rupees). */
export function inr(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
}

/** `₹1,57,000.50` — printed documents keep paise. */
export function inrExact(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Dashboard figures: `₹1.94Cr`, `₹73.4L`, `₹42.5K`, `₹950`. */
export function inrCompact(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  const fmt = (v: number, unit: string) => `${sign}₹${(Math.round(v * 100) / 100).toString().replace(/(\.\d)0$/, "$1")}${unit}`;
  if (a >= 1e7) return fmt(a / 1e7, "Cr");
  if (a >= 1e5) return fmt(Math.round((a / 1e5) * 10) / 10, "L");
  if (a >= 1e3) return fmt(Math.round((a / 1e3) * 10) / 10, "K");
  return `${sign}₹${Math.round(a)}`;
}

export type GstLine = BosLineInput & { gross: number; discount: number; taxable: number; tax: number; amount: number };
export type GstTotals = { lines: GstLine[]; subtotal: number; discountTotal: number; taxTotal: number; cgst: number; sgst: number; igst: number; grandTotal: number };

export function isIntraState(sellerState?: string | null, placeOfSupply?: string | null): boolean {
  const a = String(sellerState ?? "").trim().toLowerCase();
  const b = String(placeOfSupply ?? "").trim().toLowerCase();
  return !a || !b || a === b;
}

export function computeGstTotals(input: ReadonlyArray<BosLineInput>, intraState: boolean): GstTotals {
  const lines = input.map<GstLine>((l) => {
    const quantity = Math.max(0, num(l.quantity));
    const rate = num(l.rate);
    const discountPct = clamp(num(l.discountPct), 0, 100);
    const taxRate = clamp(num(l.taxRate), 0, 100);
    const gross = round2(quantity * rate);
    const discount = round2((gross * discountPct) / 100);
    const taxable = round2(gross - discount);
    const tax = round2((taxable * taxRate) / 100);
    return { ...l, quantity, rate, discountPct, taxRate, gross, discount, taxable, tax, amount: round2(taxable + tax) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.gross, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discount, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.tax, 0));
  const cgst = intraState ? round2(taxTotal / 2) : 0;
  const sgst = intraState ? round2(taxTotal - cgst) : 0;
  return { lines, subtotal, discountTotal, taxTotal, cgst, sgst, igst: intraState ? 0 : taxTotal, grandTotal: round2(subtotal - discountTotal + taxTotal) };
}

/* ---------- Dates ---------- */

/** Local `YYYY-MM-DD`. */
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** `2026-08-14` → `14 Aug 2026`. */
export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** `14 Aug` */
export function dayMonth(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function dateRange(from: string, to: string): string {
  return from === to ? dayMonth(from) : `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** Server timestamps (`YYYY-MM-DD HH:MM:SS`, UTC-less) → "5m ago" / "2h ago" / "3d ago" / date. */
export function timeAgo(stamp: string | null | undefined, now: Date = new Date()): string {
  if (!stamp) return "";
  const t = Date.parse(String(stamp).replace(" ", "T"));
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return dayMonth(String(stamp).slice(0, 10));
}

export function greetingFor(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/* ---------- People ---------- */

export function initialsOf(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}

const AVATAR_TONES = [
  "var(--bos-blue)",
  "var(--bos-coral)",
  "var(--bos-amber)",
  "var(--bos-emerald)",
  "var(--bos-pastel-lavender-ink)",
  "var(--bos-pastel-blue-ink)",
  "var(--bos-pastel-sage-ink)",
  "var(--bos-pastel-rose-ink)",
] as const;

/** Stable avatar tone per person/company. */
export function toneFor(seed: string | null | undefined): string {
  let h = 0;
  for (const ch of String(seed ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/* ---------- Status vocabulary (badge text + tone) ---------- */

export type BadgeView = { text: string; tone: BosBadgeTone };

const INVOICE_BADGE: Record<InvoiceDisplayStatus, BadgeView> = {
  draft: { text: "DRAFT", tone: "neutral" },
  sent: { text: "SENT", tone: "blue" },
  partial: { text: "PARTIAL", tone: "amber" },
  paid: { text: "PAID", tone: "emerald" },
  overdue: { text: "OVERDUE", tone: "coral" },
  void: { text: "VOID", tone: "neutral" },
};
export const invoiceBadge = (s: InvoiceDisplayStatus): BadgeView => INVOICE_BADGE[s] ?? INVOICE_BADGE.draft;

const BILL_BADGE: Record<BillStatus, BadgeView> = {
  pending: { text: "PENDING", tone: "amber" },
  approved: { text: "APPROVED", tone: "blue" },
  rejected: { text: "REJECTED", tone: "coral" },
  paid: { text: "PAID", tone: "emerald" },
};
export const billBadge = (s: BillStatus, overdue = false): BadgeView => (overdue && s !== "paid" && s !== "rejected" ? { text: "OVERDUE", tone: "coral" } : (BILL_BADGE[s] ?? BILL_BADGE.pending));

const EXPENSE_BADGE: Record<ExpenseStatus, BadgeView> = {
  submitted: { text: "PENDING", tone: "amber" },
  approved: { text: "APPROVED", tone: "blue" },
  rejected: { text: "REJECTED", tone: "coral" },
  reimbursed: { text: "REIMBURSED", tone: "emerald" },
};
export const expenseBadge = (s: ExpenseStatus): BadgeView => EXPENSE_BADGE[s] ?? EXPENSE_BADGE.submitted;

const LEAVE_BADGE: Record<LeaveStatus, BadgeView> = {
  pending: { text: "PENDING", tone: "amber" },
  approved: { text: "APPROVED", tone: "emerald" },
  rejected: { text: "REJECTED", tone: "coral" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};
export const leaveBadge = (s: LeaveStatus): BadgeView => LEAVE_BADGE[s] ?? LEAVE_BADGE.pending;

const EMPLOYEE_BADGE: Record<EmployeeStatus, BadgeView> = {
  active: { text: "ACTIVE", tone: "emerald" },
  probation: { text: "PROBATION", tone: "blue" },
  notice: { text: "ON NOTICE", tone: "amber" },
  exited: { text: "EXITED", tone: "neutral" },
};
export const employeeBadge = (s: EmployeeStatus): BadgeView => EMPLOYEE_BADGE[s] ?? EMPLOYEE_BADGE.active;

const ATTENDANCE_BADGE: Record<AttendanceStatus, BadgeView> = {
  present: { text: "PRESENT", tone: "emerald" },
  absent: { text: "ABSENT", tone: "coral" },
  half_day: { text: "HALF DAY", tone: "amber" },
  wfh: { text: "WFH", tone: "blue" },
  leave: { text: "ON LEAVE", tone: "lavender" },
  holiday: { text: "HOLIDAY", tone: "neutral" },
};
export const attendanceBadge = (s: AttendanceStatus | null): BadgeView => (s ? ATTENDANCE_BADGE[s] : { text: "UNMARKED", tone: "neutral" });

export const PROJECT_STAGES: ReadonlyArray<{ key: ProjectStatus; label: string; dot: string }> = [
  { key: "lead", label: "Lead", dot: "var(--bos-text-faint)" },
  { key: "planned", label: "Planned", dot: "var(--bos-pastel-lavender-ink)" },
  { key: "active", label: "Active", dot: "var(--bos-blue)" },
  { key: "on_hold", label: "On Hold", dot: "var(--bos-amber)" },
  { key: "completed", label: "Completed", dot: "var(--bos-emerald)" },
];

export const LEAVE_LABEL: Record<LeaveType, string> = { casual: "Casual Leave", sick: "Sick Leave", earned: "Earned Leave", lop: "Loss of Pay (LOP)" };
export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", intern: "Intern" };

export function sourceLabel(tool: string | null | undefined): string | null {
  if (!tool) return null;
  if (tool === "quotationv1") return "QUOTATION";
  if (tool === "sitesurveyv1") return "SITE SURVEY";
  return tool.toUpperCase();
}
