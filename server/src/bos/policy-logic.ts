import { addDaysISO } from "./logic.js";

export const POLICY_CATEGORIES = ["hr", "compliance", "finance", "it", "safety", "other"] as const;
export const POLICY_STATUSES = ["draft", "published", "archived"] as const;
export const COMPLIANCE_AREAS = ["pf", "esi", "pt", "tds", "lwf", "posh", "shops", "gratuity", "bonus", "other"] as const;
export const RECURRENCES = ["none", "monthly", "quarterly", "half_yearly", "yearly"] as const;
export const AGREEMENT_TYPES = ["employment", "nda", "non_compete", "consultant", "internship", "other"] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];
export type PolicyStatus = (typeof POLICY_STATUSES)[number];
export type ComplianceArea = (typeof COMPLIANCE_AREAS)[number];
export type Recurrence = (typeof RECURRENCES)[number];
export type AgreementType = (typeof AGREEMENT_TYPES)[number];

/** A filing is "due soon" this many days ahead. */
export const COMPLIANCE_SOON_DAYS = 7;
/** An agreement is "expiring" this many days before its end date. */
export const AGREEMENT_EXPIRY_DAYS = 30;

const STEP: Record<Recurrence, number> = { none: 0, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** `day` of the given month, clamped to the month's end (31 → 30 Apr, 28/29 Feb). */
function onDay(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, lastDay(year, month)))}`;
}

/**
 * The next due date after `dueOn` for a recurring item, or null for one-off items. `dueDay` is the intended day of
 * the month, so 31 Jan → 28 Feb → 31 Mar instead of drifting to the 28th.
 */
export function nextDueISO(dueOn: string, recurrence: Recurrence, dueDay?: number | null): string | null {
  const step = STEP[recurrence];
  if (!step) return null;
  const [y, m, d] = dueOn.split("-").map(Number);
  const index = y * 12 + (m - 1) + step;
  return onDay(Math.floor(index / 12), (index % 12) + 1, dueDay && dueDay >= 1 && dueDay <= 31 ? dueDay : d);
}

export type ComplianceState = "done" | "overdue" | "due_soon" | "upcoming";
export function complianceState(item: { status: string; dueOn: string }, today: string): ComplianceState {
  if (item.status === "done") return "done";
  if (item.dueOn < today) return "overdue";
  return item.dueOn <= addDaysISO(today, COMPLIANCE_SOON_DAYS) ? "due_soon" : "upcoming";
}

export type AgreementState = "ended" | "unsigned" | "expired" | "expiring" | "active";
export function agreementState(a: { status: string; signedOn: string | null; expiresOn: string | null }, today: string): AgreementState {
  if (a.status === "ended") return "ended";
  if (a.expiresOn && a.expiresOn < today) return "expired";
  if (!a.signedOn) return "unsigned";
  return a.expiresOn && a.expiresOn <= addDaysISO(today, AGREEMENT_EXPIRY_DAYS) ? "expiring" : "active";
}

/** Only web links: the signed copy lives in Drive, SharePoint or similar, never a `javascript:` or file URL. */
export function isWebUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Why an agreement can't be saved as it stands, or null. */
export function agreementProblem(
  a: { employeeId: string | null; counterparty: string | null; signedOn: string | null; startsOn: string | null; expiresOn: string | null },
  today: string,
): string | null {
  if (a.employeeId && a.counterparty) return "Pick an employee or name an outside party, not both";
  if (!a.employeeId && !a.counterparty) return "Pick the employee or name the other party";
  if (a.signedOn && a.signedOn > today) return "The signing date can't be in the future";
  if (a.startsOn && a.expiresOn && a.expiresOn < a.startsOn) return "The end date is before the start date";
  return null;
}

/** Whole-number percentage, or null when nobody is in scope. */
export const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

/* ---------- Standard Indian filings ---------- */

export type ComplianceTemplate = {
  key: string;
  title: string;
  area: ComplianceArea;
  recurrence: "monthly" | "yearly";
  day: number;
  /** Yearly items only: the month it falls due. */
  month?: number;
  note: string;
};

/** Usual due dates. They vary by state and change over time, so the manager reviews and edits them after adding. */
export const COMPLIANCE_TEMPLATES: ReadonlyArray<ComplianceTemplate> = [
  { key: "pf_ecr", title: "PF — ECR and contribution payment", area: "pf", recurrence: "monthly", day: 15, note: "Last month's contributions, on the EPFO employer portal." },
  { key: "esi", title: "ESI — contribution payment", area: "esi", recurrence: "monthly", day: 15, note: "Last month's contributions, on the ESIC portal." },
  { key: "tds_deposit", title: "TDS on salaries — deposit (Challan 281)", area: "tds", recurrence: "monthly", day: 7, note: "Tax deducted last month. March's deduction is due by 30 April." },
  { key: "pt", title: "Professional tax — return and payment", area: "pt", recurrence: "monthly", day: 20, note: "The due date and frequency depend on your state — change it to match." },
  { key: "tds_24q_q1", title: "TDS return 24Q — Q1 (Apr–Jun)", area: "tds", recurrence: "yearly", month: 7, day: 31, note: "Quarterly salary TDS statement." },
  { key: "tds_24q_q2", title: "TDS return 24Q — Q2 (Jul–Sep)", area: "tds", recurrence: "yearly", month: 10, day: 31, note: "Quarterly salary TDS statement." },
  { key: "tds_24q_q3", title: "TDS return 24Q — Q3 (Oct–Dec)", area: "tds", recurrence: "yearly", month: 1, day: 31, note: "Quarterly salary TDS statement." },
  { key: "tds_24q_q4", title: "TDS return 24Q — Q4 (Jan–Mar)", area: "tds", recurrence: "yearly", month: 5, day: 31, note: "Quarterly salary TDS statement." },
  { key: "form16", title: "Form 16 to employees", area: "tds", recurrence: "yearly", month: 6, day: 15, note: "Part A and Part B for the last financial year." },
  { key: "posh_annual", title: "POSH — Internal Committee annual report", area: "posh", recurrence: "yearly", month: 1, day: 31, note: "To the District Officer. Dates vary by state — check yours." },
  { key: "lwf", title: "Labour welfare fund contribution", area: "lwf", recurrence: "yearly", month: 1, day: 15, note: "Frequency and dates depend on your state — change them to match." },
  { key: "shops_renewal", title: "Shops & Establishment registration renewal", area: "shops", recurrence: "yearly", month: 12, day: 31, note: "Set this to your registration's renewal date, or delete it if yours doesn't expire." },
];

/** The first due date on or after `today` for a standard filing. */
export function firstDueISO(t: Pick<ComplianceTemplate, "recurrence" | "day" | "month">, today: string): string {
  const [y, m] = today.split("-").map(Number);
  if (t.recurrence === "monthly") {
    const thisMonth = onDay(y, m, t.day);
    return thisMonth >= today ? thisMonth : onDay(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, t.day);
  }
  const thisYear = onDay(y, t.month ?? 1, t.day);
  return thisYear >= today ? thisYear : onDay(y + 1, t.month ?? 1, t.day);
}

/* ---------- Totals ---------- */

export function complianceTotals(items: ReadonlyArray<{ status: string; dueOn: string; doneOn: string | null }>, today: string) {
  const open = items.filter((i) => i.status !== "done");
  const in30 = addDaysISO(today, 30);
  return {
    overdue: open.filter((i) => i.dueOn < today).length,
    dueSoon: open.filter((i) => complianceState(i, today) === "due_soon").length,
    due30: open.filter((i) => i.dueOn >= today && i.dueOn <= in30).length,
    doneMonth: items.filter((i) => i.status === "done" && i.doneOn && i.doneOn.slice(0, 7) === today.slice(0, 7)).length,
  };
}

export function agreementTotals(list: ReadonlyArray<{ status: string; signedOn: string | null; expiresOn: string | null }>, today: string) {
  const states = list.map((a) => agreementState(a, today));
  const count = (s: AgreementState) => states.filter((x) => x === s).length;
  return { active: count("active") + count("expiring") + count("unsigned"), expiring: count("expiring"), expired: count("expired"), unsigned: count("unsigned") };
}

/** Org-wide acknowledgement across published policies: acknowledged pairs out of policies × people in scope. */
export function policyTotals(policies: ReadonlyArray<{ status: string; mandatory: boolean; acknowledged: number }>, headcount: number) {
  const published = policies.filter((p) => p.status === "published");
  const mandatory = published.filter((p) => p.mandatory);
  const acked = published.reduce((s, p) => s + Math.min(p.acknowledged, headcount), 0);
  return {
    published: published.length,
    mandatory: mandatory.length,
    drafts: policies.filter((p) => p.status === "draft").length,
    headcount,
    ackRate: percent(acked, published.length * headcount),
    mandatoryPending: mandatory.reduce((s, p) => s + Math.max(0, headcount - p.acknowledged), 0),
  };
}
export type PolicyTotals = ReturnType<typeof policyTotals>;
