/**
 * Performance & learning rules: certificate validity, fiscal quarters, current KRAs and the headline figures.
 * Pure functions, no I/O.
 */
import { addDaysISO, isISODate } from "./logic.js";

export const PROGRAM_TEAMS = ["all", "management", "technical", "operations"] as const;
export type ProgramTeam = (typeof PROGRAM_TEAMS)[number];
export const ENROLLMENT_STATUSES = ["enrolled", "completed", "cancelled"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const KRA_STATUSES = ["on_track", "at_risk", "off_track", "achieved", "missed"] as const;
export type KraStatus = (typeof KRA_STATUSES)[number];
export const PROMOTION_STATUSES = ["pending", "approved", "rejected"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];
export const PIP_STATUSES = ["active", "passed", "failed", "cancelled"] as const;
export type PipStatus = (typeof PIP_STATUSES)[number];
export const PIP_OUTCOMES = ["passed", "failed", "cancelled"] as const;

/** Suggested award names; managers can type their own. */
export const RECOGNITION_CATEGORIES = [
  "Employee of the Month",
  "Top Performer — Sales",
  "Top Performer — Service",
  "Top Performer — Marketing",
  "Star Performer",
  "Best Performer",
  "Project Spotlight",
  "Star Technician",
  "Rising Star (Junior)",
  "Employee of the Year",
  "Best Helping Hand",
  "3-Year Milestone",
] as const;

/** Days before expiry when a certificate shows as expiring. */
export const EXPIRY_WARNING_DAYS = 30;

/** Same day `months` later, clamped to the month's end (31 Jan + 1 month → 28/29 Feb). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Last valid day of a certificate issued on `issuedOn` for `months` (12 months from 10 Jan 2026 → 9 Jan 2027). */
export function certificateExpiry(issuedOn: string, months: number | null): string | null {
  if (!months || months <= 0 || !isISODate(issuedOn)) return null;
  return addDaysISO(addMonthsISO(issuedOn, months), -1);
}

export type CertificateStatus = "valid" | "expiring" | "expired";
export function certificateStatus(expiresOn: string | null, today: string): CertificateStatus {
  if (!expiresOn) return "valid";
  if (expiresOn < today) return "expired";
  return expiresOn <= addDaysISO(today, EXPIRY_WARNING_DAYS) ? "expiring" : "valid";
}

/** First day of the fiscal quarter containing `iso`; quarters follow the financial year's start month. */
export function fiscalQuarterStart(iso: string, startMonth = 4): string {
  const [y, m] = iso.split("-").map(Number);
  const offset = (m - startMonth + 12) % 12;
  const first = m - (offset % 3);
  return first >= 1 ? `${y}-${String(first).padStart(2, "0")}-01` : `${y - 1}-${String(first + 12).padStart(2, "0")}-01`;
}

export const isCurrentKra = (k: { periodStart: string; periodEnd: string }, today: string) => k.periodStart <= today && today <= k.periodEnd;

export type PerfEmployee = { id: string };
export type PerfProgram = { id: string; archived: boolean; certificate: boolean; mandatory: boolean };
export type PerfEnrollment = { programId: string; employeeId: string; enrolledOn: string; sessionDate: string | null; status: EnrollmentStatus; completedOn: string | null };
export type PerfCertificate = { employeeId: string; programId: string | null; issuedOn: string; expiresOn: string | null };
export type PerfKra = { employeeId: string; periodStart: string; periodEnd: string; status: KraStatus };
export type PerfPromotion = { status: PromotionStatus; decidedOn: string | null };
export type PerfPip = { status: PipStatus; reviewOn: string };
export type PerfRecognition = { awardedOn: string };

export type PerformanceTotals = {
  headcount: number;
  promotionsPending: number;
  promotionsApproved: number;
  programs: number;
  enrolledQuarter: number;
  completedQuarter: number;
  upcomingSessions: number;
  certifiedEmployees: number;
  mandatoryPrograms: number;
  mandatoryCompliant: number;
  expiringSoon: number;
  expired: number;
  issuedFy: number;
  onPip: number;
  nextPipReview: string | null;
  krasSet: number;
  kras: { current: number; onTrack: number; atRisk: number; offTrack: number };
  recognitionsMonth: number;
};

/**
 * Headline figures for current employees (anyone not exited). Certificates count while not expired; mandatory
 * compliance means holding a valid certificate from every active mandatory program that issues one.
 * Quarter figures are enrollments made since the quarter start and how many of those are completed.
 */
export function performanceTotals(
  data: {
    employees: ReadonlyArray<PerfEmployee>;
    programs: ReadonlyArray<PerfProgram>;
    enrollments: ReadonlyArray<PerfEnrollment>;
    certificates: ReadonlyArray<PerfCertificate>;
    kras: ReadonlyArray<PerfKra>;
    promotions: ReadonlyArray<PerfPromotion>;
    pips: ReadonlyArray<PerfPip>;
    recognitions: ReadonlyArray<PerfRecognition>;
  },
  today: string,
  fyStart: string,
  quarterStart: string,
): PerformanceTotals {
  const current = new Set(data.employees.map((e) => e.id));
  const valid = data.certificates.filter((c) => current.has(c.employeeId) && certificateStatus(c.expiresOn, today) !== "expired");
  const mandatory = data.programs.filter((p) => !p.archived && p.mandatory && p.certificate);
  const holds = new Map<string, Set<string>>();
  for (const c of valid) if (c.programId) holds.set(c.employeeId, (holds.get(c.employeeId) ?? new Set()).add(c.programId));
  const compliant = mandatory.length ? [...current].filter((id) => mandatory.every((p) => holds.get(id)?.has(p.id))).length : 0;

  const quarter = data.enrollments.filter((e) => e.enrolledOn >= quarterStart && e.status !== "cancelled");
  const horizon = addDaysISO(today, 30);
  const sessions = new Set(
    data.enrollments.filter((e) => e.status === "enrolled" && e.sessionDate && e.sessionDate >= today && e.sessionDate <= horizon).map((e) => `${e.programId}|${e.sessionDate}`),
  );

  const kras = data.kras.filter((k) => current.has(k.employeeId) && isCurrentKra(k, today));
  const active = data.pips.filter((p) => p.status === "active");
  const month = today.slice(0, 7);

  return {
    headcount: current.size,
    promotionsPending: data.promotions.filter((p) => p.status === "pending").length,
    promotionsApproved: data.promotions.filter((p) => p.status === "approved" && p.decidedOn && p.decidedOn >= fyStart).length,
    programs: data.programs.filter((p) => !p.archived).length,
    enrolledQuarter: quarter.length,
    completedQuarter: quarter.filter((e) => e.status === "completed").length,
    upcomingSessions: sessions.size,
    certifiedEmployees: new Set(valid.map((c) => c.employeeId)).size,
    mandatoryPrograms: mandatory.length,
    mandatoryCompliant: compliant,
    expiringSoon: valid.filter((c) => certificateStatus(c.expiresOn, today) === "expiring").length,
    expired: data.certificates.filter((c) => current.has(c.employeeId) && certificateStatus(c.expiresOn, today) === "expired").length,
    issuedFy: data.certificates.filter((c) => c.issuedOn >= fyStart).length,
    onPip: active.length,
    nextPipReview: active.reduce<string | null>((min, p) => (min === null || p.reviewOn < min ? p.reviewOn : min), null),
    krasSet: new Set(kras.map((k) => k.employeeId)).size,
    kras: {
      current: kras.length,
      onTrack: kras.filter((k) => k.status === "on_track" || k.status === "achieved").length,
      atRisk: kras.filter((k) => k.status === "at_risk").length,
      offTrack: kras.filter((k) => k.status === "off_track" || k.status === "missed").length,
    },
    recognitionsMonth: data.recognitions.filter((r) => r.awardedOn.slice(0, 7) === month).length,
  };
}

/** Why a promotion can't be proposed, or null. */
export function promotionProblem(input: { proposedDesignation: string; currentDesignation: string | null; proposedCtc: number | null; currentCtc: number | null }): string | null {
  const same = input.currentDesignation !== null && input.proposedDesignation.trim().toLowerCase() === input.currentDesignation.trim().toLowerCase();
  if (same && (input.proposedCtc === null || input.proposedCtc === input.currentCtc)) return "Propose a new designation or a new CTC";
  if (input.proposedCtc !== null && input.currentCtc !== null && input.proposedCtc < input.currentCtc) return "The proposed CTC is below the current CTC";
  return null;
}
