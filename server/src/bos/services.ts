import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, money, nextSequence, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { employeeForActor } from "./hr.js";
import { todayISO } from "./logic.js";
import {
  CERTIFICATE_KINDS,
  isOpenRequest,
  letterProblem,
  resolutionDays,
  SERVICE_PRIORITIES,
  SERVICE_TYPES,
  serviceTotals,
  type CertificateKind,
  type ServicePriority,
  type ServiceStatus,
  type ServiceType,
} from "./services-logic.js";

const LIMIT = 2000;
const PATH = "?ws=hr&m=services";
const TYPE_LABEL: Record<ServiceType, string> = { helpdesk: "helpdesk ticket", certificate: "certificate request", id_card: "ID card request", kit: "kit request", other: "request" };
const KIND_LABEL: Record<CertificateKind, string> = { employment: "Employment certificate", experience: "Experience letter", salary: "Salary certificate" };

/* ---------- Inputs ---------- */

const RequestFields = z.object({
  subject: z.string().trim().max(200).optional(),
  details: optText(5000),
  addressedTo: optText(200),
  priority: z.enum(SERVICE_PRIORITIES).default("normal"),
});
const RequestInput = RequestFields.extend({
  employeeId: z.string().max(36).nullable().optional(),
  type: z.enum(SERVICE_TYPES),
  certificateKind: z.enum(CERTIFICATE_KINDS).nullable().optional(),
}).superRefine((r, ctx) => {
  if (r.type === "certificate" && !r.certificateKind) ctx.addIssue({ code: "custom", path: ["certificateKind"], message: "Pick the certificate" });
  if (r.type !== "certificate" && !r.subject) ctx.addIssue({ code: "custom", path: ["subject"], message: "Say what you need" });
});
const AssignInput = z.object({ employeeId: z.string().max(36).nullable() });
const CommentInput = z.object({ body: z.string().trim().min(1, "Write a message").max(5000), internal: z.boolean().default(false) });
const ResolveInput = z.object({ note: optText(1000) });

/* ---------- Rows ---------- */

type RequestRow = {
  id: string;
  request_no: string;
  employee_id: string;
  employee_name: string;
  emp_code: string;
  designation: string | null;
  department_name: string | null;
  user_id: number | null;
  type: ServiceType;
  certificate_kind: CertificateKind | null;
  subject: string;
  details: string | null;
  addressed_to: string | null;
  priority: ServicePriority;
  status: ServiceStatus;
  assignee_employee_id: string | null;
  assignee_name: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  letter_no: string | null;
  letter_on: string | null;
  created_by: number | null;
  created_at: string;
  comment_count: number | string;
};

const REQUEST_SELECT = `
  SELECT r.*, CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name, e.emp_code, e.designation, e.user_id, d.name AS department_name,
         (SELECT COUNT(*) FROM bos_service_comments c WHERE c.request_id = r.id AND (c.internal = 0 OR :manager = 1)) AS comment_count
  FROM bos_service_requests r
  JOIN bos_employees e ON e.id = r.employee_id
  LEFT JOIN bos_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id`;

const isOwn = (actor: BosActor, r: Pick<RequestRow, "user_id" | "created_by">) => Boolean(actor.userId && (r.user_id === actor.userId || r.created_by === actor.userId));
const requester = (r: Pick<RequestRow, "user_id" | "created_by">) => r.user_id ?? r.created_by;

function mapRequest(r: RequestRow, actor: BosActor) {
  return {
    id: r.id,
    requestNo: r.request_no,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    empCode: r.emp_code,
    designation: r.designation,
    departmentName: r.department_name,
    type: r.type,
    certificateKind: r.certificate_kind,
    subject: r.subject,
    details: r.details,
    addressedTo: r.addressed_to,
    priority: r.priority,
    status: r.status,
    assigneeId: r.assignee_employee_id,
    assigneeName: r.assignee_name,
    resolutionNote: r.resolution_note,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by_name,
    resolutionDays: r.resolved_at ? resolutionDays(r.created_at, r.resolved_at) : null,
    letterNo: r.letter_no,
    letterOn: r.letter_on,
    comments: Number(r.comment_count),
    createdAt: r.created_at,
    mine: isOwn(actor, r),
  };
}

type Person = { id: string; name: string; status: string; exit_date: string | null; ctc_annual: string | number | null; user_id: number | null };
async function loadPerson(deps: BosDeps, tenantId: number, id: string): Promise<Person> {
  const p = await one<Person>(deps.db, `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name, status, exit_date, ctc_annual, user_id FROM bos_employees WHERE id = :id AND tenant_id = :t`, { id, t: tenantId });
  if (!p) throw notFound("Employee");
  return p;
}
const letterCheck = (kind: CertificateKind, p: Person) => {
  const problem = letterProblem(kind, { status: p.status, exitDate: p.exit_date, ctcAnnual: p.ctc_annual === null ? null : money(p.ctc_annual) });
  if (problem) throw new BosError(409, problem);
};

/* ---------- Routes ---------- */

export function registerServices(router: Router, deps: BosDeps): void {
  const load = async (actor: BosActor, id: string) => {
    const r = await one<RequestRow>(deps.db, `${REQUEST_SELECT} WHERE r.id = :id AND r.tenant_id = :t`, { id, t: actor.tenantId, manager: isManager(actor) ? 1 : 0 });
    if (!r) throw notFound("Request");
    if (!isManager(actor) && !isOwn(actor, r)) throw notFound("Request");
    return r;
  };
  const mustBeOpen = (r: RequestRow) => {
    if (!isOpenRequest(r.status)) throw new BosError(409, r.status === "resolved" ? "This request is resolved — reopen it first" : "This request was cancelled");
  };

  /** HR → Employee Services. Managers see every request; everyone else sees their own. */
  router.get("/services/overview", async (_req, res) => {
    const actor = actorOf(res);
    const manager = isManager(actor);
    const today = todayISO();
    const me = await employeeForActor(deps, actor);
    const [list, people] = await Promise.all([
      rows<RequestRow>(
        deps.db,
        `${REQUEST_SELECT} WHERE r.tenant_id = :t ${manager ? "" : "AND (e.user_id = :uid OR r.created_by = :uid)"} ORDER BY r.created_at DESC LIMIT ${LIMIT}`,
        { t: actor.tenantId, uid: actor.userId ?? -1, manager: manager ? 1 : 0 },
      ),
      manager
        ? rows<{ id: string; name: string; emp_code: string; designation: string | null; status: string }>(
            deps.db,
            `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name, emp_code, designation, status FROM bos_employees WHERE tenant_id = :t ORDER BY status = 'exited', first_name, last_name`,
            { t: actor.tenantId },
          )
        : Promise.resolve([]),
    ]);
    const requests = list.map((r) => mapRequest(r, actor));
    res.json({
      today,
      manager,
      me: me ? { id: me.id, name: [me.first_name, me.last_name].filter(Boolean).join(" "), status: me.status } : null,
      employees: people.map((p) => ({ id: p.id, name: p.name, empCode: p.emp_code, designation: p.designation, status: p.status })),
      requests,
      truncated: list.length >= LIMIT,
      totals: serviceTotals(requests, today),
    });
  });

  router.get("/services/requests/:id", async (req, res) => {
    const actor = actorOf(res);
    const manager = isManager(actor);
    const r = await load(actor, req.params.id);
    const comments = await rows<{ id: string; author_name: string | null; author_user_id: number | null; body: string; internal: number; created_at: string }>(
      deps.db,
      `SELECT id, author_name, author_user_id, body, internal, created_at FROM bos_service_comments WHERE request_id = :id ${manager ? "" : "AND internal = 0"} ORDER BY created_at, id`,
      { id: r.id },
    );
    let letter = null;
    if (r.type === "certificate" && r.certificate_kind && (manager || r.letter_no)) {
      const e = await one<{ first_name: string; last_name: string | null; emp_code: string; designation: string | null; department_name: string | null; join_date: string; exit_date: string | null; status: string; ctc_annual: string | number | null }>(
        deps.db,
        `SELECT e.first_name, e.last_name, e.emp_code, e.designation, d.name AS department_name, e.join_date, e.exit_date, e.status, e.ctc_annual
         FROM bos_employees e LEFT JOIN bos_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id WHERE e.id = :id`,
        { id: r.employee_id },
      );
      if (e) {
        letter = {
          kind: r.certificate_kind,
          name: [e.first_name, e.last_name].filter(Boolean).join(" "),
          empCode: e.emp_code,
          designation: e.designation,
          departmentName: e.department_name,
          joinDate: e.join_date,
          exitDate: e.exit_date,
          status: e.status,
          ctcAnnual: r.certificate_kind === "salary" && e.ctc_annual !== null ? money(e.ctc_annual) : null,
        };
      }
    }
    res.json({
      request: mapRequest(r, actor),
      comments: comments.map((c) => ({ id: c.id, author: c.author_name, mine: Boolean(actor.userId && c.author_user_id === actor.userId), body: c.body, internal: Boolean(c.internal), createdAt: c.created_at })),
      letter,
    });
  });

  router.post("/services/requests", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(RequestInput, req.body);
    const manager = isManager(actor);
    let person: Person;
    if (input.employeeId) {
      person = await loadPerson(deps, actor.tenantId, input.employeeId);
      if (!manager && !(actor.userId && person.user_id === actor.userId)) throw forbidden("You can only raise requests for yourself");
    } else {
      const me = await employeeForActor(deps, actor);
      if (!me) throw new BosError(400, "Your login isn't linked to an employee record yet — ask HR to link it");
      person = await loadPerson(deps, actor.tenantId, me.id);
    }
    if (person.status === "exited" && !(manager && input.type === "certificate")) throw new BosError(409, `${person.name} has left`);
    if (input.type === "certificate") letterCheck(input.certificateKind!, person);
    const kind = input.type === "certificate" ? input.certificateKind! : null;
    const subject = input.subject || KIND_LABEL[kind!];
    const id = randomUUID();
    const requestNo = `SRV-${String(await nextSequence(deps.db, actor.tenantId, "service", "all")).padStart(4, "0")}`;
    await exec(
      deps.db,
      `INSERT INTO bos_service_requests (id, tenant_id, request_no, employee_id, type, certificate_kind, subject, details, addressed_to, priority, created_by)
       VALUES (:id, :t, :requestNo, :employeeId, :type, :kind, :subject, :details, :addressedTo, :priority, :userId)`,
      { id, t: actor.tenantId, requestNo, employeeId: person.id, type: input.type, kind, subject, details: input.details ?? null, addressedTo: input.addressedTo ?? null, priority: input.priority, userId: actor.userId },
    );
    await recordEvent(deps, actor, {
      type: "service.request",
      entityType: "service",
      entityId: id,
      summary: `${person.name} raised a ${TYPE_LABEL[input.type]}: ${subject} (${requestNo})`,
      notice: manager ? undefined : { kind: "approval_requested", title: `New ${TYPE_LABEL[input.type]}`, body: `${person.name} · ${subject}`, path: PATH, dedupeKey: `bos-service:${id}` },
      ip: req.ip,
    });
    res.status(201).json({ request: mapRequest(await load(actor, id), actor) });
  });

  router.patch("/services/requests/:id", async (req, res) => {
    const actor = actorOf(res);
    const patch = parsePatch(RequestFields, req.body);
    const manager = isManager(actor);
    if (!manager && patch.priority) throw forbidden("Only owners and admins set the priority");
    if (patch.subject !== undefined && !patch.subject) throw new BosError(400, "Say what you need");
    const r = await load(actor, req.params.id);
    mustBeOpen(r);
    const columns: Record<string, string> = { subject: "subject", details: "details", addressedTo: "addressed_to", priority: "priority" };
    const keys = Object.keys(patch).filter((k) => k in columns);
    if (keys.length) {
      const values = Object.fromEntries(keys.map((k) => [k, (patch as Record<string, unknown>)[k] ?? null]));
      await exec(deps.db, `UPDATE bos_service_requests SET ${keys.map((k) => `${columns[k]} = :${k}`).join(", ")} WHERE id = :id`, { ...values, id: r.id });
      await recordEvent(deps, actor, { type: "service.update", entityType: "service", entityId: r.id, summary: `Updated ${r.request_no} · ${patch.subject ?? r.subject}`, ip: req.ip });
    }
    res.json({ request: mapRequest(await load(actor, r.id), actor) });
  });

  router.post("/services/requests/:id/assign", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins assign requests");
    const { employeeId } = parse(AssignInput, req.body);
    const r = await load(actor, req.params.id);
    mustBeOpen(r);
    let assignee: Person | null = null;
    if (employeeId) {
      assignee = await loadPerson(deps, actor.tenantId, employeeId);
      if (assignee.status === "exited") throw new BosError(409, `${assignee.name} has left`);
    }
    await exec(deps.db, `UPDATE bos_service_requests SET assignee_employee_id = :aid, assignee_name = :aname, status = :status WHERE id = :id`, {
      aid: assignee?.id ?? null,
      aname: assignee?.name ?? null,
      status: assignee ? "in_progress" : "open",
      id: r.id,
    });
    await recordEvent(deps, actor, {
      type: "service.assign",
      entityType: "service",
      entityId: r.id,
      summary: assignee ? `Assigned ${r.request_no} to ${assignee.name}` : `Unassigned ${r.request_no}`,
      notice:
        assignee?.user_id && assignee.user_id !== actor.userId
          ? { kind: "workflow", title: `${r.request_no} assigned to you`, body: `${r.employee_name} · ${r.subject}`, path: PATH, targetUserId: assignee.user_id }
          : undefined,
      ip: req.ip,
    });
    res.json({ request: mapRequest(await load(actor, r.id), actor) });
  });

  router.post("/services/requests/:id/comments", async (req, res) => {
    const actor = actorOf(res);
    const { body, internal } = parse(CommentInput, req.body);
    const manager = isManager(actor);
    if (internal && !manager) throw forbidden("Only owners and admins add internal notes");
    const r = await load(actor, req.params.id);
    if (r.status === "cancelled") throw new BosError(409, "This request was cancelled");
    await exec(
      deps.db,
      `INSERT INTO bos_service_comments (id, tenant_id, request_id, author_user_id, author_name, body, internal) VALUES (:id, :t, :rid, :uid, :name, :body, :internal)`,
      { id: randomUUID(), t: actor.tenantId, rid: r.id, uid: actor.userId, name: actor.name ?? actor.email ?? null, body, internal: internal ? 1 : 0 },
    );
    const target = requester(r);
    await recordEvent(deps, actor, {
      type: internal ? "service.note" : "service.comment",
      entityType: "service",
      entityId: r.id,
      summary: `${internal ? "Internal note" : "Reply"} on ${r.request_no} · ${r.subject}`,
      notice:
        !internal && manager && target && target !== actor.userId
          ? { kind: "activity", title: `HR replied on ${r.request_no}`, body: body.length > 140 ? `${body.slice(0, 137)}…` : body, path: PATH, targetUserId: target }
          : undefined,
      ip: req.ip,
    });
    res.status(201).json({ ok: true });
  });

  router.post("/services/requests/:id/resolve", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins resolve requests");
    const { note } = parse(ResolveInput, req.body);
    const r = await load(actor, req.params.id);
    mustBeOpen(r);
    const today = todayISO();
    if (r.type === "certificate" && r.certificate_kind) letterCheck(r.certificate_kind, await loadPerson(deps, actor.tenantId, r.employee_id));
    const letterNo = await tx(deps.db, async (conn) => {
      let no = r.letter_no;
      if (r.type === "certificate" && !no) no = `LTR-${String(await nextSequence(conn, actor.tenantId, "letter", "all")).padStart(4, "0")}`;
      await exec(
        conn,
        `UPDATE bos_service_requests SET status = 'resolved', resolution_note = :note, resolved_at = CURRENT_TIMESTAMP, resolved_by_name = :by,
           letter_no = :no, letter_on = COALESCE(letter_on, :letterOn) WHERE id = :id AND status IN ('open','in_progress')`,
        { note: note ?? null, by: actor.name ?? actor.email ?? null, no, letterOn: no ? today : null, id: r.id },
      );
      return no;
    });
    const target = requester(r);
    await recordEvent(deps, actor, {
      type: "service.resolve",
      entityType: "service",
      entityId: r.id,
      summary: `Resolved ${r.request_no} · ${r.subject}${letterNo ? ` — issued ${letterNo}` : ""}`,
      notice:
        target && target !== actor.userId
          ? { kind: "approval_decided", title: `${r.request_no} resolved`, body: `${r.subject}${letterNo ? " — your letter is ready to download" : ""}${note ? ` · ${note}` : ""}`, path: PATH, targetUserId: target }
          : undefined,
      ip: req.ip,
    });
    res.json({ request: mapRequest(await load(actor, r.id), actor) });
  });

  router.post("/services/requests/:id/reopen", async (req, res) => {
    const actor = actorOf(res);
    const r = await load(actor, req.params.id);
    if (r.status !== "resolved") throw new BosError(409, "Only resolved requests can be reopened");
    await exec(deps.db, `UPDATE bos_service_requests SET status = :status, resolution_note = NULL, resolved_at = NULL, resolved_by_name = NULL WHERE id = :id`, {
      status: r.assignee_employee_id ? "in_progress" : "open",
      id: r.id,
    });
    await recordEvent(deps, actor, { type: "service.reopen", entityType: "service", entityId: r.id, summary: `Reopened ${r.request_no} · ${r.subject}`, ip: req.ip });
    res.json({ request: mapRequest(await load(actor, r.id), actor) });
  });

  router.post("/services/requests/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    const r = await load(actor, req.params.id);
    mustBeOpen(r);
    await exec(deps.db, `UPDATE bos_service_requests SET status = 'cancelled' WHERE id = :id`, { id: r.id });
    await recordEvent(deps, actor, { type: "service.cancel", entityType: "service", entityId: r.id, summary: `Cancelled ${r.request_no} · ${r.subject}`, ip: req.ip });
    res.json({ request: mapRequest(await load(actor, r.id), actor) });
  });
}
