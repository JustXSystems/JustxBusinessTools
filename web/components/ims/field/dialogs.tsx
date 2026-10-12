"use client";

import "./field.css";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, Dialog, Field, FormGrid, Input, Select, Textarea } from "@/components/bos";
import { ErrorBlock, LoadingBlock, PersonAvatar, StatusBadge, useImsAction, useImsData } from "../core";
import { PartySelect } from "../shared/pickers";
import {
  FIELD_STATUSES,
  FIELD_STATUS_META,
  FIELD_TASK_PRIORITIES,
  FIELD_TASK_STATUSES,
  FIELD_TASK_TYPES,
  OUTCOME_META,
  PRIORITY_META,
  TASK_STATUS_META,
  TASK_TYPE_LABEL,
  VISIT_OUTCOMES,
  field,
  googleDirectionsUrl,
  googleMapsUrl,
  outcomeMeta,
  priorityMeta,
  taskStatusMeta,
  taskTypeLabel,
  timeOfDay,
  type FieldPerson,
  type FieldStatus,
  type FieldTask,
  type FieldTaskPriority,
  type FieldTaskStatus,
  type FieldTaskType,
  type FieldVisit,
  type VisitOutcome,
} from "@/lib/ims/field";
import { dateLabel, inr } from "@/lib/ims/format";
import { fixBody, getFix, type GeoState } from "./geo";

export type MemberOption = { userId: number; name: string };

/* ---------- Location capture ---------- */

function useGeo(active: boolean) {
  const [geo, setGeo] = useState<GeoState>({ kind: "locating" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void getFix().then((g) => {
      if (alive) setGeo(g);
    });
    return () => {
      alive = false;
    };
  }, [active, attempt]);
  const retry = () => {
    setGeo({ kind: "locating" });
    setAttempt((n) => n + 1);
  };
  return { geo, retry };
}

export function GeoStatus({ geo, onRetry }: { geo: GeoState; onRetry: () => void }) {
  if (geo.kind === "locating") {
    return (
      <div className="ims-fd-geo" role="status">
        <span>📍 Getting your location…</span>
      </div>
    );
  }
  if (geo.kind === "ok") {
    const rough = geo.fix.accuracy !== null && geo.fix.accuracy > 250;
    return (
      <div className="ims-fd-geo" role="status">
        <span>
          📍 Location captured{geo.fix.accuracy !== null ? ` · ±${geo.fix.accuracy} m` : ""}
          {rough ? <span className="ims-faint"> — rough fix, retry outdoors for better accuracy</span> : null}
        </span>
        <a href={googleMapsUrl(geo.fix.lat, geo.fix.lng)} target="_blank" rel="noreferrer">
          View
        </a>
        <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>
          Refresh
        </Button>
      </div>
    );
  }
  const title = geo.reason === "denied" ? "Location is blocked" : geo.reason === "unsupported" ? "Location isn't available" : "No GPS fix";
  return (
    <Alert
      tone="amber"
      title={title}
      actions={
        geo.reason !== "unsupported" ? (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {geo.message} You can still continue — the entry is saved without coordinates.
    </Alert>
  );
}

/* ---------- Check in ---------- */

export function CheckInDialog({ open, onClose, tasks, initialTask }: { open: boolean; onClose: () => void; tasks: ReadonlyArray<FieldTask>; initialTask: FieldTask | null }) {
  const { run, isBusy } = useImsAction();
  const { geo, retry } = useGeo(open);
  const [taskId, setTaskId] = useState(initialTask?.id ?? "");
  const [siteName, setSiteName] = useState(initialTask?.partyName ?? "");
  const [party, setParty] = useState<{ id: string | null; name: string }>({ id: initialTask?.partyId ?? null, name: initialTask?.partyName ?? "" });
  const [purpose, setPurpose] = useState<FieldTaskType>((initialTask?.taskType as FieldTaskType) ?? "visit");
  const [address, setAddress] = useState(initialTask?.siteAddress ?? "");
  const [photoNote, setPhotoNote] = useState("");
  const [touched, setTouched] = useState(false);

  const siteError = touched && siteName.trim().length < 2 ? "Enter the site or customer name" : undefined;

  const pickTask = (id: string) => {
    setTaskId(id);
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.partyName) {
      setSiteName(t.partyName);
      setParty({ id: t.partyId, name: t.partyName });
    }
    if (t.siteAddress) setAddress(t.siteAddress);
    if ((FIELD_TASK_TYPES as readonly string[]).includes(t.taskType)) setPurpose(t.taskType as FieldTaskType);
  };

  const submit = async () => {
    setTouched(true);
    if (siteName.trim().length < 2) return;
    const done = await run(
      "checkin",
      () =>
        field.checkIn({
          siteName: siteName.trim(),
          partyId: party.id,
          partyName: party.name.trim() || null,
          purpose,
          taskId: taskId || null,
          address: address.trim() || null,
          photoNote: photoNote.trim() || null,
          ...fixBody(geo),
        }),
      { success: `Checked in at ${siteName.trim()}`, description: geo.kind === "ok" ? undefined : "Saved without GPS coordinates." },
    );
    if (done) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Check in at a site"
      description="Starts a visit and marks you At site until you check out."
      icon={{ tone: "blue", name: "login" }}
      wide
      actionsNote={geo.kind === "locating" ? "Waiting for GPS…" : undefined}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" onClick={submit} disabled={isBusy("checkin") || geo.kind === "locating"}>
            {isBusy("checkin") ? "Checking in…" : "Check in"}
          </Button>
        </>
      }
    >
      <div className="bos-stack" style={{ gap: 14 }}>
        <GeoStatus geo={geo} onRetry={retry} />
        <FormGrid>
          {tasks.length ? (
            <Field label="For task" hint="Optional — links this visit to an assigned task" full>
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} value={taskId} onChange={(e) => pickTask(e.target.value)}>
                  <option value="">No task — ad-hoc visit</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.partyName ? ` · ${t.partyName}` : ""}
                      {t.dueOn ? ` · due ${dateLabel(t.dueOn)}` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Site / customer name *" error={siteError}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="e.g. Sharma Traders, MG Road" maxLength={200} autoFocus />
            )}
          </Field>
          <Field label="Purpose">
            {({ id }) => (
              <Select id={id} value={purpose} onChange={(e) => setPurpose(e.target.value as FieldTaskType)}>
                {FIELD_TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TASK_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Customer account" hint="Link a saved customer, or type a name">
            {({ id }) => (
              <PartySelect
                id={id}
                kind="customer"
                value={party}
                onChange={(v) => {
                  setParty({ id: v.id, name: v.name });
                  if (v.party && !siteName.trim()) setSiteName(v.party.name);
                  if (v.party?.address && !address.trim()) setAddress([v.party.address, v.party.city].filter(Boolean).join(", "));
                }}
              />
            )}
          </Field>
          <Field label="Address">
            {({ id }) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, area, city" maxLength={500} />}
          </Field>
          <Field label="Photo note" hint="Describe what you found on arrival, or reference a photo you've shared" full>
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} value={photoNote} onChange={(e) => setPhotoNote(e.target.value)} maxLength={500} />}
          </Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}

/* ---------- Check out ---------- */

export function CheckOutDialog({ open, onClose, visit, today }: { open: boolean; onClose: () => void; visit: FieldVisit | null; today: string }) {
  const { run, isBusy } = useImsAction();
  const { geo, retry } = useGeo(open);
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState<VisitOutcome>("completed");
  const [nextVisitOn, setNextVisitOn] = useState("");
  const [completeTask, setCompleteTask] = useState(Boolean(visit?.taskId));
  const [touched, setTouched] = useState(false);

  const summaryError = touched && summary.trim().length < 3 ? "Add a short work summary" : undefined;
  const nextError = nextVisitOn && nextVisitOn < today ? "Pick today or a later date" : undefined;
  const wantsNext = outcome === "follow_up" || outcome === "rescheduled";

  const submit = async () => {
    setTouched(true);
    if (!visit || summary.trim().length < 3 || nextError) return;
    const done = await run(
      "checkout",
      () =>
        field.checkOut(visit.id, {
          summary: summary.trim(),
          outcome,
          nextVisitOn: nextVisitOn || null,
          completeTask: Boolean(visit.taskId) && completeTask,
          ...fixBody(geo),
        }),
      { success: `Checked out of ${visit.siteName}` },
    );
    if (done) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={visit ? `Check out · ${visit.siteName}` : "Check out"}
      description={visit ? `On site since ${timeOfDay(visit.checkedInAt)} (${visit.durationLabel}).` : undefined}
      icon={{ tone: "emerald", name: "check" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" onClick={submit} disabled={!visit || isBusy("checkout") || geo.kind === "locating"}>
            {isBusy("checkout") ? "Saving…" : "Check out"}
          </Button>
        </>
      }
    >
      <div className="bos-stack" style={{ gap: 14 }}>
        <GeoStatus geo={geo} onRetry={retry} />
        <FormGrid>
          <Field label="Work summary *" error={summaryError} full>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What was done, what the customer said, anything pending"
                maxLength={1000}
                autoFocus
              />
            )}
          </Field>
          <Field label="Outcome *">
            {({ id }) => (
              <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value as VisitOutcome)}>
                {VISIT_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_META[o].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Next visit" error={nextError} hint={wantsNext && !nextVisitOn ? "Recommended for follow-ups" : undefined}>
            {({ id, describedBy, invalid }) => <Input id={id} type="date" min={today} aria-describedby={describedBy} aria-invalid={invalid} value={nextVisitOn} onChange={(e) => setNextVisitOn(e.target.value)} />}
          </Field>
          {visit?.taskId ? (
            <div className="ims-row bos-form-grid-full" style={{ gap: 10 }}>
              <Checkbox checked={completeTask} onChange={setCompleteTask} aria-label="Mark the linked task as done" />
              <span>Mark the linked task as done</span>
            </div>
          ) : null}
        </FormGrid>
      </div>
    </Dialog>
  );
}

/* ---------- Status ---------- */

export function StatusDialog({ open, onClose, person }: { open: boolean; onClose: () => void; person: FieldPerson | null }) {
  const { run, isBusy } = useImsAction();
  const [status, setStatus] = useState<FieldStatus>(person && person.status !== "offline" ? person.status : "active");
  const [note, setNote] = useState(person?.statusNote ?? "");
  const locked = Boolean(person?.openVisit);

  const submit = async () => {
    if (!person) return;
    const done = await run("status", () => field.setStatus({ status, note: note.trim() || null, userId: person.isMe ? undefined : person.userId }), {
      success: `${person.isMe ? "Your" : `${person.name}'s`} status is now ${FIELD_STATUS_META[status].label}`,
    });
    if (done) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={person?.isMe ? "Set your status" : `Set status · ${person?.name ?? ""}`}
      icon={{ tone: "blue", name: "user" }}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!person || isBusy("status") || (locked && status !== "at_site")}>
            Save status
          </Button>
        </>
      }
    >
      <div className="bos-stack" style={{ gap: 14 }}>
        {locked ? (
          <Alert tone="blue" title={`Checked in at ${person?.openVisit?.siteName}`}>
            Check out of the current visit before switching to another status.
          </Alert>
        ) : null}
        <div className="ims-fd-chips" role="radiogroup" aria-label="Field status">
          {FIELD_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              className={`bos-filter-chip${status === s ? " is-active" : ""}`}
              onClick={() => setStatus(s)}
              disabled={locked && s !== "at_site"}
              title={FIELD_STATUS_META[s].hint}
            >
              <span className="ims-fd-dot" style={{ background: FIELD_STATUS_META[s].color }} aria-hidden="true" />
              {FIELD_STATUS_META[s].label}
            </button>
          ))}
        </div>
        <Field label="Note" hint="Optional — e.g. 'Heading to Whitefield', 'Back at 3 pm'">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------- Assign / edit task ---------- */

export function TaskDialog({
  open,
  onClose,
  task,
  members,
  today,
  defaultAssignee,
}: {
  open: boolean;
  onClose: () => void;
  task: FieldTask | null;
  members: ReadonlyArray<MemberOption>;
  today: string;
  defaultAssignee?: number | null;
}) {
  const { run, isBusy } = useImsAction();
  const [title, setTitle] = useState(task?.title ?? "");
  const [taskType, setTaskType] = useState<FieldTaskType>((task?.taskType as FieldTaskType) ?? "visit");
  const [priority, setPriority] = useState<FieldTaskPriority>((task?.priority as FieldTaskPriority) ?? "normal");
  const [status, setStatus] = useState<FieldTaskStatus>(task?.status ?? "open");
  const [assignee, setAssignee] = useState(task?.assigneeUserId != null ? String(task.assigneeUserId) : defaultAssignee != null ? String(defaultAssignee) : "");
  const [party, setParty] = useState<{ id: string | null; name: string }>({ id: task?.partyId ?? null, name: task?.partyName ?? "" });
  const [siteAddress, setSiteAddress] = useState(task?.siteAddress ?? "");
  const [dueOn, setDueOn] = useState(task?.dueOn ?? today);
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [amount, setAmount] = useState(task?.amount != null ? String(task.amount) : "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [touched, setTouched] = useState(false);

  const amountNum = amount.trim() ? Number(amount) : null;
  const errors = {
    title: title.trim().length < 2 ? "Give the task a title" : undefined,
    assignee: !assignee ? "Choose who will do this" : undefined,
    dueOn: !task && dueOn && dueOn < today ? "Due date can't be in the past" : undefined,
    amount: amountNum !== null && (!Number.isFinite(amountNum) || amountNum < 0) ? "Enter a valid amount" : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    const body = {
      title: title.trim(),
      taskType,
      priority,
      assigneeUserId: Number(assignee),
      partyId: party.id,
      partyName: party.name.trim() || null,
      siteAddress: siteAddress.trim() || null,
      dueOn: dueOn || null,
      dueTime: dueTime || null,
      amount: amountNum,
      notes: notes.trim() || null,
    };
    const who = members.find((m) => m.userId === Number(assignee))?.name ?? "the assignee";
    const done = task
      ? await run("task-save", () => field.updateTask(task.id, status !== task.status ? { ...body, status } : body), { success: "Task updated" })
      : await run("task-save", () => field.createTask(body), { success: `Task assigned to ${who}`, description: "They'll see it in their notifications and task list." });
    if (done) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task ? "Edit field task" : "Assign a field task"}
      description={task ? undefined : "Send someone to a customer or site — delivery, collection, visit, audit or service."}
      icon={{ tone: "blue", name: "tasks" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={task ? "check" : "plus"} onClick={submit} disabled={isBusy("task-save") || (touched && invalid)}>
            {task ? "Save changes" : "Assign task"}
          </Button>
        </>
      }
    >
      <FormGrid>
        <Field label="Task *" error={show("title")} full>
          {({ id, describedBy, invalid: bad }) => (
            <Input id={id} aria-describedby={describedBy} aria-invalid={bad} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Deliver 20 cartons and collect signed challan" maxLength={200} autoFocus />
          )}
        </Field>
        <Field label="Assign to *" error={show("assignee")}>
          {({ id, describedBy, invalid: bad }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={bad} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Select a team member…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={taskType} onChange={(e) => setTaskType(e.target.value as FieldTaskType)}>
              {FIELD_TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Customer / site">
          {({ id }) => (
            <PartySelect
              id={id}
              kind="customer"
              value={party}
              onChange={(v) => {
                setParty({ id: v.id, name: v.name });
                if (v.party?.address && !siteAddress.trim()) setSiteAddress([v.party.address, v.party.city].filter(Boolean).join(", "));
              }}
            />
          )}
        </Field>
        <Field label="Priority">
          {({ id }) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value as FieldTaskPriority)}>
              {FIELD_TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Site address" full>
          {({ id }) => <Input id={id} value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="Street, area, city, PIN" maxLength={500} />}
        </Field>
        <Field label="Due date" error={show("dueOn")}>
          {({ id, describedBy, invalid: bad }) => <Input id={id} type="date" min={task ? undefined : today} aria-describedby={describedBy} aria-invalid={bad} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}
        </Field>
        <Field label="Due time">
          {({ id }) => <Input id={id} type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />}
        </Field>
        <Field label={taskType === "collection" ? "Amount to collect (₹)" : "Amount (₹)"} error={show("amount")} hint={taskType === "collection" ? "Counts towards today's collections when done" : "Optional"}>
          {({ id, describedBy, invalid: bad }) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" aria-describedby={describedBy} aria-invalid={bad} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        {task ? (
          <Field label="Status">
            {({ id }) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as FieldTaskStatus)}>
                {FIELD_TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_META[s].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="Notes for the assignee" full>
          {({ id }) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contact person, gate pass, items to carry…" maxLength={2000} />}
        </Field>
      </FormGrid>
    </Dialog>
  );
}

/* ---------- Task detail ---------- */

export function TaskDetailDialog({
  taskId,
  onClose,
  meId,
  manager,
  hasOpenVisit,
  onCheckIn,
  onEdit,
}: {
  taskId: string | null;
  onClose: () => void;
  meId: number | null;
  manager: boolean;
  hasOpenVisit: boolean;
  onCheckIn: (task: FieldTask) => void;
  onEdit: (task: FieldTask) => void;
}) {
  const { run, busy } = useImsAction();
  const state = useImsData(() => (taskId ? field.task(taskId) : Promise.resolve(null)), [taskId]);
  const data = state.data;
  const task = data && data.task.id === taskId ? data.task : null;
  const mine = Boolean(task && meId !== null && task.assigneeUserId === meId);
  const canWork = Boolean(task && (mine || manager));

  const move = (to: FieldTaskStatus, success: string) => {
    if (!task) return;
    void run(`move-${to}`, () => field.updateTask(task.id, { status: to }), { success });
  };

  const where = task ? (task.lat !== null && task.lng !== null ? googleMapsUrl(task.lat, task.lng) : task.siteAddress || task.partyName ? googleDirectionsUrl(task.siteAddress || task.partyName || "") : null) : null;

  const actions = task ? (
    <>
      {manager && task.status !== "cancelled" && task.status !== "done" ? (
        <Button variant="destructive" size="sm" onClick={() => move("cancelled", "Task cancelled")} disabled={busy !== null}>
          Cancel task
        </Button>
      ) : null}
      {manager ? (
        <Button size="sm" icon="edit" onClick={() => onEdit(task)}>
          Edit
        </Button>
      ) : null}
      {canWork && task.status === "open" ? (
        <Button size="sm" onClick={() => move("in_progress", "Task started")} disabled={busy !== null}>
          Start
        </Button>
      ) : null}
      {canWork && task.status === "in_progress" ? (
        <Button size="sm" variant="ghost" onClick={() => move("open", "Task paused")} disabled={busy !== null}>
          Pause
        </Button>
      ) : null}
      {canWork && task.status === "done" ? (
        <Button size="sm" onClick={() => move("in_progress", "Task reopened")} disabled={busy !== null}>
          Reopen
        </Button>
      ) : null}
      {mine && !hasOpenVisit && (task.status === "open" || task.status === "in_progress") ? (
        <Button size="sm" icon="login" onClick={() => onCheckIn(task)}>
          Check in here
        </Button>
      ) : null}
      {canWork && (task.status === "open" || task.status === "in_progress") ? (
        <Button size="sm" variant="success" icon="check" onClick={() => move("done", "Task completed")} disabled={busy !== null}>
          Mark done
        </Button>
      ) : null}
    </>
  ) : (
    <Button variant="ghost" onClick={onClose}>
      Close
    </Button>
  );

  return (
    <Dialog open={Boolean(taskId)} onClose={onClose} title={task?.title ?? "Field task"} icon={{ tone: "blue", name: "tasks" }} wide actions={actions}>
      {!task ? (
        state.error ? (
          <ErrorBlock error={state.error} onRetry={state.reload} />
        ) : (
          <LoadingBlock rows={1} />
        )
      ) : (
        <div className="bos-stack" style={{ gap: 16 }}>
          <div className="ims-row">
            <StatusBadge view={{ text: taskStatusMeta(task.status).label.toUpperCase(), tone: taskStatusMeta(task.status).tone }} />
            <Badge tone={priorityMeta(task.priority).tone} auto>
              {priorityMeta(task.priority).label}
            </Badge>
            <Badge tag="lavender">{taskTypeLabel(task.taskType)}</Badge>
            {task.overdue ? (
              <Badge tone="coral" auto>
                OVERDUE
              </Badge>
            ) : null}
          </div>
          <dl className="ims-fd-facts">
            <div>
              <dt>Assigned to</dt>
              <dd className="ims-row">
                <PersonAvatar name={task.assigneeName} size="xs" />
                {task.assigneeName ?? "—"}
              </dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>
                {task.dueOn ? dateLabel(task.dueOn) : "No due date"}
                {task.dueTime ? ` · ${task.dueTime}` : ""}
              </dd>
            </div>
            <div>
              <dt>Customer / site</dt>
              <dd>{task.partyName ?? "—"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>
                {task.siteAddress ?? "—"}
                {where ? (
                  <>
                    {" · "}
                    <a href={where} target="_blank" rel="noreferrer">
                      Directions
                    </a>
                  </>
                ) : null}
              </dd>
            </div>
            {task.amount !== null ? (
              <div>
                <dt>{task.taskType === "collection" ? "To collect" : "Amount"}</dt>
                <dd className="ims-strong">{inr(task.amount)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Assigned by</dt>
              <dd>
                {task.createdByName ?? "—"}
                {task.createdAt ? <span className="ims-faint"> · {dateLabel(task.createdAt)}</span> : null}
              </dd>
            </div>
            {task.completedAt ? (
              <div>
                <dt>Completed</dt>
                <dd>
                  {dateLabel(task.completedAt)} · {timeOfDay(task.completedAt)}
                </dd>
              </div>
            ) : null}
          </dl>
          {task.notes ? (
            <div>
              <div className="ims-faint" style={{ marginBottom: 4 }}>
                Notes
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{task.notes}</div>
            </div>
          ) : null}
          <div>
            <div className="ims-faint" style={{ marginBottom: 6 }}>
              Visits for this task
            </div>
            {data?.visits.length ? (
              <div className="ims-fd-list">
                {data.visits.map((v) => {
                  const o = outcomeMeta(v.outcome);
                  return (
                    <div key={v.id} className="ims-fd-list-row">
                      <PersonAvatar name={v.userName} size="xs" />
                      <div className="ims-cell-stack">
                        <span>
                          {dateLabel(v.date)} · {timeOfDay(v.checkedInAt)}–{v.open ? "now" : timeOfDay(v.checkedOutAt)} ({v.durationLabel})
                        </span>
                        <small>{v.summary ?? (v.open ? "On site now" : "")}</small>
                      </div>
                      {o ? (
                        <Badge tone={o.tone} auto>
                          {o.label}
                        </Badge>
                      ) : (
                        <Badge tone="blue" auto>
                          On site
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="ims-muted" style={{ fontSize: 13 }}>
                No visits logged yet.
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
