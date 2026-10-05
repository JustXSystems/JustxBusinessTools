/**
 * Recruitment & onboarding rules: the hiring pipeline, what moves are allowed, onboarding progress and the KPIs.
 * Pure functions, no I/O.
 */
import { addDaysISO, daysBetween } from "./logic.js";

export const OPENING_STATUSES = ["draft", "open", "on_hold", "closed"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];
export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STAGES = ["applied", "interview", "shortlisted", "offer", "hired", "rejected", "withdrawn"] as const;
export type Stage = (typeof STAGES)[number];
/** Stages a candidate can be dragged between; hiring happens by accepting the offer. */
export const OPEN_STAGES: ReadonlyArray<Stage> = ["applied", "interview", "shortlisted", "offer"];
export const CLOSED_STAGES: ReadonlyArray<Stage> = ["rejected", "withdrawn"];
export const isOpenStage = (s: Stage) => OPEN_STAGES.includes(s);

export const OFFER_STATUSES = ["sent", "accepted", "declined"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const ONBOARDING_TASKS = ["documents", "kyc", "it", "induction", "kra"] as const;
export type OnboardingTask = (typeof ONBOARDING_TASKS)[number];
/** Tasks that should be done by the joining date. */
export const PRE_JOINING: ReadonlyArray<OnboardingTask> = ["documents", "kyc", "it"];
/** `date` is when the task was done, or for an induction not yet done, when it's scheduled. */
export type TaskState = { done: boolean; date: string | null };
export type Onboarding = Partial<Record<OnboardingTask, TaskState>>;

/** Why a candidate can't go from one stage to another, or null when the move is fine. */
export function stageMoveProblem(from: Stage, to: Stage): string | null {
  if (from === to) return "The candidate is already at this stage";
  if (to === "hired") return "Record the offer as accepted to hire a candidate";
  if (from === "hired") return "This candidate is hired — undo the hire first";
  return null;
}

export type OnboardingState = "not_started" | "on_track" | "delayed" | "completed";
export type OnboardingProgress = { done: number; total: number; synced: boolean; state: OnboardingState };

/**
 * Progress over the five tasks plus the employee record. It's delayed once the joining date has arrived
 * with documents, KYC, IT setup or the employee record still pending.
 */
export function onboardingProgress(c: { joiningDate: string | null; onboarding: Onboarding; employeeId: string | null }, today: string): OnboardingProgress {
  const synced = Boolean(c.employeeId);
  const done = ONBOARDING_TASKS.filter((t) => c.onboarding[t]?.done).length + (synced ? 1 : 0);
  const total = ONBOARDING_TASKS.length + 1;
  if (done === total) return { done, total, synced, state: "completed" };
  const due = c.joiningDate !== null && c.joiningDate <= today;
  if (due && (!synced || PRE_JOINING.some((t) => !c.onboarding[t]?.done))) return { done, total, synced, state: "delayed" };
  return { done, total, synced, state: done ? "on_track" : "not_started" };
}

export type PipelineCandidate = {
  openingId: string;
  stage: Stage;
  appliedOn: string;
  hiredOn: string | null;
  offerSentOn: string | null;
  offerStatus: OfferStatus | null;
  offerRespondedOn: string | null;
  joiningDate: string | null;
  onboarding: Onboarding;
  employeeId: string | null;
};
export type PipelineOpening = { id: string; status: OpeningStatus; openings: number; departmentId: string | null };

export type RecruitmentTotals = {
  openPositions: number;
  departmentsHiring: number;
  openRoles: number;
  draftRoles: number;
  activeApplicants: number;
  byStage: Record<Stage, number>;
  avgDaysToHire: number | null;
  hiresCounted: number;
  offersAccepted: number;
  offersDeclined: number;
  offersPending: number;
  offersSent: number;
  joinersThisMonth: number;
  documentsPending: number;
  inductionsSoon: number;
  onboarding: { total: number; completed: number; delayed: number; it: number; kyc: number; kra: number; synced: number };
};

/** Hired candidates per opening. */
export function hiredByOpening(candidates: ReadonlyArray<Pick<PipelineCandidate, "openingId" | "stage">>): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of candidates) if (c.stage === "hired") m.set(c.openingId, (m.get(c.openingId) ?? 0) + 1);
  return m;
}

/**
 * Headline figures. Open positions are the people still to hire on open roles. Time to hire is from application
 * to acceptance over the last year; offer figures and joiners count from `since` (the financial-year start).
 * Onboarding counts cover hires whose joining date is within the last 90 days or still ahead, or who aren't done yet.
 */
export function recruitmentTotals(openings: ReadonlyArray<PipelineOpening>, candidates: ReadonlyArray<PipelineCandidate>, today: string, since: string): RecruitmentTotals {
  const hired = hiredByOpening(candidates);
  const open = openings.filter((o) => o.status === "open");
  const remaining = open.map((o) => ({ o, left: Math.max(0, o.openings - (hired.get(o.id) ?? 0)) })).filter((x) => x.left > 0);
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const c of candidates) byStage[c.stage]++;

  const yearAgo = addDaysISO(today, -365);
  const hires = candidates.filter((c) => c.stage === "hired" && c.hiredOn && c.hiredOn >= yearAgo);
  const avg = hires.length ? Math.round(hires.reduce((s, c) => s + Math.max(0, daysBetween(c.appliedOn, c.hiredOn!)), 0) / hires.length) : null;

  const responded = candidates.filter((c) => c.offerRespondedOn && c.offerRespondedOn >= since);
  const month = today.slice(0, 7);
  const recent = addDaysISO(today, -90);
  const joiners = candidates.filter((c) => c.stage === "hired");
  const tracked = joiners.filter((c) => (c.joiningDate ?? today) >= recent || onboardingProgress(c, today).state !== "completed");
  const progress = tracked.map((c) => ({ c, p: onboardingProgress(c, today) }));
  const pending = progress.filter((x) => x.p.state !== "completed");
  const week = addDaysISO(today, 7);

  return {
    openPositions: remaining.reduce((s, x) => s + x.left, 0),
    departmentsHiring: new Set(remaining.map((x) => x.o.departmentId ?? "none")).size,
    openRoles: open.length,
    draftRoles: openings.filter((o) => o.status === "draft").length,
    activeApplicants: candidates.filter((c) => isOpenStage(c.stage)).length,
    byStage,
    avgDaysToHire: avg,
    hiresCounted: hires.length,
    offersAccepted: responded.filter((c) => c.offerStatus === "accepted").length,
    offersDeclined: responded.filter((c) => c.offerStatus === "declined").length,
    offersPending: candidates.filter((c) => c.offerStatus === "sent" && c.stage === "offer").length,
    offersSent: candidates.filter((c) => c.offerSentOn && c.offerSentOn >= since).length,
    joinersThisMonth: joiners.filter((c) => c.joiningDate?.slice(0, 7) === month).length,
    documentsPending: pending.filter((x) => !x.c.onboarding.documents?.done).length,
    inductionsSoon: pending.filter((x) => {
      const i = x.c.onboarding.induction;
      return i && !i.done && i.date && i.date >= today && i.date <= week;
    }).length,
    onboarding: {
      total: tracked.length,
      completed: progress.filter((x) => x.p.state === "completed").length,
      delayed: progress.filter((x) => x.p.state === "delayed").length,
      it: tracked.filter((c) => c.onboarding.it?.done).length,
      kyc: tracked.filter((c) => c.onboarding.kyc?.done).length,
      kra: tracked.filter((c) => c.onboarding.kra?.done).length,
      synced: tracked.filter((c) => c.employeeId).length,
    },
  };
}

/** "Asha Rao Kumar" → first "Asha Rao", last "Kumar"; a single word is the first name. */
export function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? "", lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** Reads a stored checklist, dropping anything unknown. */
export function readOnboarding(raw: unknown): Onboarding {
  const out: Onboarding = {};
  if (!raw || typeof raw !== "object") return out;
  for (const t of ONBOARDING_TASKS) {
    const v = (raw as Record<string, unknown>)[t];
    if (v && typeof v === "object") {
      const s = v as { done?: unknown; date?: unknown };
      out[t] = { done: s.done === true, date: typeof s.date === "string" ? s.date : null };
    }
  }
  return out;
}
