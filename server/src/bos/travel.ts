import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, isoDate, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, money, nextSequence, one, rows } from "./db.js";
import { EXPENSE_CATEGORIES, mapExpense, type ExpenseRow } from "./finance.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { employeeForActor } from "./hr.js";
import { todayISO } from "./logic.js";
import { canCancelTrip, returnState, TRAVEL_MODES, tripDays, tripPhase, tripProblem, workplaceTotals, type TravelMode, type TravelStatus } from "./travel-logic.js";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const LIMIT = { assets: 3000, trips: 2000, claims: 1000 };

/* ---------- Inputs ---------- */

const amount = z.coerce.number().min(0, "Can't be negative").max(1e10);
const TravelFields = z.object({
  purpose: z.string().trim().min(1, "Say what the trip is for").max(200),
  fromPlace: z.string().trim().min(1, "Required").max(120),
  toPlace: z.string().trim().min(1, "Required").max(120),
  departOn: isoDate,
  returnOn: isoDate,
  mode: z.enum(TRAVEL_MODES).default("train"),
  estimatedCost: amount.default(0),
  advance: amount.default(0),
  projectId: z.string().max(36).nullable().optional(),
  note: optText(1000),
});
const TravelInput = TravelFields.extend({ employeeId: z.string().max(36).nullable().optional() });
const DecisionInput = z.object({ decision: z.enum(["approved", "rejected"]), note: optText(500) });

/* ---------- Rows ---------- */

type TripRow = {
  id: string;
  request_no: string;
  employee_id: string;
  employee_name: string;
  emp_code: string;
  designation: string | null;
  department_name: string | null;
  user_id: number | null;
  purpose: string;
  from_place: string;
  to_place: string;
  depart_on: string;
  return_on: string;
  mode: TravelMode;
  estimated_cost: string | number;
  advance: string | number;
  project_id: string | null;
  project_name: string | null;
  note: string | null;
  status: TravelStatus;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_by: number | null;
  created_at: string;
};

const TRIP_SELECT = `
  SELECT t.*, CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name, e.emp_code, e.designation, e.user_id,
         d.name AS department_name, p.name AS project_name
  FROM bos_travel_requests t
  JOIN bos_employees e ON e.id = t.employee_id
  LEFT JOIN bos_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
  LEFT JOIN bos_projects p ON p.id = t.project_id AND p.tenant_id = t.tenant_id`;

type AssetRow = {
  id: string;
  tag: string;
  name: string;
  category: string;
  serial_no: string | null;
  location: string | null;
  status: string;
  employee_id: string | null;
  employee_name: string | null;
  employee_designation: string | null;
  employee_status: string | null;
  employee_exit_date: string | null;
  department_name: string | null;
  assigned_on: string | null;
};

const ASSET_SELECT = `
  SELECT a.id, a.tag, a.name, a.category, a.serial_no, a.location, a.status, a.employee_id,
         NULLIF(CONCAT_WS(' ', e.first_name, e.last_name), '') AS employee_name, e.designation AS employee_designation,
         e.status AS employee_status, e.exit_date AS employee_exit_date, d.name AS department_name,
         (SELECT MAX(ev.event_date) FROM bos_asset_events ev WHERE ev.asset_id = a.id AND ev.kind = 'assign') AS assigned_on
  FROM bos_assets a
  LEFT JOIN bos_employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
  LEFT JOIN bos_departments d ON d.id = a.department_id AND d.tenant_id = a.tenant_id`;

const isOwn = (actor: BosActor, t: Pick<TripRow, "user_id" | "created_by">) => Boolean(actor.userId && (t.user_id === actor.userId || t.created_by === actor.userId));

function mapTrip(r: TripRow, actor: BosActor, today: string) {
  const trip = {
    id: r.id,
    requestNo: r.request_no,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    empCode: r.emp_code,
    designation: r.designation,
    departmentName: r.department_name,
    purpose: r.purpose,
    fromPlace: r.from_place,
    toPlace: r.to_place,
    departOn: r.depart_on,
    returnOn: r.return_on,
    days: tripDays(r.depart_on, r.return_on),
    mode: r.mode,
    estimatedCost: money(r.estimated_cost),
    advance: money(r.advance),
    projectId: r.project_id,
    projectName: r.project_name,
    note: r.note,
    status: r.status,
    decisionNote: r.decision_note,
    decidedBy: r.decided_by_name,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
  return { ...trip, phase: tripPhase(trip, today), mine: isOwn(actor, r), canCancel: canCancelTrip(trip, today) };
}

function mapAsset(r: AssetRow, today: string) {
  return {
    id: r.id,
    tag: r.tag,
    name: r.name,
    category: r.category,
    serialNo: r.serial_no,
    location: r.location,
    status: r.status,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeDesignation: r.employee_designation,
    departmentName: r.department_name,
    assignedOn: r.employee_id ? r.assigned_on : null,
    returnState: r.employee_id && r.employee_status ? returnState({ status: r.employee_status, exitDate: r.employee_exit_date }, today) : null,
  };
}

async function loadTrip(deps: BosDeps, tenantId: number, id: string): Promise<TripRow> {
  const t = await one<TripRow>(deps.db, `${TRIP_SELECT} WHERE t.id = :id AND t.tenant_id = :t`, { id, t: tenantId });
  if (!t) throw notFound("Travel request");
  return t;
}

async function checkOverlap(deps: BosDeps, tenantId: number, employeeId: string, departOn: string, returnOn: string, exceptId: string | null) {
  const clash = await one<{ request_no: string }>(
    deps.db,
    `SELECT request_no FROM bos_travel_requests
     WHERE tenant_id = :t AND employee_id = :employeeId AND status IN ('pending','approved') AND depart_on <= :returnOn AND return_on >= :departOn
       ${exceptId ? "AND id <> :exceptId" : ""}
     LIMIT 1`,
    { t: tenantId, employeeId, departOn, returnOn, exceptId },
  );
  if (clash) throw new BosError(409, `There is already a trip on these dates (${clash.request_no})`);
}

async function checkProject(deps: BosDeps, tenantId: number, projectId: string | null | undefined) {
  if (!projectId) return;
  if (!(await one(deps.db, `SELECT id FROM bos_projects WHERE id = :id AND tenant_id = :t`, { id: projectId, t: tenantId }))) throw notFound("Project");
}

function checkTrip(t: { departOn: string; returnOn: string; estimatedCost: number; advance: number }, today: string) {
  const problem = tripProblem(t, today);
  if (problem) throw new BosError(400, problem);
}

/* ---------- Routes ---------- */

export function registerTravel(router: Router, deps: BosDeps): void {
  /** HR → Expenses & Assets. Managers see the whole team; everyone else sees their own assets, trips and claims. */
  router.get("/hr/expenses-assets", async (_req, res) => {
    const actor = actorOf(res);
    const t = actor.tenantId;
    const today = todayISO();
    const manager = isManager(actor);
    const me = await employeeForActor(deps, actor);
    const uid = actor.userId ?? -1;
    const meId = me?.id ?? "";
    const [assetRows, tripRows, claimRows, people, projects] = await Promise.all([
      manager || me
        ? rows<AssetRow>(
            deps.db,
            `${ASSET_SELECT} WHERE a.tenant_id = :t AND a.status <> 'disposed' ${manager ? "" : "AND a.employee_id = :meId"}
             ORDER BY a.employee_id IS NULL, employee_name, a.tag LIMIT ${LIMIT.assets}`,
            { t, meId },
          )
        : Promise.resolve([]),
      rows<TripRow>(
        deps.db,
        `${TRIP_SELECT} WHERE t.tenant_id = :t ${manager ? "" : "AND (e.user_id = :uid OR t.created_by = :uid)"} ORDER BY t.depart_on DESC, t.created_at DESC LIMIT ${LIMIT.trips}`,
        { t, uid },
      ),
      rows<ExpenseRow>(
        deps.db,
        `SELECT * FROM bos_expenses WHERE tenant_id = :t ${manager ? "" : "AND (employee_id = :meId OR created_by = :uid)"} ORDER BY spent_on DESC, created_at DESC LIMIT ${LIMIT.claims}`,
        { t, meId, uid },
      ),
      manager
        ? rows<{ id: string; name: string; emp_code: string; designation: string | null; department_name: string | null; status: string }>(
            deps.db,
            `SELECT e.id, CONCAT_WS(' ', e.first_name, e.last_name) AS name, e.emp_code, e.designation, d.name AS department_name, e.status
             FROM bos_employees e LEFT JOIN bos_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
             WHERE e.tenant_id = :t AND e.status <> 'exited' ORDER BY e.first_name, e.last_name`,
            { t },
          )
        : Promise.resolve([]),
      rows<{ id: string; name: string }>(deps.db, `SELECT id, name FROM bos_projects WHERE tenant_id = :t AND status NOT IN ('completed','cancelled') ORDER BY name LIMIT 500`, { t }),
    ]);
    const assets = assetRows.map((r) => mapAsset(r, today));
    const trips = tripRows.map((r) => mapTrip(r, actor, today));
    const claims = claimRows.map(mapExpense);
    res.json({
      today,
      manager,
      me: me ? { id: me.id, name: [me.first_name, me.last_name].filter(Boolean).join(" "), status: me.status } : null,
      employees: people.map((p) => ({ id: p.id, name: p.name, empCode: p.emp_code, designation: p.designation, departmentName: p.department_name, status: p.status })),
      projects,
      assets,
      trips,
      claims,
      categories: EXPENSE_CATEGORIES,
      truncated: assetRows.length >= LIMIT.assets || tripRows.length >= LIMIT.trips || claimRows.length >= LIMIT.claims,
      totals: workplaceTotals({ assets, trips, claims }, today),
    });
  });

  router.post("/travel", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(TravelInput, req.body);
    const today = todayISO();
    checkTrip(input, today);
    const manager = isManager(actor);
    let employee: { id: string; name: string; status: string };
    if (input.employeeId) {
      const e = await one<{ id: string; name: string; status: string; user_id: number | null }>(
        deps.db,
        `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name, status, user_id FROM bos_employees WHERE id = :id AND tenant_id = :t`,
        { id: input.employeeId, t: actor.tenantId },
      );
      if (!e) throw notFound("Employee");
      if (!manager && !(actor.userId && e.user_id === actor.userId)) throw forbidden("You can only request travel for yourself");
      employee = e;
    } else {
      const me = await employeeForActor(deps, actor);
      if (!me) throw new BosError(400, "Your login isn't linked to an employee record yet — ask HR to link it");
      employee = { id: me.id, name: [me.first_name, me.last_name].filter(Boolean).join(" "), status: me.status };
    }
    if (employee.status === "exited") throw new BosError(409, `${employee.name} has left`);
    await checkOverlap(deps, actor.tenantId, employee.id, input.departOn, input.returnOn, null);
    await checkProject(deps, actor.tenantId, input.projectId);
    const id = randomUUID();
    const requestNo = `TRV-${String(await nextSequence(deps.db, actor.tenantId, "travel", "all")).padStart(4, "0")}`;
    await exec(
      deps.db,
      `INSERT INTO bos_travel_requests (id, tenant_id, request_no, employee_id, purpose, from_place, to_place, depart_on, return_on, mode, estimated_cost, advance, project_id, note, created_by)
       VALUES (:id, :t, :requestNo, :employeeId, :purpose, :fromPlace, :toPlace, :departOn, :returnOn, :mode, :estimatedCost, :advance, :projectId, :note, :userId)`,
      { ...input, id, t: actor.tenantId, requestNo, employeeId: employee.id, projectId: input.projectId || null, note: input.note ?? null, userId: actor.userId },
    );
    await recordEvent(deps, actor, {
      type: "travel.request",
      entityType: "travel",
      entityId: id,
      summary: `${employee.name} requested travel to ${input.toPlace} (${requestNo}, ${input.departOn} → ${input.returnOn})`,
      notice: manager
        ? undefined
        : { kind: "approval_requested", title: "Travel request awaiting approval", body: `${employee.name} · ${input.fromPlace} → ${input.toPlace} · from ${input.departOn}`, path: "?ws=hr&m=expenses", dedupeKey: `bos-travel:${id}` },
      ip: req.ip,
    });
    res.status(201).json({ trip: mapTrip(await loadTrip(deps, actor.tenantId, id), actor, today) });
  });

  router.patch("/travel/:id", async (req, res) => {
    const actor = actorOf(res);
    const patch = parsePatch(TravelFields, req.body);
    const today = todayISO();
    const cur = await loadTrip(deps, actor.tenantId, req.params.id);
    if (!isManager(actor) && !isOwn(actor, cur)) throw forbidden();
    if (cur.status !== "pending") throw new BosError(409, "Only pending requests can be changed");
    const next = {
      departOn: patch.departOn ?? cur.depart_on,
      returnOn: patch.returnOn ?? cur.return_on,
      estimatedCost: patch.estimatedCost ?? money(cur.estimated_cost),
      advance: patch.advance ?? money(cur.advance),
    };
    checkTrip(next, today);
    if (patch.departOn || patch.returnOn) await checkOverlap(deps, actor.tenantId, cur.employee_id, next.departOn, next.returnOn, cur.id);
    if ("projectId" in patch) await checkProject(deps, actor.tenantId, patch.projectId);
    const columns: Record<string, string> = {
      purpose: "purpose",
      fromPlace: "from_place",
      toPlace: "to_place",
      departOn: "depart_on",
      returnOn: "return_on",
      mode: "mode",
      estimatedCost: "estimated_cost",
      advance: "advance",
      projectId: "project_id",
      note: "note",
    };
    const keys = Object.keys(patch).filter((k) => k in columns);
    if (keys.length) {
      const values = Object.fromEntries(keys.map((k) => [k, (patch as Record<string, unknown>)[k] ?? null]));
      await exec(deps.db, `UPDATE bos_travel_requests SET ${keys.map((k) => `${columns[k]} = :${k}`).join(", ")} WHERE id = :id`, { ...values, projectId: values.projectId || null, id: cur.id });
      await recordEvent(deps, actor, { type: "travel.update", entityType: "travel", entityId: cur.id, summary: `Updated ${cur.employee_name}'s travel request ${cur.request_no}`, ip: req.ip });
    }
    res.json({ trip: mapTrip(await loadTrip(deps, actor.tenantId, cur.id), actor, today) });
  });

  router.post("/travel/:id/decision", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins can approve travel");
    const { decision, note } = parse(DecisionInput, req.body);
    const cur = await loadTrip(deps, actor.tenantId, req.params.id);
    if (cur.status !== "pending") throw new BosError(409, "This request has already been decided");
    await exec(
      deps.db,
      `UPDATE bos_travel_requests SET status = :decision, decision_note = :note, decided_by = :userId, decided_by_name = :name, decided_at = CURRENT_TIMESTAMP WHERE id = :id AND status = 'pending'`,
      { decision, note: note ?? null, userId: actor.userId, name: actor.name ?? actor.email ?? null, id: cur.id },
    );
    const target = cur.user_id ?? cur.created_by;
    await recordEvent(deps, actor, {
      type: `travel.${decision}`,
      entityType: "travel",
      entityId: cur.id,
      summary: `${decision === "approved" ? "Approved" : "Turned down"} ${cur.employee_name}'s travel to ${cur.to_place} (${cur.request_no}${money(cur.estimated_cost) ? `, ${inr(money(cur.estimated_cost))}` : ""})`,
      notice:
        target && target !== actor.userId
          ? { kind: "approval_decided", title: `Travel request ${decision}`, body: `${cur.from_place} → ${cur.to_place} · from ${cur.depart_on}${note ? ` · ${note}` : ""}`, path: "?ws=hr&m=expenses", targetUserId: target }
          : undefined,
      ip: req.ip,
    });
    res.json({ trip: mapTrip(await loadTrip(deps, actor.tenantId, cur.id), actor, todayISO()) });
  });

  router.post("/travel/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const cur = await loadTrip(deps, actor.tenantId, req.params.id);
    if (!isManager(actor) && !isOwn(actor, cur)) throw forbidden();
    if (!canCancelTrip({ status: cur.status, departOn: cur.depart_on }, today)) throw new BosError(409, "Only pending trips, or approved ones that haven't started, can be cancelled");
    await exec(deps.db, `UPDATE bos_travel_requests SET status = 'cancelled' WHERE id = :id`, { id: cur.id });
    await recordEvent(deps, actor, { type: "travel.cancel", entityType: "travel", entityId: cur.id, summary: `Cancelled ${cur.employee_name}'s travel request ${cur.request_no}`, ip: req.ip });
    res.json({ trip: mapTrip(await loadTrip(deps, actor.tenantId, cur.id), actor, today) });
  });
}
