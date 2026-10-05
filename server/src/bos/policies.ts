import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, isoDate, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, nextSequence, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { employeeForActor } from "./hr.js";
import { addDaysISO, todayISO } from "./logic.js";
import {
  AGREEMENT_TYPES,
  agreementProblem,
  agreementState,
  agreementTotals,
  COMPLIANCE_AREAS,
  COMPLIANCE_TEMPLATES,
  complianceState,
  complianceTotals,
  firstDueISO,
  isWebUrl,
  nextDueISO,
  POLICY_CATEGORIES,
  policyTotals,
  RECURRENCES,
  type AgreementType,
  type ComplianceArea,
  type PolicyCategory,
  type PolicyStatus,
  type Recurrence,
} from "./policy-logic.js";

const LIMIT = 2000;
const AGREEMENT_LABEL: Record<AgreementType, string> = {
  employment: "Employment agreement",
  nda: "Non-disclosure agreement",
  non_compete: "Non-compete agreement",
  consultant: "Consultancy agreement",
  internship: "Internship agreement",
  other: "Agreement",
};

/* ---------- Inputs ---------- */

const PolicyFields = z.object({
  title: z.string().trim().min(1, "Name the policy").max(160),
  category: z.enum(POLICY_CATEGORIES).default("hr"),
  summary: optText(600),
  body: z.string().trim().min(1, "Write the policy").max(100_000),
  mandatory: z.boolean().default(false),
  effectiveOn: isoDate.nullable().optional(),
});
const PolicyInput = PolicyFields.extend({ publish: z.boolean().default(false) });
const NewVersionInput = z.object({ newVersion: z.boolean().default(false) });
const RecordAckInput = z.object({ employeeId: z.string().min(1).max(36), note: optText(300) });

const ComplianceFields = z.object({
  title: z.string().trim().min(1, "Name the filing").max(160),
  area: z.enum(COMPLIANCE_AREAS).default("other"),
  dueOn: isoDate,
  recurrence: z.enum(RECURRENCES).default("none"),
  responsible: optText(120),
  note: optText(1000),
});
const DoneInput = z.object({ doneOn: isoDate.optional(), reference: optText(120), note: optText(1000) });
const TemplatesInput = z.object({ keys: z.array(z.string().max(40)).min(1, "Pick at least one filing").max(50) });

const AgreementFields = z.object({
  type: z.enum(AGREEMENT_TYPES).default("employment"),
  title: z.string().trim().max(160).optional(),
  employeeId: z.string().max(36).nullable().optional(),
  counterparty: optText(160),
  signedOn: isoDate.nullable().optional(),
  startsOn: isoDate.nullable().optional(),
  expiresOn: isoDate.nullable().optional(),
  documentUrl: z.string().trim().max(500).refine(isWebUrl, "Use a link that starts with https://").nullable().optional(),
  note: optText(1000),
});
const EndInput = z.object({ endedOn: isoDate.optional() });

/* ---------- Rows ---------- */

type PolicyRow = {
  id: string;
  title: string;
  category: PolicyCategory;
  summary: string | null;
  body: string;
  mandatory: number;
  status: PolicyStatus;
  version: number;
  effective_on: string | null;
  published_at: string | null;
  published_by_name: string | null;
  created_at: string;
  updated_at: string;
};
type MyAck = { acknowledgedAt: string | null; ackedVersion: number | null };

function mapPolicy(p: PolicyRow, acknowledged: number | null, mine: MyAck | null, withBody = false) {
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    summary: p.summary,
    ...(withBody ? { body: p.body } : {}),
    mandatory: Boolean(p.mandatory),
    status: p.status,
    version: Number(p.version),
    effectiveOn: p.effective_on,
    publishedAt: p.published_at,
    publishedBy: p.published_by_name,
    updatedAt: p.updated_at,
    acknowledged,
    acknowledgedAt: mine?.acknowledgedAt ?? null,
    ackedVersion: mine?.ackedVersion ?? null,
  };
}

type ComplianceRow = {
  id: string;
  title: string;
  area: ComplianceArea;
  due_on: string;
  due_day: number | null;
  recurrence: Recurrence;
  responsible: string | null;
  note: string | null;
  status: "open" | "done";
  done_on: string | null;
  done_by_name: string | null;
  reference: string | null;
  next_id: string | null;
  template_key: string | null;
};
const mapCompliance = (c: ComplianceRow, today: string) => ({
  id: c.id,
  title: c.title,
  area: c.area,
  dueOn: c.due_on,
  recurrence: c.recurrence,
  responsible: c.responsible,
  note: c.note,
  status: c.status,
  doneOn: c.done_on,
  doneBy: c.done_by_name,
  reference: c.reference,
  hasNext: Boolean(c.next_id),
  templateKey: c.template_key,
  state: complianceState({ status: c.status, dueOn: c.due_on }, today),
});

type AgreementRow = {
  id: string;
  agreement_no: string;
  type: AgreementType;
  title: string;
  employee_id: string | null;
  employee_name: string | null;
  emp_code: string | null;
  counterparty: string | null;
  signed_on: string | null;
  starts_on: string | null;
  expires_on: string | null;
  document_url: string | null;
  note: string | null;
  status: "active" | "ended";
  ended_on: string | null;
  created_at: string;
};
const AGREEMENT_SELECT = `
  SELECT a.*, CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name, e.emp_code
  FROM bos_agreements a LEFT JOIN bos_employees e ON e.id = a.employee_id`;
const mapAgreement = (a: AgreementRow, today: string) => ({
  id: a.id,
  agreementNo: a.agreement_no,
  type: a.type,
  title: a.title,
  employeeId: a.employee_id,
  employeeName: a.employee_name,
  empCode: a.emp_code,
  counterparty: a.counterparty,
  signedOn: a.signed_on,
  startsOn: a.starts_on,
  expiresOn: a.expires_on,
  documentUrl: a.document_url,
  note: a.note,
  status: a.status,
  endedOn: a.ended_on,
  state: agreementState({ status: a.status, signedOn: a.signed_on, expiresOn: a.expires_on }, today),
  createdAt: a.created_at,
});
const partyOf = (a: Pick<AgreementRow, "employee_name" | "counterparty">) => a.employee_name ?? a.counterparty ?? "";

const nameOf = (e: { first_name: string; last_name: string | null }) => [e.first_name, e.last_name].filter(Boolean).join(" ");
const dayOf = (iso: string) => Number(iso.slice(8, 10));

/* ---------- Routes ---------- */

export function registerPolicies(router: Router, deps: BosDeps): void {
  const managersOnly = (actor: BosActor, what: string) => {
    if (!isManager(actor)) throw forbidden(`Only owners and admins ${what}`);
  };
  const loadPolicy = async (actor: BosActor, id: string) => {
    const p = await one<PolicyRow>(deps.db, `SELECT * FROM bos_policies WHERE id = :id AND tenant_id = :t`, { id, t: actor.tenantId });
    if (!p || (!isManager(actor) && p.status !== "published")) throw notFound("Policy");
    return p;
  };
  const loadItem = async (actor: BosActor, id: string) => {
    const c = await one<ComplianceRow>(deps.db, `SELECT * FROM bos_compliance_items WHERE id = :id AND tenant_id = :t`, { id, t: actor.tenantId });
    if (!c) throw notFound("Filing");
    return c;
  };
  const loadAgreement = async (actor: BosActor, id: string) => {
    const a = await one<AgreementRow>(deps.db, `${AGREEMENT_SELECT} WHERE a.id = :id AND a.tenant_id = :t`, { id, t: actor.tenantId });
    if (!a) throw notFound("Agreement");
    return a;
  };
  const loadPerson = async (actor: BosActor, id: string) => {
    const e = await one<{ id: string; first_name: string; last_name: string | null; status: string }>(
      deps.db,
      `SELECT id, first_name, last_name, status FROM bos_employees WHERE id = :id AND tenant_id = :t`,
      { id, t: actor.tenantId },
    );
    if (!e) throw notFound("Employee");
    return e;
  };
  /** False when this person already acknowledged this version (unique key), so nothing is recorded twice. */
  const insertAck = async (sql: string, params: Record<string, unknown>) => {
    try {
      await exec(deps.db, sql, params);
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") return false;
      throw err;
    }
  };
  /** Current-version acknowledgements by people who haven't left, per policy. */
  const ackCounts = async (tenantId: number) => {
    const list = await rows<{ policy_id: string; n: number | string }>(
      deps.db,
      `SELECT a.policy_id, COUNT(*) AS n FROM bos_policy_acks a
       JOIN bos_policies p ON p.id = a.policy_id AND p.version = a.version
       JOIN bos_employees e ON e.id = a.employee_id AND e.status <> 'exited'
       WHERE a.tenant_id = :t GROUP BY a.policy_id`,
      { t: tenantId },
    );
    return new Map(list.map((r) => [r.policy_id, Number(r.n)]));
  };
  /** The employee's latest acknowledgement of each policy. */
  const myAcks = async (tenantId: number, employeeId: string) => {
    const list = await rows<{ policy_id: string; version: number; acknowledged_at: string }>(
      deps.db,
      `SELECT policy_id, version, acknowledged_at FROM bos_policy_acks WHERE tenant_id = :t AND employee_id = :e ORDER BY version`,
      { t: tenantId, e: employeeId },
    );
    return new Map(list.map((r) => [r.policy_id, { version: Number(r.version), at: r.acknowledged_at }]));
  };
  const mineOf = (p: PolicyRow, acks: Map<string, { version: number; at: string }>): MyAck => {
    const a = acks.get(p.id);
    return { acknowledgedAt: a && a.version === Number(p.version) ? a.at : null, ackedVersion: a?.version ?? null };
  };

  /** HR → Policies & Compliance. Managers see everything; everyone else sees published policies and their own agreements. */
  router.get("/policies/overview", async (_req, res) => {
    const actor = actorOf(res);
    const manager = isManager(actor);
    const today = todayISO();
    const me = await employeeForActor(deps, actor);
    const [policies, headcountRow] = await Promise.all([
      rows<PolicyRow>(
        deps.db,
        `SELECT * FROM bos_policies WHERE tenant_id = :t ${manager ? "" : "AND status = 'published'"} ORDER BY status = 'archived', mandatory DESC, title LIMIT 500`,
        { t: actor.tenantId },
      ),
      one<{ n: number | string }>(deps.db, `SELECT COUNT(*) AS n FROM bos_employees WHERE tenant_id = :t AND status <> 'exited'`, { t: actor.tenantId }),
    ]);
    const headcount = Number(headcountRow?.n ?? 0);
    const counts = manager ? await ackCounts(actor.tenantId) : new Map<string, number>();
    const acks = me ? await myAcks(actor.tenantId, me.id) : new Map<string, { version: number; at: string }>();
    const mapped = policies.map((p) => mapPolicy(p, manager ? (counts.get(p.id) ?? 0) : null, me ? mineOf(p, acks) : null));

    const [agreements, compliance, employees] = await Promise.all([
      manager || me
        ? rows<AgreementRow>(
            deps.db,
            `${AGREEMENT_SELECT} WHERE a.tenant_id = :t ${manager ? "" : "AND a.employee_id = :e"} ORDER BY a.status = 'ended', a.expires_on IS NULL, a.expires_on, a.created_at DESC LIMIT ${LIMIT}`,
            { t: actor.tenantId, e: me?.id ?? "" },
          )
        : Promise.resolve([]),
      manager
        ? rows<ComplianceRow>(
            deps.db,
            `SELECT * FROM bos_compliance_items WHERE tenant_id = :t AND (status = 'open' OR done_on >= :since) ORDER BY status = 'done', due_on LIMIT ${LIMIT}`,
            { t: actor.tenantId, since: addDaysISO(today, -400) },
          )
        : Promise.resolve([]),
      manager
        ? rows<{ id: string; name: string; emp_code: string; designation: string | null; status: string; user_id: number | null }>(
            deps.db,
            `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name, emp_code, designation, status, user_id FROM bos_employees WHERE tenant_id = :t ORDER BY status = 'exited', first_name, last_name`,
            { t: actor.tenantId },
          )
        : Promise.resolve([]),
    ]);
    const items = compliance.map((c) => mapCompliance(c, today));
    const deals = agreements.map((a) => mapAgreement(a, today));
    const openKeys = new Set(compliance.filter((c) => c.status === "open" && c.template_key).map((c) => c.template_key));
    const published = mapped.filter((p) => p.status === "published");
    res.json({
      today,
      manager,
      me: me ? { id: me.id, name: nameOf(me), status: me.status } : null,
      headcount,
      policies: mapped,
      employees: employees.map((e) => ({ id: e.id, name: e.name, empCode: e.emp_code, designation: e.designation, status: e.status, hasLogin: Boolean(e.user_id) })),
      compliance: items,
      templates: manager
        ? COMPLIANCE_TEMPLATES.map((t) => ({ key: t.key, title: t.title, area: t.area, recurrence: t.recurrence, note: t.note, firstDue: firstDueISO(t, today), added: openKeys.has(t.key) }))
        : [],
      agreements: deals,
      truncated: compliance.length >= LIMIT || agreements.length >= LIMIT,
      totals: {
        policies: manager ? policyTotals(mapped.map((p) => ({ status: p.status, mandatory: p.mandatory, acknowledged: p.acknowledged ?? 0 })), headcount) : null,
        mine: me
          ? {
              toAcknowledge: published.filter((p) => !p.acknowledgedAt).length,
              mandatoryPending: published.filter((p) => p.mandatory && !p.acknowledgedAt).length,
              acknowledged: published.filter((p) => p.acknowledgedAt).length,
            }
          : null,
        compliance: manager ? complianceTotals(items, today) : null,
        agreements: agreementTotals(deals, today),
      },
    });
  });

  /** Published policies the signed-in employee still has to acknowledge (for Home). */
  router.get("/policies/pending", async (_req, res) => {
    const actor = actorOf(res);
    const me = await employeeForActor(deps, actor);
    if (!me || me.status === "exited") {
      res.json({ policies: [] });
      return;
    }
    const [policies, acks] = await Promise.all([
      rows<PolicyRow>(deps.db, `SELECT * FROM bos_policies WHERE tenant_id = :t AND status = 'published' ORDER BY mandatory DESC, title LIMIT 500`, { t: actor.tenantId }),
      myAcks(actor.tenantId, me.id),
    ]);
    res.json({
      policies: policies
        .map((p) => ({ p, mine: mineOf(p, acks) }))
        .filter(({ mine }) => !mine.acknowledgedAt)
        .map(({ p, mine }) => ({ id: p.id, title: p.title, mandatory: Boolean(p.mandatory), version: Number(p.version), updated: mine.ackedVersion !== null })),
    });
  });

  router.get("/policies/:id", async (req, res) => {
    const actor = actorOf(res);
    const p = await loadPolicy(actor, req.params.id);
    const me = await employeeForActor(deps, actor);
    const mine = me ? mineOf(p, await myAcks(actor.tenantId, me.id)) : null;
    const canAcknowledge = Boolean(me && me.status !== "exited" && p.status === "published");
    if (!isManager(actor)) {
      res.json({ policy: mapPolicy(p, null, mine, true), roster: [], canAcknowledge });
      return;
    }
    const roster = await rows<{
      id: string;
      name: string;
      emp_code: string;
      designation: string | null;
      department_name: string | null;
      status: string;
      user_id: number | null;
      acknowledged_at: string | null;
      method: string | null;
      recorded_by_name: string | null;
      note: string | null;
      last_version: number | null;
    }>(
      deps.db,
      `SELECT e.id, CONCAT_WS(' ', e.first_name, e.last_name) AS name, e.emp_code, e.designation, d.name AS department_name, e.status, e.user_id,
              a.acknowledged_at, a.method, a.recorded_by_name, a.note,
              (SELECT MAX(x.version) FROM bos_policy_acks x WHERE x.policy_id = :pid AND x.employee_id = e.id) AS last_version
       FROM bos_employees e
       LEFT JOIN bos_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
       LEFT JOIN bos_policy_acks a ON a.policy_id = :pid AND a.version = :v AND a.employee_id = e.id
       WHERE e.tenant_id = :t AND e.status <> 'exited'
       ORDER BY a.acknowledged_at IS NOT NULL, e.first_name, e.last_name`,
      { pid: p.id, v: p.version, t: actor.tenantId },
    );
    const acknowledged = roster.filter((r) => r.acknowledged_at).length;
    res.json({
      policy: mapPolicy(p, acknowledged, mine, true),
      canAcknowledge,
      roster: roster.map((r) => ({
        employeeId: r.id,
        name: r.name,
        empCode: r.emp_code,
        designation: r.designation,
        departmentName: r.department_name,
        status: r.status,
        hasLogin: Boolean(r.user_id),
        acknowledgedAt: r.acknowledged_at,
        method: r.method,
        recordedBy: r.recorded_by_name,
        note: r.note,
        lastVersion: r.last_version === null ? null : Number(r.last_version),
      })),
    });
  });

  router.post("/policies", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "write policies");
    const input = parse(PolicyInput, req.body);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_policies (id, tenant_id, title, category, summary, body, mandatory, status, version, effective_on, published_at, published_by_name, created_by)
       VALUES (:id, :t, :title, :category, :summary, :body, :mandatory, :status, :version, :effectiveOn, ${input.publish ? "CURRENT_TIMESTAMP" : "NULL"}, :by, :userId)`,
      {
        id,
        t: actor.tenantId,
        title: input.title,
        category: input.category,
        summary: input.summary ?? null,
        body: input.body,
        mandatory: input.mandatory ? 1 : 0,
        status: input.publish ? "published" : "draft",
        version: input.publish ? 1 : 0,
        effectiveOn: input.effectiveOn ?? null,
        by: input.publish ? (actor.name ?? actor.email ?? null) : null,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: input.publish ? "policy.publish" : "policy.create", entityType: "policy", entityId: id, summary: `${input.publish ? "Published" : "Drafted"} ${input.title}`, ip: req.ip });
    res.status(201).json({ policy: mapPolicy(await loadPolicy(actor, id), 0, null, true) });
  });

  router.patch("/policies/:id", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "edit policies");
    const patch = parsePatch(PolicyFields, req.body);
    const { newVersion } = parse(NewVersionInput, req.body);
    const p = await loadPolicy(actor, req.params.id);
    if (p.status === "archived") throw new BosError(409, "This policy is archived — restore it first");
    const columns: Record<string, string> = { title: "title", category: "category", summary: "summary", body: "body", mandatory: "mandatory", effectiveOn: "effective_on" };
    const keys = Object.keys(patch).filter((k) => k in columns);
    const bump = newVersion && p.status === "published";
    if (keys.length || bump) {
      const values = Object.fromEntries(keys.map((k) => [k, k === "mandatory" ? (patch.mandatory ? 1 : 0) : ((patch as Record<string, unknown>)[k] ?? null)]));
      const sets = keys.map((k) => `${columns[k]} = :${k}`);
      if (bump) sets.push("version = version + 1", "published_at = CURRENT_TIMESTAMP", "published_by_name = :by");
      await exec(deps.db, `UPDATE bos_policies SET ${sets.join(", ")} WHERE id = :id`, { ...values, by: actor.name ?? actor.email ?? null, id: p.id });
      const title = patch.title ?? p.title;
      await recordEvent(deps, actor, {
        type: bump ? "policy.version" : "policy.update",
        entityType: "policy",
        entityId: p.id,
        summary: bump ? `Published ${title} version ${Number(p.version) + 1} — everyone acknowledges again` : `Updated ${title}`,
        ip: req.ip,
      });
    }
    res.json({ ok: true });
  });

  router.post("/policies/:id/publish", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "publish policies");
    const p = await loadPolicy(actor, req.params.id);
    if (p.status !== "draft") throw new BosError(409, p.status === "archived" ? "This policy is archived — restore it first" : "This policy is already published");
    await exec(deps.db, `UPDATE bos_policies SET status = 'published', version = version + 1, published_at = CURRENT_TIMESTAMP, published_by_name = :by WHERE id = :id AND status = 'draft'`, {
      by: actor.name ?? actor.email ?? null,
      id: p.id,
    });
    await recordEvent(deps, actor, { type: "policy.publish", entityType: "policy", entityId: p.id, summary: `Published ${p.title}`, ip: req.ip });
    res.json({ ok: true });
  });

  router.post("/policies/:id/archive", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "archive policies");
    const p = await loadPolicy(actor, req.params.id);
    if (p.status === "archived") throw new BosError(409, "This policy is already archived");
    await exec(deps.db, `UPDATE bos_policies SET status = 'archived' WHERE id = :id`, { id: p.id });
    await recordEvent(deps, actor, { type: "policy.archive", entityType: "policy", entityId: p.id, summary: `Archived ${p.title}`, ip: req.ip });
    res.json({ ok: true });
  });

  router.post("/policies/:id/restore", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "restore policies");
    const p = await loadPolicy(actor, req.params.id);
    if (p.status !== "archived") throw new BosError(409, "Only archived policies can be restored");
    await exec(deps.db, `UPDATE bos_policies SET status = :status WHERE id = :id`, { status: Number(p.version) > 0 ? "published" : "draft", id: p.id });
    await recordEvent(deps, actor, { type: "policy.restore", entityType: "policy", entityId: p.id, summary: `Restored ${p.title}`, ip: req.ip });
    res.json({ ok: true });
  });

  router.delete("/policies/:id", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "delete policies");
    const p = await loadPolicy(actor, req.params.id);
    const acked = await one<{ n: number | string }>(deps.db, `SELECT COUNT(*) AS n FROM bos_policy_acks WHERE policy_id = :id`, { id: p.id });
    if (Number(acked?.n ?? 0) > 0) throw new BosError(409, "People have acknowledged this policy — archive it instead, so the record stays");
    await exec(deps.db, `DELETE FROM bos_policies WHERE id = :id`, { id: p.id });
    await recordEvent(deps, actor, { type: "policy.delete", entityType: "policy", entityId: p.id, summary: `Deleted ${p.title}`, ip: req.ip });
    res.status(204).end();
  });

  router.post("/policies/:id/acknowledge", async (req, res) => {
    const actor = actorOf(res);
    const p = await loadPolicy(actor, req.params.id);
    if (p.status !== "published") throw new BosError(409, "Only published policies can be acknowledged");
    const me = await employeeForActor(deps, actor);
    if (!me) throw new BosError(400, "Your login isn't linked to an employee record yet — ask HR to link it");
    if (me.status === "exited") throw new BosError(409, "You've left, so there's nothing to acknowledge");
    const added = await insertAck(
      `INSERT INTO bos_policy_acks (id, tenant_id, policy_id, version, employee_id, method, user_id, ip) VALUES (:id, :t, :pid, :v, :e, 'self', :uid, :ip)`,
      { id: randomUUID(), t: actor.tenantId, pid: p.id, v: p.version, e: me.id, uid: actor.userId, ip: req.ip?.slice(0, 45) ?? null },
    );
    if (added) {
      await recordEvent(deps, actor, { type: "policy.acknowledge", entityType: "policy", entityId: p.id, summary: `${nameOf(me)} acknowledged ${p.title} (version ${p.version})`, ip: req.ip });
    }
    res.json({ ok: true, version: Number(p.version) });
  });

  router.post("/policies/:id/acknowledgements", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "record acknowledgements");
    const { employeeId, note } = parse(RecordAckInput, req.body);
    const p = await loadPolicy(actor, req.params.id);
    if (p.status !== "published") throw new BosError(409, "Only published policies can be acknowledged");
    const person = await loadPerson(actor, employeeId);
    if (person.status === "exited") throw new BosError(409, `${nameOf(person)} has left`);
    const added = await insertAck(
      `INSERT INTO bos_policy_acks (id, tenant_id, policy_id, version, employee_id, method, user_id, recorded_by_name, note, ip)
       VALUES (:id, :t, :pid, :v, :e, 'recorded', :uid, :by, :note, :ip)`,
      { id: randomUUID(), t: actor.tenantId, pid: p.id, v: p.version, e: person.id, uid: actor.userId, by: actor.name ?? actor.email ?? null, note: note ?? null, ip: req.ip?.slice(0, 45) ?? null },
    );
    if (!added) throw new BosError(409, `${nameOf(person)} has already acknowledged this version`);
    await recordEvent(deps, actor, { type: "policy.record_ack", entityType: "policy", entityId: p.id, summary: `Recorded ${nameOf(person)}'s acknowledgement of ${p.title}`, ip: req.ip });
    res.status(201).json({ ok: true });
  });

  router.delete("/policies/:id/acknowledgements/:employeeId", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "remove acknowledgements");
    const p = await loadPolicy(actor, req.params.id);
    const ack = await one<{ id: string; method: string }>(deps.db, `SELECT id, method FROM bos_policy_acks WHERE policy_id = :pid AND version = :v AND employee_id = :e`, {
      pid: p.id,
      v: p.version,
      e: req.params.employeeId,
    });
    if (!ack) throw notFound("Acknowledgement");
    if (ack.method !== "recorded") throw new BosError(409, "Only acknowledgements recorded by HR can be removed — the employee's own stays on record");
    const person = await loadPerson(actor, req.params.employeeId);
    await exec(deps.db, `DELETE FROM bos_policy_acks WHERE id = :id`, { id: ack.id });
    await recordEvent(deps, actor, { type: "policy.remove_ack", entityType: "policy", entityId: p.id, summary: `Removed the recorded acknowledgement of ${p.title} for ${nameOf(person)}`, ip: req.ip });
    res.status(204).end();
  });

  /* ---------- Compliance calendar (managers) ---------- */

  router.post("/compliance/templates", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage the compliance calendar");
    const { keys } = parse(TemplatesInput, req.body);
    const unknown = keys.filter((k) => !COMPLIANCE_TEMPLATES.some((t) => t.key === k));
    if (unknown.length) throw new BosError(400, `Unknown filing: ${unknown.join(", ")}`);
    const today = todayISO();
    const existing = await rows<{ template_key: string }>(deps.db, `SELECT DISTINCT template_key FROM bos_compliance_items WHERE tenant_id = :t AND status = 'open' AND template_key IS NOT NULL`, {
      t: actor.tenantId,
    });
    const have = new Set(existing.map((r) => r.template_key));
    const picked = COMPLIANCE_TEMPLATES.filter((t) => keys.includes(t.key) && !have.has(t.key));
    for (const t of picked) {
      const dueOn = firstDueISO(t, today);
      await exec(
        deps.db,
        `INSERT INTO bos_compliance_items (id, tenant_id, title, area, due_on, due_day, recurrence, note, template_key, created_by)
         VALUES (:id, :t, :title, :area, :dueOn, :day, :recurrence, :note, :key, :userId)`,
        { id: randomUUID(), t: actor.tenantId, title: t.title, area: t.area, dueOn, day: t.day, recurrence: t.recurrence, note: t.note, key: t.key, userId: actor.userId },
      );
    }
    if (picked.length) {
      await recordEvent(deps, actor, { type: "compliance.templates", entityType: "compliance", entityId: String(actor.tenantId), summary: `Added ${picked.length} standard filing${picked.length === 1 ? "" : "s"} to the compliance calendar`, ip: req.ip });
    }
    res.status(201).json({ added: picked.length, skipped: keys.length - picked.length });
  });

  router.post("/compliance", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage the compliance calendar");
    const input = parse(ComplianceFields, req.body);
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_compliance_items (id, tenant_id, title, area, due_on, due_day, recurrence, responsible, note, created_by)
       VALUES (:id, :t, :title, :area, :dueOn, :day, :recurrence, :responsible, :note, :userId)`,
      {
        id,
        t: actor.tenantId,
        title: input.title,
        area: input.area,
        dueOn: input.dueOn,
        day: input.recurrence === "none" ? null : dayOf(input.dueOn),
        recurrence: input.recurrence,
        responsible: input.responsible ?? null,
        note: input.note ?? null,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: "compliance.create", entityType: "compliance", entityId: id, summary: `Added ${input.title} (due ${input.dueOn}) to the compliance calendar`, ip: req.ip });
    res.status(201).json({ item: mapCompliance(await loadItem(actor, id), todayISO()) });
  });

  router.patch("/compliance/:id", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage the compliance calendar");
    const patch = parsePatch(ComplianceFields, req.body);
    const c = await loadItem(actor, req.params.id);
    if (c.status === "done") throw new BosError(409, "This filing is done — reopen it to change it");
    const columns: Record<string, string> = { title: "title", area: "area", dueOn: "due_on", recurrence: "recurrence", responsible: "responsible", note: "note" };
    const keys = Object.keys(patch).filter((k) => k in columns);
    if (keys.length) {
      const values: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, (patch as Record<string, unknown>)[k] ?? null]));
      const recurrence = patch.recurrence ?? c.recurrence;
      const dueOn = patch.dueOn ?? c.due_on;
      const sets = [...keys.map((k) => `${columns[k]} = :${k}`), "due_day = :day"];
      await exec(deps.db, `UPDATE bos_compliance_items SET ${sets.join(", ")} WHERE id = :id`, {
        ...values,
        day: recurrence === "none" ? null : patch.dueOn ? dayOf(dueOn) : (c.due_day ?? dayOf(dueOn)),
        id: c.id,
      });
      await recordEvent(deps, actor, { type: "compliance.update", entityType: "compliance", entityId: c.id, summary: `Updated ${patch.title ?? c.title}`, ip: req.ip });
    }
    res.json({ item: mapCompliance(await loadItem(actor, c.id), todayISO()) });
  });

  router.post("/compliance/:id/done", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage the compliance calendar");
    const input = parse(DoneInput, req.body);
    const today = todayISO();
    const doneOn = input.doneOn ?? today;
    if (doneOn > today) throw new BosError(400, "The filing date can't be in the future");
    const c = await loadItem(actor, req.params.id);
    const nextId = await tx(deps.db, async (conn) => {
      const fresh = await one<ComplianceRow>(conn, `SELECT * FROM bos_compliance_items WHERE id = :id FOR UPDATE`, { id: c.id });
      if (!fresh || fresh.status !== "open") throw new BosError(409, "This filing is already done");
      const nextDue = nextDueISO(fresh.due_on, fresh.recurrence, fresh.due_day);
      const next = nextDue ? randomUUID() : null;
      if (next) {
        await exec(
          conn,
          `INSERT INTO bos_compliance_items (id, tenant_id, title, area, due_on, due_day, recurrence, responsible, note, template_key, created_by)
           SELECT :next, tenant_id, title, area, :due, due_day, recurrence, responsible, note, template_key, :userId FROM bos_compliance_items WHERE id = :id`,
          { next, due: nextDue, userId: actor.userId, id: c.id },
        );
      }
      await exec(
        conn,
        `UPDATE bos_compliance_items SET status = 'done', done_on = :doneOn, done_by_name = :by, reference = :reference, note = COALESCE(:note, note), next_id = :next WHERE id = :id`,
        { doneOn, by: actor.name ?? actor.email ?? null, reference: input.reference ?? null, note: input.note ?? null, next, id: c.id },
      );
      return next;
    });
    const next = nextId ? await loadItem(actor, nextId) : null;
    await recordEvent(deps, actor, {
      type: "compliance.done",
      entityType: "compliance",
      entityId: c.id,
      summary: `Filed ${c.title} (due ${c.due_on})${input.reference ? ` · ref ${input.reference}` : ""}${next ? ` — next due ${next.due_on}` : ""}`,
      ip: req.ip,
    });
    res.json({ item: mapCompliance(await loadItem(actor, c.id), today), next: next ? mapCompliance(next, today) : null });
  });

  router.post("/compliance/:id/reopen", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage the compliance calendar");
    const c = await loadItem(actor, req.params.id);
    if (c.status !== "done") throw new BosError(409, "This filing isn't done");
    await tx(deps.db, async (conn) => {
      if (c.next_id) {
        const next = await one<{ status: string; due_on: string }>(conn, `SELECT status, due_on FROM bos_compliance_items WHERE id = :id FOR UPDATE`, { id: c.next_id });
        if (next?.status === "done") throw new BosError(409, `The next one (due ${next.due_on}) is already done — reopen that first`);
        if (next) await exec(conn, `DELETE FROM bos_compliance_items WHERE id = :id`, { id: c.next_id });
      }
      await exec(conn, `UPDATE bos_compliance_items SET status = 'open', done_on = NULL, done_by_name = NULL, reference = NULL, next_id = NULL WHERE id = :id`, { id: c.id });
    });
    await recordEvent(deps, actor, { type: "compliance.reopen", entityType: "compliance", entityId: c.id, summary: `Reopened ${c.title} (due ${c.due_on})`, ip: req.ip });
    res.json({ item: mapCompliance(await loadItem(actor, c.id), todayISO()) });
  });

  router.delete("/compliance/:id", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage the compliance calendar");
    const c = await loadItem(actor, req.params.id);
    await exec(deps.db, `UPDATE bos_compliance_items SET next_id = NULL WHERE tenant_id = :t AND next_id = :id`, { t: actor.tenantId, id: c.id });
    await exec(deps.db, `DELETE FROM bos_compliance_items WHERE id = :id`, { id: c.id });
    await recordEvent(deps, actor, { type: "compliance.delete", entityType: "compliance", entityId: c.id, summary: `Removed ${c.title} (due ${c.due_on}) from the compliance calendar`, ip: req.ip });
    res.status(204).end();
  });

  /* ---------- Agreements ---------- */

  const checkAgreement = async (actor: BosActor, a: { employeeId: string | null; counterparty: string | null; signedOn: string | null; startsOn: string | null; expiresOn: string | null }) => {
    const problem = agreementProblem(a, todayISO());
    if (problem) throw new BosError(400, problem);
    if (a.employeeId) await loadPerson(actor, a.employeeId);
  };

  router.post("/agreements", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage agreements");
    const input = parse(AgreementFields, req.body);
    const fields = {
      employeeId: input.employeeId || null,
      counterparty: input.counterparty || null,
      signedOn: input.signedOn ?? null,
      startsOn: input.startsOn ?? null,
      expiresOn: input.expiresOn ?? null,
    };
    await checkAgreement(actor, fields);
    const id = randomUUID();
    const agreementNo = `AGR-${String(await nextSequence(deps.db, actor.tenantId, "agreement", "all")).padStart(4, "0")}`;
    const title = input.title || AGREEMENT_LABEL[input.type];
    await exec(
      deps.db,
      `INSERT INTO bos_agreements (id, tenant_id, agreement_no, type, title, employee_id, counterparty, signed_on, starts_on, expires_on, document_url, note, created_by)
       VALUES (:id, :t, :no, :type, :title, :employeeId, :counterparty, :signedOn, :startsOn, :expiresOn, :url, :note, :userId)`,
      { id, t: actor.tenantId, no: agreementNo, type: input.type, title, ...fields, url: input.documentUrl ?? null, note: input.note ?? null, userId: actor.userId },
    );
    const a = await loadAgreement(actor, id);
    await recordEvent(deps, actor, { type: "agreement.create", entityType: "agreement", entityId: id, summary: `Recorded ${title} with ${partyOf(a)} (${agreementNo})`, ip: req.ip });
    res.status(201).json({ agreement: mapAgreement(a, todayISO()) });
  });

  router.patch("/agreements/:id", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage agreements");
    const patch = parsePatch(AgreementFields, req.body);
    const a = await loadAgreement(actor, req.params.id);
    const merged = {
      employeeId: patch.employeeId !== undefined ? patch.employeeId || null : a.employee_id,
      counterparty: patch.counterparty !== undefined ? patch.counterparty || null : a.counterparty,
      signedOn: patch.signedOn !== undefined ? patch.signedOn : a.signed_on,
      startsOn: patch.startsOn !== undefined ? patch.startsOn : a.starts_on,
      expiresOn: patch.expiresOn !== undefined ? patch.expiresOn : a.expires_on,
    };
    await checkAgreement(actor, merged);
    const columns: Record<string, string> = {
      type: "type",
      title: "title",
      employeeId: "employee_id",
      counterparty: "counterparty",
      signedOn: "signed_on",
      startsOn: "starts_on",
      expiresOn: "expires_on",
      documentUrl: "document_url",
      note: "note",
    };
    const keys = Object.keys(patch).filter((k) => k in columns);
    if (keys.length) {
      const values: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, (patch as Record<string, unknown>)[k] || null]));
      if ("title" in values && !values.title) values.title = AGREEMENT_LABEL[patch.type ?? a.type];
      await exec(deps.db, `UPDATE bos_agreements SET ${keys.map((k) => `${columns[k]} = :${k}`).join(", ")} WHERE id = :id`, { ...values, id: a.id });
      await recordEvent(deps, actor, { type: "agreement.update", entityType: "agreement", entityId: a.id, summary: `Updated ${a.agreement_no} · ${values.title ?? a.title}`, ip: req.ip });
    }
    res.json({ agreement: mapAgreement(await loadAgreement(actor, a.id), todayISO()) });
  });

  router.post("/agreements/:id/end", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage agreements");
    const { endedOn } = parse(EndInput, req.body);
    const a = await loadAgreement(actor, req.params.id);
    if (a.status === "ended") throw new BosError(409, "This agreement has already ended");
    const on = endedOn ?? todayISO();
    await exec(deps.db, `UPDATE bos_agreements SET status = 'ended', ended_on = :on WHERE id = :id`, { on, id: a.id });
    await recordEvent(deps, actor, { type: "agreement.end", entityType: "agreement", entityId: a.id, summary: `Ended ${a.agreement_no} · ${a.title} with ${partyOf(a)} on ${on}`, ip: req.ip });
    res.json({ agreement: mapAgreement(await loadAgreement(actor, a.id), todayISO()) });
  });

  router.post("/agreements/:id/reinstate", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage agreements");
    const a = await loadAgreement(actor, req.params.id);
    if (a.status !== "ended") throw new BosError(409, "This agreement hasn't ended");
    await exec(deps.db, `UPDATE bos_agreements SET status = 'active', ended_on = NULL WHERE id = :id`, { id: a.id });
    await recordEvent(deps, actor, { type: "agreement.reinstate", entityType: "agreement", entityId: a.id, summary: `Reinstated ${a.agreement_no} · ${a.title}`, ip: req.ip });
    res.json({ agreement: mapAgreement(await loadAgreement(actor, a.id), todayISO()) });
  });

  router.delete("/agreements/:id", async (req, res) => {
    const actor = actorOf(res);
    managersOnly(actor, "manage agreements");
    const a = await loadAgreement(actor, req.params.id);
    await exec(deps.db, `DELETE FROM bos_agreements WHERE id = :id`, { id: a.id });
    await recordEvent(deps, actor, { type: "agreement.delete", entityType: "agreement", entityId: a.id, summary: `Deleted ${a.agreement_no} · ${a.title}`, ip: req.ip });
    res.status(204).end();
  });
}
