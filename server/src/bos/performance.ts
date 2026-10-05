import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, isoDate, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, money, nextSequence, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { fiscalYearStart, todayISO } from "./logic.js";
import {
  certificateExpiry,
  certificateStatus,
  fiscalQuarterStart,
  KRA_STATUSES,
  performanceTotals,
  PIP_OUTCOMES,
  PROGRAM_TEAMS,
  promotionProblem,
  RECOGNITION_CATEGORIES,
  type EnrollmentStatus,
  type KraStatus,
  type PipStatus,
  type ProgramTeam,
  type PromotionStatus,
} from "./performance-logic.js";
import { getSettings } from "./workspace.js";

const managerOnly = (actor: BosActor) => {
  if (!isManager(actor)) throw forbidden("Performance & Learning is available to owners and admins");
};
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const KRA_LABEL: Record<KraStatus, string> = { on_track: "on track", at_risk: "at risk", off_track: "off track", achieved: "achieved", missed: "missed" };
const OUTCOME_LABEL: Record<(typeof PIP_OUTCOMES)[number], string> = { passed: "completed successfully", failed: "not met", cancelled: "cancelled" };
const LIMIT = 3000;

/* ---------- Inputs ---------- */

const ids = z.array(z.string().min(1).max(36)).min(1, "Pick at least one employee").max(500);
const link = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Use a link starting with http:// or https://")
  .nullable()
  .optional();
const ProgramFields = z.object({
  title: z.string().trim().min(1, "Required").max(160),
  team: z.enum(PROGRAM_TEAMS).default("all"),
  durationDays: z.coerce
    .number()
    .min(0.5, "At least half a day")
    .max(365)
    .refine((v) => Number.isInteger(v * 2), "Use whole or half days")
    .nullable()
    .optional(),
  certificate: z.boolean().default(false),
  validityMonths: z.coerce.number().int("Whole months").min(1).max(120).nullable().optional(),
  mandatory: z.boolean().default(false),
  description: optText(5000),
});
const ProgramPatch = ProgramFields.extend({ archived: z.boolean() });
const EnrollInput = z.object({ programId: z.string().min(1, "Pick a program").max(36), employeeIds: ids, sessionDate: isoDate.nullable().optional(), note: optText(300) });
const SessionInput = z.object({ sessionDate: isoDate.nullable(), note: optText(300) });
const CompleteInput = z.object({ date: isoDate });
const CertificateFields = z.object({
  employeeId: z.string().min(1, "Pick an employee").max(36),
  name: z.string().trim().min(1, "Required").max(160),
  issuer: optText(160),
  credentialNo: optText(80),
  link,
  issuedOn: isoDate,
  expiresOn: isoDate.nullable().optional(),
});
const KraFields = z.object({
  title: z.string().trim().min(1, "Required").max(200),
  target: optText(80),
  weight: z.coerce.number().int("Whole number").min(1).max(100).nullable().optional(),
  periodStart: isoDate,
  periodEnd: isoDate,
});
const KraInput = KraFields.extend({ employeeIds: ids });
const KraPatch = KraFields.extend({
  status: z.enum(KRA_STATUSES),
  progress: z.coerce.number().int().min(0).max(100).nullable(),
  note: optText(500),
});
const PromotionInput = z.object({
  employeeId: z.string().min(1, "Pick an employee").max(36),
  proposedDesignation: z.string().trim().min(1, "Required").max(120),
  proposedCtc: z.coerce.number().positive().max(1e11).nullable().optional(),
  effectiveDate: isoDate,
  reason: optText(2000),
});
const DecisionInput = z.object({ decision: z.enum(["approved", "rejected"]), note: optText(300), apply: z.boolean().default(false) });
const PipInput = z.object({
  employeeId: z.string().min(1, "Pick an employee").max(36),
  reason: z.string().trim().min(1, "Say what needs to improve").max(300),
  goals: optText(5000),
  startedOn: isoDate,
  reviewOn: isoDate,
});
const PipPatch = z.object({ reason: z.string().trim().min(1).max(300), goals: optText(5000), reviewOn: isoDate });
const PipClose = z.object({ outcome: z.enum(PIP_OUTCOMES), date: isoDate, note: optText(300) });
const RecognitionInput = z.object({
  employeeId: z.string().min(1, "Pick an employee").max(36),
  category: z.string().trim().min(1, "Pick an award").max(80),
  awardedOn: isoDate,
  note: optText(300),
});

/* ---------- Rows ---------- */

const NAME = `CONCAT_WS(' ', e.first_name, e.last_name)`;
type Person = { id: string; name: string; status: string; designation: string | null; ctc_annual: string | null };
async function loadPerson(deps: BosDeps, tenantId: number, id: string, opts: { current?: boolean } = {}): Promise<Person> {
  const p = await one<Person>(deps.db, `SELECT e.id, ${NAME} AS name, e.status, e.designation, e.ctc_annual FROM bos_employees e WHERE e.id = :id AND e.tenant_id = :t`, { id, t: tenantId });
  if (!p) throw notFound("Employee");
  if (opts.current && p.status === "exited") throw new BosError(409, `${p.name} has left`);
  return p;
}
async function loadPeople(deps: BosDeps, tenantId: number, list: ReadonlyArray<string>): Promise<Person[]> {
  const unique = [...new Set(list)];
  const found = await rows<Person>(deps.db, `SELECT e.id, ${NAME} AS name, e.status, e.designation, e.ctc_annual FROM bos_employees e WHERE e.tenant_id = :t AND e.id IN (:ids)`, { t: tenantId, ids: unique });
  if (found.length !== unique.length) throw new BosError(400, "Pick employees from the list");
  const left = found.filter((p) => p.status === "exited");
  if (left.length) throw new BosError(409, `${left.map((p) => p.name).join(", ")} ${left.length === 1 ? "has" : "have"} left`);
  return found;
}

type ProgramRow = {
  id: string;
  title: string;
  team: ProgramTeam;
  duration_days: string | null;
  certificate: number;
  validity_months: number | null;
  mandatory: number;
  description: string | null;
  archived: number;
  created_at: string;
};
const mapProgram = (p: ProgramRow) => ({
  id: p.id,
  title: p.title,
  team: p.team,
  durationDays: p.duration_days === null ? null : Number(p.duration_days),
  certificate: Boolean(p.certificate),
  validityMonths: p.validity_months === null ? null : Number(p.validity_months),
  mandatory: Boolean(p.mandatory),
  description: p.description,
  archived: Boolean(p.archived),
  createdAt: p.created_at,
});
async function loadProgram(deps: BosDeps, tenantId: number, id: string): Promise<ProgramRow> {
  const p = await one<ProgramRow>(deps.db, `SELECT * FROM bos_training_programs WHERE id = :id AND tenant_id = :t`, { id, t: tenantId });
  if (!p) throw notFound("Training program");
  return p;
}

type EnrollmentRow = {
  id: string;
  program_id: string;
  program_title: string;
  employee_id: string;
  employee_name: string;
  enrolled_on: string;
  session_date: string | null;
  status: EnrollmentStatus;
  completed_on: string | null;
  note: string | null;
  certificate_id: string | null;
};
const ENROLLMENT_SELECT = `
  SELECT n.*, p.title AS program_title, ${NAME} AS employee_name, c.id AS certificate_id
  FROM bos_training_enrollments n
  JOIN bos_training_programs p ON p.id = n.program_id
  JOIN bos_employees e ON e.id = n.employee_id
  LEFT JOIN bos_certifications c ON c.enrollment_id = n.id`;
const mapEnrollment = (n: EnrollmentRow) => ({
  id: n.id,
  programId: n.program_id,
  programTitle: n.program_title,
  employeeId: n.employee_id,
  employeeName: n.employee_name,
  enrolledOn: n.enrolled_on,
  sessionDate: n.session_date,
  status: n.status,
  completedOn: n.completed_on,
  note: n.note,
  certificateId: n.certificate_id,
});
async function loadEnrollment(deps: BosDeps, tenantId: number, id: string): Promise<EnrollmentRow> {
  const n = await one<EnrollmentRow>(deps.db, `${ENROLLMENT_SELECT} WHERE n.id = :id AND n.tenant_id = :t`, { id, t: tenantId });
  if (!n) throw notFound("Enrollment");
  return n;
}

type CertificateRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  emp_code: string;
  name: string;
  program_id: string | null;
  enrollment_id: string | null;
  cert_no: string | null;
  issuer: string | null;
  credential_no: string | null;
  link: string | null;
  issued_on: string;
  expires_on: string | null;
};
const CERTIFICATE_SELECT = `SELECT c.*, ${NAME} AS employee_name, e.emp_code FROM bos_certifications c JOIN bos_employees e ON e.id = c.employee_id`;
const mapCertificate = (c: CertificateRow, today: string) => ({
  id: c.id,
  employeeId: c.employee_id,
  employeeName: c.employee_name,
  employeeCode: c.emp_code,
  name: c.name,
  programId: c.program_id,
  enrollmentId: c.enrollment_id,
  certNo: c.cert_no,
  issuer: c.issuer,
  credentialNo: c.credential_no,
  link: c.link,
  issuedOn: c.issued_on,
  expiresOn: c.expires_on,
  status: certificateStatus(c.expires_on, today),
});
async function loadCertificate(deps: BosDeps, tenantId: number, id: string): Promise<CertificateRow> {
  const c = await one<CertificateRow>(deps.db, `${CERTIFICATE_SELECT} WHERE c.id = :id AND c.tenant_id = :t`, { id, t: tenantId });
  if (!c) throw notFound("Certificate");
  return c;
}

type KraRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  designation: string | null;
  title: string;
  target: string | null;
  weight: number | null;
  period_start: string;
  period_end: string;
  status: KraStatus;
  progress: number | null;
  note: string | null;
  reviewed_on: string | null;
};
const KRA_SELECT = `SELECT k.*, ${NAME} AS employee_name, e.designation FROM bos_kras k JOIN bos_employees e ON e.id = k.employee_id`;
const mapKra = (k: KraRow) => ({
  id: k.id,
  employeeId: k.employee_id,
  employeeName: k.employee_name,
  designation: k.designation,
  title: k.title,
  target: k.target,
  weight: k.weight === null ? null : Number(k.weight),
  periodStart: k.period_start,
  periodEnd: k.period_end,
  status: k.status,
  progress: k.progress === null ? null : Number(k.progress),
  note: k.note,
  reviewedOn: k.reviewed_on,
});
async function loadKra(deps: BosDeps, tenantId: number, id: string): Promise<KraRow> {
  const k = await one<KraRow>(deps.db, `${KRA_SELECT} WHERE k.id = :id AND k.tenant_id = :t`, { id, t: tenantId });
  if (!k) throw notFound("KRA");
  return k;
}

type PromotionRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  current_designation: string | null;
  proposed_designation: string;
  current_ctc: string | null;
  proposed_ctc: string | null;
  effective_date: string;
  reason: string | null;
  status: PromotionStatus;
  decided_on: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  applied: number;
  created_at: string;
};
const PROMOTION_SELECT = `SELECT r.*, ${NAME} AS employee_name FROM bos_promotions r JOIN bos_employees e ON e.id = r.employee_id`;
const optMoney = (v: string | null) => (v === null ? null : money(v));
const mapPromotion = (r: PromotionRow) => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  currentDesignation: r.current_designation,
  proposedDesignation: r.proposed_designation,
  currentCtc: optMoney(r.current_ctc),
  proposedCtc: optMoney(r.proposed_ctc),
  effectiveDate: r.effective_date,
  reason: r.reason,
  status: r.status,
  decidedOn: r.decided_on,
  decidedBy: r.decided_by_name,
  decisionNote: r.decision_note,
  applied: Boolean(r.applied),
  createdAt: r.created_at,
});
async function loadPromotion(deps: BosDeps, tenantId: number, id: string): Promise<PromotionRow> {
  const r = await one<PromotionRow>(deps.db, `${PROMOTION_SELECT} WHERE r.id = :id AND r.tenant_id = :t`, { id, t: tenantId });
  if (!r) throw notFound("Promotion");
  return r;
}

type PipRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  designation: string | null;
  department_name: string | null;
  reason: string;
  goals: string | null;
  started_on: string;
  review_on: string;
  status: PipStatus;
  closed_on: string | null;
  outcome_note: string | null;
};
const PIP_SELECT = `SELECT p.*, ${NAME} AS employee_name, e.designation, d.name AS department_name FROM bos_pips p JOIN bos_employees e ON e.id = p.employee_id LEFT JOIN bos_departments d ON d.id = e.department_id`;
const mapPip = (p: PipRow) => ({
  id: p.id,
  employeeId: p.employee_id,
  employeeName: p.employee_name,
  designation: p.designation,
  departmentName: p.department_name,
  reason: p.reason,
  goals: p.goals,
  startedOn: p.started_on,
  reviewOn: p.review_on,
  status: p.status,
  closedOn: p.closed_on,
  outcomeNote: p.outcome_note,
});
async function loadPip(deps: BosDeps, tenantId: number, id: string): Promise<PipRow> {
  const p = await one<PipRow>(deps.db, `${PIP_SELECT} WHERE p.id = :id AND p.tenant_id = :t`, { id, t: tenantId });
  if (!p) throw notFound("Improvement plan");
  return p;
}

type RecognitionRow = { id: string; employee_id: string; employee_name: string; category: string; awarded_on: string; note: string | null };
const RECOGNITION_SELECT = `SELECT g.*, ${NAME} AS employee_name FROM bos_recognitions g JOIN bos_employees e ON e.id = g.employee_id`;
const mapRecognition = (g: RecognitionRow) => ({ id: g.id, employeeId: g.employee_id, employeeName: g.employee_name, category: g.category, awardedOn: g.awarded_on, note: g.note });

function checkPeriod(start: string, end: string) {
  if (end < start) throw new BosError(400, "The period ends before it starts");
  if (end > `${Number(start.slice(0, 4)) + 3}${start.slice(4)}`) throw new BosError(400, "Keep a KRA period to three years or less");
}
const notFuture = (date: string, what: string) => {
  if (date > todayISO()) throw new BosError(400, `${what} can't be in the future`);
};

/* ---------- Routes ---------- */

export function registerPerformance(router: Router, deps: BosDeps): void {
  router.get("/performance/overview", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const t = actor.tenantId;
    const today = todayISO();
    const [settings, employees, programs, enrollments, certificates, kras, promotions, pips, recognitions] = await Promise.all([
      getSettings(deps, t),
      rows<{ id: string; emp_code: string; name: string; designation: string | null; department_name: string | null; status: string; ctc_annual: string | null }>(
        deps.db,
        `SELECT e.id, e.emp_code, ${NAME} AS name, e.designation, d.name AS department_name, e.status, e.ctc_annual
         FROM bos_employees e LEFT JOIN bos_departments d ON d.id = e.department_id
         WHERE e.tenant_id = :t AND e.status <> 'exited' ORDER BY e.first_name, e.last_name`,
        { t },
      ),
      rows<ProgramRow>(deps.db, `SELECT * FROM bos_training_programs WHERE tenant_id = :t ORDER BY archived, title`, { t }),
      rows<EnrollmentRow>(deps.db, `${ENROLLMENT_SELECT} WHERE n.tenant_id = :t ORDER BY n.enrolled_on DESC, n.created_at DESC LIMIT ${LIMIT}`, { t }),
      rows<CertificateRow>(deps.db, `${CERTIFICATE_SELECT} WHERE c.tenant_id = :t ORDER BY c.issued_on DESC, c.created_at DESC LIMIT ${LIMIT}`, { t }),
      rows<KraRow>(deps.db, `${KRA_SELECT} WHERE k.tenant_id = :t ORDER BY k.period_end DESC, employee_name, k.created_at LIMIT ${LIMIT}`, { t }),
      rows<PromotionRow>(deps.db, `${PROMOTION_SELECT} WHERE r.tenant_id = :t ORDER BY r.status = 'pending' DESC, r.created_at DESC LIMIT 500`, { t }),
      rows<PipRow>(deps.db, `${PIP_SELECT} WHERE p.tenant_id = :t ORDER BY p.status = 'active' DESC, p.review_on, p.created_at DESC LIMIT 500`, { t }),
      rows<RecognitionRow>(deps.db, `${RECOGNITION_SELECT} WHERE g.tenant_id = :t ORDER BY g.awarded_on DESC, g.created_at DESC LIMIT 500`, { t }),
    ]);
    const fyStart = fiscalYearStart(today, settings.fiscalYearStart);
    const quarterStart = fiscalQuarterStart(today, settings.fiscalYearStart);
    const programList = programs.map(mapProgram);
    const enrollmentList = enrollments.map(mapEnrollment);
    const certificateList = certificates.map((c) => mapCertificate(c, today));
    const kraList = kras.map(mapKra);
    const promotionList = promotions.map(mapPromotion);
    const pipList = pips.map(mapPip);
    const recognitionList = recognitions.map(mapRecognition);
    const counts = new Map<string, { enrolled: number; completed: number }>();
    for (const n of enrollmentList) {
      const c = counts.get(n.programId) ?? { enrolled: 0, completed: 0 };
      if (n.status === "enrolled") c.enrolled++;
      if (n.status === "completed") c.completed++;
      counts.set(n.programId, c);
    }
    res.json({
      today,
      fyStart,
      quarterStart,
      employees: employees.map((e) => ({ id: e.id, empCode: e.emp_code, name: e.name, designation: e.designation, departmentName: e.department_name, status: e.status, ctcAnnual: optMoney(e.ctc_annual) })),
      programs: programList.map((p) => ({ ...p, ...(counts.get(p.id) ?? { enrolled: 0, completed: 0 }) })),
      enrollments: enrollmentList,
      certificates: certificateList,
      kras: kraList,
      promotions: promotionList,
      pips: pipList,
      recognitions: recognitionList,
      categories: [...new Set([...RECOGNITION_CATEGORIES, ...recognitionList.map((g) => g.category)])],
      truncated: [enrollments, certificates, kras].some((r) => r.length >= LIMIT),
      totals: performanceTotals(
        { employees, programs: programList, enrollments: enrollmentList, certificates: certificateList, kras: kraList, promotions: promotionList, pips: pipList, recognitions: recognitionList },
        today,
        fyStart,
        quarterStart,
      ),
    });
  });

  /* ----- Training programs ----- */

  router.post("/performance/programs", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(ProgramFields, req.body);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_training_programs (id, tenant_id, title, team, duration_days, certificate, validity_months, mandatory, description, created_by)
       VALUES (:id, :t, :title, :team, :durationDays, :certificate, :validityMonths, :mandatory, :description, :userId)`,
      {
        id,
        t: actor.tenantId,
        title: input.title,
        team: input.team,
        durationDays: input.durationDays ?? null,
        certificate: input.certificate ? 1 : 0,
        validityMonths: input.certificate ? (input.validityMonths ?? null) : null,
        mandatory: input.mandatory ? 1 : 0,
        description: input.description || null,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: "training.program", entityType: "training", entityId: id, summary: `Added the training program ${input.title}`, ip: req.ip });
    res.status(201).json({ program: mapProgram(await loadProgram(deps, actor.tenantId, id)) });
  });

  router.patch("/performance/programs/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parsePatch(ProgramPatch, req.body);
    const p = await loadProgram(deps, actor.tenantId, req.params.id);
    const certificate = input.certificate ?? Boolean(p.certificate);
    await exec(
      deps.db,
      `UPDATE bos_training_programs SET title = :title, team = :team, duration_days = :durationDays, certificate = :certificate, validity_months = :validityMonths,
         mandatory = :mandatory, description = :description, archived = :archived WHERE id = :id`,
      {
        id: p.id,
        title: input.title ?? p.title,
        team: input.team ?? p.team,
        durationDays: input.durationDays === undefined ? p.duration_days : input.durationDays,
        certificate: certificate ? 1 : 0,
        validityMonths: !certificate ? null : input.validityMonths === undefined ? p.validity_months : input.validityMonths,
        mandatory: (input.mandatory ?? Boolean(p.mandatory)) ? 1 : 0,
        description: input.description === undefined ? p.description : input.description || null,
        archived: (input.archived ?? Boolean(p.archived)) ? 1 : 0,
      },
    );
    const title = input.title ?? p.title;
    const summary = input.archived === true ? `Archived the training program ${title}` : input.archived === false ? `Restored the training program ${title}` : `Updated the training program ${title}`;
    await recordEvent(deps, actor, { type: "training.program", entityType: "training", entityId: p.id, summary, ip: req.ip });
    res.json({ program: mapProgram(await loadProgram(deps, actor.tenantId, p.id)) });
  });

  router.delete("/performance/programs/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const p = await loadProgram(deps, actor.tenantId, req.params.id);
    const used = await one(deps.db, `SELECT 1 FROM bos_training_enrollments WHERE program_id = :id LIMIT 1`, { id: p.id });
    if (used) throw new BosError(409, "People have enrolled in this program — archive it instead");
    await exec(deps.db, `DELETE FROM bos_training_programs WHERE id = :id`, { id: p.id });
    await recordEvent(deps, actor, { type: "training.program", entityType: "training", entityId: p.id, summary: `Deleted the training program ${p.title}`, ip: req.ip });
    res.status(204).end();
  });

  /* ----- Enrollments ----- */

  router.post("/performance/enrollments", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(EnrollInput, req.body);
    const t = actor.tenantId;
    const p = await loadProgram(deps, t, input.programId);
    if (p.archived) throw new BosError(409, "This program is archived — restore it to enroll people");
    const people = await loadPeople(deps, t, input.employeeIds);
    const already = new Set(
      (await rows<{ employee_id: string }>(deps.db, `SELECT employee_id FROM bos_training_enrollments WHERE program_id = :p AND status = 'enrolled' AND employee_id IN (:ids)`, { p: p.id, ids: people.map((x) => x.id) })).map(
        (r) => r.employee_id,
      ),
    );
    const add = people.filter((x) => !already.has(x.id));
    const today = todayISO();
    await tx(deps.db, async (conn) => {
      for (const person of add) {
        await exec(
          conn,
          `INSERT INTO bos_training_enrollments (id, tenant_id, program_id, employee_id, enrolled_on, session_date, note, created_by)
           VALUES (:id, :t, :programId, :employeeId, :today, :sessionDate, :note, :userId)`,
          { id: randomUUID(), t, programId: p.id, employeeId: person.id, today, sessionDate: input.sessionDate ?? null, note: input.note || null, userId: actor.userId },
        );
      }
    });
    if (add.length) {
      const who = add.length === 1 ? add[0].name : `${add.length} people`;
      const when = input.sessionDate ? ` for the session on ${dayLabel(input.sessionDate)}` : "";
      await recordEvent(deps, actor, { type: "training.enroll", entityType: "training", entityId: p.id, summary: `Enrolled ${who} in ${p.title}${when}`, ip: req.ip });
    }
    res.status(201).json({ enrolled: add.length, skipped: people.length - add.length });
  });

  router.patch("/performance/enrollments/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(SessionInput, req.body);
    const n = await loadEnrollment(deps, actor.tenantId, req.params.id);
    if (n.status !== "enrolled") throw new BosError(409, "Only open enrollments can be rescheduled");
    await exec(deps.db, `UPDATE bos_training_enrollments SET session_date = :sessionDate, note = :note WHERE id = :id`, {
      id: n.id,
      sessionDate: input.sessionDate,
      note: input.note === undefined ? n.note : input.note || null,
    });
    const summary = input.sessionDate ? `Scheduled ${n.employee_name} for ${n.program_title} on ${dayLabel(input.sessionDate)}` : `Cleared ${n.employee_name}'s ${n.program_title} session date`;
    await recordEvent(deps, actor, { type: "training.schedule", entityType: "training", entityId: n.program_id, summary, ip: req.ip });
    res.json({ enrollment: mapEnrollment(await loadEnrollment(deps, actor.tenantId, n.id)) });
  });

  router.post("/performance/enrollments/:id/complete", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(CompleteInput, req.body);
    const t = actor.tenantId;
    notFuture(input.date, "The completion date");
    const n = await loadEnrollment(deps, t, req.params.id);
    if (n.status !== "enrolled") throw new BosError(409, n.status === "completed" ? "This training is already completed" : "This enrollment was cancelled");
    if (input.date < n.enrolled_on) throw new BosError(400, "The training can't be completed before the enrollment");
    const p = await loadProgram(deps, t, n.program_id);
    const certNo = await tx(deps.db, async (conn) => {
      const done = await exec(conn, `UPDATE bos_training_enrollments SET status = 'completed', completed_on = :date WHERE id = :id AND status = 'enrolled'`, { id: n.id, date: input.date });
      if (!done.affectedRows) throw new BosError(409, "This training is already completed");
      if (!p.certificate) return null;
      const no = `CERT-${String(await nextSequence(conn, t, "certificate", "all")).padStart(4, "0")}`;
      await exec(
        conn,
        `INSERT INTO bos_certifications (id, tenant_id, employee_id, name, program_id, enrollment_id, cert_no, issued_on, expires_on, created_by)
         VALUES (:id, :t, :employeeId, :name, :programId, :enrollmentId, :certNo, :issuedOn, :expiresOn, :userId)`,
        {
          id: randomUUID(),
          t,
          employeeId: n.employee_id,
          name: p.title,
          programId: p.id,
          enrollmentId: n.id,
          certNo: no,
          issuedOn: input.date,
          expiresOn: certificateExpiry(input.date, p.validity_months),
          userId: actor.userId,
        },
      );
      return no;
    });
    await recordEvent(deps, actor, {
      type: "training.complete",
      entityType: "training",
      entityId: p.id,
      summary: `${n.employee_name} completed ${p.title}${certNo ? ` · certificate ${certNo}` : ""}`,
      ip: req.ip,
    });
    res.json({ enrollment: mapEnrollment(await loadEnrollment(deps, t, n.id)) });
  });

  router.post("/performance/enrollments/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const n = await loadEnrollment(deps, actor.tenantId, req.params.id);
    if (n.status !== "enrolled") throw new BosError(409, "Only open enrollments can be cancelled");
    await exec(deps.db, `UPDATE bos_training_enrollments SET status = 'cancelled' WHERE id = :id`, { id: n.id });
    await recordEvent(deps, actor, { type: "training.cancel", entityType: "training", entityId: n.program_id, summary: `Cancelled ${n.employee_name}'s enrollment in ${n.program_title}`, ip: req.ip });
    res.json({ enrollment: mapEnrollment(await loadEnrollment(deps, actor.tenantId, n.id)) });
  });

  /* ----- Certifications ----- */

  router.post("/performance/certifications", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(CertificateFields, req.body);
    const t = actor.tenantId;
    notFuture(input.issuedOn, "The issue date");
    if (input.expiresOn && input.expiresOn < input.issuedOn) throw new BosError(400, "The certificate expires before it was issued");
    const person = await loadPerson(deps, t, input.employeeId, { current: true });
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_certifications (id, tenant_id, employee_id, name, issuer, credential_no, link, issued_on, expires_on, created_by)
       VALUES (:id, :t, :employeeId, :name, :issuer, :credentialNo, :link, :issuedOn, :expiresOn, :userId)`,
      {
        id,
        t,
        employeeId: person.id,
        name: input.name,
        issuer: input.issuer || null,
        credentialNo: input.credentialNo || null,
        link: input.link || null,
        issuedOn: input.issuedOn,
        expiresOn: input.expiresOn ?? null,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: "certificate.create", entityType: "certificate", entityId: id, summary: `Recorded ${person.name}'s certificate: ${input.name}`, ip: req.ip });
    res.status(201).json({ certificate: mapCertificate(await loadCertificate(deps, t, id), todayISO()) });
  });

  router.patch("/performance/certifications/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parsePatch(CertificateFields.omit({ employeeId: true }), req.body);
    const t = actor.tenantId;
    const c = await loadCertificate(deps, t, req.params.id);
    if (c.enrollment_id && (input.name !== undefined || input.issuer !== undefined)) throw new BosError(409, "BOS issued this certificate from a training, so only its dates can change");
    const issuedOn = input.issuedOn ?? c.issued_on;
    const expiresOn = input.expiresOn === undefined ? c.expires_on : input.expiresOn;
    notFuture(issuedOn, "The issue date");
    if (expiresOn && expiresOn < issuedOn) throw new BosError(400, "The certificate expires before it was issued");
    await exec(
      deps.db,
      `UPDATE bos_certifications SET name = :name, issuer = :issuer, credential_no = :credentialNo, link = :link, issued_on = :issuedOn, expires_on = :expiresOn WHERE id = :id`,
      {
        id: c.id,
        name: input.name ?? c.name,
        issuer: input.issuer === undefined ? c.issuer : input.issuer || null,
        credentialNo: input.credentialNo === undefined ? c.credential_no : input.credentialNo || null,
        link: input.link === undefined ? c.link : input.link || null,
        issuedOn,
        expiresOn,
      },
    );
    const renewed = input.issuedOn && input.issuedOn !== c.issued_on;
    await recordEvent(deps, actor, {
      type: "certificate.update",
      entityType: "certificate",
      entityId: c.id,
      summary: `${renewed ? "Renewed" : "Updated"} ${c.employee_name}'s certificate: ${input.name ?? c.name}${expiresOn ? `, valid to ${dayLabel(expiresOn)}` : ""}`,
      ip: req.ip,
    });
    res.json({ certificate: mapCertificate(await loadCertificate(deps, t, c.id), todayISO()) });
  });

  router.delete("/performance/certifications/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const c = await loadCertificate(deps, actor.tenantId, req.params.id);
    await exec(deps.db, `DELETE FROM bos_certifications WHERE id = :id`, { id: c.id });
    await recordEvent(deps, actor, { type: "certificate.delete", entityType: "certificate", entityId: c.id, summary: `Deleted ${c.employee_name}'s certificate: ${c.name}${c.cert_no ? ` (${c.cert_no})` : ""}`, ip: req.ip });
    res.status(204).end();
  });

  /* ----- KRAs ----- */

  router.post("/performance/kras", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(KraInput, req.body);
    const t = actor.tenantId;
    checkPeriod(input.periodStart, input.periodEnd);
    const people = await loadPeople(deps, t, input.employeeIds);
    const created = people.map((person) => ({ id: randomUUID(), person }));
    await tx(deps.db, async (conn) => {
      for (const { id, person } of created) {
        await exec(
          conn,
          `INSERT INTO bos_kras (id, tenant_id, employee_id, title, target, weight, period_start, period_end, created_by)
           VALUES (:id, :t, :employeeId, :title, :target, :weight, :periodStart, :periodEnd, :userId)`,
          {
            id,
            t,
            employeeId: person.id,
            title: input.title,
            target: input.target || null,
            weight: input.weight ?? null,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            userId: actor.userId,
          },
        );
      }
    });
    const who = people.length === 1 ? people[0].name : `${people.length} people`;
    await recordEvent(deps, actor, { type: "kra.create", entityType: "kra", entityId: created[0].id, summary: `Set the KRA "${input.title}" for ${who}`, ip: req.ip });
    res.status(201).json({ created: people.length });
  });

  router.patch("/performance/kras/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parsePatch(KraPatch, req.body);
    const t = actor.tenantId;
    const k = await loadKra(deps, t, req.params.id);
    const periodStart = input.periodStart ?? k.period_start;
    const periodEnd = input.periodEnd ?? k.period_end;
    checkPeriod(periodStart, periodEnd);
    const reviewed = input.status !== undefined || input.progress !== undefined || input.note !== undefined;
    await exec(
      deps.db,
      `UPDATE bos_kras SET title = :title, target = :target, weight = :weight, period_start = :periodStart, period_end = :periodEnd,
         status = :status, progress = :progress, note = :note, reviewed_on = :reviewedOn WHERE id = :id`,
      {
        id: k.id,
        title: input.title ?? k.title,
        target: input.target === undefined ? k.target : input.target || null,
        weight: input.weight === undefined ? k.weight : input.weight,
        periodStart,
        periodEnd,
        status: input.status ?? k.status,
        progress: input.progress === undefined ? k.progress : input.progress,
        note: input.note === undefined ? k.note : input.note || null,
        reviewedOn: reviewed ? todayISO() : k.reviewed_on,
      },
    );
    const summary =
      input.status && input.status !== k.status
        ? `${k.employee_name}'s KRA "${input.title ?? k.title}" is now ${KRA_LABEL[input.status]}`
        : `Updated ${k.employee_name}'s KRA "${input.title ?? k.title}"`;
    await recordEvent(deps, actor, { type: "kra.update", entityType: "kra", entityId: k.id, summary, ip: req.ip });
    res.json({ kra: mapKra(await loadKra(deps, t, k.id)) });
  });

  router.delete("/performance/kras/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const k = await loadKra(deps, actor.tenantId, req.params.id);
    await exec(deps.db, `DELETE FROM bos_kras WHERE id = :id`, { id: k.id });
    await recordEvent(deps, actor, { type: "kra.delete", entityType: "kra", entityId: k.id, summary: `Removed ${k.employee_name}'s KRA "${k.title}"`, ip: req.ip });
    res.status(204).end();
  });

  /* ----- Promotions ----- */

  router.post("/performance/promotions", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(PromotionInput, req.body);
    const t = actor.tenantId;
    const person = await loadPerson(deps, t, input.employeeId, { current: true });
    const currentCtc = optMoney(person.ctc_annual);
    const problem = promotionProblem({ proposedDesignation: input.proposedDesignation, currentDesignation: person.designation, proposedCtc: input.proposedCtc ?? null, currentCtc });
    if (problem) throw new BosError(400, problem);
    const pending = await one(deps.db, `SELECT 1 FROM bos_promotions WHERE tenant_id = :t AND employee_id = :e AND status = 'pending' LIMIT 1`, { t, e: person.id });
    if (pending) throw new BosError(409, `${person.name} already has a promotion awaiting sign-off`);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_promotions (id, tenant_id, employee_id, current_designation, proposed_designation, current_ctc, proposed_ctc, effective_date, reason, created_by)
       VALUES (:id, :t, :employeeId, :currentDesignation, :proposedDesignation, :currentCtc, :proposedCtc, :effectiveDate, :reason, :userId)`,
      {
        id,
        t,
        employeeId: person.id,
        currentDesignation: person.designation,
        proposedDesignation: input.proposedDesignation,
        currentCtc,
        proposedCtc: input.proposedCtc ?? null,
        effectiveDate: input.effectiveDate,
        reason: input.reason || null,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: "promotion.create", entityType: "promotion", entityId: id, summary: `Proposed ${person.name} as ${input.proposedDesignation} from ${dayLabel(input.effectiveDate)}`, ip: req.ip });
    res.status(201).json({ promotion: mapPromotion(await loadPromotion(deps, t, id)) });
  });

  router.post("/performance/promotions/:id/decision", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(DecisionInput, req.body);
    const t = actor.tenantId;
    const r = await loadPromotion(deps, t, req.params.id);
    if (r.status !== "pending") throw new BosError(409, "This promotion has already been decided");
    const apply = input.decision === "approved" && input.apply;
    const today = todayISO();
    await tx(deps.db, async (conn) => {
      const decided = await exec(
        conn,
        `UPDATE bos_promotions SET status = :status, decided_on = :today, decided_by_name = :by, decision_note = :note, applied = :applied WHERE id = :id AND status = 'pending'`,
        { id: r.id, status: input.decision, today, by: actor.name ?? actor.email ?? null, note: input.note || null, applied: apply ? 1 : 0 },
      );
      if (!decided.affectedRows) throw new BosError(409, "This promotion has already been decided");
      if (apply) {
        await exec(conn, `UPDATE bos_employees SET designation = :designation, ctc_annual = COALESCE(:ctc, ctc_annual) WHERE id = :id AND tenant_id = :t`, {
          id: r.employee_id,
          t,
          designation: r.proposed_designation,
          ctc: r.proposed_ctc,
        });
      }
    });
    const ctc = r.proposed_ctc === null ? "" : ` at ${inr(money(r.proposed_ctc))} a year`;
    await recordEvent(deps, actor, {
      type: input.decision === "approved" ? "promotion.approve" : "promotion.reject",
      entityType: "promotion",
      entityId: r.id,
      summary: input.decision === "approved" ? `Approved ${r.employee_name}'s promotion to ${r.proposed_designation}${ctc}` : `Turned down ${r.employee_name}'s promotion to ${r.proposed_designation}`,
      ip: req.ip,
    });
    if (apply) {
      await recordEvent(deps, actor, {
        type: "employee.update",
        entityType: "employee",
        entityId: r.employee_id,
        summary: `${r.employee_name} is now ${r.proposed_designation}${ctc} (promotion)`,
        payload: { fields: r.proposed_ctc === null ? ["designation"] : ["designation", "ctcAnnual"] },
        ip: req.ip,
      });
    }
    res.json({ promotion: mapPromotion(await loadPromotion(deps, t, r.id)) });
  });

  router.delete("/performance/promotions/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const r = await loadPromotion(deps, actor.tenantId, req.params.id);
    if (r.status !== "pending") throw new BosError(409, "Decided promotions stay on record");
    await exec(deps.db, `DELETE FROM bos_promotions WHERE id = :id`, { id: r.id });
    await recordEvent(deps, actor, { type: "promotion.delete", entityType: "promotion", entityId: r.id, summary: `Withdrew ${r.employee_name}'s proposed promotion to ${r.proposed_designation}`, ip: req.ip });
    res.status(204).end();
  });

  /* ----- Performance improvement plans ----- */

  router.post("/performance/pips", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(PipInput, req.body);
    const t = actor.tenantId;
    if (input.reviewOn <= input.startedOn) throw new BosError(400, "The review date must be after the start");
    const person = await loadPerson(deps, t, input.employeeId, { current: true });
    const open = await one(deps.db, `SELECT 1 FROM bos_pips WHERE tenant_id = :t AND employee_id = :e AND status = 'active' LIMIT 1`, { t, e: person.id });
    if (open) throw new BosError(409, `${person.name} already has an active improvement plan`);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_pips (id, tenant_id, employee_id, reason, goals, started_on, review_on, created_by)
       VALUES (:id, :t, :employeeId, :reason, :goals, :startedOn, :reviewOn, :userId)`,
      { id, t, employeeId: person.id, reason: input.reason, goals: input.goals || null, startedOn: input.startedOn, reviewOn: input.reviewOn, userId: actor.userId },
    );
    await recordEvent(deps, actor, { type: "pip.create", entityType: "pip", entityId: id, summary: `Started an improvement plan for ${person.name}, review ${dayLabel(input.reviewOn)}`, ip: req.ip });
    res.status(201).json({ pip: mapPip(await loadPip(deps, t, id)) });
  });

  router.patch("/performance/pips/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parsePatch(PipPatch, req.body);
    const t = actor.tenantId;
    const p = await loadPip(deps, t, req.params.id);
    if (p.status !== "active") throw new BosError(409, "This plan is closed");
    const reviewOn = input.reviewOn ?? p.review_on;
    if (reviewOn <= p.started_on) throw new BosError(400, "The review date must be after the start");
    await exec(deps.db, `UPDATE bos_pips SET reason = :reason, goals = :goals, review_on = :reviewOn WHERE id = :id`, {
      id: p.id,
      reason: input.reason ?? p.reason,
      goals: input.goals === undefined ? p.goals : input.goals || null,
      reviewOn,
    });
    const summary = reviewOn !== p.review_on ? `Moved ${p.employee_name}'s improvement plan review to ${dayLabel(reviewOn)}` : `Updated ${p.employee_name}'s improvement plan`;
    await recordEvent(deps, actor, { type: "pip.update", entityType: "pip", entityId: p.id, summary, ip: req.ip });
    res.json({ pip: mapPip(await loadPip(deps, t, p.id)) });
  });

  router.post("/performance/pips/:id/close", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(PipClose, req.body);
    const t = actor.tenantId;
    const p = await loadPip(deps, t, req.params.id);
    if (p.status !== "active") throw new BosError(409, "This plan is already closed");
    notFuture(input.date, "The closing date");
    if (input.date < p.started_on) throw new BosError(400, "The plan can't close before it started");
    await exec(deps.db, `UPDATE bos_pips SET status = :status, closed_on = :date, outcome_note = :note WHERE id = :id`, { id: p.id, status: input.outcome, date: input.date, note: input.note || null });
    await recordEvent(deps, actor, { type: "pip.close", entityType: "pip", entityId: p.id, summary: `Closed ${p.employee_name}'s improvement plan: ${OUTCOME_LABEL[input.outcome]}`, ip: req.ip });
    res.json({ pip: mapPip(await loadPip(deps, t, p.id)) });
  });

  /* ----- Recognition ----- */

  router.post("/performance/recognitions", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(RecognitionInput, req.body);
    const t = actor.tenantId;
    notFuture(input.awardedOn, "The award date");
    const person = await loadPerson(deps, t, input.employeeId, { current: true });
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_recognitions (id, tenant_id, employee_id, category, awarded_on, note, created_by) VALUES (:id, :t, :employeeId, :category, :awardedOn, :note, :userId)`,
      { id, t, employeeId: person.id, category: input.category, awardedOn: input.awardedOn, note: input.note || null, userId: actor.userId },
    );
    await recordEvent(deps, actor, { type: "recognition.create", entityType: "recognition", entityId: id, summary: `🏆 ${person.name} — ${input.category}`, ip: req.ip });
    const g = await one<RecognitionRow>(deps.db, `${RECOGNITION_SELECT} WHERE g.id = :id`, { id });
    res.status(201).json({ recognition: mapRecognition(g!) });
  });

  router.delete("/performance/recognitions/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const g = await one<RecognitionRow>(deps.db, `${RECOGNITION_SELECT} WHERE g.id = :id AND g.tenant_id = :t`, { id: req.params.id, t: actor.tenantId });
    if (!g) throw notFound("Recognition");
    await exec(deps.db, `DELETE FROM bos_recognitions WHERE id = :id`, { id: g.id });
    await recordEvent(deps, actor, { type: "recognition.delete", entityType: "recognition", entityId: g.id, summary: `Removed ${g.employee_name}'s recognition: ${g.category}`, ip: req.ip });
    res.status(204).end();
  });
}
