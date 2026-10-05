/**
 * Pure presentation rules for the BOS app. Money math mirrors
 * `server/src/bos/logic.ts` so the invoice preview matches what the API stores.
 */
import type { BosBadgeTone } from "@/components/bos";
import type {
  AccountType,
  AssetStatus,
  AttendanceStatus,
  BankTxnStatus,
  BillStatus,
  BosLineInput,
  BudgetStatus,
  CandidateStage,
  CertificateStatus,
  EnrollmentStatus,
  KraStatus,
  PipStatus,
  ProgramTeam,
  PromotionStatus,
  DepreciationMethod,
  EmployeeStatus,
  EmploymentType,
  ExpenseStatus,
  HiringPriority,
  InvoiceDisplayStatus,
  LeaveStatus,
  LeaveType,
  OnboardingState,
  OnboardingTask,
  OpeningStatus,
  PayrollRunStatus,
  ProjectStatus,
  TravelMode,
  TripPhase,
  CertificateKind,
  ServiceStatus,
  AgreementState,
  AgreementType,
  ChallanReason,
  PosMethod,
  SalesKind,
  SalesStage,
  ComplianceArea,
  ComplianceState,
  PolicyCategory,
  PolicyStatus,
  Recurrence,
  ServiceType,
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

export type ReportPreset = "month" | "lastMonth" | "quarter" | "fy";

/** Report period up to `today`. Quarters follow the financial year (April start → Apr–Jun, Jul–Sep, …). */
export function reportRange(preset: ReportPreset, today: string, fyStartMonth = 4): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const first = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  if (preset === "lastMonth") return { from: first(y, m - 1), to: addDaysISO(first(y, m), -1) };
  if (preset === "month") return { from: first(y, m), to: today };
  const monthsIntoFy = (m - fyStartMonth + 12) % 12;
  const back = preset === "quarter" ? monthsIntoFy % 3 : monthsIntoFy;
  return { from: first(y, m - back), to: today };
}

/** Month to run payroll for: last month, until the 25th of this one (when this month's run usually starts). */
export function defaultPayrollPeriod(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  if (d >= 25) return today.slice(0, 7);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/** `2026-08` → `Aug 2026`. */
export function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
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

const PAYROLL_BADGE: Record<PayrollRunStatus, BadgeView> = {
  draft: { text: "DRAFT", tone: "amber" },
  finalized: { text: "FINALISED", tone: "blue" },
  paid: { text: "PAID", tone: "emerald" },
};
export const payrollBadge = (s: PayrollRunStatus): BadgeView => PAYROLL_BADGE[s] ?? PAYROLL_BADGE.draft;

const BANK_TXN_BADGE: Record<BankTxnStatus, BadgeView> = {
  unmatched: { text: "UNMATCHED", tone: "coral" },
  matched: { text: "MATCHED", tone: "emerald" },
  categorized: { text: "CATEGORISED", tone: "blue" },
  excluded: { text: "EXCLUDED", tone: "neutral" },
};
export const bankTxnBadge = (s: BankTxnStatus): BadgeView => BANK_TXN_BADGE[s] ?? BANK_TXN_BADGE.unmatched;

const BUDGET_BADGE: Record<BudgetStatus, BadgeView> = {
  ok: { text: "ON TRACK", tone: "emerald" },
  watch: { text: "WATCH", tone: "amber" },
  over: { text: "OVER BUDGET", tone: "coral" },
};
export const budgetBadge = (s: BudgetStatus): BadgeView => BUDGET_BADGE[s] ?? BUDGET_BADGE.ok;

const ASSET_BADGE: Record<AssetStatus, BadgeView> = {
  in_use: { text: "IN USE", tone: "emerald" },
  maintenance: { text: "MAINTENANCE", tone: "amber" },
  disposed: { text: "DISPOSED", tone: "neutral" },
};
export const assetBadge = (s: AssetStatus): BadgeView => ASSET_BADGE[s] ?? ASSET_BADGE.in_use;

const ACCOUNT_TYPE_BADGE: Record<AccountType, BadgeView> = {
  asset: { text: "ASSET", tone: "blue" },
  liability: { text: "LIABILITY", tone: "amber" },
  equity: { text: "EQUITY", tone: "lavender" },
  income: { text: "INCOME", tone: "emerald" },
  expense: { text: "EXPENSE", tone: "coral" },
};
export const accountTypeBadge = (t: AccountType): BadgeView => ACCOUNT_TYPE_BADGE[t] ?? ACCOUNT_TYPE_BADGE.asset;

const OPENING_BADGE: Record<OpeningStatus, BadgeView> = {
  draft: { text: "DRAFT", tone: "amber" },
  open: { text: "PUBLISHED", tone: "emerald" },
  on_hold: { text: "ON HOLD", tone: "neutral" },
  closed: { text: "CLOSED", tone: "neutral" },
};
export const openingBadge = (s: OpeningStatus): BadgeView => OPENING_BADGE[s] ?? OPENING_BADGE.draft;

const PRIORITY_BADGE: Record<HiringPriority, BadgeView> = {
  high: { text: "HIGH", tone: "coral" },
  medium: { text: "MEDIUM", tone: "amber" },
  low: { text: "LOW", tone: "blue" },
};
export const priorityBadge = (p: HiringPriority): BadgeView => PRIORITY_BADGE[p] ?? PRIORITY_BADGE.medium;

export const STAGE_LABEL: Record<CandidateStage, string> = {
  applied: "Applied",
  interview: "Interview",
  shortlisted: "Shortlisted",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
const STAGE_BADGE: Record<CandidateStage, BadgeView> = {
  applied: { text: "REVIEW", tone: "blue" },
  interview: { text: "INTERVIEW", tone: "amber" },
  shortlisted: { text: "SHORTLISTED", tone: "emerald" },
  offer: { text: "OFFER", tone: "lavender" },
  hired: { text: "HIRED", tone: "emerald" },
  rejected: { text: "REJECTED", tone: "neutral" },
  withdrawn: { text: "WITHDRAWN", tone: "neutral" },
};
export const stageBadge = (s: CandidateStage): BadgeView => STAGE_BADGE[s] ?? STAGE_BADGE.applied;

const ONBOARDING_BADGE: Record<OnboardingState, BadgeView> = {
  not_started: { text: "NOT STARTED", tone: "neutral" },
  on_track: { text: "ON TRACK", tone: "blue" },
  delayed: { text: "DELAYED", tone: "coral" },
  completed: { text: "COMPLETED", tone: "emerald" },
};
export const onboardingBadge = (s: OnboardingState): BadgeView => ONBOARDING_BADGE[s] ?? ONBOARDING_BADGE.not_started;

export const ONBOARDING_TASK_LABEL: Record<OnboardingTask, string> = { documents: "Documents", kyc: "KYC", it: "IT setup", induction: "Induction", kra: "KRA update" };
const TASK_DONE: Record<OnboardingTask, string> = { documents: "SUBMITTED", kyc: "VERIFIED", it: "DONE", induction: "COMPLETED", kra: "UPDATED" };
/** "SUBMITTED", "PENDING", or for an induction "SCHEDULED — 11 Aug" / "NOT SCHEDULED". */
export function taskBadge(task: OnboardingTask, state: { done: boolean; date: string | null } | undefined): BadgeView {
  if (state?.done) return { text: TASK_DONE[task], tone: "emerald" };
  if (task === "induction") return state?.date ? { text: `SCHEDULED — ${dayMonth(state.date)}`, tone: "blue" } : { text: "NOT SCHEDULED", tone: "amber" };
  return { text: "PENDING", tone: "amber" };
}

export const TEAM_LABEL: Record<ProgramTeam, string> = { all: "Everyone", management: "Management Team", technical: "Technical Team", operations: "Operation Team" };

/** "3 Days", "1 Day", "½ Day", "Ongoing". */
export function durationLabel(days: number | null): string {
  if (days === null) return "Ongoing";
  const whole = Math.floor(days);
  const text = days - whole ? (whole ? `${whole}½` : "½") : String(whole);
  return `${text} ${days > 1 ? "Days" : "Day"}`;
}

const ENROLLMENT_BADGE: Record<EnrollmentStatus, BadgeView> = {
  enrolled: { text: "ENROLLED", tone: "blue" },
  completed: { text: "COMPLETED", tone: "emerald" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};
export const enrollmentBadge = (s: EnrollmentStatus): BadgeView => ENROLLMENT_BADGE[s] ?? ENROLLMENT_BADGE.enrolled;

const CERTIFICATE_BADGE: Record<CertificateStatus, BadgeView> = {
  valid: { text: "VALID", tone: "emerald" },
  expiring: { text: "EXPIRING SOON", tone: "amber" },
  expired: { text: "EXPIRED", tone: "coral" },
};
export const certificateBadge = (s: CertificateStatus): BadgeView => CERTIFICATE_BADGE[s] ?? CERTIFICATE_BADGE.valid;

export const KRA_LABEL: Record<KraStatus, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track", achieved: "Achieved", missed: "Missed" };
const KRA_BADGE: Record<KraStatus, BadgeView> = {
  on_track: { text: "ON TRACK", tone: "emerald" },
  at_risk: { text: "AT RISK", tone: "amber" },
  off_track: { text: "OFF TRACK", tone: "coral" },
  achieved: { text: "ACHIEVED", tone: "emerald" },
  missed: { text: "MISSED", tone: "neutral" },
};
export const kraBadge = (s: KraStatus): BadgeView => KRA_BADGE[s] ?? KRA_BADGE.on_track;

const PROMOTION_BADGE: Record<PromotionStatus, BadgeView> = {
  pending: { text: "PENDING SIGN-OFF", tone: "amber" },
  approved: { text: "APPROVED", tone: "emerald" },
  rejected: { text: "NOT APPROVED", tone: "neutral" },
};
export const promotionBadge = (s: PromotionStatus): BadgeView => PROMOTION_BADGE[s] ?? PROMOTION_BADGE.pending;

const PIP_BADGE: Record<PipStatus, BadgeView> = {
  active: { text: "ON PIP", tone: "coral" },
  passed: { text: "COMPLETED", tone: "emerald" },
  failed: { text: "NOT MET", tone: "neutral" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};
export const pipBadge = (s: PipStatus): BadgeView => PIP_BADGE[s] ?? PIP_BADGE.active;

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = { flight: "Flight", train: "Train", bus: "Bus", car: "Car / cab", other: "Other" };
const TRIP_BADGE: Record<TripPhase, BadgeView> = {
  pending: { text: "PENDING APPROVAL", tone: "amber" },
  upcoming: { text: "APPROVED", tone: "blue" },
  on_trip: { text: "ON TRIP", tone: "lavender" },
  completed: { text: "COMPLETED", tone: "emerald" },
  rejected: { text: "NOT APPROVED", tone: "neutral" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};
export const tripBadge = (p: TripPhase): BadgeView => TRIP_BADGE[p] ?? TRIP_BADGE.pending;

/** The holder's state first (a return is what needs doing), then the asset's own. */
export function heldAssetBadge(a: { employeeId: string | null; status: AssetStatus; returnState: "overdue" | "due" | null }): BadgeView {
  if (a.returnState === "overdue") return { text: "OVERDUE RETURN", tone: "coral" };
  if (a.returnState === "due") return { text: "RETURN DUE", tone: "amber" };
  if (a.status === "maintenance") return { text: "IN MAINTENANCE", tone: "amber" };
  return a.employeeId ? { text: "ACTIVE", tone: "emerald" } : { text: "IN STORE", tone: "neutral" };
}

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = { helpdesk: "Helpdesk", certificate: "Certificate", id_card: "ID card", kit: "Kit request", other: "Other" };
export const CERTIFICATE_KIND_LABEL: Record<CertificateKind, string> = { employment: "Employment certificate", experience: "Experience letter", salary: "Salary certificate" };
const SERVICE_BADGE: Record<ServiceStatus, BadgeView> = {
  open: { text: "UNASSIGNED", tone: "coral" },
  in_progress: { text: "IN PROGRESS", tone: "amber" },
  resolved: { text: "RESOLVED", tone: "emerald" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};
export const serviceBadge = (s: ServiceStatus): BadgeView => SERVICE_BADGE[s] ?? SERVICE_BADGE.open;

/** "1.4d", "6h" under a day, "—" when there's nothing to average. */
export function resolutionLabel(days: number | null): string {
  if (days === null) return "—";
  return days < 1 ? `${Math.max(1, Math.round(days * 24))}h` : `${Math.round(days * 10) / 10}d`;
}

export const POLICY_CATEGORY_LABEL: Record<PolicyCategory, string> = { hr: "HR", compliance: "Compliance", finance: "Finance", it: "IT", safety: "Safety", other: "Other" };
const POLICY_BADGE: Record<PolicyStatus, BadgeView> = {
  draft: { text: "DRAFT", tone: "neutral" },
  published: { text: "PUBLISHED", tone: "emerald" },
  archived: { text: "ARCHIVED", tone: "neutral" },
};
export const policyBadge = (s: PolicyStatus): BadgeView => POLICY_BADGE[s] ?? POLICY_BADGE.draft;

export const COMPLIANCE_AREA_LABEL: Record<ComplianceArea, string> = {
  pf: "PF",
  esi: "ESI",
  pt: "Professional tax",
  tds: "TDS",
  lwf: "Labour welfare",
  posh: "POSH",
  shops: "Shops & Establishment",
  gratuity: "Gratuity",
  bonus: "Bonus",
  other: "Other",
};
export const RECURRENCE_LABEL: Record<Recurrence, string> = { none: "One-off", monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Every 6 months", yearly: "Yearly" };
const COMPLIANCE_BADGE: Record<ComplianceState, BadgeView> = {
  overdue: { text: "OVERDUE", tone: "coral" },
  due_soon: { text: "DUE SOON", tone: "amber" },
  upcoming: { text: "UPCOMING", tone: "blue" },
  done: { text: "DONE", tone: "emerald" },
};
export const complianceBadge = (s: ComplianceState): BadgeView => COMPLIANCE_BADGE[s] ?? COMPLIANCE_BADGE.upcoming;

export const AGREEMENT_TYPE_LABEL: Record<AgreementType, string> = {
  employment: "Employment",
  nda: "NDA",
  non_compete: "Non-compete",
  consultant: "Consultancy",
  internship: "Internship",
  other: "Other",
};
const AGREEMENT_BADGE: Record<AgreementState, BadgeView> = {
  active: { text: "ACTIVE", tone: "emerald" },
  expiring: { text: "EXPIRING", tone: "amber" },
  expired: { text: "EXPIRED", tone: "coral" },
  unsigned: { text: "AWAITING SIGNATURE", tone: "blue" },
  ended: { text: "ENDED", tone: "neutral" },
};
export const agreementBadge = (s: AgreementState): BadgeView => AGREEMENT_BADGE[s] ?? AGREEMENT_BADGE.active;

export const SALES_KIND_LABEL: Record<SalesKind, string> = { quotation: "Quotation", order: "Sales order", challan: "Delivery challan" };
/** Kind tag colours from the Sales Billing design: blue orders, lavender quotations, mint challans. */
export const SALES_KIND_TAG: Record<SalesKind, { text: string; tag: "blue" | "lavender" | "mint" }> = {
  quotation: { text: "QUOTATION", tag: "lavender" },
  order: { text: "SALES ORDER", tag: "blue" },
  challan: { text: "CHALLAN", tag: "mint" },
};
const SALES_BADGE: Record<SalesStage, BadgeView> = {
  draft: { text: "DRAFT", tone: "neutral" },
  sent: { text: "SENT", tone: "blue" },
  expired: { text: "EXPIRED", tone: "coral" },
  accepted: { text: "ACCEPTED", tone: "emerald" },
  declined: { text: "DECLINED", tone: "coral" },
  converted: { text: "CONVERTED", tone: "emerald" },
  confirmed: { text: "CONFIRMED", tone: "blue" },
  in_transit: { text: "IN TRANSIT", tone: "amber" },
  part_delivered: { text: "PART DELIVERED", tone: "amber" },
  delivered: { text: "DELIVERED", tone: "emerald" },
  invoiced: { text: "INVOICED", tone: "emerald" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};
export const salesBadge = (s: SalesStage): BadgeView => SALES_BADGE[s] ?? SALES_BADGE.draft;
export const CHALLAN_REASON_LABEL: Record<ChallanReason, string> = { supply: "Supply (sale)", job_work: "Job work", approval: "On approval", other: "Other" };
export const POS_METHOD_LABEL: Record<PosMethod, string> = { cash: "Cash", upi: "UPI", card: "Card" };

/** Change to hand back at the counter, or `null` while the cash tendered is short or blank. */
export function posChange(total: number, tendered: string): number | null {
  const paid = Number(tendered);
  if (!tendered.trim() || !Number.isFinite(paid) || paid < total) return null;
  return round2(paid - total);
}

/** Suggestions for where a candidate came from; any text is accepted. */
export const CANDIDATE_SOURCES = ["Naukri", "LinkedIn", "Indeed", "Referral", "Website", "Walk-in", "Campus", "Agency", "Direct"] as const;

/** A debit-positive balance seen from the account's normal side, so liabilities and income read positive. */
export const normalBalance = (balance: number, type: AccountType): number =>
  round2(type === "asset" || type === "expense" ? balance : -balance) || 0;

/** A debit-positive balance as "₹1,200 Dr", "₹500 Cr" or "₹0". */
export function drCr(balance: number): string {
  const n = round2(Number.isFinite(balance) ? balance : 0);
  if (Math.abs(n) < 0.5) return "₹0";
  return `${inr(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`;
}

/** "WDV 15%", "SLM 31.67%", or "No depreciation". */
export const depreciationLabel = (method: DepreciationMethod, rate: number): string =>
  method === "none" ? "No depreciation" : `${method.toUpperCase()} ${Number(round2(rate).toFixed(2))}%`;

/** An annual amount as twelve whole-rupee months that add back up exactly (earlier months take the spare rupees, the last month any paise). */
export function spreadEvenly(annual: number): number[] {
  const total = Math.max(0, Number.isFinite(annual) ? annual : 0);
  const rupees = Math.floor(total);
  const base = Math.floor(rupees / 12);
  const spare = rupees - base * 12;
  const months = Array.from({ length: 12 }, (_, i) => base + (i < spare ? 1 : 0));
  months[11] = round2(months[11] + (total - rupees));
  return months;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const tail = rest < 20 ? ONES[rest] : [TENS[Math.floor(rest / 10)], ONES[rest % 10]].filter(Boolean).join(" ");
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", tail].filter(Boolean).join(" ");
}

function indianWords(n: number): string {
  if (n === 0) return "";
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  return [crore ? `${indianWords(crore)} Crore` : "", lakh ? `${belowThousand(lakh)} Lakh` : "", thousand ? `${belowThousand(thousand)} Thousand` : "", belowThousand(n % 1000)].filter(Boolean).join(" ");
}

/** Whole rupees in words, Indian system: `Rupees Twelve Lakh Five Thousand only`. */
export function rupeesInWords(amount: number): string {
  const n = Math.round(Math.abs(Number.isFinite(amount) ? amount : 0));
  return `Rupees ${indianWords(n) || "Zero"} only`;
}

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
