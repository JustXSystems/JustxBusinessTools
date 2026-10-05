import { describe, expect, it } from "vitest";
import { byUrgency, milestoneState, nextTaskDue, taskAccess, taskProblem, taskProgress, taskState, taskTotals } from "./task-logic.js";

const today = "2026-10-05"; // a Monday

describe("repeating tasks", () => {
  it("has no next occurrence for a one-off task", () => {
    expect(nextTaskDue("2026-10-05", "none", today)).toBeNull();
  });

  it("moves a daily task to the next working day", () => {
    expect(nextTaskDue("2026-10-06", "daily", today, [0])).toBe("2026-10-07");
    expect(nextTaskDue("2026-10-10", "daily", today, [0])).toBe("2026-10-12"); // Saturday → Monday, Sunday off
    expect(nextTaskDue("2026-10-09", "daily", today, [0, 6])).toBe("2026-10-12"); // Friday → Monday
  });

  it("never loops forever when every day is a weekend day", () => {
    expect(nextTaskDue("2026-10-06", "daily", today, [0, 1, 2, 3, 4, 5, 6])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps the weekday for weekly tasks and the day of the month for monthly ones", () => {
    expect(nextTaskDue("2026-10-07", "weekly", today)).toBe("2026-10-14");
    expect(nextTaskDue("2027-01-31", "monthly", today, [0], 31)).toBe("2027-02-28");
    expect(nextTaskDue("2027-02-28", "monthly", today, [0], 31)).toBe("2027-03-31");
  });

  it("skips past occurrences when a task is finished late, so the next one isn't already overdue", () => {
    expect(nextTaskDue("2026-09-21", "weekly", today)).toBe("2026-10-12");
    expect(nextTaskDue("2026-10-01", "daily", today, [0])).toBe("2026-10-06");
    expect(nextTaskDue("2026-07-15", "monthly", today, [0], 15)).toBe("2026-10-15");
  });

  it("steps once when a task is finished early", () => {
    expect(nextTaskDue("2026-10-20", "weekly", today)).toBe("2026-10-27");
  });
});

describe("task and milestone states", () => {
  it("derives overdue, due today, upcoming and undated", () => {
    expect(taskState({ status: "todo", dueOn: "2026-10-04" }, today)).toBe("overdue");
    expect(taskState({ status: "in_progress", dueOn: today }, today)).toBe("due_today");
    expect(taskState({ status: "on_hold", dueOn: "2026-10-09" }, today)).toBe("upcoming");
    expect(taskState({ status: "todo", dueOn: null }, today)).toBe("no_date");
    expect(taskState({ status: "done", dueOn: "2026-10-01" }, today)).toBe("done");
    expect(taskState({ status: "cancelled", dueOn: "2026-10-01" }, today)).toBe("cancelled");
  });

  it("flags milestones due within a week", () => {
    expect(milestoneState({ status: "open", dueOn: "2026-10-12" }, today)).toBe("due_soon");
    expect(milestoneState({ status: "open", dueOn: "2026-10-13" }, today)).toBe("upcoming");
    expect(milestoneState({ status: "open", dueOn: "2026-10-01" }, today)).toBe("overdue");
    expect(milestoneState({ status: "done", dueOn: "2026-10-01" }, today)).toBe("done");
    expect(milestoneState({ status: "open", dueOn: null }, today)).toBe("no_date");
  });

  it("reports progress only when there are tasks", () => {
    expect(taskProgress({ total: 0, done: 0 })).toBeNull();
    expect(taskProgress({ total: 3, done: 1 })).toBe(33);
    expect(taskProgress({ total: 4, done: 4 })).toBe(100);
  });
});

describe("task checks", () => {
  const base = { recurrence: "none" as const };
  it("accepts a plain task and explains what's wrong otherwise", () => {
    expect(taskProblem(base)).toBeNull();
    expect(taskProblem({ ...base, startOn: "2026-10-10", dueOn: "2026-10-09" })).toMatch(/before the start/);
    expect(taskProblem({ recurrence: "weekly", dueOn: null })).toMatch(/needs a due date/);
    expect(taskProblem({ ...base, milestoneId: "m1", projectId: null })).toMatch(/project/);
    expect(taskProblem({ ...base, milestoneId: "m1", projectId: "p1" })).toBeNull();
  });
});

describe("who can change a task", () => {
  const task = { createdBy: 3, assigneeUserId: 9 };
  it("gives owners and admins everything", () => {
    expect(taskAccess(task, { userId: 1, manager: true })).toEqual({ edit: true, status: true, cancel: true, delete: true });
  });

  it("lets the creator edit, cancel and delete", () => {
    expect(taskAccess(task, { userId: 3, manager: false })).toEqual({ edit: true, status: true, cancel: true, delete: true });
  });

  it("lets the assignee move it along but not edit, cancel or delete it", () => {
    expect(taskAccess(task, { userId: 9, manager: false })).toEqual({ edit: false, status: true, cancel: false, delete: false });
  });

  it("gives everyone else read-only access, including callers without a user id", () => {
    expect(taskAccess(task, { userId: 4, manager: false })).toEqual({ edit: false, status: false, cancel: false, delete: false });
    expect(taskAccess({ createdBy: null, assigneeUserId: null }, { userId: null, manager: false }).edit).toBe(false);
  });
});

describe("task totals", () => {
  it("counts open work by status, overdue, due today, repeating and recently done", () => {
    const t = taskTotals(
      [
        { status: "todo", dueOn: "2026-10-01", recurrence: "none", doneAt: null },
        { status: "todo", dueOn: today, recurrence: "weekly", doneAt: null },
        { status: "in_progress", dueOn: null, recurrence: "none", doneAt: null },
        { status: "on_hold", dueOn: "2026-10-20", recurrence: "none", doneAt: null },
        { status: "done", dueOn: "2026-10-01", recurrence: "none", doneAt: "2026-09-29 10:00:00" },
        { status: "done", dueOn: "2026-09-01", recurrence: "none", doneAt: "2026-09-28 18:00:00" },
        { status: "cancelled", dueOn: "2026-09-01", recurrence: "daily", doneAt: null },
      ],
      today,
    );
    expect(t).toEqual({ open: 4, todo: 2, inProgress: 1, onHold: 1, overdue: 1, dueToday: 1, recurring: 1, doneRecent: 1 });
  });

  it("sorts the most pressing first", () => {
    const list = [
      { id: "a", dueOn: null, priority: "urgent" },
      { id: "b", dueOn: "2026-10-09", priority: "low" },
      { id: "c", dueOn: "2026-10-09", priority: "urgent" },
      { id: "d", dueOn: "2026-10-01", priority: "normal" },
    ];
    expect([...list].sort(byUrgency).map((t) => t.id)).toEqual(["d", "c", "b", "a"]);
  });
});
