import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, isoDate, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, nextSequence, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { employeeForActor } from "./hr.js";
import { todayISO } from "./logic.js";
import {
  byUrgency,
  isOpenTask,
  MILESTONE_STATUSES,
  milestoneState,
  nextTaskDue,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_STATUSES,
  taskAccess,
  taskProblem,
  taskProgress,
  taskState,
  taskTotals,
  type MilestoneStatus,
  type TaskPriority,
  type TaskRecurrence,
  type TaskStatus,
} from "./task-logic.js";
import { getSettings } from "./workspace.js";

const LIMIT = { open: 5000, closed: 500, people: 2000, projects: 1000, upcoming: 6 };
const OPEN_STATUSES = ["todo", "in_progress", "on_hold"] as const;
const STATUS_LABEL: Record<TaskStatus, string> = { todo: "to do", in_progress: "in progress", on_hold: "on hold", done: "done", cancelled: "cancelled" };
const taskPath = (id: string) => `?ws=projects&m=tasks&open=${id}`;

/* ---------- Inputs ---------- */

const ref = z.string().max(36).nullable().optional();
const TaskFields = z.object({
  title: z.string().trim().min(1, "Say what needs doing").max(200),
  details: optText(4000),
  projectId: ref,
  milestoneId: ref,
  assigneeId: ref,
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  startOn: isoDate.nullable().optional(),
  dueOn: isoDate.nullable().optional(),
  recurrence: z.enum(TASK_RECURRENCES).default("none"),
});
const TaskInput = TaskFields.extend({ status: z.enum(OPEN_STATUSES).default("todo") });
const StatusInput = z.object({ status: z.enum(TASK_STATUSES) });
const MilestoneFields = z.object({ name: z.string().trim().min(1, "Required").max(160), dueOn: isoDate.nullable().optional() });
const MilestonePatch = MilestoneFields.extend({ status: z.enum(MILESTONE_STATUSES) });

/* ---------- Rows ---------- */

type TaskRow = {
  id: string;
  task_no: string;
  project_id: string | null;
  project_name: string | null;
  milestone_id: string | null;
  milestone_name: string | null;
  title: string;
  details: string | null;
  assignee_employee_id: string | null;
  assignee_name: string | null;
  assignee_designation: string | null;
  assignee_user_id: number | null;
  status: TaskStatus;
  priority: TaskPriority;
  start_on: string | null;
  due_on: string | null;
  recurrence: TaskRecurrence;
  due_day: number | null;
  done_at: string | null;
  done_by_name: string | null;
  next_task_id: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const TASK_SELECT = `
  SELECT t.*, NULLIF(CONCAT_WS(' ', e.first_name, e.last_name), '') AS assignee_name, e.designation AS assignee_designation,
         e.user_id AS assignee_user_id, p.name AS project_name, m.name AS milestone_name
  FROM bos_project_tasks t
  LEFT JOIN bos_employees e ON e.id = t.assignee_employee_id AND e.tenant_id = t.tenant_id
  LEFT JOIN bos_projects p ON p.id = t.project_id AND p.tenant_id = t.tenant_id
  LEFT JOIN bos_project_milestones m ON m.id = t.milestone_id AND m.tenant_id = t.tenant_id`;

/** Assigned to the caller, or unassigned and created by them. */
const MINE_SQL = `(e.user_id = :uid OR (t.assignee_employee_id IS NULL AND t.created_by = :uid))`;

type MilestoneRow = {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  due_on: string | null;
  status: MilestoneStatus;
  done_on: string | null;
  created_by: number | null;
  total: number | string;
  done: number | string;
};

const MILESTONE_SELECT = `
  SELECT m.*, p.name AS project_name,
         (SELECT COUNT(*) FROM bos_project_tasks t WHERE t.milestone_id = m.id AND t.status <> 'cancelled') AS total,
         (SELECT COUNT(*) FROM bos_project_tasks t WHERE t.milestone_id = m.id AND t.status = 'done') AS done
  FROM bos_project_milestones m
  JOIN bos_projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id`;

const accessFor = (actor: BosActor, r: Pick<TaskRow, "created_by" | "assignee_user_id">) =>
  taskAccess({ createdBy: r.created_by, assigneeUserId: r.assignee_user_id }, { userId: actor.userId, manager: isManager(actor) });

const isMine = (actor: BosActor, r: TaskRow) => Boolean(actor.userId && (r.assignee_user_id === actor.userId || (!r.assignee_employee_id && r.created_by === actor.userId)));

function mapTask(r: TaskRow, actor: BosActor, today: string) {
  const task = {
    id: r.id,
    taskNo: r.task_no,
    title: r.title,
    details: r.details,
    projectId: r.project_id,
    projectName: r.project_name,
    milestoneId: r.milestone_id,
    milestoneName: r.milestone_name,
    assigneeId: r.assignee_employee_id,
    assigneeName: r.assignee_name,
    assigneeDesignation: r.assignee_designation,
    status: r.status,
    priority: r.priority,
    startOn: r.start_on,
    dueOn: r.due_on,
    recurrence: r.recurrence,
    doneAt: r.done_at,
    doneBy: r.done_by_name,
    createdBy: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  return { ...task, state: taskState(task, today), mine: isMine(actor, r), access: accessFor(actor, r) };
}

const mayDeleteMilestone = (actor: BosActor, r: Pick<MilestoneRow, "created_by">) => isManager(actor) || Boolean(actor.userId && r.created_by === actor.userId);

function mapMilestone(r: MilestoneRow, actor: BosActor, today: string) {
  const counts = { total: Number(r.total) || 0, done: Number(r.done) || 0 };
  const m = { id: r.id, projectId: r.project_id, projectName: r.project_name, name: r.name, dueOn: r.due_on, status: r.status, doneOn: r.done_on, ...counts };
  return { ...m, progress: taskProgress(counts), state: milestoneState(m, today), canDelete: mayDeleteMilestone(actor, r) };
}

async function loadTask(db: BosDeps["db"] | PoolConnection, tenantId: number, id: string): Promise<TaskRow> {
  const t = await one<TaskRow>(db, `${TASK_SELECT} WHERE t.id = :id AND t.tenant_id = :t`, { id, t: tenantId });
  if (!t) throw notFound("Task");
  return t;
}

async function loadMilestone(deps: BosDeps, tenantId: number, id: string): Promise<MilestoneRow> {
  const m = await one<MilestoneRow>(deps.db, `${MILESTONE_SELECT} WHERE m.id = :id AND m.tenant_id = :t`, { id, t: tenantId });
  if (!m) throw notFound("Milestone");
  return m;
}

type Assignee = { id: string; name: string; status: string; user_id: number | null };

/** Checks that the project, milestone and assignee belong to this tenant (and fit together). */
async function checkRefs(deps: BosDeps, tenantId: number, r: { projectId: string | null; milestoneId: string | null; assigneeId: string | null }, check: { project: boolean; milestone: boolean; assignee: boolean }) {
  let assignee: Assignee | null = null;
  if (check.project && r.projectId && !(await one(deps.db, `SELECT id FROM bos_projects WHERE id = :id AND tenant_id = :t`, { id: r.projectId, t: tenantId }))) throw notFound("Project");
  if (check.milestone && r.milestoneId) {
    const m = await one<{ project_id: string }>(deps.db, `SELECT project_id FROM bos_project_milestones WHERE id = :id AND tenant_id = :t`, { id: r.milestoneId, t: tenantId });
    if (!m) throw notFound("Milestone");
    if (m.project_id !== r.projectId) throw new BosError(400, "That milestone belongs to another project");
  }
  if (check.assignee && r.assigneeId) {
    assignee = await one<Assignee>(deps.db, `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name, status, user_id FROM bos_employees WHERE id = :id AND tenant_id = :t`, { id: r.assigneeId, t: tenantId });
    if (!assignee) throw notFound("Employee");
    if (assignee.status === "exited") throw new BosError(409, `${assignee.name} has left`);
  }
  return assignee;
}

function checkTask(t: Parameters<typeof taskProblem>[0]) {
  const problem = taskProblem(t);
  if (problem) throw new BosError(400, problem);
}

const dueDayOf = (recurrence: TaskRecurrence, dueOn: string | null | undefined) => (recurrence === "monthly" && dueOn ? Number(dueOn.slice(8, 10)) : null);

function assignNotice(actor: BosActor, assignee: Assignee | null, task: { id: string; title: string; taskNo: string; dueOn: string | null | undefined }) {
  if (!assignee?.user_id || assignee.user_id === actor.userId) return undefined;
  return {
    kind: "workflow" as const,
    title: "Task assigned to you",
    body: `${task.taskNo} · ${task.title}${task.dueOn ? ` · due ${task.dueOn}` : ""}`,
    path: taskPath(task.id),
    targetUserId: assignee.user_id,
    dedupeKey: `bos-task:${task.id}:${assignee.id}`,
  };
}

/* ---------- Routes ---------- */

export function registerTasks(router: Router, deps: BosDeps): void {
  /**
   * Projects → Tasks. Every open task (up to 5,000) and the latest 500 done or cancelled, optionally for one project
   * or only the caller's. Milestones come with their progress: one project's, or every open one for the pickers.
   */
  router.get("/tasks", async (req, res) => {
    const actor = actorOf(res);
    const t = actor.tenantId;
    const today = todayISO();
    const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId.slice(0, 36) : null;
    const mineOnly = req.query.mine === "1" || req.query.mine === "true";
    const params = { t, projectId, uid: actor.userId ?? -1, today };
    const where = `t.tenant_id = :t ${projectId ? "AND t.project_id = :projectId" : ""} ${mineOnly ? `AND ${MINE_SQL}` : ""}`;
    const [open, closed, milestones, people, projects, progress, me] = await Promise.all([
      rows<TaskRow>(deps.db, `${TASK_SELECT} WHERE ${where} AND t.status IN ('todo','in_progress','on_hold') ORDER BY t.due_on IS NULL, t.due_on, t.created_at LIMIT ${LIMIT.open}`, params),
      rows<TaskRow>(deps.db, `${TASK_SELECT} WHERE ${where} AND t.status IN ('done','cancelled') ORDER BY COALESCE(t.done_at, t.updated_at) DESC LIMIT ${LIMIT.closed}`, params),
      rows<MilestoneRow>(
        deps.db,
        `${MILESTONE_SELECT} WHERE m.tenant_id = :t ${projectId ? "AND m.project_id = :projectId" : "AND m.status = 'open' AND p.status NOT IN ('completed','cancelled')"}
         ORDER BY m.due_on IS NULL, m.due_on, m.created_at LIMIT 2000`,
        params,
      ),
      rows<{ id: string; name: string; designation: string | null; user_id: number | null }>(
        deps.db,
        `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name, designation, user_id FROM bos_employees WHERE tenant_id = :t AND status <> 'exited' ORDER BY first_name, last_name LIMIT ${LIMIT.people}`,
        params,
      ),
      rows<{ id: string; name: string; status: string }>(
        deps.db,
        `SELECT id, name, status FROM bos_projects WHERE tenant_id = :t ORDER BY status IN ('completed','cancelled'), name LIMIT ${LIMIT.projects}`,
        params,
      ),
      projectProgress(deps, t, today),
      employeeForActor(deps, actor),
    ]);
    const tasks = [...open, ...closed].map((r) => mapTask(r, actor, today));
    res.json({
      today,
      manager: isManager(actor),
      me: me ? { id: me.id, name: [me.first_name, me.last_name].filter(Boolean).join(" ") } : null,
      tasks,
      milestones: milestones.map((m) => mapMilestone(m, actor, today)),
      people: people.map((p) => ({ id: p.id, name: p.name, designation: p.designation, isMe: Boolean(actor.userId && p.user_id === actor.userId) })),
      projects,
      progress,
      truncated: open.length >= LIMIT.open || closed.length >= LIMIT.closed,
      totals: taskTotals(tasks, today),
    });
  });

  /** Home → My Profile and the project screens: the caller's task counts, their next few tasks and progress per project. */
  router.get("/tasks/summary", async (_req, res) => {
    const actor = actorOf(res);
    const today = todayISO();
    const params = { t: actor.tenantId, uid: actor.userId ?? -1 };
    const [mine, progress] = await Promise.all([
      actor.userId
        ? rows<TaskRow>(
            deps.db,
            `${TASK_SELECT} WHERE t.tenant_id = :t AND ${MINE_SQL}
               AND (t.status IN ('todo','in_progress','on_hold') OR (t.status = 'done' AND t.done_at >= DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY)))
             ORDER BY t.due_on IS NULL, t.due_on LIMIT ${LIMIT.open}`,
            params,
          )
        : Promise.resolve([]),
      projectProgress(deps, actor.tenantId, today),
    ]);
    const tasks = mine.map((r) => mapTask(r, actor, today));
    res.json({
      today,
      totals: taskTotals(tasks, today),
      upcoming: tasks.filter((x) => isOpenTask(x.status)).sort(byUrgency).slice(0, LIMIT.upcoming),
      progress,
    });
  });

  router.get("/tasks/:id", async (req, res) => {
    const actor = actorOf(res);
    res.json({ task: mapTask(await loadTask(deps.db, actor.tenantId, req.params.id), actor, todayISO()) });
  });

  router.post("/tasks", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(TaskInput, req.body);
    const r = { projectId: input.projectId || null, milestoneId: input.milestoneId || null, assigneeId: input.assigneeId || null };
    checkTask({ ...input, ...r });
    const assignee = await checkRefs(deps, actor.tenantId, r, { project: true, milestone: true, assignee: true });
    const id = randomUUID();
    const taskNo = `TSK-${String(await nextSequence(deps.db, actor.tenantId, "task", "all")).padStart(4, "0")}`;
    await exec(
      deps.db,
      `INSERT INTO bos_project_tasks (id, tenant_id, task_no, project_id, milestone_id, title, details, assignee_employee_id, status, priority,
         start_on, due_on, recurrence, due_day, created_by, created_by_name)
       VALUES (:id, :t, :taskNo, :projectId, :milestoneId, :title, :details, :assigneeId, :status, :priority,
         :startOn, :dueOn, :recurrence, :dueDay, :userId, :userName)`,
      {
        ...r,
        id,
        t: actor.tenantId,
        taskNo,
        title: input.title,
        details: input.details ?? null,
        status: input.status,
        priority: input.priority,
        startOn: input.startOn ?? null,
        dueOn: input.dueOn ?? null,
        recurrence: input.recurrence,
        dueDay: dueDayOf(input.recurrence, input.dueOn),
        userId: actor.userId,
        userName: actor.name ?? actor.email ?? null,
      },
    );
    await recordEvent(deps, actor, {
      type: "task.create",
      entityType: "task",
      entityId: id,
      summary: `Created task ${taskNo}: ${input.title}${assignee ? ` for ${assignee.name}` : ""}`,
      notice: assignNotice(actor, assignee, { id, title: input.title, taskNo, dueOn: input.dueOn }),
      ip: req.ip,
    });
    res.status(201).json({ task: mapTask(await loadTask(deps.db, actor.tenantId, id), actor, todayISO()) });
  });

  router.patch("/tasks/:id", async (req, res) => {
    const actor = actorOf(res);
    const patch = parsePatch(TaskFields, req.body);
    const cur = await loadTask(deps.db, actor.tenantId, req.params.id);
    if (!accessFor(actor, cur).edit) throw forbidden("Only the person who created this task, or an owner or admin, can change it");
    if (!isOpenTask(cur.status)) throw new BosError(409, "Reopen the task to change it");
    const next = {
      title: patch.title ?? cur.title,
      details: "details" in patch ? (patch.details ?? null) : cur.details,
      projectId: "projectId" in patch ? patch.projectId || null : cur.project_id,
      milestoneId: "milestoneId" in patch ? patch.milestoneId || null : cur.milestone_id,
      assigneeId: "assigneeId" in patch ? patch.assigneeId || null : cur.assignee_employee_id,
      priority: patch.priority ?? cur.priority,
      startOn: "startOn" in patch ? (patch.startOn ?? null) : cur.start_on,
      dueOn: "dueOn" in patch ? (patch.dueOn ?? null) : cur.due_on,
      recurrence: patch.recurrence ?? cur.recurrence,
    };
    if (next.projectId !== cur.project_id && !("milestoneId" in patch)) next.milestoneId = null;
    checkTask(next);
    const changed = { project: next.projectId !== cur.project_id, milestone: next.milestoneId !== cur.milestone_id, assignee: next.assigneeId !== cur.assignee_employee_id };
    const assignee = await checkRefs(deps, actor.tenantId, next, changed);
    await exec(
      deps.db,
      `UPDATE bos_project_tasks SET title = :title, details = :details, project_id = :projectId, milestone_id = :milestoneId, assignee_employee_id = :assigneeId,
         priority = :priority, start_on = :startOn, due_on = :dueOn, recurrence = :recurrence, due_day = :dueDay
       WHERE id = :id AND tenant_id = :t`,
      { ...next, dueDay: dueDayOf(next.recurrence, next.dueOn), id: cur.id, t: actor.tenantId },
    );
    await recordEvent(deps, actor, {
      type: "task.update",
      entityType: "task",
      entityId: cur.id,
      summary: changed.assignee ? `${next.assigneeId ? `Assigned ${cur.task_no} to ${assignee?.name}` : `Unassigned ${cur.task_no}`}: ${next.title}` : `Updated task ${cur.task_no}: ${next.title}`,
      notice: changed.assignee ? assignNotice(actor, assignee, { id: cur.id, title: next.title, taskNo: cur.task_no, dueOn: next.dueOn }) : undefined,
      ip: req.ip,
    });
    res.json({ task: mapTask(await loadTask(deps.db, actor.tenantId, cur.id), actor, todayISO()) });
  });

  /**
   * Move a task between to do, in progress, on hold, done and cancelled. Marking a repeating task done adds its next
   * occurrence; reopening it removes that one again while it hasn't been started.
   */
  router.post("/tasks/:id/status", async (req, res) => {
    const actor = actorOf(res);
    const { status } = parse(StatusInput, req.body);
    const today = todayISO();
    const cur = await loadTask(deps.db, actor.tenantId, req.params.id);
    const access = accessFor(actor, cur);
    if (status === "cancelled" ? !access.cancel : !access.status) {
      throw forbidden(status === "cancelled" ? "Only the person who created this task, or an owner or admin, can cancel it" : "Only the assignee, the person who created this task, or an owner or admin can move it");
    }
    if (status === cur.status) {
      res.json({ task: mapTask(cur, actor, today), next: null });
      return;
    }
    const reopening = !isOpenTask(cur.status) && isOpenTask(status);
    if (!isOpenTask(cur.status) && !isOpenTask(status)) throw new BosError(409, `This task is already ${STATUS_LABEL[cur.status]} — reopen it first`);

    const nextId = await tx(deps.db, async (conn) => {
      let created: string | null = null;
      if (reopening && cur.next_task_id) {
        const following = await one<{ id: string; task_no: string; status: string }>(conn, `SELECT id, task_no, status FROM bos_project_tasks WHERE id = :id AND tenant_id = :t FOR UPDATE`, {
          id: cur.next_task_id,
          t: actor.tenantId,
        });
        if (following && following.status !== "todo") throw new BosError(409, `The next occurrence (${following.task_no}) has already been started — change that one instead`);
        if (following) await exec(conn, `DELETE FROM bos_project_tasks WHERE id = :id`, { id: following.id });
      }
      if (status === "done" && cur.recurrence !== "none" && cur.due_on) {
        const weekendDays = (await getSettings(deps, actor.tenantId)).weekendDays;
        const due = nextTaskDue(cur.due_on, cur.recurrence, today, weekendDays, cur.due_day);
        if (due) {
          created = randomUUID();
          const taskNo = `TSK-${String(await nextSequence(conn, actor.tenantId, "task", "all")).padStart(4, "0")}`;
          await exec(
            conn,
            `INSERT INTO bos_project_tasks (id, tenant_id, task_no, project_id, milestone_id, title, details, assignee_employee_id, status, priority,
               due_on, recurrence, due_day, created_by, created_by_name)
             SELECT :newId, tenant_id, :taskNo, project_id, milestone_id, title, details, assignee_employee_id, 'todo', priority,
               :due, recurrence, due_day, created_by, created_by_name
             FROM bos_project_tasks WHERE id = :id`,
            { newId: created, taskNo, due, id: cur.id },
          );
        }
      }
      const updated = await exec(
        conn,
        `UPDATE bos_project_tasks SET status = :status,
           done_at = ${status === "done" ? "CURRENT_TIMESTAMP" : "NULL"}, done_by_name = :doneBy,
           next_task_id = ${status === "done" ? ":nextId" : "NULL"}
         WHERE id = :id AND status = :from`,
        { status, doneBy: status === "done" ? (actor.name ?? actor.email ?? null) : null, nextId: created, id: cur.id, from: cur.status },
      );
      if (!updated.affectedRows) throw new BosError(409, "Someone else just changed this task — refresh and try again");
      return created;
    });

    await recordEvent(deps, actor, {
      type: reopening ? "task.reopen" : `task.${status}`,
      entityType: "task",
      entityId: cur.id,
      summary: `${reopening ? "Reopened" : `Marked ${STATUS_LABEL[status]}`} ${cur.task_no}: ${cur.title}`,
      ip: req.ip,
    });
    res.json({
      task: mapTask(await loadTask(deps.db, actor.tenantId, cur.id), actor, today),
      next: nextId ? mapTask(await loadTask(deps.db, actor.tenantId, nextId), actor, today) : null,
    });
  });

  router.delete("/tasks/:id", async (req, res) => {
    const actor = actorOf(res);
    const cur = await loadTask(deps.db, actor.tenantId, req.params.id);
    if (!accessFor(actor, cur).delete) throw forbidden("Only the person who created this task, or an owner or admin, can delete it");
    await exec(deps.db, `DELETE FROM bos_project_tasks WHERE id = :id AND tenant_id = :t`, { id: cur.id, t: actor.tenantId });
    await recordEvent(deps, actor, { type: "task.delete", entityType: "task", entityId: cur.id, summary: `Deleted task ${cur.task_no}: ${cur.title}`, ip: req.ip });
    res.status(204).end();
  });

  /* ---------- Milestones ---------- */

  router.post("/projects/:id/milestones", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(MilestoneFields, req.body);
    const project = await one<{ id: string; name: string }>(deps.db, `SELECT id, name FROM bos_projects WHERE id = :id AND tenant_id = :t`, { id: req.params.id, t: actor.tenantId });
    if (!project) throw notFound("Project");
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_project_milestones (id, tenant_id, project_id, name, due_on, created_by) VALUES (:id, :t, :projectId, :name, :dueOn, :userId)`,
      { id, t: actor.tenantId, projectId: project.id, name: input.name, dueOn: input.dueOn ?? null, userId: actor.userId },
    );
    await recordEvent(deps, actor, { type: "milestone.create", entityType: "milestone", entityId: id, summary: `Added milestone ${input.name} to ${project.name}`, ip: req.ip });
    res.status(201).json({ milestone: mapMilestone(await loadMilestone(deps, actor.tenantId, id), actor, todayISO()) });
  });

  router.patch("/milestones/:id", async (req, res) => {
    const actor = actorOf(res);
    const patch = parsePatch(MilestonePatch, req.body);
    const today = todayISO();
    const cur = await loadMilestone(deps, actor.tenantId, req.params.id);
    const next = {
      name: patch.name ?? cur.name,
      dueOn: "dueOn" in patch ? (patch.dueOn ?? null) : cur.due_on,
      status: patch.status ?? cur.status,
    };
    const doneOn = next.status === "done" ? (cur.status === "done" ? cur.done_on : today) : null;
    await exec(deps.db, `UPDATE bos_project_milestones SET name = :name, due_on = :dueOn, status = :status, done_on = :doneOn WHERE id = :id AND tenant_id = :t`, {
      ...next,
      doneOn,
      id: cur.id,
      t: actor.tenantId,
    });
    const statusChanged = next.status !== cur.status;
    await recordEvent(deps, actor, {
      type: statusChanged ? `milestone.${next.status === "done" ? "done" : "reopen"}` : "milestone.update",
      entityType: "milestone",
      entityId: cur.id,
      summary: `${statusChanged ? (next.status === "done" ? "Reached" : "Reopened") : "Updated"} milestone ${next.name} (${cur.project_name})`,
      ip: req.ip,
    });
    res.json({ milestone: mapMilestone(await loadMilestone(deps, actor.tenantId, cur.id), actor, today) });
  });

  /** Tasks under the milestone stay on the project; they just lose the milestone. */
  router.delete("/milestones/:id", async (req, res) => {
    const actor = actorOf(res);
    const cur = await loadMilestone(deps, actor.tenantId, req.params.id);
    if (!mayDeleteMilestone(actor, cur)) throw forbidden("Only the person who added this milestone, or an owner or admin, can delete it");
    await exec(deps.db, `DELETE FROM bos_project_milestones WHERE id = :id AND tenant_id = :t`, { id: cur.id, t: actor.tenantId });
    await recordEvent(deps, actor, { type: "milestone.delete", entityType: "milestone", entityId: cur.id, summary: `Deleted milestone ${cur.name} (${cur.project_name})`, ip: req.ip });
    res.status(204).end();
  });
}

/** Task counts per project: not cancelled, done, and open past their due date. */
async function projectProgress(deps: BosDeps, tenantId: number, today: string) {
  const list = await rows<{ project_id: string; total: number | string; done: number | string; overdue: number | string }>(
    deps.db,
    `SELECT project_id, SUM(status <> 'cancelled') AS total, SUM(status = 'done') AS done,
            SUM(status IN ('todo','in_progress','on_hold') AND due_on < :today) AS overdue
     FROM bos_project_tasks WHERE tenant_id = :t AND project_id IS NOT NULL GROUP BY project_id`,
    { t: tenantId, today },
  );
  return Object.fromEntries(
    list.map((r) => {
      const counts = { total: Number(r.total) || 0, done: Number(r.done) || 0 };
      return [r.project_id, { ...counts, overdue: Number(r.overdue) || 0, progress: taskProgress(counts) }];
    }),
  ) as Record<string, { total: number; done: number; overdue: number; progress: number | null }>;
}
