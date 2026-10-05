import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, isoDate, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, json, money, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { EMPLOYMENT_TYPES, insertEmployee, NewEmployeeInput, recordEmployeeCreated } from "./hr.js";
import { fiscalYearStart, isISODate, todayISO } from "./logic.js";
import {
  CLOSED_STAGES,
  isOpenStage,
  ONBOARDING_TASKS,
  onboardingProgress,
  OPENING_STATUSES,
  PRIORITIES,
  readOnboarding,
  recruitmentTotals,
  STAGES,
  stageMoveProblem,
  type OfferStatus,
  type OpeningStatus,
  type Priority,
  type Stage,
} from "./recruitment-logic.js";
import { getSettings } from "./workspace.js";

const STAGE_LABEL: Record<Stage, string> = {
  applied: "Applied",
  interview: "Interview",
  shortlisted: "Shortlisted",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
const TASK_LABEL: Record<(typeof ONBOARDING_TASKS)[number], string> = { documents: "Documents", kyc: "KYC", it: "IT setup", induction: "Induction", kra: "KRA update" };
const INTERVIEW_MODES = ["in_person", "phone", "video"] as const;
const MODE_LABEL: Record<(typeof INTERVIEW_MODES)[number], string> = { in_person: "in person", phone: "phone", video: "video call" };

const managerOnly = (actor: BosActor) => {
  if (!isManager(actor)) throw forbidden("Recruitment is available to owners and admins");
};
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/* ---------- Inputs ---------- */

const amount = z.coerce.number().min(0, "Can't be negative").max(1e11);
const OpeningFields = z.object({
  title: z.string().trim().min(1, "Required").max(160),
  departmentId: z.string().max(36).nullable().optional(),
  location: optText(120),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"),
  openings: z.coerce.number().int("Whole number").min(1, "At least one").max(500).default(1),
  priority: z.enum(PRIORITIES).default("medium"),
  status: z.enum(OPENING_STATUSES).default("open"),
  salaryMin: amount.nullable().optional(),
  salaryMax: amount.nullable().optional(),
  targetDate: isoDate.nullable().optional(),
  description: optText(5000),
});
const link = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Use a link starting with http:// or https://")
  .nullable()
  .optional();
const CandidateFields = z.object({
  openingId: z.string().min(1, "Pick a role").max(36),
  name: z.string().trim().min(1, "Required").max(160),
  email: z.string().trim().max(180).email("Enter a valid email").nullable().optional().or(z.literal("")),
  phone: optText(40),
  source: z.string().trim().min(1).max(40).default("Direct"),
  referredBy: optText(160),
  appliedOn: isoDate,
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  currentCtc: amount.nullable().optional(),
  expectedCtc: amount.nullable().optional(),
  noticeDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  resumeLink: link,
  notes: optText(5000),
});
const StageInput = z.object({ stage: z.enum(STAGES), reason: optText(300) });
const InterviewInput = z.object({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time").refine((v) => isISODate(v.slice(0, 10)) && Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60, "Pick a valid date and time"),
  mode: z.enum(INTERVIEW_MODES).default("in_person"),
  interviewer: optText(160),
  note: optText(300),
});
const OfferInput = z.object({
  ctc: z.coerce.number().positive("Enter the annual CTC").max(1e11),
  joiningDate: isoDate,
  sentOn: isoDate,
  terms: optText(5000),
});
const ResponseInput = z.object({ response: z.enum(["accepted", "declined"]), date: isoDate, joiningDate: isoDate.optional(), note: optText(300) });
const NoteInput = z.object({ note: z.string().trim().min(1, "Write a note").max(500) });
const OnboardingInput = z.object({ task: z.enum(ONBOARDING_TASKS), done: z.boolean(), date: isoDate.nullable().optional() });

/* ---------- Rows ---------- */

type OpeningRow = {
  id: string;
  title: string;
  department_id: string | null;
  department_name: string | null;
  location: string | null;
  employment_type: string;
  openings: number;
  priority: Priority;
  status: OpeningStatus;
  salary_min: string | null;
  salary_max: string | null;
  target_date: string | null;
  description: string | null;
  opened_on: string | null;
  closed_on: string | null;
  created_at: string;
};
const mapOpening = (o: OpeningRow) => ({
  id: o.id,
  title: o.title,
  departmentId: o.department_id,
  departmentName: o.department_name,
  location: o.location,
  employmentType: o.employment_type,
  openings: Number(o.openings),
  priority: o.priority,
  status: o.status,
  salaryMin: o.salary_min === null ? null : money(o.salary_min),
  salaryMax: o.salary_max === null ? null : money(o.salary_max),
  targetDate: o.target_date,
  description: o.description,
  openedOn: o.opened_on,
  closedOn: o.closed_on,
  createdAt: o.created_at,
});
const OPENING_SELECT = `SELECT o.*, d.name AS department_name FROM bos_job_openings o LEFT JOIN bos_departments d ON d.id = o.department_id`;

type CandidateRow = {
  id: string;
  opening_id: string;
  opening_title: string;
  department_id: string | null;
  department_name: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  referred_by: string | null;
  applied_on: string;
  stage: Stage;
  stage_on: string;
  rating: number | null;
  current_ctc: string | null;
  expected_ctc: string | null;
  notice_days: number | null;
  resume_link: string | null;
  notes: string | null;
  interview_at: string | null;
  interview_mode: (typeof INTERVIEW_MODES)[number] | null;
  interviewer: string | null;
  offer_ctc: string | null;
  offer_sent_on: string | null;
  offer_status: OfferStatus | null;
  offer_responded_on: string | null;
  offer_terms: string | null;
  joining_date: string | null;
  hired_on: string | null;
  closed_reason: string | null;
  onboarding: unknown;
  employee_id: string | null;
  emp_code: string | null;
  created_at: string;
};
const optMoney = (v: string | null) => (v === null ? null : money(v));
const mapCandidate = (c: CandidateRow) => {
  const onboarding = readOnboarding(json(c.onboarding, null));
  return {
    ...candidateFields(c),
    onboarding,
    progress: c.stage === "hired" ? onboardingProgress({ joiningDate: c.joining_date, onboarding, employeeId: c.employee_id }, todayISO()) : null,
  };
};
const candidateFields = (c: CandidateRow) => ({
  id: c.id,
  openingId: c.opening_id,
  openingTitle: c.opening_title,
  departmentId: c.department_id,
  departmentName: c.department_name,
  name: c.name,
  email: c.email,
  phone: c.phone,
  source: c.source,
  referredBy: c.referred_by,
  appliedOn: c.applied_on,
  stage: c.stage,
  stageOn: c.stage_on,
  rating: c.rating === null ? null : Number(c.rating),
  currentCtc: optMoney(c.current_ctc),
  expectedCtc: optMoney(c.expected_ctc),
  noticeDays: c.notice_days === null ? null : Number(c.notice_days),
  resumeLink: c.resume_link,
  notes: c.notes,
  interviewAt: c.interview_at ? c.interview_at.slice(0, 16).replace(" ", "T") : null,
  interviewMode: c.interview_mode,
  interviewer: c.interviewer,
  offerCtc: optMoney(c.offer_ctc),
  offerSentOn: c.offer_sent_on,
  offerStatus: c.offer_status,
  offerRespondedOn: c.offer_responded_on,
  offerTerms: c.offer_terms,
  joiningDate: c.joining_date,
  hiredOn: c.hired_on,
  closedReason: c.closed_reason,
  employeeId: c.employee_id,
  employeeCode: c.emp_code,
  createdAt: c.created_at,
});
const CANDIDATE_SELECT = `
  SELECT c.*, o.title AS opening_title, o.department_id, d.name AS department_name, e.emp_code
  FROM bos_candidates c
  JOIN bos_job_openings o ON o.id = c.opening_id
  LEFT JOIN bos_departments d ON d.id = o.department_id
  LEFT JOIN bos_employees e ON e.id = c.employee_id`;

async function loadOpening(deps: BosDeps, tenantId: number, id: string): Promise<OpeningRow> {
  const o = await one<OpeningRow>(deps.db, `${OPENING_SELECT} WHERE o.id = :id AND o.tenant_id = :t`, { id, t: tenantId });
  if (!o) throw notFound("Role");
  return o;
}
async function loadCandidate(deps: BosDeps, tenantId: number, id: string): Promise<CandidateRow> {
  const c = await one<CandidateRow>(deps.db, `${CANDIDATE_SELECT} WHERE c.id = :id AND c.tenant_id = :t`, { id, t: tenantId });
  if (!c) throw notFound("Candidate");
  return c;
}
async function checkDepartment(deps: BosDeps, tenantId: number, id: string | null | undefined) {
  if (!id) return;
  const d = await one(deps.db, `SELECT 1 FROM bos_departments WHERE id = :id AND tenant_id = :t`, { id, t: tenantId });
  if (!d) throw new BosError(400, "Pick a department from the list");
}
function checkSalary(min: number | null | undefined, max: number | null | undefined) {
  if (min != null && max != null && min > max) throw new BosError(400, "The salary range's minimum is above its maximum");
}

async function logCandidate(
  deps: BosDeps,
  actor: BosActor,
  candidateId: string,
  kind: string,
  note: string | null,
  opts: { from?: Stage; to?: Stage; date?: string } = {},
): Promise<void> {
  await exec(
    deps.db,
    `INSERT INTO bos_candidate_events (id, tenant_id, candidate_id, kind, from_stage, to_stage, note, event_date, actor_name, created_by)
     VALUES (:id, :t, :candidateId, :kind, :from, :to, :note, :date, :actorName, :userId)`,
    {
      id: randomUUID(),
      t: actor.tenantId,
      candidateId,
      kind,
      from: opts.from ?? null,
      to: opts.to ?? null,
      note: note ? note.slice(0, 500) : null,
      date: opts.date ?? todayISO(),
      actorName: actor.name ?? actor.email ?? null,
      userId: actor.userId,
    },
  );
}

/* ---------- Routes ---------- */

export function registerRecruitment(router: Router, deps: BosDeps): void {
  router.get("/recruitment/overview", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const t = actor.tenantId;
    const today = todayISO();
    const [settings, openings, candidates, departments] = await Promise.all([
      getSettings(deps, t),
      rows<OpeningRow>(deps.db, `${OPENING_SELECT} WHERE o.tenant_id = :t ORDER BY FIELD(o.status, 'open', 'draft', 'on_hold', 'closed'), o.created_at DESC`, { t }),
      rows<CandidateRow>(deps.db, `${CANDIDATE_SELECT} WHERE c.tenant_id = :t ORDER BY c.applied_on DESC, c.created_at DESC LIMIT 3000`, { t }),
      rows<{ id: string; name: string }>(deps.db, `SELECT id, name FROM bos_departments WHERE tenant_id = :t ORDER BY name`, { t }),
    ]);
    const list = candidates.map(mapCandidate);
    const roles = openings.map(mapOpening);
    const counts = new Map<string, { applicants: number; active: number; hired: number }>();
    for (const c of list) {
      const n = counts.get(c.openingId) ?? { applicants: 0, active: 0, hired: 0 };
      n.applicants++;
      if (isOpenStage(c.stage)) n.active++;
      if (c.stage === "hired") n.hired++;
      counts.set(c.openingId, n);
    }
    const fyStart = fiscalYearStart(today, settings.fiscalYearStart);
    res.json({
      today,
      fyStart,
      departments,
      openings: roles.map((o) => ({ ...o, ...(counts.get(o.id) ?? { applicants: 0, active: 0, hired: 0 }) })),
      candidates: list,
      truncated: candidates.length >= 3000,
      totals: recruitmentTotals(roles, list, today, fyStart),
    });
  });

  router.post("/recruitment/openings", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(OpeningFields, req.body);
    const t = actor.tenantId;
    checkSalary(input.salaryMin, input.salaryMax);
    await checkDepartment(deps, t, input.departmentId);
    const id = randomUUID();
    const today = todayISO();
    await exec(
      deps.db,
      `INSERT INTO bos_job_openings (id, tenant_id, title, department_id, location, employment_type, openings, priority, status, salary_min, salary_max, target_date, description, opened_on, closed_on, created_by)
       VALUES (:id, :t, :title, :departmentId, :location, :employmentType, :openings, :priority, :status, :salaryMin, :salaryMax, :targetDate, :description, :openedOn, :closedOn, :userId)`,
      {
        id,
        t,
        title: input.title,
        departmentId: input.departmentId || null,
        location: input.location ?? null,
        employmentType: input.employmentType,
        openings: input.openings,
        priority: input.priority,
        status: input.status,
        salaryMin: input.salaryMin ?? null,
        salaryMax: input.salaryMax ?? null,
        targetDate: input.targetDate ?? null,
        description: input.description ?? null,
        openedOn: input.status === "draft" ? null : today,
        closedOn: input.status === "closed" ? today : null,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: "opening.create", entityType: "opening", entityId: id, summary: `Added the role ${input.title} (${input.openings} opening${input.openings === 1 ? "" : "s"})`, ip: req.ip });
    res.status(201).json({ opening: mapOpening(await loadOpening(deps, t, id)) });
  });

  router.patch("/recruitment/openings/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parsePatch(OpeningFields, req.body);
    const t = actor.tenantId;
    const o = await loadOpening(deps, t, req.params.id);
    const salaryMin = input.salaryMin === undefined ? optMoney(o.salary_min) : input.salaryMin;
    const salaryMax = input.salaryMax === undefined ? optMoney(o.salary_max) : input.salaryMax;
    checkSalary(salaryMin, salaryMax);
    if (input.departmentId !== undefined) await checkDepartment(deps, t, input.departmentId);
    const status = input.status ?? o.status;
    const today = todayISO();
    await exec(
      deps.db,
      `UPDATE bos_job_openings SET title = :title, department_id = :departmentId, location = :location, employment_type = :employmentType, openings = :openings,
         priority = :priority, status = :status, salary_min = :salaryMin, salary_max = :salaryMax, target_date = :targetDate, description = :description,
         opened_on = :openedOn, closed_on = :closedOn
       WHERE id = :id`,
      {
        id: o.id,
        title: input.title ?? o.title,
        departmentId: input.departmentId === undefined ? o.department_id : input.departmentId || null,
        location: input.location === undefined ? o.location : input.location,
        employmentType: input.employmentType ?? o.employment_type,
        openings: input.openings ?? o.openings,
        priority: input.priority ?? o.priority,
        status,
        salaryMin,
        salaryMax,
        targetDate: input.targetDate === undefined ? o.target_date : input.targetDate,
        description: input.description === undefined ? o.description : input.description,
        openedOn: o.opened_on ?? (status === "draft" ? null : today),
        closedOn: status === "closed" ? (o.closed_on ?? today) : null,
      },
    );
    const statusText: Record<OpeningStatus, string> = { draft: "Moved back to draft", open: "Opened", on_hold: "Put on hold", closed: "Closed" };
    const summary = input.status && input.status !== o.status ? `${statusText[input.status]} the role ${input.title ?? o.title}` : `Updated the role ${input.title ?? o.title}`;
    await recordEvent(deps, actor, { type: "opening.update", entityType: "opening", entityId: o.id, summary, ip: req.ip });
    res.json({ opening: mapOpening(await loadOpening(deps, t, o.id)) });
  });

  router.delete("/recruitment/openings/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const o = await loadOpening(deps, actor.tenantId, req.params.id);
    const used = await one(deps.db, `SELECT 1 FROM bos_candidates WHERE opening_id = :id LIMIT 1`, { id: o.id });
    if (used) throw new BosError(409, "This role has candidates — close it instead");
    await exec(deps.db, `DELETE FROM bos_job_openings WHERE id = :id`, { id: o.id });
    await recordEvent(deps, actor, { type: "opening.delete", entityType: "opening", entityId: o.id, summary: `Deleted the role ${o.title}`, ip: req.ip });
    res.status(204).end();
  });

  router.get("/recruitment/candidates/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const c = await loadCandidate(deps, actor.tenantId, req.params.id);
    const [opening, events] = await Promise.all([
      loadOpening(deps, actor.tenantId, c.opening_id),
      rows<{ id: string; kind: string; from_stage: Stage | null; to_stage: Stage | null; note: string | null; event_date: string; actor_name: string | null; created_at: string }>(
        deps.db,
        `SELECT id, kind, from_stage, to_stage, note, event_date, actor_name, created_at FROM bos_candidate_events WHERE candidate_id = :id ORDER BY event_date DESC, seq DESC`,
        { id: c.id },
      ),
    ]);
    res.json({
      candidate: mapCandidate(c),
      opening: mapOpening(opening),
      events: events.map((e) => ({ id: e.id, kind: e.kind, fromStage: e.from_stage, toStage: e.to_stage, note: e.note, date: e.event_date, actorName: e.actor_name, createdAt: e.created_at })),
    });
  });

  router.post("/recruitment/candidates", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(CandidateFields, req.body);
    const t = actor.tenantId;
    const today = todayISO();
    if (input.appliedOn > today) throw new BosError(400, "The application date can't be in the future");
    const opening = await loadOpening(deps, t, input.openingId);
    if (opening.status === "closed") throw new BosError(409, "This role is closed — reopen it to add candidates");
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_candidates (id, tenant_id, opening_id, name, email, phone, source, referred_by, applied_on, stage, stage_on, rating, current_ctc, expected_ctc, notice_days, resume_link, notes, created_by)
       VALUES (:id, :t, :openingId, :name, :email, :phone, :source, :referredBy, :appliedOn, 'applied', :appliedOn, :rating, :currentCtc, :expectedCtc, :noticeDays, :resumeLink, :notes, :userId)`,
      {
        id,
        t,
        openingId: opening.id,
        name: input.name,
        email: input.email || null,
        phone: input.phone ?? null,
        source: input.source,
        referredBy: input.referredBy ?? null,
        appliedOn: input.appliedOn,
        rating: input.rating ?? null,
        currentCtc: input.currentCtc ?? null,
        expectedCtc: input.expectedCtc ?? null,
        noticeDays: input.noticeDays ?? null,
        resumeLink: input.resumeLink || null,
        notes: input.notes ?? null,
        userId: actor.userId,
      },
    );
    await logCandidate(deps, actor, id, "applied", `Applied for ${opening.title} via ${input.source}`, { to: "applied", date: input.appliedOn });
    await recordEvent(deps, actor, { type: "candidate.create", entityType: "candidate", entityId: id, summary: `Added ${input.name} for ${opening.title} (${input.source})`, ip: req.ip });
    res.status(201).json({ candidate: mapCandidate(await loadCandidate(deps, t, id)) });
  });

  router.patch("/recruitment/candidates/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parsePatch(CandidateFields, req.body);
    const t = actor.tenantId;
    const c = await loadCandidate(deps, t, req.params.id);
    if (input.appliedOn && input.appliedOn > todayISO()) throw new BosError(400, "The application date can't be in the future");
    if (input.openingId && input.openingId !== c.opening_id) {
      const o = await loadOpening(deps, t, input.openingId);
      if (o.status === "closed") throw new BosError(409, "That role is closed");
    }
    const keep = <K extends keyof typeof input>(k: K, current: unknown) => (input[k] === undefined ? current : input[k] === "" ? null : input[k]);
    await exec(
      deps.db,
      `UPDATE bos_candidates SET opening_id = :openingId, name = :name, email = :email, phone = :phone, source = :source, referred_by = :referredBy, applied_on = :appliedOn,
         rating = :rating, current_ctc = :currentCtc, expected_ctc = :expectedCtc, notice_days = :noticeDays, resume_link = :resumeLink, notes = :notes
       WHERE id = :id`,
      {
        id: c.id,
        openingId: input.openingId ?? c.opening_id,
        name: input.name ?? c.name,
        email: keep("email", c.email),
        phone: keep("phone", c.phone),
        source: input.source ?? c.source,
        referredBy: keep("referredBy", c.referred_by),
        appliedOn: input.appliedOn ?? c.applied_on,
        rating: keep("rating", c.rating),
        currentCtc: keep("currentCtc", c.current_ctc),
        expectedCtc: keep("expectedCtc", c.expected_ctc),
        noticeDays: keep("noticeDays", c.notice_days),
        resumeLink: keep("resumeLink", c.resume_link),
        notes: keep("notes", c.notes),
      },
    );
    await recordEvent(deps, actor, { type: "candidate.update", entityType: "candidate", entityId: c.id, summary: `Updated ${input.name ?? c.name}'s application`, ip: req.ip });
    res.json({ candidate: mapCandidate(await loadCandidate(deps, t, c.id)) });
  });

  router.delete("/recruitment/candidates/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const c = await loadCandidate(deps, actor.tenantId, req.params.id);
    if (c.employee_id) throw new BosError(409, "An employee record was created from this candidate, so the application stays on record");
    await exec(deps.db, `DELETE FROM bos_candidates WHERE id = :id`, { id: c.id });
    await recordEvent(deps, actor, { type: "candidate.delete", entityType: "candidate", entityId: c.id, summary: `Deleted ${c.name}'s application for ${c.opening_title}`, ip: req.ip });
    res.status(204).end();
  });

  router.post("/recruitment/candidates/:id/stage", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(StageInput, req.body);
    const t = actor.tenantId;
    const c = await loadCandidate(deps, t, req.params.id);
    const problem = stageMoveProblem(c.stage, input.stage);
    if (problem) throw new BosError(409, problem);
    const closing = CLOSED_STAGES.includes(input.stage);
    const today = todayISO();
    await exec(deps.db, `UPDATE bos_candidates SET stage = :stage, stage_on = :today, closed_reason = :reason WHERE id = :id`, {
      id: c.id,
      stage: input.stage,
      today,
      reason: closing ? (input.reason ?? null) : null,
    });
    const reopening = CLOSED_STAGES.includes(c.stage) && !closing;
    const note = closing && input.reason ? input.reason : reopening ? "Application reopened" : null;
    await logCandidate(deps, actor, c.id, "stage", note, { from: c.stage, to: input.stage });
    await recordEvent(deps, actor, {
      type: "candidate.stage",
      entityType: "candidate",
      entityId: c.id,
      summary:
        input.stage === "rejected"
          ? `Rejected ${c.name} for ${c.opening_title}`
          : input.stage === "withdrawn"
            ? `${c.name} withdrew from ${c.opening_title}`
            : `Moved ${c.name} (${c.opening_title}) to ${STAGE_LABEL[input.stage]}`,
      ip: req.ip,
    });
    res.json({ candidate: mapCandidate(await loadCandidate(deps, t, c.id)) });
  });

  router.post("/recruitment/candidates/:id/interview", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(InterviewInput, req.body);
    const t = actor.tenantId;
    const c = await loadCandidate(deps, t, req.params.id);
    if (!isOpenStage(c.stage)) throw new BosError(409, "Only candidates still in the pipeline can be interviewed");
    const date = input.at.slice(0, 10);
    if (date < c.applied_on) throw new BosError(400, "The interview can't be before the application date");
    const stage: Stage = c.stage === "applied" ? "interview" : c.stage;
    await exec(deps.db, `UPDATE bos_candidates SET interview_at = :at, interview_mode = :mode, interviewer = :interviewer, stage = :stage, stage_on = :stageOn WHERE id = :id`, {
      id: c.id,
      at: `${input.at.replace("T", " ")}:00`,
      mode: input.mode,
      interviewer: input.interviewer ?? null,
      stage,
      stageOn: stage === c.stage ? c.stage_on : todayISO(),
    });
    const when = `${dayLabel(date)}, ${input.at.slice(11)} · ${MODE_LABEL[input.mode]}${input.interviewer ? ` with ${input.interviewer}` : ""}`;
    await logCandidate(deps, actor, c.id, "interview", `Interview ${when}${input.note ? ` — ${input.note}` : ""}`, stage === c.stage ? {} : { from: c.stage, to: stage });
    await recordEvent(deps, actor, { type: "candidate.interview", entityType: "candidate", entityId: c.id, summary: `Scheduled an interview with ${c.name} on ${when}`, ip: req.ip });
    res.json({ candidate: mapCandidate(await loadCandidate(deps, t, c.id)) });
  });

  router.post("/recruitment/candidates/:id/offer", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(OfferInput, req.body);
    const t = actor.tenantId;
    const c = await loadCandidate(deps, t, req.params.id);
    if (!isOpenStage(c.stage)) throw new BosError(409, "Only candidates still in the pipeline can be made an offer");
    if (input.sentOn > todayISO()) throw new BosError(400, "The offer date can't be in the future");
    if (input.sentOn < c.applied_on) throw new BosError(400, "The offer can't be before the application date");
    if (input.joiningDate < input.sentOn) throw new BosError(400, "The joining date can't be before the offer date");
    await exec(
      deps.db,
      `UPDATE bos_candidates SET offer_ctc = :ctc, offer_sent_on = :sentOn, offer_status = 'sent', offer_responded_on = NULL, offer_terms = :terms, joining_date = :joiningDate,
         stage = 'offer', stage_on = :stageOn WHERE id = :id`,
      { id: c.id, ctc: input.ctc, sentOn: input.sentOn, terms: input.terms ?? null, joiningDate: input.joiningDate, stageOn: c.stage === "offer" ? c.stage_on : todayISO() },
    );
    const note = `Offer of ${inr(input.ctc)} a year, joining ${dayLabel(input.joiningDate)}`;
    await logCandidate(deps, actor, c.id, "offer", note, c.stage === "offer" ? { date: input.sentOn } : { from: c.stage, to: "offer", date: input.sentOn });
    await recordEvent(deps, actor, { type: "candidate.offer", entityType: "candidate", entityId: c.id, summary: `Sent ${c.name} an offer for ${c.opening_title}: ${inr(input.ctc)} a year`, ip: req.ip });
    res.json({ candidate: mapCandidate(await loadCandidate(deps, t, c.id)) });
  });

  router.post("/recruitment/candidates/:id/offer-response", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(ResponseInput, req.body);
    const t = actor.tenantId;
    const c = await loadCandidate(deps, t, req.params.id);
    if (c.stage !== "offer" || c.offer_status !== "sent" || !c.offer_sent_on) throw new BosError(409, "There's no open offer to respond to");
    if (input.date > todayISO()) throw new BosError(400, "The response date can't be in the future");
    if (input.date < c.offer_sent_on) throw new BosError(400, "The response can't be before the offer was sent");
    if (input.response === "accepted") {
      const joining = input.joiningDate ?? c.joining_date ?? input.date;
      if (joining < input.date) throw new BosError(400, "The joining date can't be before the acceptance");
      await exec(
        deps.db,
        `UPDATE bos_candidates SET offer_status = 'accepted', offer_responded_on = :date, stage = 'hired', stage_on = :date, hired_on = :date, joining_date = :joining,
           onboarding = COALESCE(onboarding, JSON_OBJECT()), closed_reason = NULL WHERE id = :id`,
        { id: c.id, date: input.date, joining },
      );
      await logCandidate(deps, actor, c.id, "offer_response", `Accepted the offer, joining ${dayLabel(joining)}${input.note ? ` — ${input.note}` : ""}`, { from: "offer", to: "hired", date: input.date });
      await recordEvent(deps, actor, {
        type: "candidate.hired",
        entityType: "candidate",
        entityId: c.id,
        summary: `${c.name} accepted the offer for ${c.opening_title}, joining ${dayLabel(joining)}`,
        notice: { kind: "activity", title: "Offer accepted", body: `${c.name} · ${c.opening_title} · joining ${dayLabel(joining)}`, path: "?ws=hr&m=recruit" },
        ip: req.ip,
      });
    } else {
      const reason = input.note || "Declined the offer";
      await exec(deps.db, `UPDATE bos_candidates SET offer_status = 'declined', offer_responded_on = :date, stage = 'withdrawn', stage_on = :date, closed_reason = :reason WHERE id = :id`, {
        id: c.id,
        date: input.date,
        reason,
      });
      await logCandidate(deps, actor, c.id, "offer_response", reason, { from: "offer", to: "withdrawn", date: input.date });
      await recordEvent(deps, actor, { type: "candidate.declined", entityType: "candidate", entityId: c.id, summary: `${c.name} declined the offer for ${c.opening_title}`, ip: req.ip });
    }
    res.json({ candidate: mapCandidate(await loadCandidate(deps, t, c.id)) });
  });

  router.post("/recruitment/candidates/:id/undo-hire", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const t = actor.tenantId;
    const c = await loadCandidate(deps, t, req.params.id);
    if (c.stage !== "hired") throw new BosError(409, "This candidate isn't hired");
    if (c.employee_id) throw new BosError(409, "An employee record was created from this candidate — update the employee instead");
    await exec(deps.db, `UPDATE bos_candidates SET stage = 'offer', stage_on = :today, offer_status = 'sent', offer_responded_on = NULL, hired_on = NULL WHERE id = :id`, { id: c.id, today: todayISO() });
    await logCandidate(deps, actor, c.id, "stage", "Hire undone — the offer is open again", { from: "hired", to: "offer" });
    await recordEvent(deps, actor, { type: "candidate.stage", entityType: "candidate", entityId: c.id, summary: `Undid the hire of ${c.name} · ${c.opening_title}`, ip: req.ip });
    res.json({ candidate: mapCandidate(await loadCandidate(deps, t, c.id)) });
  });

  router.post("/recruitment/candidates/:id/notes", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(NoteInput, req.body);
    const c = await loadCandidate(deps, actor.tenantId, req.params.id);
    await logCandidate(deps, actor, c.id, "note", input.note);
    res.status(201).json({ ok: true });
  });

  router.patch("/recruitment/candidates/:id/onboarding", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(OnboardingInput, req.body);
    const t = actor.tenantId;
    const c = await loadCandidate(deps, t, req.params.id);
    if (c.stage !== "hired") throw new BosError(409, "Onboarding starts once the offer is accepted");
    const today = todayISO();
    if (input.done && input.date && input.date > today) throw new BosError(400, "A task can't be marked done in the future");
    const scheduled = input.task === "induction" && !input.done ? (input.date ?? null) : null;
    const state = input.done ? { done: true, date: input.date ?? today } : { done: false, date: scheduled };
    const onboarding = { ...readOnboarding(json(c.onboarding, null)), [input.task]: state };
    await exec(deps.db, `UPDATE bos_candidates SET onboarding = :onboarding WHERE id = :id`, { id: c.id, onboarding: JSON.stringify(onboarding) });
    const label = TASK_LABEL[input.task];
    const note = input.done ? `${label} done` : scheduled ? `${label} scheduled for ${dayLabel(scheduled)}` : `${label} marked pending`;
    await logCandidate(deps, actor, c.id, "onboarding", note);
    await recordEvent(deps, actor, { type: "candidate.onboarding", entityType: "candidate", entityId: c.id, summary: `Onboarding · ${c.name}: ${note.toLowerCase()}`, ip: req.ip });
    res.json({ candidate: mapCandidate(await loadCandidate(deps, t, c.id)) });
  });

  router.post("/recruitment/candidates/:id/employee", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(NewEmployeeInput, req.body);
    const t = actor.tenantId;
    const c = await loadCandidate(deps, t, req.params.id);
    if (c.stage !== "hired") throw new BosError(409, "Create the employee record once the offer is accepted");
    if (c.employee_id) throw new BosError(409, "An employee record already exists for this candidate");
    const settings = await getSettings(deps, t);
    const id = randomUUID();
    const empCode = await tx(deps.db, async (conn) => {
      const code = await insertEmployee(conn, t, settings.employeePrefix, id, input);
      const linked = await exec(conn, `UPDATE bos_candidates SET employee_id = :employeeId WHERE id = :id AND employee_id IS NULL`, { id: c.id, employeeId: id });
      if (!linked.affectedRows) throw new BosError(409, "An employee record already exists for this candidate");
      return code;
    });
    await recordEmployeeCreated(deps, actor, id, empCode, input, req.ip);
    await logCandidate(deps, actor, c.id, "employee", `Employee record ${empCode} created`);
    res.status(201).json({ candidate: mapCandidate(await loadCandidate(deps, t, c.id)), employee: { id, empCode } });
  });
}
