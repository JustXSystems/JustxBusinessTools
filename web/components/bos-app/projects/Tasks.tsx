"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  DetailsGrid,
  Dialog,
  Field,
  FormGrid,
  Grid,
  Input,
  Kanban,
  KpiCard,
  ModuleToolbar,
  ProgressBar,
  SearchInput,
  Segmented,
  Select,
  Textarea,
  useToast,
  type BosColumn,
  type BosKanbanColumn,
} from "@/components/bos";
import { bos, type BosMilestone, type BosTask, type TaskPriority, type TaskRecurrence, type TaskStatus, type TasksOverview } from "@/lib/bos-app/api";
import { dateLabel, dayMonth, TASK_COLUMNS, TASK_PRIORITY_LABEL, TASK_RECURRENCE_LABEL, TASK_STATUS_LABEL, taskStatusBadge } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

type Scope = "mine" | "all";
type View = "board" | "list";
/** Project filter: every task, tasks without a project, or one project's id. */
const ALL = "";
const NO_PROJECT = "none";
/** The Done column shows only the latest few; the list shows everything loaded. */
const DONE_ON_BOARD = 20;

const PRIORITIES: ReadonlyArray<TaskPriority> = ["urgent", "high", "normal", "low"];
const RECURRENCES: ReadonlyArray<TaskRecurrence> = ["none", "daily", "weekly", "monthly"];
const RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const faint = (text: ReactNode = "—") => <span className="bos-text-faint">{text}</span>;
const open = (t: Pick<BosTask, "status">) => t.status !== "done" && t.status !== "cancelled";
const byUrgency = (a: BosTask, b: BosTask) =>
  a.dueOn === b.dueOn ? RANK[a.priority] - RANK[b.priority] : !a.dueOn ? 1 : !b.dueOn ? -1 : a.dueOn < b.dueOn ? -1 : 1;

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "urgent") return <Badge tone="coral">URGENT</Badge>;
  if (priority === "high") return <Badge tone="amber">HIGH</Badge>;
  return null;
}

function Due({ task }: { task: Pick<BosTask, "dueOn" | "state"> }) {
  if (!task.dueOn) return faint();
  const late = task.state === "overdue";
  const today = task.state === "due_today";
  return <span style={late ? { color: "var(--bos-coral-600)", fontWeight: 600 } : today ? { color: "var(--bos-amber-700, var(--bos-amber))", fontWeight: 600 } : undefined}>{today ? "Today" : dayMonth(task.dueOn)}</span>;
}

/** Projects → Tasks: to-dos with an assignee, due date and priority, optionally on a project and milestone; repeating tasks add their next one when done. */
export function Tasks() {
  const { takeIntent, canManage } = useBosApp();
  const [intent] = useState(() => takeIntent("tasks"));
  const [scope, setScope] = useState<Scope>(intent === "mine" || !canManage ? "mine" : "all");
  const [projectId, setProjectId] = useState<string>(intent?.startsWith("project:") ? intent.slice(8) : ALL);
  const [view, setView] = useState<View>("board");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  const [editing, setEditing] = useState<BosTask | "new" | null>(intent === "new" ? "new" : null);
  const { run } = useBosAction();
  const { show } = useToast();
  const state = useBosData(() => bos.tasks({ projectId: projectId && projectId !== NO_PROJECT ? projectId : null, mine: scope === "mine" }), [projectId, scope]);

  return (
    <Loaded state={state}>
      {(o) => {
        const q = query.trim().toLowerCase();
        const shown = o.tasks.filter(
          (t) => (projectId !== NO_PROJECT || !t.projectId) && (!q || `${t.title} ${t.taskNo} ${t.assigneeName ?? ""} ${t.projectName ?? ""} ${t.milestoneName ?? ""}`.toLowerCase().includes(q)),
        );
        const project = projectId && projectId !== NO_PROJECT ? o.projects.find((p) => p.id === projectId) : undefined;
        const t = o.totals;
        const move = (task: BosTask, to: TaskStatus) => {
          if (!task.access.status) {
            show({ tone: "amber", title: "You can't move this task", description: "Only the assignee, the person who created it, or an owner or admin can." });
            return;
          }
          void run(`move-${task.id}`, () => bos.setTaskStatus(task.id, to), {
            success: to === "done" ? "Task done" : `Moved to ${TASK_STATUS_LABEL[to]}`,
            description: to === "done" && task.recurrence !== "none" ? `${task.title} — the next one has been added.` : task.title,
          });
        };
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label={scope === "mine" ? "My open tasks" : "Open tasks"} value={t.open} chip={{ color: "blue", glyph: "☐" }} delta={`${t.inProgress} in progress · ${t.onHold} on hold`} deltaTone="muted" />
              <KpiCard label="Overdue" value={t.overdue} valueTone={t.overdue ? "coral" : undefined} chip={{ color: "rose", glyph: "!" }} delta={t.overdue ? "Past their due date" : "Nothing overdue"} deltaTone={t.overdue ? "down" : "up"} />
              <KpiCard label="Due today" value={t.dueToday} chip={{ color: "lavender", glyph: "◷" }} delta={t.recurring ? `${t.recurring} repeating` : "No repeating tasks"} deltaTone="muted" />
              <KpiCard label="Done this week" value={t.doneRecent} chip={{ color: "mint", glyph: "✓" }} delta="Last 7 days" deltaTone="muted" />
            </Grid>
            <ModuleToolbar>
              <Segmented<Scope>
                size="sm"
                aria-label="Whose tasks"
                options={[
                  { value: "mine", label: "My tasks" },
                  { value: "all", label: "Everyone" },
                ]}
                value={scope}
                onChange={setScope}
              />
              <Select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ maxWidth: 220 }}>
                <option value={ALL}>All projects</option>
                <option value={NO_PROJECT}>No project</option>
                {o.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.status === "completed" || p.status === "cancelled" ? ` (${p.status})` : ""}
                  </option>
                ))}
              </Select>
              <SearchInput placeholder="Search tasks, people, projects…" aria-label="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="bos-spacer" />
              <Segmented<View>
                size="sm"
                aria-label="Layout"
                options={[
                  { value: "board", label: "Board" },
                  { value: "list", label: "List" },
                ]}
                value={view}
                onChange={setView}
              />
              <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
                New task
              </Button>
            </ModuleToolbar>
            {o.truncated ? <Alert tone="amber" title="Showing the first 5,000 open tasks and the latest 500 finished">Pick a project or search to narrow it down.</Alert> : null}
            {project ? <ProjectPlan projectId={project.id} projectName={project.name} o={o} /> : null}
            {view === "board" ? <TaskBoard tasks={shown} onOpen={setOpenId} onMove={move} /> : <TaskList tasks={shown} onOpen={setOpenId} showProject={!project} />}
            {openId ? (
              <TaskView
                id={openId}
                o={o}
                onClose={() => setOpenId(null)}
                onEdit={(task) => {
                  setOpenId(null);
                  setEditing(task);
                }}
              />
            ) : null}
            {editing ? <TaskForm task={editing === "new" ? null : editing} o={o} defaultProjectId={project?.id ?? null} onClose={() => setEditing(null)} onSaved={(id) => setOpenId(id)} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function TaskBoard({ tasks, onOpen, onMove }: { tasks: ReadonlyArray<BosTask>; onOpen: (id: string) => void; onMove: (task: BosTask, to: TaskStatus) => void }) {
  const columns: BosKanbanColumn[] = TASK_COLUMNS.map((c) => {
    const list = tasks.filter((t) => t.status === c.key);
    const cards = c.key === "done" ? list.slice(0, DONE_ON_BOARD) : [...list].sort(byUrgency);
    return {
      id: c.key,
      title: c.label,
      dot: c.dot,
      cards: cards.map((t) => ({
        id: t.id,
        title: (
          <button type="button" className="bos-link" style={{ textAlign: "left", font: "inherit", color: "inherit" }} onClick={() => onOpen(t.id)}>
            {t.title}
          </button>
        ),
        tag: t.priority === "urgent" || t.priority === "high" ? <PriorityBadge priority={t.priority} /> : t.projectName ? <Badge tag="sage">{t.projectName.toUpperCase()}</Badge> : t.recurrence !== "none" ? <Badge tag="lavender">REPEATS</Badge> : undefined,
        people: t.assigneeName ? <PersonAvatar name={t.assigneeName} size="xs" /> : undefined,
        due: c.key === "done" ? (t.doneAt ? dayMonth(t.doneAt.slice(0, 10)) : undefined) : t.dueOn ? <Due task={t} /> : undefined,
      })),
    };
  });
  return (
    <Kanban
      aria-label="Tasks by status"
      columns={columns}
      onMove={(id, _from, to) => {
        const task = tasks.find((t) => t.id === id);
        if (task) onMove(task, to as TaskStatus);
      }}
    />
  );
}

function TaskList({ tasks, onOpen, showProject }: { tasks: ReadonlyArray<BosTask>; onOpen: (id: string) => void; showProject: boolean }) {
  const rows = [...tasks.filter(open).sort(byUrgency), ...tasks.filter((t) => !open(t))];
  const columns: BosColumn<BosTask>[] = [
    {
      key: "task",
      header: "Task",
      cell: (t) => (
        <span style={{ display: "block", maxWidth: 340 }}>
          <span style={{ fontWeight: 600 }}>{t.title}</span> <PriorityBadge priority={t.priority} />
          <span className="bos-text-faint" style={{ display: "block", fontSize: 11.5 }}>
            {[t.taskNo, showProject ? t.projectName : null, t.milestoneName, t.recurrence !== "none" ? TASK_RECURRENCE_LABEL[t.recurrence] : null].filter(Boolean).join(" · ")}
          </span>
        </span>
      ),
    },
    { key: "who", header: "Assignee", cell: (t) => t.assigneeName ?? faint("Unassigned") },
    { key: "due", header: "Due", mono: true, cell: (t) => (open(t) ? <Due task={t} /> : t.doneAt ? dateLabel(t.doneAt.slice(0, 10)) : faint()) },
    { key: "status", header: "Status", cell: (t) => <StatusBadge view={taskStatusBadge(t.status)} /> },
  ];
  return <DataTable caption="Tasks" columns={columns} rows={rows} rowKey={(t) => t.id} onRowClick={(t) => onOpen(t.id)} chevron empty="No tasks here yet — add one with New task." />;
}

/* ---------- One project's plan: progress and milestones ---------- */

function ProjectPlan({ projectId, projectName, o }: { projectId: string; projectName: string; o: TasksOverview }) {
  const { run, busy } = useBosAction();
  const [name, setName] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [removing, setRemoving] = useState<BosMilestone | null>(null);
  const p = o.progress[projectId];
  const milestones = o.milestones.filter((m) => m.projectId === projectId);
  const add = async () => {
    if (!name.trim()) return;
    const ok = await run("milestone-add", () => bos.createMilestone(projectId, { name: name.trim(), dueOn: dueOn || null }), { success: "Milestone added", description: name.trim() });
    if (ok) {
      setName("");
      setDueOn("");
    }
  };
  const columns: BosColumn<BosMilestone>[] = [
    { key: "name", header: "Milestone", cell: (m) => <strong style={{ fontWeight: 600 }}>{m.name}</strong> },
    {
      key: "due",
      header: "Due",
      mono: true,
      cell: (m) =>
        m.status === "done" ? (
          `Reached ${dayMonth(m.doneOn ?? m.dueOn ?? "")}`
        ) : m.dueOn ? (
          <span style={m.state === "overdue" ? { color: "var(--bos-coral-600)", fontWeight: 600 } : undefined}>{dayMonth(m.dueOn)}</span>
        ) : (
          faint()
        ),
    },
    {
      key: "progress",
      header: "Tasks",
      cell: (m) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160 }}>
          <span style={{ flex: 1 }}>
            <ProgressBar value={m.progress ?? 0} tone={m.status === "done" || m.progress === 100 ? "emerald" : m.state === "overdue" ? "coral" : "blue"} label={`${m.name} progress`} />
          </span>
          <span className="bos-text-faint" style={{ fontSize: 12 }}>
            {m.done}/{m.total}
          </span>
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (m) => (
        <span className="bos-row" style={{ gap: 6, justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" disabled={busy === `ms-${m.id}`} onClick={() => run(`ms-${m.id}`, () => bos.updateMilestone(m.id, { status: m.status === "done" ? "open" : "done" }), { success: m.status === "done" ? "Milestone reopened" : "Milestone reached", description: m.name })}>
            {m.status === "done" ? "Reopen" : "Mark reached"}
          </Button>
          {m.canDelete ? (
            <Button size="sm" variant="ghost" aria-label={`Delete ${m.name}`} onClick={() => setRemoving(m)}>
              Delete
            </Button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Card style={{ padding: 16 }}>
      <div className="bos-row" style={{ gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <strong style={{ fontWeight: 650 }}>{projectName}</strong>
        <span className="bos-text-faint" style={{ fontSize: 12.5 }}>
          {p ? `${p.done} of ${p.total} tasks done${p.overdue ? ` · ${p.overdue} overdue` : ""}` : "No tasks yet"}
        </span>
        <span style={{ flex: 1, minWidth: 120 }}>{p?.progress !== null && p ? <ProgressBar value={p.progress ?? 0} tone={p.progress === 100 ? "emerald" : "blue"} label={`${projectName} progress`} /> : null}</span>
      </div>
      {milestones.length ? <DataTable caption="Milestones" columns={columns} rows={milestones} rowKey={(m) => m.id} /> : null}
      <form
        className="bos-row"
        style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input aria-label="New milestone" placeholder="Add a milestone, e.g. Panels installed" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <Input aria-label="Milestone due date" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} style={{ width: 160 }} />
        <Button size="sm" type="submit" icon="plus" disabled={!name.trim() || busy === "milestone-add"}>
          Add milestone
        </Button>
      </form>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Delete ${removing?.name ?? "milestone"}?`}
        description="Its tasks stay on the project; they just won't be grouped under this milestone."
        confirmLabel="Delete milestone"
        destructive
        busy={busy === "ms-delete"}
        onConfirm={async () => {
          if (!removing) return;
          await run("ms-delete", () => bos.deleteMilestone(removing.id).then(() => true), { success: "Milestone deleted", description: removing.name });
          setRemoving(null);
        }}
      />
    </Card>
  );
}

/* ---------- One task ---------- */

function TaskView({ id, o, onClose, onEdit }: { id: string; o: TasksOverview; onClose: () => void; onEdit: (task: BosTask) => void }) {
  const { run, busy } = useBosAction();
  const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
  const state = useBosData(() => bos.task(id), [id]);
  const task = state.data?.task ?? o.tasks.find((t) => t.id === id) ?? null;
  const missing = !task && state.error !== null && !state.loading;

  const setStatus = (to: TaskStatus, success: string) =>
    run(`status-${to}`, () => bos.setTaskStatus(id, to), { success, description: to === "done" && task?.recurrence !== "none" ? `${task?.title} — the next one has been added.` : task?.title });

  const actions: ReactNode[] = [];
  if (task && task.access.status) {
    if (open(task)) {
      if (task.status === "todo") actions.push(<Button key="start" size="sm" onClick={() => setStatus("in_progress", "Started")}>Start</Button>);
      if (task.status === "on_hold") actions.push(<Button key="resume" size="sm" onClick={() => setStatus("in_progress", "Resumed")}>Resume</Button>);
      if (task.status !== "on_hold") actions.push(<Button key="hold" size="sm" onClick={() => setStatus("on_hold", "Put on hold")}>Put on hold</Button>);
      actions.push(
        <Button key="done" size="sm" variant="primary" icon="check" disabled={busy === "status-done"} onClick={async () => (await setStatus("done", "Task done")) && onClose()}>
          Mark done
        </Button>,
      );
    } else {
      actions.push(<Button key="reopen" size="sm" onClick={() => setStatus("todo", "Task reopened")}>Reopen</Button>);
    }
  }
  if (task?.access.edit && open(task)) actions.unshift(<Button key="edit" size="sm" icon="edit" onClick={() => onEdit(task)}>Edit</Button>);

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        wide
        icon={{ tone: task?.state === "overdue" ? "coral" : "blue", name: "check" }}
        title={task?.title ?? (missing ? "Task not found" : "Loading…")}
        description={task ? [task.taskNo, task.projectName ?? "No project", task.milestoneName].filter(Boolean).join(" · ") : undefined}
        actionsNote={
          task && (task.access.cancel || task.access.delete) ? (
            <span className="bos-row" style={{ gap: 6 }}>
              {task.access.cancel && open(task) ? (
                <Button size="sm" variant="ghost" onClick={() => setConfirm("cancel")}>
                  Cancel task
                </Button>
              ) : null}
              {task.access.delete ? (
                <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>
                  Delete
                </Button>
              ) : null}
            </span>
          ) : undefined
        }
        actions={actions.length ? <>{actions}</> : <Button size="sm" onClick={onClose}>Close</Button>}
      >
        {missing ? (
          <Alert tone="amber" title="This task doesn't exist any more">It may have been deleted.</Alert>
        ) : task ? (
          <Stack gap={14}>
            <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <StatusBadge view={taskStatusBadge(task.status)} />
              <PriorityBadge priority={task.priority} />
              {task.state === "overdue" ? <Badge tone="coral">OVERDUE</Badge> : null}
              {task.recurrence !== "none" ? <Badge tag="lavender">{TASK_RECURRENCE_LABEL[task.recurrence].toUpperCase()}</Badge> : null}
            </div>
            <DetailsGrid
              cols={3}
              items={[
                { label: "Assignee", value: task.assigneeName ? `${task.assigneeName}${task.assigneeDesignation ? ` · ${task.assigneeDesignation}` : ""}` : "Unassigned" },
                { label: "Due", value: task.dueOn ? dateLabel(task.dueOn) : "—" },
                { label: "Start", value: task.startOn ? dateLabel(task.startOn) : "—" },
                { label: "Priority", value: TASK_PRIORITY_LABEL[task.priority] },
                { label: "Created by", value: task.createdBy ?? "—" },
                { label: task.status === "done" ? "Done" : "Updated", value: task.status === "done" && task.doneAt ? `${dateLabel(task.doneAt.slice(0, 10))}${task.doneBy ? ` · ${task.doneBy}` : ""}` : dateLabel(task.updatedAt.slice(0, 10)) },
              ]}
            />
            {task.details ? <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{task.details}</div> : null}
            {!task.access.status ? <div className="bos-text-faint" style={{ fontSize: 12.5 }}>Only the assignee, the person who created this task, or an owner or admin can change it.</div> : null}
          </Stack>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "delete" ? "Delete this task?" : "Cancel this task?"}
        description={confirm === "delete" ? "It's removed for everyone. This can't be undone." : task?.recurrence !== "none" ? "It stops repeating. You can reopen it later." : "It stays on record as cancelled. You can reopen it later."}
        confirmLabel={confirm === "delete" ? "Delete task" : "Cancel task"}
        destructive
        busy={busy === "task-delete" || busy === "status-cancelled"}
        onConfirm={async () => {
          const ok =
            confirm === "delete"
              ? await run("task-delete", () => bos.deleteTask(id).then(() => true), { success: "Task deleted", description: task?.title })
              : await setStatus("cancelled", "Task cancelled");
          setConfirm(null);
          if (ok) onClose();
        }}
      />
    </>
  );
}

function TaskForm({ task, o, defaultProjectId, onClose, onSaved }: { task: BosTask | null; o: TasksOverview; defaultProjectId: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { run, busy } = useBosAction();
  const me = o.people.find((p) => p.isMe);
  const f = useFormState(() => ({
    title: task?.title ?? "",
    details: task?.details ?? "",
    projectId: task ? (task.projectId ?? "") : (defaultProjectId ?? ""),
    milestoneId: task?.milestoneId ?? "",
    assigneeId: task ? (task.assigneeId ?? "") : (me?.id ?? ""),
    priority: (task?.priority ?? "normal") as TaskPriority,
    startOn: task?.startOn ?? "",
    dueOn: task?.dueOn ?? "",
    recurrence: (task?.recurrence ?? "none") as TaskRecurrence,
  }));
  const v = f.values;
  const milestones = o.milestones.filter((m) => m.projectId === v.projectId);
  const keepMilestone = task?.milestoneId && task.milestoneId === v.milestoneId && !milestones.some((m) => m.id === task.milestoneId);
  const keepAssignee = task?.assigneeId && !o.people.some((p) => p.id === task.assigneeId);
  const { setValues } = f;
  useEffect(() => {
    if (v.milestoneId && !milestones.some((m) => m.id === v.milestoneId) && !keepMilestone) setValues((s) => ({ ...s, milestoneId: "" }));
  }, [v.projectId, v.milestoneId, milestones, keepMilestone, setValues]);

  const submit = async () => {
    const body = {
      title: v.title.trim(),
      details: v.details.trim() || null,
      projectId: v.projectId || null,
      milestoneId: v.projectId ? v.milestoneId || null : null,
      assigneeId: v.assigneeId || null,
      priority: v.priority,
      startOn: v.startOn || null,
      dueOn: v.dueOn || null,
      recurrence: v.recurrence,
    };
    const out = await run("task-save", () => (task ? bos.updateTask(task.id, body) : bos.createTask(body)), { success: task ? "Task updated" : "Task added", description: body.title });
    if (out) {
      onClose();
      onSaved(out.task.id);
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={task ? `Edit ${task.taskNo}` : "New task"}
      icon={{ tone: "blue", name: "check" }}
      submitLabel={task ? "Save" : "Add task"}
      busy={busy === "task-save"}
      onSubmit={submit}
      wide
      note={v.recurrence !== "none" ? "When it's marked done, the next one is added automatically." : undefined}
    >
      <FormGrid>
        <Field label="What needs doing" full>{({ id }) => <Input id={id} required maxLength={200} value={v.title} onChange={(e) => f.set("title")(e.target.value)} />}</Field>
        <Field label="Project">
          {({ id }) => (
            <Select id={id} value={v.projectId} onChange={(e) => f.set("projectId")(e.target.value)}>
              <option value="">No project</option>
              {o.projects
                .filter((p) => (p.status !== "completed" && p.status !== "cancelled") || p.id === v.projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Milestone" hint={v.projectId && !milestones.length && !keepMilestone ? "Add milestones from the project's task view" : undefined}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={v.milestoneId} disabled={!v.projectId} onChange={(e) => f.set("milestoneId")(e.target.value)}>
              <option value="">None</option>
              {keepMilestone ? <option value={task!.milestoneId!}>{task!.milestoneName}</option> : null}
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.dueOn ? ` · ${dayMonth(m.dueOn)}` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Assignee">
          {({ id }) => (
            <Select id={id} value={v.assigneeId} onChange={(e) => f.set("assigneeId")(e.target.value)}>
              <option value="">Unassigned</option>
              {keepAssignee ? <option value={task!.assigneeId!}>{task!.assigneeName}</option> : null}
              {o.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isMe ? " (me)" : p.designation ? ` · ${p.designation}` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority">
          {({ id }) => (
            <Select id={id} value={v.priority} onChange={(e) => f.set("priority")(e.target.value as TaskPriority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Start date">{({ id }) => <Input id={id} type="date" value={v.startOn} onChange={(e) => f.set("startOn")(e.target.value)} />}</Field>
        <Field label="Due date">{({ id }) => <Input id={id} type="date" min={v.startOn || undefined} required={v.recurrence !== "none"} value={v.dueOn} onChange={(e) => f.set("dueOn")(e.target.value)} />}</Field>
        <Field label="Repeats" hint={v.recurrence === "daily" ? "Skips the weekend days in Settings" : undefined}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={v.recurrence} onChange={(e) => f.set("recurrence")(e.target.value as TaskRecurrence)}>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {TASK_RECURRENCE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Details" full>{({ id }) => <Textarea id={id} rows={3} maxLength={4000} value={v.details} onChange={(e) => f.set("details")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}
