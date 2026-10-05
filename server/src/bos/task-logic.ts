import { addDaysISO, weekdayOf } from "./logic.js";
import { nextDueISO } from "./policy-logic.js";

export const TASK_STATUSES = ["todo", "in_progress", "on_hold", "done", "cancelled"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TASK_RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;
export const MILESTONE_STATUSES = ["open", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** Due within this many days counts as "due soon" for milestones. */
export const MILESTONE_SOON_DAYS = 7;

export const isOpenTask = (status: string): boolean => status !== "done" && status !== "cancelled";

function step(dueOn: string, recurrence: TaskRecurrence, weekendDays: ReadonlyArray<number>, dueDay?: number | null): string {
  if (recurrence === "weekly") return addDaysISO(dueOn, 7);
  if (recurrence === "monthly") return nextDueISO(dueOn, "monthly", dueDay) ?? addDaysISO(dueOn, 30);
  let next = addDaysISO(dueOn, 1);
  for (let i = 0; i < 6 && weekendDays.includes(weekdayOf(next)); i++) next = addDaysISO(next, 1);
  return next;
}

/**
 * Due date of the next occurrence of a repeating task, or null for one-off tasks. Daily tasks skip the weekend days in
 * Settings. A task finished late moves on to the first occurrence after today, so the new one isn't already overdue.
 */
export function nextTaskDue(dueOn: string, recurrence: TaskRecurrence, today: string, weekendDays: ReadonlyArray<number> = [0], dueDay?: number | null): string | null {
  if (recurrence === "none") return null;
  let next = step(dueOn, recurrence, weekendDays, dueDay);
  for (let i = 0; i < 1000 && next <= today; i++) next = step(next, recurrence, weekendDays, dueDay);
  return next;
}

export type TaskState = "done" | "cancelled" | "overdue" | "due_today" | "upcoming" | "no_date";
export function taskState(t: { status: string; dueOn: string | null }, today: string): TaskState {
  if (t.status === "done") return "done";
  if (t.status === "cancelled") return "cancelled";
  if (!t.dueOn) return "no_date";
  if (t.dueOn < today) return "overdue";
  return t.dueOn === today ? "due_today" : "upcoming";
}

export type MilestoneState = "done" | "overdue" | "due_soon" | "upcoming" | "no_date";
export function milestoneState(m: { status: string; dueOn: string | null }, today: string): MilestoneState {
  if (m.status === "done") return "done";
  if (!m.dueOn) return "no_date";
  if (m.dueOn < today) return "overdue";
  return m.dueOn <= addDaysISO(today, MILESTONE_SOON_DAYS) ? "due_soon" : "upcoming";
}

/** Share of tasks done, ignoring cancelled ones. */
export function taskProgress(counts: { total: number; done: number }): number | null {
  return counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : null;
}

/** The checks shared by create and edit. */
export function taskProblem(t: { startOn?: string | null; dueOn?: string | null; recurrence: TaskRecurrence; milestoneId?: string | null; projectId?: string | null }): string | null {
  if (t.startOn && t.dueOn && t.dueOn < t.startOn) return "The due date can't be before the start date";
  if (t.recurrence !== "none" && !t.dueOn) return "A repeating task needs a due date";
  if (t.milestoneId && !t.projectId) return "Pick the project for this milestone";
  return null;
}

export type TaskAccess = { edit: boolean; status: boolean; cancel: boolean; delete: boolean };

/**
 * Owners and admins can do anything. Whoever created a task can edit, cancel or delete it. The assignee can move it
 * between to do, in progress, on hold and done.
 */
export function taskAccess(t: { createdBy: number | null; assigneeUserId: number | null }, actor: { userId: number | null; manager: boolean }): TaskAccess {
  if (actor.manager) return { edit: true, status: true, cancel: true, delete: true };
  const creator = actor.userId !== null && t.createdBy === actor.userId;
  const assignee = actor.userId !== null && t.assigneeUserId === actor.userId;
  return { edit: creator, status: creator || assignee, cancel: creator, delete: creator };
}

type TotalsTask = { status: string; dueOn: string | null; recurrence: string; doneAt: string | null };

/** The task KPIs. `doneRecent` counts tasks finished in the last 7 days, today included. */
export function taskTotals(tasks: ReadonlyArray<TotalsTask>, today: string) {
  const weekAgo = addDaysISO(today, -6);
  const t = { open: 0, todo: 0, inProgress: 0, onHold: 0, overdue: 0, dueToday: 0, recurring: 0, doneRecent: 0 };
  for (const task of tasks) {
    if (!isOpenTask(task.status)) {
      if (task.status === "done" && task.doneAt && task.doneAt.slice(0, 10) >= weekAgo) t.doneRecent++;
      continue;
    }
    t.open++;
    if (task.status === "todo") t.todo++;
    else if (task.status === "in_progress") t.inProgress++;
    else if (task.status === "on_hold") t.onHold++;
    if (task.recurrence !== "none") t.recurring++;
    const state = taskState(task, today);
    if (state === "overdue") t.overdue++;
    else if (state === "due_today") t.dueToday++;
  }
  return t;
}
export type TaskTotals = ReturnType<typeof taskTotals>;

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Most pressing first: overdue, then by due date (undated last), then priority. */
export function byUrgency<T extends { dueOn: string | null; priority: string }>(a: T, b: T): number {
  if (a.dueOn !== b.dueOn) {
    if (!a.dueOn) return 1;
    if (!b.dueOn) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  }
  return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
}
