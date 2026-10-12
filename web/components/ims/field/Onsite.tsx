"use client";

import "./field.css";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, DataTable, EmptyState, FilterChip, Grid, Input, Kanban, KpiCard, Segmented, Select, Switch, useToast, type BosColumn, type BosKanbanColumn } from "@/components/bos";
import { Loaded, PageHeader, PersonAvatar, Stack, StatusBadge, SubTabs, useIms, useImsAction, useImsData, useOpenIntent } from "../core";
import {
  FIELD_STATUSES,
  FIELD_STATUS_META,
  FIELD_TASK_STATUSES,
  OUTCOME_META,
  VISIT_OUTCOMES,
  canMoveFieldTask,
  field,
  googleMapsUrl,
  googleRouteUrl,
  minutesText,
  outcomeMeta,
  priorityMeta,
  statusMeta,
  taskStatusMeta,
  taskTypeLabel,
  timeOfDay,
  type FieldOverview,
  type FieldPerson,
  type FieldStatus,
  type FieldTask,
  type FieldTaskStatus,
  type FieldVisit,
} from "@/lib/ims/field";
import { addDaysISO, dateLabel, dayMonth, downloadCsv, downloadXlsx, inr, ROLE_LABEL, timeAgo, type ExportColumn } from "@/lib/ims/format";
import { CheckInDialog, CheckOutDialog, StatusDialog, TaskDetailDialog, TaskDialog, type MemberOption } from "./dialogs";
import { useLiveShare } from "./geo";
import { TeamMap, type MapMarker } from "./TeamMap";

type Tab = "today" | "tasks" | "history" | "timeline";

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "today", label: "Today" },
  { value: "tasks", label: "Tasks" },
  { value: "history", label: "Visit history" },
  { value: "timeline", label: "Day timeline" },
];

const QUICK_STATUSES: ReadonlyArray<FieldStatus> = ["active", "travelling", "at_travel", "on_leave", "offline"];
const roleLabel = (r: string) => (ROLE_LABEL as Record<string, string>)[r] ?? r;
const isOpenTask = (t: FieldTask) => t.status === "open" || t.status === "in_progress";

function useDialog<T>(initial: T) {
  const [s, setS] = useState({ open: false, seq: 0, value: initial });
  return {
    ...s,
    show: (value: T) => setS((p) => ({ open: true, seq: p.seq + 1, value })),
    hide: () => setS((p) => ({ ...p, open: false })),
  };
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

function StatusPill({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span className="ims-row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <span className="ims-fd-dot" style={{ background: m.color }} aria-hidden="true" />
      <Badge tone={m.tone} auto>
        {m.label}
      </Badge>
    </span>
  );
}

const positionOf = (p: FieldPerson) => p.lastPing ?? (p.openVisit && p.openVisit.inLat !== null && p.openVisit.inLng !== null ? { lat: p.openVisit.inLat, lng: p.openVisit.inLng } : null);

/* ---------- Module ---------- */

export function FieldModule() {
  const { session, can } = useIms();
  const manager = can("field");
  const openTaskId = useOpenIntent("field");
  const today = session.today;
  const meId = session.actor.userId;
  const [tab, setTab] = useState<Tab>(openTaskId ? "tasks" : "today");
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<number | null>(null);
  const [timelineUser, setTimelineUser] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<string | null>(openTaskId);
  const overview = useImsData(() => field.overview(date), [date]);
  const live = useLiveShare();
  const { run, busy } = useImsAction();

  const checkIn = useDialog<FieldTask | null>(null);
  const checkOut = useDialog<FieldVisit | null>(null);
  const statusDlg = useDialog<FieldPerson | null>(null);
  const taskDlg = useDialog<{ task: FieldTask | null; assignee: number | null }>({ task: null, assignee: null });

  const { reload } = overview;
  useEffect(() => {
    if (date !== today) return;
    const id = window.setInterval(reload, 60_000);
    return () => window.clearInterval(id);
  }, [date, today, reload]);

  const data = overview.data;
  const me = data?.me ?? null;
  const members: MemberOption[] = useMemo(() => (data ? data.team.map((p) => ({ userId: p.userId, name: p.isMe ? `${p.name} (me)` : p.name })) : []), [data]);
  const myOpenTasks = useMemo(() => (data ? data.tasks.filter((t) => t.assigneeUserId === meId && isOpenTask(t)) : []), [data, meId]);
  const hasOpenVisit = Boolean(me?.openVisit);

  const quickStatus = (s: FieldStatus) => void run("status", () => field.setStatus({ status: s }), { success: `Status set to ${FIELD_STATUS_META[s].label}` });
  const startCheckIn = (task: FieldTask | null) => {
    setDetailId(null);
    checkIn.show(task);
  };
  const openTimeline = (userId: number) => {
    setTimelineUser(userId);
    setTab("timeline");
  };

  return (
    <Stack>
      <PageHeader
        title="Onsite Track"
        sub="Field check-ins, live location, team status and site tasks."
        actions={
          <>
            {tab === "today" ? (
              <Input type="date" size="sm" aria-label="Day" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} style={{ width: 150 }} />
            ) : null}
            <Button size="sm" variant="ghost" icon="refresh" onClick={reload} aria-label="Refresh">
              Refresh
            </Button>
            {manager ? (
              <Button size="sm" variant="primary" icon="plus" onClick={() => taskDlg.show({ task: null, assignee: null })}>
                Assign task
              </Button>
            ) : null}
          </>
        }
      />
      <SubTabs label="Onsite Track sections" value={tab} onChange={setTab} options={TABS} />

      {tab === "today" ? (
        <Loaded state={overview} rows={3}>
          {(d) => (
            <TodayTab
              data={d}
              manager={manager}
              live={live}
              busy={busy !== null}
              selected={selected}
              onSelect={setSelected}
              onCheckIn={() => startCheckIn(null)}
              onCheckOut={(v) => checkOut.show(v)}
              onStatus={(p) => statusDlg.show(p)}
              onQuickStatus={quickStatus}
              onTimeline={openTimeline}
              onAssign={(userId) => taskDlg.show({ task: null, assignee: userId })}
              onOpenTask={setDetailId}
              onStartTask={(t) => void run("move", () => field.updateTask(t.id, { status: "in_progress" }), { success: "Task started" })}
              onCompleteTask={(t) => void run("move", () => field.updateTask(t.id, { status: "done" }), { success: "Task completed" })}
              onCheckInTask={startCheckIn}
            />
          )}
        </Loaded>
      ) : null}

      {tab === "tasks" ? (
        <TasksTab
          manager={manager}
          meId={meId}
          members={members}
          hasOpenVisit={hasOpenVisit}
          onOpen={setDetailId}
          onAssign={() => taskDlg.show({ task: null, assignee: null })}
          onCheckIn={startCheckIn}
        />
      ) : null}

      {tab === "history" ? <HistoryTab manager={manager} members={members} today={today} onOpenTask={setDetailId} /> : null}

      {tab === "timeline" ? <TimelineTab manager={manager} members={members} today={today} userId={timelineUser ?? meId ?? 0} onUser={setTimelineUser} /> : null}

      <CheckInDialog key={`ci-${checkIn.seq}`} open={checkIn.open} onClose={checkIn.hide} tasks={myOpenTasks} initialTask={checkIn.value} />
      <CheckOutDialog key={`co-${checkOut.seq}`} open={checkOut.open} onClose={checkOut.hide} visit={checkOut.value} today={today} />
      <StatusDialog key={`st-${statusDlg.seq}`} open={statusDlg.open} onClose={statusDlg.hide} person={statusDlg.value} />
      {manager ? (
        <TaskDialog key={`tk-${taskDlg.seq}`} open={taskDlg.open} onClose={taskDlg.hide} task={taskDlg.value.task} defaultAssignee={taskDlg.value.assignee} members={members} today={today} />
      ) : null}
      <TaskDetailDialog
        taskId={detailId}
        onClose={() => setDetailId(null)}
        meId={meId}
        manager={manager}
        hasOpenVisit={hasOpenVisit}
        onCheckIn={startCheckIn}
        onEdit={(t) => {
          setDetailId(null);
          taskDlg.show({ task: t, assignee: null });
        }}
      />
    </Stack>
  );
}

/* ---------- Today ---------- */

type LiveShare = ReturnType<typeof useLiveShare>;

function TodayTab({
  data,
  manager,
  live,
  busy,
  selected,
  onSelect,
  onCheckIn,
  onCheckOut,
  onStatus,
  onQuickStatus,
  onTimeline,
  onAssign,
  onOpenTask,
  onStartTask,
  onCompleteTask,
  onCheckInTask,
}: {
  data: FieldOverview;
  manager: boolean;
  live: LiveShare;
  busy: boolean;
  selected: number | null;
  onSelect: (userId: number) => void;
  onCheckIn: () => void;
  onCheckOut: (v: FieldVisit) => void;
  onStatus: (p: FieldPerson) => void;
  onQuickStatus: (s: FieldStatus) => void;
  onTimeline: (userId: number) => void;
  onAssign: (userId: number) => void;
  onOpenTask: (id: string) => void;
  onStartTask: (t: FieldTask) => void;
  onCompleteTask: (t: FieldTask) => void;
  onCheckInTask: (t: FieldTask) => void;
}) {
  const isToday = data.date === data.today;
  const n = data.numbers;
  const mine = data.tasks.filter((t) => t.assigneeUserId === data.me.userId && isOpenTask(t));
  return (
    <Stack>
      {!isToday ? (
        <Alert tone="blue" title={`Viewing ${dateLabel(data.date)}`}>
          Past days are read-only. Switch back to today to check in or change status.
        </Alert>
      ) : null}
      <MeCard me={data.me} isToday={isToday} live={live} busy={busy} onCheckIn={onCheckIn} onCheckOut={onCheckOut} onStatus={onStatus} onQuickStatus={onQuickStatus} />

      <Grid cols={4} min={150}>
        <KpiCard label={manager ? "Team visits" : "My visits"} value={n.visits} chip={{ color: "blue", glyph: "📍" }} delta={n.activeVisits ? `${n.activeVisits} on site now` : "No one on site"} deltaTone={n.activeVisits ? "info" : "muted"} interactive={false} />
        <KpiCard label="Distance travelled" value={`${n.km.toFixed(1)} km`} chip={{ color: "lavender", glyph: "🛣" }} delta="From live-location pings" deltaTone="muted" interactive={false} />
        <KpiCard
          label="Tasks done"
          value={n.tasksDone}
          chip={{ color: "mint", glyph: "✓" }}
          delta={`${n.tasksOpen} open${n.tasksOverdue ? ` · ${n.tasksOverdue} overdue` : ""}`}
          deltaTone={n.tasksOverdue ? "warn" : "muted"}
          interactive={false}
        />
        <KpiCard
          label="Time on site"
          value={minutesText(n.minutesOnSite)}
          chip={{ color: "amber", glyph: "⏱" }}
          delta={n.collections ? `${inr(n.collections)} collected` : n.followUps ? `${n.followUps} follow-ups` : "Across today's visits"}
          deltaTone={n.collections ? "up" : "muted"}
          interactive={false}
        />
      </Grid>

      {isToday ? <MyTasksCard tasks={mine} busy={busy} hasOpenVisit={Boolean(data.me.openVisit)} onOpen={onOpenTask} onStart={onStartTask} onComplete={onCompleteTask} onCheckIn={onCheckInTask} /> : null}

      {manager ? <TeamBoard data={data} selected={selected} onSelect={onSelect} onStatus={onStatus} onTimeline={onTimeline} onAssign={onAssign} /> : null}

      <MapSection data={data} manager={manager} selected={selected} onSelect={onSelect} />

      <VisitsCard visits={data.visits.filter((v) => v.date === data.date || v.open)} manager={manager} onOpenTask={onOpenTask} />
    </Stack>
  );
}

function MeCard({
  me,
  isToday,
  live,
  busy,
  onCheckIn,
  onCheckOut,
  onStatus,
  onQuickStatus,
}: {
  me: FieldPerson;
  isToday: boolean;
  live: LiveShare;
  busy: boolean;
  onCheckIn: () => void;
  onCheckOut: (v: FieldVisit) => void;
  onStatus: (p: FieldPerson) => void;
  onQuickStatus: (s: FieldStatus) => void;
}) {
  const visit = me.openVisit;
  const liveLine = live.error
    ? live.error
    : live.on
      ? live.lastSentAt
        ? `Shared ${timeAgo(new Date(live.lastSentAt).toISOString())}${live.accuracy !== null ? ` · ±${live.accuracy} m` : ""} · every minute while this tab is open`
        : "Waiting for the first GPS fix…"
      : "Off — your manager sees only check-in locations.";
  return (
    <Card interactive={false}>
      <div className="ims-fd-me">
        <div>
          <div className="ims-fd-me-head">
            <PersonAvatar name={me.name} size="lg" />
            <div className="ims-cell-stack">
              <span className="ims-fd-me-name">{me.name}</span>
              <small>
                {roleLabel(me.role)}
                {me.statusAt ? ` · status updated ${timeAgo(me.statusAt)}` : ""}
              </small>
            </div>
            <span style={{ marginLeft: "auto" }}>
              <StatusPill status={me.status} />
            </span>
          </div>
          {me.statusNote ? (
            <div className="ims-muted" style={{ marginTop: 8, fontSize: 13 }}>
              “{me.statusNote}”
            </div>
          ) : null}

          {visit ? (
            <div className="ims-fd-visit">
              <span className="ims-faint">CHECKED IN</span>
              <b>{visit.siteName}</b>
              <span>
                Since {timeOfDay(visit.checkedInAt)} · {visit.durationLabel} · {taskTypeLabel(visit.purpose)}
                {visit.inLat === null ? " · no GPS" : ""}
              </span>
              {isToday ? (
                <div style={{ marginTop: 8 }}>
                  <Button variant="primary" icon="check" onClick={() => onCheckOut(visit)}>
                    Check out
                  </Button>
                </div>
              ) : null}
            </div>
          ) : isToday ? (
            <div className="ims-row" style={{ marginTop: 14 }}>
              <Button variant="primary" icon="login" onClick={onCheckIn}>
                Check in at a site
              </Button>
              <span className="ims-faint">Captures GPS, site and purpose; marks you At site.</span>
            </div>
          ) : null}

          {isToday ? (
            <div style={{ marginTop: 16 }}>
              <div className="ims-faint" style={{ marginBottom: 6 }}>
                Quick status
              </div>
              <div className="ims-fd-chips">
                {QUICK_STATUSES.map((s) => (
                  <FilterChip key={s} active={me.status === s} disabled={Boolean(visit) || busy} onClick={() => onQuickStatus(s)} title={FIELD_STATUS_META[s].hint}>
                    <span className="ims-fd-dot" style={{ background: FIELD_STATUS_META[s].color }} aria-hidden="true" />
                    {FIELD_STATUS_META[s].label}
                  </FilterChip>
                ))}
                <Button size="sm" variant="ghost" icon="edit" onClick={() => onStatus(me)}>
                  Status with note
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="ims-fd-side">
          <div className="ims-fd-geo">
            <div className="ims-cell-stack">
              <span className="ims-strong">Live location</span>
              <small style={live.error ? { color: "var(--bos-coral)" } : undefined}>{liveLine}</small>
            </div>
            <Switch checked={live.on} onChange={live.toggle} disabled={!isToday} aria-label="Share live location" />
          </div>
          <div className="ims-fd-stats">
            <div>
              <b>{me.visits}</b>Visits
            </div>
            <div>
              <b>{me.km.toFixed(1)}</b>km
            </div>
            <div>
              <b>{minutesText(me.minutesOnSite)}</b>On site
            </div>
            <div>
              <b>{me.doneTasks}</b>Tasks done
            </div>
            <div>
              <b>{me.openTasks}</b>Open tasks
            </div>
            <div>
              <b>{me.firstSeenAt ? timeOfDay(me.firstSeenAt) : "—"}</b>Day started
            </div>
          </div>
          {me.lastPing ? (
            <a className="ims-faint" href={googleMapsUrl(me.lastPing.lat, me.lastPing.lng)} target="_blank" rel="noreferrer">
              Last location {timeAgo(me.lastPing.at)} — open in Google Maps ↗
            </a>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function MyTasksCard({
  tasks,
  busy,
  hasOpenVisit,
  onOpen,
  onStart,
  onComplete,
  onCheckIn,
}: {
  tasks: ReadonlyArray<FieldTask>;
  busy: boolean;
  hasOpenVisit: boolean;
  onOpen: (id: string) => void;
  onStart: (t: FieldTask) => void;
  onComplete: (t: FieldTask) => void;
  onCheckIn: (t: FieldTask) => void;
}) {
  return (
    <Card interactive={false}>
      <div className="ims-between" style={{ marginBottom: 12 }}>
        <h2 className="bos-widget-title" style={{ margin: 0 }}>
          My tasks
        </h2>
        <span className="ims-faint">{tasks.length ? `${tasks.length} open` : ""}</span>
      </div>
      {tasks.length ? (
        <div className="ims-fd-list" style={{ maxHeight: "none" }}>
          {tasks.map((t) => (
            <div key={t.id} className="ims-fd-list-row">
              <Badge tone={priorityMeta(t.priority).tone} auto>
                {priorityMeta(t.priority).label}
              </Badge>
              <div className="ims-cell-stack">
                <button type="button" className="ims-fd-task-title ims-strong" onClick={() => onOpen(t.id)}>
                  {t.title}
                </button>
                <small>
                  {[taskTypeLabel(t.taskType), t.partyName, t.dueOn ? `due ${dayMonth(t.dueOn)}${t.dueTime ? ` ${t.dueTime}` : ""}` : null].filter(Boolean).join(" · ")}
                  {t.overdue ? " · overdue" : ""}
                </small>
              </div>
              <div className="ims-row" style={{ flexWrap: "nowrap" }}>
                {t.status === "open" ? (
                  <Button size="sm" variant="ghost" onClick={() => onStart(t)} disabled={busy}>
                    Start
                  </Button>
                ) : null}
                {!hasOpenVisit ? (
                  <Button size="sm" icon="login" onClick={() => onCheckIn(t)}>
                    Check in
                  </Button>
                ) : null}
                <Button size="sm" variant="success" icon="check" onClick={() => onComplete(t)} disabled={busy} aria-label={`Mark ${t.title} done`}>
                  Done
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ims-muted" style={{ fontSize: 13 }}>
          Nothing assigned to you right now.
        </div>
      )}
    </Card>
  );
}

function TeamBoard({
  data,
  selected,
  onSelect,
  onStatus,
  onTimeline,
  onAssign,
}: {
  data: FieldOverview;
  selected: number | null;
  onSelect: (userId: number) => void;
  onStatus: (p: FieldPerson) => void;
  onTimeline: (userId: number) => void;
  onAssign: (userId: number) => void;
}) {
  const [filter, setFilter] = useState<FieldStatus | "all">("all");
  const isToday = data.date === data.today;
  const shown = filter === "all" ? data.team : data.team.filter((p) => p.status === filter);
  return (
    <Card interactive={false}>
      <div className="ims-between" style={{ marginBottom: 12 }}>
        <h2 className="bos-widget-title" style={{ margin: 0 }}>
          Team board
        </h2>
        <div className="ims-fd-chips" role="group" aria-label="Filter by status">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All · {data.team.length}
          </FilterChip>
          {FIELD_STATUSES.filter((s) => data.numbers.statusCounts[s] > 0).map((s) => (
            <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
              <span className="ims-fd-dot" style={{ background: FIELD_STATUS_META[s].color }} aria-hidden="true" />
              {FIELD_STATUS_META[s].label} · {data.numbers.statusCounts[s]}
            </FilterChip>
          ))}
        </div>
      </div>
      {shown.length ? (
        <div className="ims-fd-team">
          {shown.map((p) => (
            <div key={p.userId} className={`ims-fd-member${selected === p.userId ? " is-selected" : ""}`}>
              <div className="ims-fd-member-head">
                <PersonAvatar name={p.name} size="md" />
                <div className="ims-cell-stack">
                  <span className="ims-strong">
                    {p.name}
                    {p.isMe ? <span className="ims-faint"> (me)</span> : null}
                  </span>
                  <small>{roleLabel(p.role)}</small>
                </div>
                <StatusPill status={p.status} />
              </div>
              <div className="ims-fd-site" title={p.currentSite ?? p.statusNote ?? undefined}>
                {p.currentSite ? `📍 ${p.currentSite} · ${p.openVisit?.durationLabel ?? ""}` : p.statusNote ? `“${p.statusNote}”` : p.lastSeenAt ? `Last active ${timeAgo(p.lastSeenAt)}` : "No activity yet today"}
              </div>
              <div className="ims-fd-stats">
                <div>
                  <b>{p.km.toFixed(1)}</b>km
                </div>
                <div>
                  <b>{p.visits}</b>visits
                </div>
                <div>
                  <b>{p.openTasks}</b>open tasks
                </div>
              </div>
              <div className="ims-between" style={{ gap: 6 }}>
                <span className="ims-faint">{p.lastPing ? `Ping ${timeAgo(p.lastPing.at)}` : "No GPS today"}</span>
                <div className="ims-row" style={{ gap: 4 }}>
                  <Button size="sm" variant="ghost" onClick={() => onSelect(p.userId)} aria-pressed={selected === p.userId} aria-label={`Show ${p.name} on the map`}>
                    Map
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onTimeline(p.userId)} aria-label={`${p.name}'s day timeline`}>
                    Timeline
                  </Button>
                  {isToday ? (
                    <>
                      <Button size="sm" variant="ghost" icon="plus" onClick={() => onAssign(p.userId)} aria-label={`Assign a task to ${p.name}`} iconOnly />
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => onStatus(p)} aria-label={`Set ${p.name}'s status`} iconOnly />
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="users" title="No one in this status" />
      )}
    </Card>
  );
}

function MapSection({ data, manager, selected, onSelect }: { data: FieldOverview; manager: boolean; selected: number | null; onSelect: (userId: number) => void }) {
  const subject = data.team.find((p) => p.userId === selected) ?? data.me;
  const point = positionOf(subject);
  const checkins = data.visits.filter((v) => v.inLat !== null && v.inLng !== null && (v.date === data.date || v.open));
  const people: MapMarker[] = (manager ? data.team : [data.me]).flatMap((p) => {
    const at = positionOf(p);
    if (!at) return [];
    const detail = [statusMeta(p.status).label, p.currentSite, p.lastPing?.at ? `fix ${timeAgo(p.lastPing.at)}` : null].filter(Boolean).join(" · ");
    return [{ id: String(p.userId), lat: at.lat, lng: at.lng, label: p.isMe ? "You" : p.name, color: statusMeta(p.status).color, detail }];
  });
  const markers: MapMarker[] = people.length
    ? people
    : checkins
        .filter((v) => manager || v.userId === data.me.userId)
        .map((v) => ({ id: `visit-${v.id}`, lat: v.inLat as number, lng: v.inLng as number, label: v.siteName, color: "#9098B8", detail: `${manager && v.userName ? `${v.userName} · ` : ""}checked in ${timeOfDay(v.checkedInAt)}` }));
  return (
    <div className="ims-fd-mapgrid">
      <Card interactive={false}>
        <div className="ims-between" style={{ marginBottom: 12 }}>
          <h2 className="bos-widget-title" style={{ margin: 0 }}>
            {manager ? `Team map · ${people.length} located` : point ? "My location" : "Map"}
          </h2>
          <div className="ims-row">
            {manager && data.team.length > 1 ? (
              <Select size="sm" aria-label="Show member on map" value={String(subject.userId)} onChange={(e) => onSelect(Number(e.target.value))} style={{ width: 200 }}>
                {data.team.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                    {p.lastPing ? "" : " (no GPS)"}
                  </option>
                ))}
              </Select>
            ) : null}
            {point ? (
              <a className="ims-faint" href={googleMapsUrl(point.lat, point.lng)} target="_blank" rel="noreferrer">
                Google Maps ↗
              </a>
            ) : null}
          </div>
        </div>
        <TeamMap
          markers={markers}
          selectedId={point ? String(subject.userId) : null}
          onSelect={manager ? (id) => (/^\d+$/.test(id) ? onSelect(Number(id)) : undefined) : undefined}
          title={manager ? "Team locations" : "My location"}
        />
        {subject.lastPing ? (
          <div className="ims-faint" style={{ marginTop: 8 }}>
            {subject.isMe ? "Your" : `${subject.name}'s`} last fix {timeAgo(subject.lastPing.at)}
            {subject.lastPing.accuracy !== null ? ` · ±${subject.lastPing.accuracy} m` : ""}
          </div>
        ) : null}
      </Card>
      <Card interactive={false}>
        <h2 className="bos-widget-title" style={{ marginTop: 0 }}>
          Check-ins · {dayMonth(data.date)}
        </h2>
        {checkins.length ? (
          <div className="ims-fd-list">
            {checkins.map((v) => (
              <div key={v.id} className="ims-fd-list-row">
                <PersonAvatar name={v.userName} size="xs" />
                <div className="ims-cell-stack">
                  <span className="ims-strong">{v.siteName}</span>
                  <small>
                    {manager ? `${v.userName ?? "—"} · ` : ""}
                    {timeOfDay(v.checkedInAt)}
                    {v.open ? " · on site" : ` – ${timeOfDay(v.checkedOutAt)}`}
                  </small>
                </div>
                <a href={googleMapsUrl(v.inLat as number, v.inLng as number)} target="_blank" rel="noreferrer" aria-label={`Open ${v.siteName} in Google Maps`}>
                  Map ↗
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="ims-muted" style={{ fontSize: 13 }}>
            No GPS-tagged check-ins for this day.
          </div>
        )}
      </Card>
    </div>
  );
}

function VisitsCard({ visits, manager, onOpenTask }: { visits: ReadonlyArray<FieldVisit>; manager: boolean; onOpenTask: (id: string) => void }) {
  const columns: BosColumn<FieldVisit>[] = [
    ...(manager ? [{ key: "user", header: "Member", cell: (v: FieldVisit) => v.userName ?? "—" }] : []),
    {
      key: "site",
      header: "Site",
      cell: (v) => (
        <div className="ims-cell-stack">
          <span className="ims-strong">{v.siteName}</span>
          <small>{[taskTypeLabel(v.purpose), v.partyName && v.partyName !== v.siteName ? v.partyName : null].filter(Boolean).join(" · ")}</small>
        </div>
      ),
    },
    { key: "in", header: "In", mono: true, cell: (v) => timeOfDay(v.checkedInAt) },
    { key: "out", header: "Out", mono: true, cell: (v) => (v.open ? "—" : timeOfDay(v.checkedOutAt)) },
    { key: "dur", header: "Time", align: "right", cell: (v) => v.durationLabel },
    {
      key: "outcome",
      header: "Outcome",
      cell: (v) => {
        const o = outcomeMeta(v.outcome);
        return o ? <StatusBadge view={{ text: o.label.toUpperCase(), tone: o.tone }} auto /> : <StatusBadge view={{ text: "ON SITE", tone: "blue" }} />;
      },
    },
    { key: "summary", header: "Summary", cell: (v) => <span className="ims-muted">{v.summary ?? v.photoNote ?? ""}</span> },
  ];
  return (
    <Card interactive={false}>
      <h2 className="bos-widget-title" style={{ marginTop: 0 }}>
        Visits
      </h2>
      <DataTable
        columns={columns}
        rows={visits}
        rowKey={(v) => v.id}
        compact
        onRowClick={(v) => {
          if (v.taskId) onOpenTask(v.taskId);
        }}
        empty="No visits logged for this day."
        caption="Visits for the selected day"
      />
    </Card>
  );
}

/* ---------- Tasks ---------- */

function TasksTab({
  manager,
  meId,
  members,
  hasOpenVisit,
  onOpen,
  onAssign,
  onCheckIn,
}: {
  manager: boolean;
  meId: number | null;
  members: ReadonlyArray<MemberOption>;
  hasOpenVisit: boolean;
  onOpen: (id: string) => void;
  onAssign: () => void;
  onCheckIn: (t: FieldTask) => void;
}) {
  const { show } = useToast();
  const { run, busy } = useImsAction();
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  const [closedToo, setClosedToo] = useState(false);
  const query = useDebounced(q.trim());
  const state = useImsData(
    () => field.tasks({ q: query || undefined, userId: who ? Number(who) : undefined, status: closedToo ? undefined : "open,in_progress,done", limit: 500 }),
    [query, who, closedToo],
  );

  const move = (task: FieldTask, to: FieldTaskStatus) => {
    if (!canMoveFieldTask(task.status, to, manager)) {
      show({ tone: "amber", title: "Can't move that task", description: to === "cancelled" ? "Only a field manager can cancel a task." : `A task can't go from ${taskStatusMeta(task.status).label} to ${taskStatusMeta(to).label}.` });
      return;
    }
    void run("move", () => field.updateTask(task.id, { status: to }), { success: `Moved to ${taskStatusMeta(to).label}` });
  };

  return (
    <Stack>
      <Loaded state={state} rows={2}>
        {({ tasks }) => {
          const mine = tasks.filter((t) => t.assigneeUserId === meId && isOpenTask(t));
          const byId = new Map(tasks.map((t) => [t.id, t]));
          const columns: BosKanbanColumn[] = FIELD_TASK_STATUSES.filter((s) => closedToo || s !== "cancelled").map((s) => {
            const list = tasks.filter((t) => t.status === s);
            return {
              id: s,
              title: `${taskStatusMeta(s).label} · ${list.length}`,
              dot: taskStatusMeta(s).dot,
              cards: list.slice(0, 60).map((t) => ({
                id: t.id,
                title: (
                  <span className="ims-cell-stack">
                    <button type="button" className="ims-fd-task-title" onClick={() => onOpen(t.id)}>
                      {t.title}
                    </button>
                    <small>{[taskTypeLabel(t.taskType), t.partyName].filter(Boolean).join(" · ")}</small>
                  </span>
                ),
                tag: (
                  <Badge tone={priorityMeta(t.priority).tone} auto>
                    {priorityMeta(t.priority).label}
                  </Badge>
                ),
                people: manager ? <PersonAvatar name={t.assigneeName} size="xs" /> : undefined,
                due: t.dueOn ? <span style={t.overdue ? { color: "var(--bos-coral)" } : undefined}>{`${dayMonth(t.dueOn)}${t.dueTime ? ` ${t.dueTime}` : ""}`}</span> : undefined,
              })),
            };
          });
          const listCols: BosColumn<FieldTask>[] = [
            {
              key: "title",
              header: "Task",
              cell: (t) => (
                <div className="ims-cell-stack">
                  <span className="ims-strong">{t.title}</span>
                  <small>{taskTypeLabel(t.taskType)}</small>
                </div>
              ),
            },
            { key: "party", header: "Customer / site", cell: (t) => t.partyName ?? t.siteAddress ?? "—" },
            ...(manager ? [{ key: "who", header: "Assignee", cell: (t: FieldTask) => t.assigneeName ?? "—" }] : []),
            {
              key: "due",
              header: "Due",
              mono: true,
              cell: (t) => (t.dueOn ? <span style={t.overdue ? { color: "var(--bos-coral)" } : undefined}>{`${dateLabel(t.dueOn)}${t.dueTime ? ` ${t.dueTime}` : ""}`}</span> : "—"),
            },
            {
              key: "priority",
              header: "Priority",
              cell: (t) => (
                <Badge tone={priorityMeta(t.priority).tone} auto>
                  {priorityMeta(t.priority).label}
                </Badge>
              ),
            },
            { key: "amount", header: "Amount", align: "right", cell: (t) => (t.amount !== null ? inr(t.amount) : "") },
            { key: "status", header: "Status", cell: (t) => <StatusBadge view={{ text: taskStatusMeta(t.status).label.toUpperCase(), tone: taskStatusMeta(t.status).tone }} /> },
          ];
          return (
            <>
              {mine.length && manager ? (
                <MyTasksCard
                  tasks={mine}
                  busy={busy !== null}
                  hasOpenVisit={hasOpenVisit}
                  onOpen={onOpen}
                  onStart={(t) => move(t, "in_progress")}
                  onComplete={(t) => move(t, "done")}
                  onCheckIn={onCheckIn}
                />
              ) : null}
              <Card interactive={false}>
                <div className="ims-toolbar">
                  <Input className="ims-grow" size="sm" type="search" placeholder="Search task, customer, address or assignee…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
                  {manager ? (
                    <Select size="sm" aria-label="Assignee" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 190 }}>
                      <option value="">Everyone</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  <FilterChip active={closedToo} onClick={() => setClosedToo((v) => !v)}>
                    Include cancelled
                  </FilterChip>
                  <Segmented
                    size="sm"
                    role="radio"
                    aria-label="Task view"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: "board", label: "Board" },
                      { value: "list", label: "List" },
                    ]}
                  />
                  {manager ? (
                    <Button size="sm" variant="primary" icon="plus" onClick={onAssign}>
                      Assign task
                    </Button>
                  ) : null}
                </div>
                {!tasks.length ? (
                  <EmptyState
                    icon="tasks"
                    title={query || who ? "No tasks match" : manager ? "No field tasks yet" : "No tasks assigned to you"}
                    actions={
                      manager && !query && !who ? (
                        <Button variant="primary" icon="plus" onClick={onAssign}>
                          Assign the first task
                        </Button>
                      ) : undefined
                    }
                  >
                    {manager ? "Assign deliveries, collections and visits; the assignee is notified instantly." : "Tasks your manager assigns will show up here."}
                  </EmptyState>
                ) : view === "board" ? (
                  <Kanban
                    aria-label="Field tasks board"
                    columns={columns}
                    onMove={(cardId, _from, to) => {
                      const t = byId.get(cardId);
                      if (t) move(t, to as FieldTaskStatus);
                    }}
                  />
                ) : (
                  <DataTable columns={listCols} rows={tasks} rowKey={(t) => t.id} onRowClick={(t) => onOpen(t.id)} compact chevron caption="Field tasks" />
                )}
              </Card>
            </>
          );
        }}
      </Loaded>
    </Stack>
  );
}

/* ---------- History ---------- */

const VISIT_EXPORT: ReadonlyArray<ExportColumn<FieldVisit>> = [
  { header: "Date", value: (v) => v.date },
  { header: "Member", value: (v) => v.userName },
  { header: "Site", value: (v) => v.siteName },
  { header: "Customer", value: (v) => v.partyName },
  { header: "Purpose", value: (v) => taskTypeLabel(v.purpose) },
  { header: "Address", value: (v) => v.address },
  { header: "Checked in", value: (v) => (v.checkedInAt ? new Date(v.checkedInAt).toLocaleString("en-IN") : "") },
  { header: "Checked out", value: (v) => (v.checkedOutAt ? new Date(v.checkedOutAt).toLocaleString("en-IN") : "") },
  { header: "Minutes on site", value: (v) => v.minutes },
  { header: "Outcome", value: (v) => outcomeMeta(v.outcome)?.label ?? (v.open ? "On site" : "") },
  { header: "Summary", value: (v) => v.summary },
  { header: "Next visit", value: (v) => v.nextVisitOn },
  { header: "Photo note", value: (v) => v.photoNote },
  { header: "Check-in latitude", value: (v) => v.inLat },
  { header: "Check-in longitude", value: (v) => v.inLng },
  { header: "GPS accuracy (m)", value: (v) => v.inAccuracy },
];

function HistoryTab({ manager, members, today, onOpenTask }: { manager: boolean; members: ReadonlyArray<MemberOption>; today: string; onOpenTask: (id: string) => void }) {
  const [from, setFrom] = useState(addDaysISO(today, -29));
  const [to, setTo] = useState(today);
  const [who, setWho] = useState("");
  const [outcome, setOutcome] = useState("");
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim());
  const rangeOk = Boolean(from && to && from <= to);
  const state = useImsData(
    () => field.history({ from: rangeOk ? from : undefined, to: rangeOk ? to : undefined, userId: who ? Number(who) : undefined, outcome: outcome || undefined, q: query || undefined }),
    [from, to, rangeOk, who, outcome, query],
  );
  const [busyExport, setBusyExport] = useState(false);

  return (
    <Card interactive={false}>
      <div className="ims-toolbar">
        <Input type="date" size="sm" aria-label="From" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="ims-faint">to</span>
        <Input type="date" size="sm" aria-label="To" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        {manager ? (
          <Select size="sm" aria-label="Member" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 180 }}>
            <option value="">Everyone</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select size="sm" aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ width: 180 }}>
          <option value="">Any outcome</option>
          {VISIT_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {OUTCOME_META[o].label}
            </option>
          ))}
        </Select>
        <Input className="ims-grow" size="sm" type="search" placeholder="Search site, customer, summary…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search visits" />
      </div>
      {!rangeOk ? (
        <Alert tone="amber" title="Check the dates">
          The start date must be on or before the end date.
        </Alert>
      ) : (
        <Loaded state={state} rows={1}>
          {(h) => (
            <Stack gap={16}>
              <Grid cols={4} min={140}>
                <KpiCard label="Visits" value={h.summary.visits} chip={{ color: "blue", glyph: "📍" }} delta={dateLabel(h.range.from) + " – " + dateLabel(h.range.to)} deltaTone="muted" interactive={false} />
                <KpiCard label="Time on site" value={minutesText(h.summary.minutes)} chip={{ color: "amber", glyph: "⏱" }} delta={h.summary.visits ? `${minutesText(h.summary.minutes / h.summary.visits)} per visit` : "—"} deltaTone="muted" interactive={false} />
                <KpiCard label={manager ? "People" : "Open visits"} value={manager ? h.summary.members : h.summary.open} chip={{ color: "lavender", glyph: "👥" }} interactive={false} />
                <KpiCard label="Follow-ups" value={h.summary.followUps} chip={{ color: "rose", glyph: "↻" }} deltaTone={h.summary.followUps ? "warn" : "muted"} delta={h.summary.followUps ? "Need another visit" : "None pending"} interactive={false} />
              </Grid>
              <div className="ims-between">
                <span className="ims-faint">{h.visits.length >= 2000 ? "Showing the latest 2,000 visits — narrow the dates for a full export." : `${h.visits.length} visits`}</span>
                <div className="ims-row">
                  <Button size="sm" icon="download" disabled={!h.visits.length} onClick={() => downloadCsv(`field-visits-${h.range.from}-to-${h.range.to}`, h.visits, VISIT_EXPORT)}>
                    CSV
                  </Button>
                  <Button
                    size="sm"
                    icon="download"
                    disabled={!h.visits.length || busyExport}
                    onClick={async () => {
                      setBusyExport(true);
                      try {
                        await downloadXlsx(`field-visits-${h.range.from}-to-${h.range.to}`, "Visits", h.visits, VISIT_EXPORT);
                      } finally {
                        setBusyExport(false);
                      }
                    }}
                  >
                    Excel
                  </Button>
                </div>
              </div>
              <DataTable
                columns={[
                  { key: "date", header: "Date", mono: true, cell: (v: FieldVisit) => dayMonth(v.date) },
                  ...(manager ? [{ key: "who", header: "Member", cell: (v: FieldVisit) => v.userName ?? "—" }] : []),
                  {
                    key: "site",
                    header: "Site",
                    cell: (v: FieldVisit) => (
                      <div className="ims-cell-stack">
                        <span className="ims-strong">{v.siteName}</span>
                        <small>{taskTypeLabel(v.purpose)}</small>
                      </div>
                    ),
                  },
                  { key: "time", header: "In – out", mono: true, cell: (v: FieldVisit) => `${timeOfDay(v.checkedInAt)} – ${v.open ? "now" : timeOfDay(v.checkedOutAt)}` },
                  { key: "dur", header: "Time", align: "right", cell: (v: FieldVisit) => v.durationLabel },
                  {
                    key: "outcome",
                    header: "Outcome",
                    cell: (v: FieldVisit) => {
                      const o = outcomeMeta(v.outcome);
                      return o ? <StatusBadge view={{ text: o.label.toUpperCase(), tone: o.tone }} auto /> : <StatusBadge view={{ text: "ON SITE", tone: "blue" }} />;
                    },
                  },
                  { key: "summary", header: "Summary", cell: (v: FieldVisit) => <span className="ims-muted">{v.summary ?? ""}</span> },
                  {
                    key: "map",
                    header: "",
                    cell: (v: FieldVisit) =>
                      v.inLat !== null && v.inLng !== null ? (
                        <a href={googleMapsUrl(v.inLat, v.inLng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Open ${v.siteName} in Google Maps`}>
                          Map ↗
                        </a>
                      ) : (
                        <span className="ims-faint">No GPS</span>
                      ),
                  },
                ]}
                rows={h.visits}
                rowKey={(v) => v.id}
                compact
                onRowClick={(v) => {
                  if (v.taskId) onOpenTask(v.taskId);
                }}
                empty="No visits match these filters."
                caption="Visit history"
              />
            </Stack>
          )}
        </Loaded>
      )}
    </Card>
  );
}

/* ---------- Day timeline ---------- */

const NODE_COLOR: Record<string, string> = { check_in: "var(--bos-blue)", check_out: "var(--bos-emerald)", status: "var(--bos-pastel-lavender-ink, #7C6CF2)", task_done: "var(--bos-amber)" };

function TimelineTab({ manager, members, today, userId, onUser }: { manager: boolean; members: ReadonlyArray<MemberOption>; today: string; userId: number; onUser: (id: number) => void }) {
  const [date, setDate] = useState(today);
  const state = useImsData(() => field.day({ userId: manager ? userId : undefined, date }), [userId, date, manager]);
  const who = members.find((m) => m.userId === userId)?.name ?? "Me";
  return (
    <Card interactive={false}>
      <div className="ims-toolbar">
        {manager && members.length ? (
          <Select size="sm" aria-label="Member" value={String(userId)} onChange={(e) => onUser(Number(e.target.value))} style={{ width: 220 }}>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Input type="date" size="sm" aria-label="Day" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} style={{ width: 150 }} />
        <Button size="sm" variant="ghost" icon="chevronLeft" onClick={() => setDate(addDaysISO(date, -1))} aria-label="Previous day" iconOnly />
        <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => setDate(addDaysISO(date, 1))} disabled={date >= today} aria-label="Next day" iconOnly />
      </div>
      <Loaded state={state} rows={1}>
        {(d) => {
          const points = d.pings.map((p) => ({ lat: p.lat, lng: p.lng }));
          const last = points[points.length - 1] ?? null;
          const route = googleRouteUrl(points);
          const minutes = d.visits.reduce((s, v) => s + v.minutes, 0);
          return (
            <Stack gap={16}>
              <Grid cols={4} min={140}>
                <KpiCard label="Distance" value={`${d.km.toFixed(1)} km`} chip={{ color: "lavender", glyph: "🛣" }} delta={`${d.pings.length} location points`} deltaTone="muted" interactive={false} />
                <KpiCard label="Visits" value={d.visits.length} chip={{ color: "blue", glyph: "📍" }} interactive={false} />
                <KpiCard label="Time on site" value={minutesText(minutes)} chip={{ color: "amber", glyph: "⏱" }} interactive={false} />
                <KpiCard label="Tasks done" value={d.timeline.filter((t) => t.kind === "task_done").length} chip={{ color: "mint", glyph: "✓" }} interactive={false} />
              </Grid>
              <div className="ims-fd-mapgrid">
                <div>
                  <TeamMap
                    markers={last ? [{ id: "last", lat: last.lat, lng: last.lng, label: who, color: "#4C6FF5", detail: "Last known position" }] : []}
                    path={points}
                    title={`${who}'s route on ${dateLabel(d.date)}`}
                  />
                  <div className="ims-between" style={{ marginTop: 8 }}>
                    <span className="ims-faint">The line is the day&apos;s trail · the marker is the last known position</span>
                    <div className="ims-row">
                      {route ? (
                        <a className="ims-faint" href={route} target="_blank" rel="noreferrer">
                          Route in Google Maps ↗
                        </a>
                      ) : null}
                      {d.pings.length ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="download"
                          onClick={() =>
                            downloadCsv(`field-trail-${d.userId}-${d.date}`, d.pings, [
                              { header: "Time", value: (p) => (p.at ? new Date(p.at).toLocaleString("en-IN") : "") },
                              { header: "Latitude", value: (p) => p.lat },
                              { header: "Longitude", value: (p) => p.lng },
                              { header: "Accuracy (m)", value: (p) => p.accuracy },
                              { header: "Kind", value: (p) => p.kind },
                              { header: "Status", value: (p) => statusMeta(p.status).label },
                            ])
                          }
                        >
                          Trail CSV
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div>
                  {d.timeline.length ? (
                    <ol className="ims-fd-timeline" aria-label={`Timeline for ${dateLabel(d.date)}`}>
                      {d.timeline.map((e, i) => (
                        <li key={`${e.at}-${i}`}>
                          <span className="ims-fd-node" style={{ background: NODE_COLOR[e.kind] ?? "var(--bos-text-faint)" }} aria-hidden="true" />
                          <div className="ims-fd-time">{timeOfDay(e.at)}</div>
                          <div className="ims-fd-title">{e.title}</div>
                          {e.detail ? <div className="ims-fd-detail">{e.detail}</div> : null}
                          {e.lat !== null && e.lng !== null ? (
                            <a className="ims-faint" href={googleMapsUrl(e.lat, e.lng)} target="_blank" rel="noreferrer">
                              Map ↗
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyState icon="clock" title="Nothing logged this day">
                      Check-ins, status changes and completed tasks appear here in order.
                    </EmptyState>
                  )}
                </div>
              </div>
            </Stack>
          );
        }}
      </Loaded>
    </Card>
  );
}
