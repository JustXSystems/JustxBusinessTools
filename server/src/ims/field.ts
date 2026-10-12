import type { Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { accessOf, actorName, actorOf, can, isoDate, optText, parse, parsePatch, qint, qstr, recordEvent, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, likeOf, money, one, rows, type Queryable } from "./db.js";
import { ImsError, conflict, forbidden, notFound, type ImsActor } from "./host.js";
import {
  FIELD_STATUSES,
  FIELD_STATUS_LABELS,
  FIELD_TASK_PRIORITIES,
  FIELD_TASK_STATUSES,
  FIELD_TASK_TYPES,
  VISIT_OUTCOMES,
  addDaysISO,
  canMoveFieldTask,
  durationLabel,
  effectiveFieldStatus,
  isISODate,
  minutesBetween,
  round2,
  todayISO,
  trackKm,
  type FieldStatus,
  type FieldTaskStatus,
} from "./logic.js";
import { listMembers } from "./settings.js";

/* ---------- Time helpers ---------- */

const epochIso = (ts: unknown): string | null => {
  const n = Number(ts);
  return ts !== null && ts !== undefined && Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};
const epochMs = (ts: unknown): number => {
  const n = Number(ts);
  return Number.isFinite(n) ? n * 1000 : 0;
};
const coord = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** UTC offset of the business timezone on `date`, as `+05:30` (MySQL TIMESTAMPs are compared as epoch seconds). */
function zoneOffset(date: string): string {
  const tz = process.env.IMS_TIMEZONE || process.env.BOS_TIMEZONE || "Asia/Kolkata";
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(name);
    return m ? `${m[1]}:${m[2] ?? "00"}` : "Z";
  } catch {
    return "+05:30";
  }
}

export function dayBounds(date: string): { start: number; end: number } {
  const start = Math.floor(Date.parse(`${date}T00:00:00${zoneOffset(date)}`) / 1000);
  return { start, end: start + 86_400 };
}

/* ---------- Rows & mapping ---------- */

type VisitRow = {
  id: string;
  user_id: number;
  user_name: string | null;
  visit_date: string;
  site_name: string;
  party_id: string | null;
  party_name: string | null;
  purpose: string;
  task_id: string | null;
  address: string | null;
  photo_note: string | null;
  in_lat: string | null;
  in_lng: string | null;
  in_accuracy_m: number | null;
  out_lat: string | null;
  out_lng: string | null;
  out_accuracy_m: number | null;
  summary: string | null;
  outcome: string | null;
  next_visit_on: string | null;
  in_ts: string | number;
  out_ts: string | number | null;
};

const SELECT_VISIT = `SELECT v.*, UNIX_TIMESTAMP(v.checked_in_at) AS in_ts, UNIX_TIMESTAMP(v.checked_out_at) AS out_ts FROM ims_field_visits v`;

function mapVisit(r: VisitRow, nowMs = Date.now()) {
  const inMs = epochMs(r.in_ts);
  const open = !r.out_ts;
  const minutes = minutesBetween(inMs, open ? nowMs : epochMs(r.out_ts));
  return {
    id: r.id,
    userId: Number(r.user_id),
    userName: r.user_name,
    date: isoOf(r.visit_date),
    siteName: r.site_name,
    partyId: r.party_id,
    partyName: r.party_name,
    purpose: r.purpose,
    taskId: r.task_id,
    address: r.address,
    photoNote: r.photo_note,
    inLat: coord(r.in_lat),
    inLng: coord(r.in_lng),
    inAccuracy: r.in_accuracy_m == null ? null : Number(r.in_accuracy_m),
    checkedInAt: epochIso(r.in_ts),
    checkedOutAt: epochIso(r.out_ts),
    outLat: coord(r.out_lat),
    outLng: coord(r.out_lng),
    outAccuracy: r.out_accuracy_m == null ? null : Number(r.out_accuracy_m),
    open,
    minutes,
    durationLabel: durationLabel(minutes),
    summary: r.summary,
    outcome: r.outcome,
    nextVisitOn: r.next_visit_on ? isoOf(r.next_visit_on) : null,
  };
}
export type FieldVisit = ReturnType<typeof mapVisit>;

type TaskRow = {
  id: string;
  title: string;
  task_type: string;
  status: FieldTaskStatus;
  priority: string;
  assignee_user_id: number | null;
  assignee_name: string | null;
  party_id: string | null;
  party_name: string | null;
  site_address: string | null;
  lat: string | null;
  lng: string | null;
  due_on: string | null;
  due_time: string | null;
  amount: string | null;
  notes: string | null;
  created_by: number | null;
  created_by_name: string | null;
  done_ts: string | number | null;
  created_ts: string | number | null;
  updated_ts: string | number | null;
};

const SELECT_TASK = `SELECT t.*, UNIX_TIMESTAMP(t.completed_at) AS done_ts, UNIX_TIMESTAMP(t.created_at) AS created_ts, UNIX_TIMESTAMP(t.updated_at) AS updated_ts FROM ims_field_tasks t`;

function mapTask(r: TaskRow, today = todayISO()) {
  const dueOn = r.due_on ? isoOf(r.due_on) : null;
  return {
    id: r.id,
    title: r.title,
    taskType: r.task_type,
    status: r.status,
    priority: r.priority,
    assigneeUserId: r.assignee_user_id == null ? null : Number(r.assignee_user_id),
    assigneeName: r.assignee_name,
    partyId: r.party_id,
    partyName: r.party_name,
    siteAddress: r.site_address,
    lat: coord(r.lat),
    lng: coord(r.lng),
    dueOn,
    dueTime: r.due_time,
    amount: r.amount == null ? null : round2(money(r.amount)),
    notes: r.notes,
    overdue: Boolean(dueOn && dueOn < today && (r.status === "open" || r.status === "in_progress")),
    completedAt: epochIso(r.done_ts),
    createdBy: r.created_by == null ? null : Number(r.created_by),
    createdByName: r.created_by_name,
    createdAt: epochIso(r.created_ts),
    updatedAt: epochIso(r.updated_ts),
  };
}
export type FieldTask = ReturnType<typeof mapTask>;

type TrailRow = {
  id: string;
  user_id: number;
  kind: string;
  field_status: string;
  lat: string | null;
  lng: string | null;
  accuracy_m: number | null;
  site_name: string | null;
  note: string | null;
  ts: string | number;
};

/* ---------- Access ---------- */

const meId = (actor: ImsActor): number => actor.userId ?? 0;
const isManager = (res: Response): boolean => can(res, "field");

/** Managers act for anyone; everyone else only for themselves. */
function scopeUser(res: Response, actor: ImsActor, requested: unknown): number | null {
  const n = Number(requested);
  const asked = requested !== undefined && requested !== "" && Number.isInteger(n) ? n : null;
  if (isManager(res)) return asked;
  if (asked !== null && asked !== meId(actor)) throw forbidden("You can only see your own field activity. Field managers can see the whole team.");
  return meId(actor);
}

async function loadTask(db: Queryable, tenantId: number, id: string): Promise<TaskRow> {
  const r = await one<TaskRow>(db, `${SELECT_TASK} WHERE t.tenant_id = :tenantId AND t.id = :id LIMIT 1`, { tenantId, id });
  if (!r) throw notFound("Task");
  return r;
}

async function openVisitOf(db: Queryable, tenantId: number, userId: number): Promise<VisitRow | null> {
  return one<VisitRow>(db, `${SELECT_VISIT} WHERE v.tenant_id = :tenantId AND v.user_id = :userId AND v.checked_out_at IS NULL ORDER BY v.checked_in_at DESC LIMIT 1`, { tenantId, userId });
}

async function latestStatus(db: Queryable, tenantId: number, userId: number, date: string): Promise<FieldStatus> {
  const r = await one<{ field_status: string }>(
    db,
    `SELECT field_status FROM ims_field_checkins WHERE tenant_id = :tenantId AND user_id = :userId AND ping_date = :date AND kind <> 'ping' ORDER BY created_at DESC, id DESC LIMIT 1`,
    { tenantId, userId, date },
  );
  return effectiveFieldStatus(r ? { status: r.field_status, date } : null, date, false);
}

async function insertTrail(
  db: Queryable,
  actor: ImsActor,
  row: { userId: number; userName: string | null; kind: "check_in" | "check_out" | "ping" | "status"; status: FieldStatus; lat?: number | null; lng?: number | null; accuracy?: number | null; siteName?: string | null; taskId?: string | null; note?: string | null },
): Promise<void> {
  await exec(
    db,
    `INSERT INTO ims_field_checkins (id, tenant_id, user_id, user_name, kind, field_status, lat, lng, accuracy_m, site_name, task_id, note, ping_date)
     VALUES (:id, :tenantId, :userId, :userName, :kind, :status, :lat, :lng, :accuracy, :siteName, :taskId, :note, :date)`,
    {
      id: randomUUID(),
      tenantId: actor.tenantId,
      userId: row.userId,
      userName: row.userName,
      kind: row.kind,
      status: row.status,
      lat: row.lat ?? null,
      lng: row.lng ?? null,
      accuracy: row.accuracy == null ? null : Math.round(row.accuracy),
      siteName: row.siteName ?? null,
      taskId: row.taskId ?? null,
      note: row.note ?? null,
      date: todayISO(),
    },
  );
}

/* ---------- Overview ---------- */

type Person = { userId: number; name: string; role: string; phone: string | null };

async function buildOverview(deps: ImsDeps, res: Response, date: string) {
  const actor = actorOf(res);
  const manager = isManager(res);
  const today = todayISO();
  const me = meId(actor);
  const tenantId = actor.tenantId;
  const nowMs = Date.now();

  const people = new Map<number, Person>();
  if (manager) {
    for (const m of await listMembers(deps, actor)) {
      if (m.active) people.set(m.userId, { userId: m.userId, name: m.name || m.email || `User ${m.userId}`, role: m.imsRole, phone: m.phone });
    }
  }
  if (!people.has(me)) people.set(me, { userId: me, name: actorName(actor) ?? "You", role: accessOf(res).role, phone: null });

  const scoped = manager ? "" : "AND user_id = :me";
  const params = { tenantId, date, me, isToday: date === today ? 1 : 0 };
  const trail = await rows<TrailRow>(
    deps.db,
    `SELECT id, user_id, kind, field_status, lat, lng, accuracy_m, site_name, note, UNIX_TIMESTAMP(created_at) AS ts
     FROM ims_field_checkins WHERE tenant_id = :tenantId AND ping_date = :date ${scoped} ORDER BY created_at, id`,
    params,
  );
  const visits = (
    await rows<VisitRow>(
      deps.db,
      `${SELECT_VISIT} WHERE v.tenant_id = :tenantId AND (v.visit_date = :date OR (:isToday = 1 AND v.checked_out_at IS NULL)) ${manager ? "" : "AND v.user_id = :me"}
       ORDER BY v.checked_in_at DESC LIMIT 1000`,
      params,
    )
  ).map((v) => mapVisit(v, nowMs));
  const { start, end } = dayBounds(date);
  const tasks = (
    await rows<TaskRow>(
      deps.db,
      `${SELECT_TASK} WHERE t.tenant_id = :tenantId ${manager ? "" : "AND t.assignee_user_id = :me"}
       AND (t.status IN ('open', 'in_progress')
         OR (t.status = 'done' AND t.completed_at >= FROM_UNIXTIME(:start) AND t.completed_at < FROM_UNIXTIME(:end))
         OR (t.status = 'cancelled' AND t.updated_at >= FROM_UNIXTIME(:start) AND t.updated_at < FROM_UNIXTIME(:end)))
       ORDER BY FIELD(t.priority, 'urgent', 'high', 'normal', 'low'), t.due_on IS NULL, t.due_on, t.due_time, t.created_at DESC LIMIT 500`,
      { ...params, start, end },
    )
  ).map((t) => mapTask(t, today));

  for (const v of visits) if (!people.has(v.userId) && manager) people.set(v.userId, { userId: v.userId, name: v.userName ?? `User ${v.userId}`, role: "field", phone: null });

  const personView = (p: Person) => {
    const mine = trail.filter((t) => Number(t.user_id) === p.userId);
    const statusRows = mine.filter((t) => t.kind !== "ping");
    const latest = statusRows[statusRows.length - 1] ?? null;
    const located = mine.filter((t) => t.lat != null && t.lng != null);
    const last = located[located.length - 1] ?? null;
    const openVisit = date === today ? (visits.find((v) => v.userId === p.userId && v.open) ?? null) : null;
    const dayVisits = visits.filter((v) => v.userId === p.userId && v.date === date);
    const km = trackKm(located.map((t) => ({ lat: coord(t.lat), lng: coord(t.lng), accuracy: t.accuracy_m, at: epochMs(t.ts) })));
    const myTasks = tasks.filter((t) => t.assigneeUserId === p.userId);
    const status = effectiveFieldStatus(latest ? { status: latest.field_status, date } : null, date, Boolean(openVisit));
    return {
      ...p,
      isMe: p.userId === me,
      status,
      statusLabel: FIELD_STATUS_LABELS[status],
      statusAt: latest ? epochIso(latest.ts) : null,
      statusNote: latest?.kind === "status" ? latest.note : null,
      currentSite: openVisit?.siteName ?? null,
      openVisit,
      lastPing: last ? { lat: Number(last.lat), lng: Number(last.lng), accuracy: last.accuracy_m == null ? null : Number(last.accuracy_m), at: epochIso(last.ts) } : null,
      km,
      visits: dayVisits.length,
      minutesOnSite: dayVisits.reduce((s, v) => s + v.minutes, 0),
      openTasks: myTasks.filter((t) => t.status === "open" || t.status === "in_progress").length,
      doneTasks: myTasks.filter((t) => t.status === "done").length,
      firstSeenAt: mine.length ? epochIso(mine[0].ts) : (dayVisits[dayVisits.length - 1]?.checkedInAt ?? null),
      lastSeenAt: mine.length ? epochIso(mine[mine.length - 1].ts) : null,
    };
  };

  const order = new Map(FIELD_STATUSES.map((s, i) => [s, i]));
  const team = [...people.values()].map(personView).sort((a, b) => Number(b.isMe) - Number(a.isMe) || (order.get(a.status) ?? 9) - (order.get(b.status) ?? 9) || a.name.localeCompare(b.name));
  const meView = team.find((t) => t.isMe) ?? personView(people.get(me)!);
  const statusCounts = Object.fromEntries(FIELD_STATUSES.map((s) => [s, team.filter((t) => t.status === s).length])) as Record<FieldStatus, number>;
  const scopeTeam = manager ? team : [meView];
  const dayVisits = visits.filter((v) => v.date === date);
  return {
    date,
    today,
    canManage: manager,
    me: meView,
    team: manager ? team : [meView],
    visits,
    tasks,
    numbers: {
      visits: dayVisits.length,
      activeVisits: visits.filter((v) => v.open).length,
      km: round2(scopeTeam.reduce((s, t) => s + t.km, 0)),
      minutesOnSite: dayVisits.reduce((s, v) => s + v.minutes, 0),
      tasksDone: tasks.filter((t) => t.status === "done").length,
      tasksOpen: tasks.filter((t) => t.status === "open" || t.status === "in_progress").length,
      tasksOverdue: tasks.filter((t) => t.overdue).length,
      collections: round2(tasks.filter((t) => t.status === "done" && t.taskType === "collection").reduce((s, t) => s + (t.amount ?? 0), 0)),
      followUps: dayVisits.filter((v) => v.outcome === "follow_up" || v.nextVisitOn).length,
      statusCounts,
    },
  };
}

/* ---------- Validation ---------- */

const lat = z.number().min(-90).max(90).nullable().optional();
const lng = z.number().min(-180).max(180).nullable().optional();
const accuracy = z.number().min(0).max(1_000_000).nullable().optional();

const CheckInInput = z.object({
  siteName: z.string().trim().min(2, "Enter the site or customer name").max(200),
  partyId: z.string().uuid().nullable().optional(),
  partyName: optText(200),
  purpose: z.enum(FIELD_TASK_TYPES).default("visit"),
  taskId: z.string().uuid().nullable().optional(),
  address: optText(500),
  photoNote: optText(500),
  lat,
  lng,
  accuracy,
});

const CheckOutInput = z.object({
  summary: z.string().trim().min(3, "Add a short work summary").max(1000),
  outcome: z.enum(VISIT_OUTCOMES),
  nextVisitOn: isoDate.nullable().optional(),
  completeTask: z.boolean().optional(),
  lat,
  lng,
  accuracy,
});

const StatusInput = z.object({
  status: z.enum(FIELD_STATUSES),
  note: optText(200),
  userId: z.number().int().min(0).optional(),
});

const PingInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy,
});

const TaskInput = z.object({
  title: z.string().trim().min(2, "Give the task a title").max(200),
  taskType: z.enum(FIELD_TASK_TYPES).default("visit"),
  priority: z.enum(FIELD_TASK_PRIORITIES).default("normal"),
  status: z.enum(FIELD_TASK_STATUSES).optional(),
  assigneeUserId: z.number().int().min(0, "Choose who will do this"),
  partyId: z.string().uuid().nullable().optional(),
  partyName: optText(200),
  siteAddress: optText(500),
  lat,
  lng,
  dueOn: isoDate.nullable().optional(),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
    .nullable()
    .optional(),
  amount: z.number().min(0).max(1e10).nullable().optional(),
  notes: optText(2000),
});

const AssigneeTaskPatch = z.object({ status: z.enum(FIELD_TASK_STATUSES).optional(), notes: optText(2000) });

const TASK_COLUMN: Record<string, string> = {
  title: "title",
  taskType: "task_type",
  priority: "priority",
  partyId: "party_id",
  partyName: "party_name",
  siteAddress: "site_address",
  lat: "lat",
  lng: "lng",
  dueOn: "due_on",
  dueTime: "due_time",
  amount: "amount",
  notes: "notes",
};

/** The member a task is assigned to, by IMS membership (or the caller themself). */
async function resolveAssignee(deps: ImsDeps, actor: ImsActor, userId: number): Promise<{ userId: number; name: string }> {
  if (userId === meId(actor)) return { userId, name: actorName(actor) ?? "Me" };
  const member = (await listMembers(deps, actor)).find((m) => m.userId === userId);
  if (!member) throw new ImsError(400, "That person isn't a member of this business");
  if (!member.active) throw new ImsError(400, `${member.name ?? "That member"} is inactive in IMS`);
  return { userId, name: member.name || member.email || `User ${userId}` };
}

const taskPath = (id: string) => `?m=field&open=${id}`;

/* ---------- Routes ---------- */

export function registerField(router: Router, deps: ImsDeps): void {
  router.get("/field/overview", async (req, res) => {
    const raw = qstr(req.query.date, 10);
    const date = isISODate(raw) ? raw : todayISO();
    res.json(await buildOverview(deps, res, date));
  });

  router.post("/field/checkin", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(CheckInInput, req.body);
    const me = meId(actor);
    const open = await openVisitOf(deps.db, actor.tenantId, me);
    if (open) throw conflict(`You're already checked in at ${open.site_name}. Check out there first.`);
    if (input.taskId) {
      const task = await loadTask(deps.db, actor.tenantId, input.taskId);
      if (task.assignee_user_id !== me && !isManager(res)) throw forbidden("That task is assigned to someone else");
      if (task.status === "open") await exec(deps.db, `UPDATE ims_field_tasks SET status = 'in_progress' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: task.id });
    }
    const id = randomUUID();
    const name = actorName(actor);
    await exec(
      deps.db,
      `INSERT INTO ims_field_visits (id, tenant_id, user_id, user_name, visit_date, site_name, party_id, party_name, purpose, task_id, address, photo_note, in_lat, in_lng, in_accuracy_m)
       VALUES (:id, :tenantId, :userId, :userName, :date, :siteName, :partyId, :partyName, :purpose, :taskId, :address, :photoNote, :lat, :lng, :accuracy)`,
      {
        id,
        tenantId: actor.tenantId,
        userId: me,
        userName: name,
        date: todayISO(),
        siteName: input.siteName,
        partyId: input.partyId ?? null,
        partyName: input.partyName ?? null,
        purpose: input.purpose,
        taskId: input.taskId ?? null,
        address: input.address ?? null,
        photoNote: input.photoNote ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracy: input.accuracy == null ? null : Math.round(input.accuracy),
      },
    );
    await insertTrail(deps.db, actor, { userId: me, userName: name, kind: "check_in", status: "at_site", lat: input.lat, lng: input.lng, accuracy: input.accuracy, siteName: input.siteName, taskId: input.taskId ?? null });
    await recordEvent(deps, actor, {
      type: "field.checkin",
      entityType: "visit",
      entityId: id,
      summary: `Checked in at ${input.siteName}${input.lat == null ? " (no GPS fix)" : ""}`,
      payload: { purpose: input.purpose, taskId: input.taskId ?? null },
    });
    const row = await one<VisitRow>(deps.db, `${SELECT_VISIT} WHERE v.tenant_id = :tenantId AND v.id = :id`, { tenantId: actor.tenantId, id });
    res.status(201).json({ visit: row ? mapVisit(row) : null });
  });

  router.post("/field/checkout/:id", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(CheckOutInput, req.body);
    const visit = await one<VisitRow>(deps.db, `${SELECT_VISIT} WHERE v.tenant_id = :tenantId AND v.id = :id LIMIT 1`, { tenantId: actor.tenantId, id: req.params.id });
    if (!visit) throw notFound("Visit");
    if (Number(visit.user_id) !== meId(actor) && !isManager(res)) throw forbidden("You can only check yourself out");
    if (visit.out_ts) throw conflict("This visit is already checked out");
    await exec(
      deps.db,
      `UPDATE ims_field_visits SET checked_out_at = CURRENT_TIMESTAMP, out_lat = :lat, out_lng = :lng, out_accuracy_m = :accuracy, summary = :summary, outcome = :outcome, next_visit_on = :nextVisitOn
       WHERE tenant_id = :tenantId AND id = :id`,
      {
        tenantId: actor.tenantId,
        id: visit.id,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracy: input.accuracy == null ? null : Math.round(input.accuracy),
        summary: input.summary,
        outcome: input.outcome,
        nextVisitOn: input.nextVisitOn ?? null,
      },
    );
    if (input.completeTask && visit.task_id) {
      await exec(deps.db, `UPDATE ims_field_tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id AND status IN ('open', 'in_progress')`, {
        tenantId: actor.tenantId,
        id: visit.task_id,
      });
    }
    await insertTrail(deps.db, actor, {
      userId: Number(visit.user_id),
      userName: visit.user_name,
      kind: "check_out",
      status: "active",
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy,
      siteName: visit.site_name,
      taskId: visit.task_id,
      note: input.outcome,
    });
    const minutes = minutesBetween(epochMs(visit.in_ts), Date.now());
    await recordEvent(deps, actor, {
      type: "field.checkout",
      entityType: "visit",
      entityId: visit.id,
      summary: `Checked out of ${visit.site_name} after ${durationLabel(minutes)} — ${input.outcome.replace(/_/g, " ")}`,
      payload: { outcome: input.outcome, nextVisitOn: input.nextVisitOn ?? null, taskCompleted: Boolean(input.completeTask && visit.task_id) },
    });
    const row = await one<VisitRow>(deps.db, `${SELECT_VISIT} WHERE v.tenant_id = :tenantId AND v.id = :id`, { tenantId: actor.tenantId, id: visit.id });
    res.json({ visit: row ? mapVisit(row) : null });
  });

  router.post("/field/status", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(StatusInput, req.body);
    const target = input.userId ?? meId(actor);
    if (target !== meId(actor) && !isManager(res)) throw forbidden("You can only change your own status");
    let name = actorName(actor);
    if (target !== meId(actor)) name = (await resolveAssignee(deps, actor, target)).name;
    if (await openVisitOf(deps.db, actor.tenantId, target)) {
      if (input.status !== "at_site") throw conflict("Check out of the current visit before changing status");
    }
    await insertTrail(deps.db, actor, { userId: target, userName: name, kind: "status", status: input.status, note: input.note ?? null });
    await recordEvent(deps, actor, {
      type: "field.status",
      entityType: "member",
      entityId: String(target),
      summary: `${target === meId(actor) ? "Set status" : `Set ${name ?? "member"}'s status`} to ${FIELD_STATUS_LABELS[input.status]}${input.note ? ` — ${input.note}` : ""}`,
    });
    res.json({ ok: true, status: input.status });
  });

  router.post("/field/ping", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(PingInput, req.body);
    const me = meId(actor);
    const today = todayISO();
    const last = await one<{ ts: string | number }>(
      deps.db,
      `SELECT UNIX_TIMESTAMP(created_at) AS ts FROM ims_field_checkins WHERE tenant_id = :tenantId AND user_id = :me AND kind = 'ping' ORDER BY created_at DESC LIMIT 1`,
      { tenantId: actor.tenantId, me },
    );
    if (last && Date.now() - epochMs(last.ts) < 20_000) {
      res.json({ ok: true, skipped: true });
      return;
    }
    const status: FieldStatus = (await openVisitOf(deps.db, actor.tenantId, me)) ? "at_site" : await latestStatus(deps.db, actor.tenantId, me, today);
    await insertTrail(deps.db, actor, { userId: me, userName: actorName(actor), kind: "ping", status: status === "offline" ? "active" : status, lat: input.lat, lng: input.lng, accuracy: input.accuracy });
    res.json({ ok: true, skipped: false });
  });

  router.get("/field/pings", async (req, res) => {
    const actor = actorOf(res);
    const userId = scopeUser(res, actor, req.query.userId) ?? meId(actor);
    const raw = qstr(req.query.date, 10);
    const date = isISODate(raw) ? raw : todayISO();
    const trail = await rows<TrailRow>(
      deps.db,
      `SELECT id, user_id, kind, field_status, lat, lng, accuracy_m, site_name, note, UNIX_TIMESTAMP(created_at) AS ts
       FROM ims_field_checkins WHERE tenant_id = :tenantId AND user_id = :userId AND ping_date = :date ORDER BY created_at, id LIMIT 5000`,
      { tenantId: actor.tenantId, userId, date },
    );
    const visits = (await rows<VisitRow>(deps.db, `${SELECT_VISIT} WHERE v.tenant_id = :tenantId AND v.user_id = :userId AND v.visit_date = :date ORDER BY v.checked_in_at`, { tenantId: actor.tenantId, userId, date })).map((v) =>
      mapVisit(v),
    );
    const { start, end } = dayBounds(date);
    const done = (
      await rows<TaskRow>(deps.db, `${SELECT_TASK} WHERE t.tenant_id = :tenantId AND t.assignee_user_id = :userId AND t.completed_at >= FROM_UNIXTIME(:start) AND t.completed_at < FROM_UNIXTIME(:end)`, {
        tenantId: actor.tenantId,
        userId,
        start,
        end,
      })
    ).map((t) => mapTask(t));
    const pings = trail
      .filter((t) => t.lat != null && t.lng != null)
      .map((t) => ({ at: epochIso(t.ts), lat: Number(t.lat), lng: Number(t.lng), accuracy: t.accuracy_m == null ? null : Number(t.accuracy_m), kind: t.kind, status: t.field_status }));
    type Entry = { at: string | null; kind: "check_in" | "check_out" | "status" | "task_done"; title: string; detail: string | null; lat: number | null; lng: number | null };
    const timeline: Entry[] = [];
    for (const v of visits) {
      timeline.push({ at: v.checkedInAt, kind: "check_in", title: `Checked in · ${v.siteName}`, detail: [v.purpose, v.partyName, v.photoNote].filter(Boolean).join(" · ") || null, lat: v.inLat, lng: v.inLng });
      if (v.checkedOutAt) {
        timeline.push({
          at: v.checkedOutAt,
          kind: "check_out",
          title: `Checked out · ${v.siteName} (${v.durationLabel})`,
          detail: [v.outcome?.replace(/_/g, " "), v.summary].filter(Boolean).join(" — ") || null,
          lat: v.outLat,
          lng: v.outLng,
        });
      }
    }
    for (const t of trail.filter((r) => r.kind === "status")) {
      const label = (FIELD_STATUS_LABELS as Record<string, string>)[t.field_status] ?? t.field_status;
      timeline.push({ at: epochIso(t.ts), kind: "status", title: `Status → ${label}`, detail: t.note, lat: null, lng: null });
    }
    for (const t of done) timeline.push({ at: t.completedAt, kind: "task_done", title: `Completed task · ${t.title}`, detail: t.partyName, lat: t.lat, lng: t.lng });
    timeline.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    res.json({
      userId,
      date,
      pings,
      km: trackKm(trail.filter((t) => t.lat != null).map((t) => ({ lat: coord(t.lat), lng: coord(t.lng), accuracy: t.accuracy_m, at: epochMs(t.ts) }))),
      visits,
      timeline,
    });
  });

  router.get("/field/tasks", async (req, res) => {
    const actor = actorOf(res);
    const userId = scopeUser(res, actor, req.query.userId);
    const where = ["t.tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, limit: qint(req.query.limit, 500, 1, 2000) };
    if (userId !== null) {
      where.push("t.assignee_user_id = :userId");
      params.userId = userId;
    }
    const statuses = qstr(req.query.status, 80)
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is FieldTaskStatus => (FIELD_TASK_STATUSES as readonly string[]).includes(s));
    if (statuses.length) {
      where.push(`t.status IN (${statuses.map((_, i) => `:s${i}`).join(", ")})`);
      statuses.forEach((s, i) => (params[`s${i}`] = s));
    }
    const from = qstr(req.query.from, 10);
    const to = qstr(req.query.to, 10);
    if (isISODate(from)) {
      where.push("t.due_on >= :from");
      params.from = from;
    }
    if (isISODate(to)) {
      where.push("t.due_on <= :to");
      params.to = to;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(t.title LIKE :q OR t.party_name LIKE :q OR t.site_address LIKE :q OR t.assignee_name LIKE :q)");
      params.q = likeOf(q);
    }
    const list = await rows<TaskRow>(deps.db, `${SELECT_TASK} WHERE ${where.join(" AND ")} ORDER BY t.due_on IS NULL, t.due_on DESC, t.created_at DESC LIMIT :limit`, params);
    const today = todayISO();
    res.json({ tasks: list.map((t) => mapTask(t, today)) });
  });

  router.get("/field/tasks/:id", async (req, res) => {
    const actor = actorOf(res);
    const task = await loadTask(deps.db, actor.tenantId, req.params.id);
    if (!isManager(res) && task.assignee_user_id !== meId(actor)) throw forbidden("That task is assigned to someone else");
    const visits = (await rows<VisitRow>(deps.db, `${SELECT_VISIT} WHERE v.tenant_id = :tenantId AND v.task_id = :id ORDER BY v.checked_in_at DESC LIMIT 50`, { tenantId: actor.tenantId, id: task.id })).map((v) =>
      mapVisit(v),
    );
    res.json({ task: mapTask(task), visits });
  });

  router.post("/field/tasks", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "field", "Only field managers can assign tasks. Ask an owner to grant Field ops in Settings → Role permissions.");
    const input = parse(TaskInput, req.body);
    const assignee = await resolveAssignee(deps, actor, input.assigneeUserId);
    const id = randomUUID();
    const status = input.status === "done" || input.status === "cancelled" ? "open" : (input.status ?? "open");
    await exec(
      deps.db,
      `INSERT INTO ims_field_tasks (id, tenant_id, title, task_type, status, priority, assignee_user_id, assignee_name, party_id, party_name, site_address, lat, lng, due_on, due_time, amount, notes, created_by, created_by_name)
       VALUES (:id, :tenantId, :title, :taskType, :status, :priority, :assignee, :assigneeName, :partyId, :partyName, :siteAddress, :lat, :lng, :dueOn, :dueTime, :amount, :notes, :createdBy, :createdByName)`,
      {
        id,
        tenantId: actor.tenantId,
        title: input.title,
        taskType: input.taskType,
        status,
        priority: input.priority,
        assignee: assignee.userId,
        assigneeName: assignee.name,
        partyId: input.partyId ?? null,
        partyName: input.partyName ?? null,
        siteAddress: input.siteAddress ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        dueOn: input.dueOn ?? null,
        dueTime: input.dueTime ?? null,
        amount: input.amount ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        createdByName: actorName(actor),
      },
    );
    const due = input.dueOn ? ` · due ${input.dueOn}${input.dueTime ? ` ${input.dueTime}` : ""}` : "";
    await recordEvent(deps, actor, {
      type: "field.task.assigned",
      entityType: "field_task",
      entityId: id,
      summary: `Assigned "${input.title}" to ${assignee.name}${due}`,
      payload: { priority: input.priority, taskType: input.taskType },
      notice:
        assignee.userId !== meId(actor)
          ? { kind: "activity", title: `New ${input.priority === "urgent" ? "urgent " : ""}field task`, body: `${input.title}${input.partyName ? ` · ${input.partyName}` : ""}${due}`, path: taskPath(id), targetUserId: assignee.userId }
          : undefined,
    });
    res.status(201).json({ task: mapTask(await loadTask(deps.db, actor.tenantId, id)) });
  });

  router.patch("/field/tasks/:id", async (req, res) => {
    const actor = actorOf(res);
    const manager = isManager(res);
    const task = await loadTask(deps.db, actor.tenantId, req.params.id);
    if (!manager && task.assignee_user_id !== meId(actor)) throw forbidden("That task is assigned to someone else");
    const patch = (manager ? parsePatch(TaskInput, req.body) : parsePatch(AssigneeTaskPatch, req.body)) as Record<string, unknown>;
    const sets: string[] = [];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, id: task.id };
    for (const [k, v] of Object.entries(patch)) {
      if (!TASK_COLUMN[k]) continue;
      sets.push(`${TASK_COLUMN[k]} = :${k}`);
      params[k] = typeof v === "string" && !v.trim() ? null : (v ?? null);
    }
    let reassigned: { userId: number; name: string } | null = null;
    if (manager && typeof patch.assigneeUserId === "number" && patch.assigneeUserId !== task.assignee_user_id) {
      reassigned = await resolveAssignee(deps, actor, patch.assigneeUserId);
      sets.push("assignee_user_id = :assignee", "assignee_name = :assigneeName");
      params.assignee = reassigned.userId;
      params.assigneeName = reassigned.name;
    }
    const nextStatus = patch.status as FieldTaskStatus | undefined;
    if (nextStatus && nextStatus !== task.status) {
      if (!canMoveFieldTask(task.status, nextStatus, manager)) throw new ImsError(400, `A task can't move from ${task.status.replace("_", " ")} to ${nextStatus.replace("_", " ")}`);
      sets.push("status = :status");
      params.status = nextStatus;
      sets.push(nextStatus === "done" ? "completed_at = CURRENT_TIMESTAMP" : "completed_at = NULL");
    }
    if (!sets.length) {
      res.json({ task: mapTask(task) });
      return;
    }
    await exec(deps.db, `UPDATE ims_field_tasks SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
    const done = nextStatus === "done" && task.status !== "done";
    const summary = done
      ? `Completed task "${task.title}"`
      : nextStatus && nextStatus !== task.status
        ? `Moved task "${task.title}" to ${nextStatus.replace("_", " ")}`
        : reassigned
          ? `Reassigned task "${task.title}" to ${reassigned.name}`
          : `Updated task "${task.title}"`;
    const notifyCreator = done && task.created_by != null && Number(task.created_by) !== meId(actor);
    await recordEvent(deps, actor, {
      type: done ? "field.task.done" : "field.task.updated",
      entityType: "field_task",
      entityId: task.id,
      summary,
      payload: { fields: Object.keys(patch) },
      notice: reassigned
        ? { kind: "activity", title: "Field task assigned to you", body: task.title, path: taskPath(task.id), targetUserId: reassigned.userId }
        : notifyCreator
          ? { kind: "activity", title: "Field task completed", body: `${actorName(actor) ?? "A team member"} completed "${task.title}"`, path: taskPath(task.id), targetUserId: Number(task.created_by) }
          : undefined,
    });
    res.json({ task: mapTask(await loadTask(deps.db, actor.tenantId, task.id)) });
  });

  router.get("/field/history", async (req, res) => {
    const actor = actorOf(res);
    const userId = scopeUser(res, actor, req.query.userId);
    const today = todayISO();
    const fromRaw = qstr(req.query.from, 10);
    const toRaw = qstr(req.query.to, 10);
    const to = isISODate(toRaw) ? toRaw : today;
    const from = isISODate(fromRaw) && fromRaw <= to ? fromRaw : addDaysISO(to, -29);
    const where = ["v.tenant_id = :tenantId", "v.visit_date BETWEEN :from AND :to"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, from, to };
    if (userId !== null) {
      where.push("v.user_id = :userId");
      params.userId = userId;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(v.site_name LIKE :q OR v.party_name LIKE :q OR v.summary LIKE :q OR v.user_name LIKE :q)");
      params.q = likeOf(q);
    }
    const outcome = qstr(req.query.outcome, 24);
    if ((VISIT_OUTCOMES as readonly string[]).includes(outcome)) {
      where.push("v.outcome = :outcome");
      params.outcome = outcome;
    }
    const nowMs = Date.now();
    const visits = (await rows<VisitRow>(deps.db, `${SELECT_VISIT} WHERE ${where.join(" AND ")} ORDER BY v.checked_in_at DESC LIMIT 2000`, params)).map((v) => mapVisit(v, nowMs));
    const members = new Set(visits.map((v) => v.userId));
    res.json({
      range: { from, to },
      visits,
      summary: {
        visits: visits.length,
        minutes: visits.reduce((s, v) => s + v.minutes, 0),
        members: members.size,
        followUps: visits.filter((v) => v.outcome === "follow_up" || v.nextVisitOn).length,
        open: visits.filter((v) => v.open).length,
      },
    });
  });
}
