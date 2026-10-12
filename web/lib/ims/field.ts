/**
 * Onsite Track client: check-ins / check-outs, live location pings, field status,
 * the team board and field tasks. Built on the request helpers in `api.ts`.
 */
import type { BosBadgeTone } from "@/components/bos";
import { get, patch, post } from "./api";

/* ---------- Vocabulary (mirrors server/src/ims/logic.ts) ---------- */

export const FIELD_STATUSES = ["active", "at_site", "travelling", "at_travel", "on_leave", "offline"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

export const FIELD_STATUS_META: Record<FieldStatus, { label: string; color: string; tone: BosBadgeTone; hint: string }> = {
  active: { label: "Active", color: "#1FA679", tone: "emerald", hint: "Working, available for tasks" },
  at_site: { label: "At site", color: "#4C6FF5", tone: "blue", hint: "Checked in at a customer site" },
  travelling: { label: "Travelling", color: "#7C6CF2", tone: "lavender", hint: "On the way to the next site" },
  at_travel: { label: "On a trip", color: "#2BB6C9", tone: "blue", hint: "Out-station travel" },
  on_leave: { label: "On leave", color: "#A9762B", tone: "amber", hint: "Not working today" },
  offline: { label: "Offline", color: "#9098B8", tone: "neutral", hint: "No activity today" },
};

export const FIELD_TASK_TYPES = ["delivery", "collection", "visit", "audit", "installation", "service", "other"] as const;
export type FieldTaskType = (typeof FIELD_TASK_TYPES)[number];
export const TASK_TYPE_LABEL: Record<FieldTaskType, string> = {
  delivery: "Delivery",
  collection: "Payment collection",
  visit: "Customer visit",
  audit: "Stock audit",
  installation: "Installation",
  service: "Service / repair",
  other: "Other",
};

export const FIELD_TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type FieldTaskStatus = (typeof FIELD_TASK_STATUSES)[number];
export const TASK_STATUS_META: Record<FieldTaskStatus, { label: string; tone: BosBadgeTone; dot: string }> = {
  open: { label: "Open", tone: "amber", dot: "var(--bos-amber)" },
  in_progress: { label: "In progress", tone: "blue", dot: "var(--bos-blue)" },
  done: { label: "Done", tone: "emerald", dot: "var(--bos-emerald)" },
  cancelled: { label: "Cancelled", tone: "neutral", dot: "var(--bos-text-faint)" },
};

export const FIELD_TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type FieldTaskPriority = (typeof FIELD_TASK_PRIORITIES)[number];
export const PRIORITY_META: Record<FieldTaskPriority, { label: string; tone: BosBadgeTone }> = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "blue" },
  high: { label: "High", tone: "amber" },
  urgent: { label: "Urgent", tone: "coral" },
};

export const VISIT_OUTCOMES = ["completed", "follow_up", "order_received", "payment_collected", "customer_unavailable", "rescheduled", "other"] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export const OUTCOME_META: Record<VisitOutcome, { label: string; tone: BosBadgeTone }> = {
  completed: { label: "Work completed", tone: "emerald" },
  follow_up: { label: "Follow-up needed", tone: "amber" },
  order_received: { label: "Order received", tone: "emerald" },
  payment_collected: { label: "Payment collected", tone: "emerald" },
  customer_unavailable: { label: "Customer unavailable", tone: "coral" },
  rescheduled: { label: "Rescheduled", tone: "amber" },
  other: { label: "Other", tone: "neutral" },
};

/** Mirrors the server rule: managers move tasks anywhere; assignees work forward, pause or reopen — never cancel. */
export function canMoveFieldTask(from: string, to: FieldTaskStatus, manager: boolean): boolean {
  if (from === to) return false;
  if (manager) return true;
  const allowed: Record<string, ReadonlyArray<FieldTaskStatus>> = { open: ["in_progress", "done"], in_progress: ["open", "done"], done: ["in_progress"], cancelled: [] };
  return (allowed[from] ?? []).includes(to);
}

export const statusMeta = (s: string) => FIELD_STATUS_META[s as FieldStatus] ?? FIELD_STATUS_META.offline;
export const taskTypeLabel = (t: string) => TASK_TYPE_LABEL[t as FieldTaskType] ?? t;
export const taskStatusMeta = (s: string) => TASK_STATUS_META[s as FieldTaskStatus] ?? TASK_STATUS_META.open;
export const priorityMeta = (p: string) => PRIORITY_META[p as FieldTaskPriority] ?? PRIORITY_META.normal;
export const outcomeMeta = (o: string | null) => (o ? (OUTCOME_META[o as VisitOutcome] ?? { label: o.replace(/_/g, " "), tone: "neutral" as BosBadgeTone }) : null);

/* ---------- Shapes ---------- */

export type GeoFix = { lat: number; lng: number; accuracy: number | null };

export type FieldVisit = {
  id: string;
  userId: number;
  userName: string | null;
  date: string;
  siteName: string;
  partyId: string | null;
  partyName: string | null;
  purpose: string;
  taskId: string | null;
  address: string | null;
  photoNote: string | null;
  inLat: number | null;
  inLng: number | null;
  inAccuracy: number | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  outLat: number | null;
  outLng: number | null;
  outAccuracy: number | null;
  open: boolean;
  minutes: number;
  durationLabel: string;
  summary: string | null;
  outcome: string | null;
  nextVisitOn: string | null;
};

export type FieldTask = {
  id: string;
  title: string;
  taskType: string;
  status: FieldTaskStatus;
  priority: string;
  assigneeUserId: number | null;
  assigneeName: string | null;
  partyId: string | null;
  partyName: string | null;
  siteAddress: string | null;
  lat: number | null;
  lng: number | null;
  dueOn: string | null;
  dueTime: string | null;
  amount: number | null;
  notes: string | null;
  overdue: boolean;
  completedAt: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FieldPerson = {
  userId: number;
  name: string;
  role: string;
  phone: string | null;
  isMe: boolean;
  status: FieldStatus;
  statusLabel: string;
  statusAt: string | null;
  statusNote: string | null;
  currentSite: string | null;
  openVisit: FieldVisit | null;
  lastPing: { lat: number; lng: number; accuracy: number | null; at: string | null } | null;
  km: number;
  visits: number;
  minutesOnSite: number;
  openTasks: number;
  doneTasks: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type FieldOverview = {
  date: string;
  today: string;
  canManage: boolean;
  me: FieldPerson;
  team: FieldPerson[];
  visits: FieldVisit[];
  tasks: FieldTask[];
  numbers: {
    visits: number;
    activeVisits: number;
    km: number;
    minutesOnSite: number;
    tasksDone: number;
    tasksOpen: number;
    tasksOverdue: number;
    collections: number;
    followUps: number;
    statusCounts: Record<FieldStatus, number>;
  };
};

export type FieldTimelineEntry = { at: string | null; kind: "check_in" | "check_out" | "status" | "task_done"; title: string; detail: string | null; lat: number | null; lng: number | null };

export type FieldDayTrail = {
  userId: number;
  date: string;
  pings: Array<{ at: string | null; lat: number; lng: number; accuracy: number | null; kind: string; status: string }>;
  km: number;
  visits: FieldVisit[];
  timeline: FieldTimelineEntry[];
};

export type FieldHistory = {
  range: { from: string; to: string };
  visits: FieldVisit[];
  summary: { visits: number; minutes: number; members: number; followUps: number; open: number };
};

export type CheckInInput = {
  siteName: string;
  partyId?: string | null;
  partyName?: string | null;
  purpose: FieldTaskType;
  taskId?: string | null;
  address?: string | null;
  photoNote?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
};

export type CheckOutInput = {
  summary: string;
  outcome: VisitOutcome;
  nextVisitOn?: string | null;
  completeTask?: boolean;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
};

export type FieldTaskInput = {
  title: string;
  taskType: FieldTaskType;
  priority: FieldTaskPriority;
  status?: FieldTaskStatus;
  assigneeUserId: number;
  partyId?: string | null;
  partyName?: string | null;
  siteAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  dueOn?: string | null;
  dueTime?: string | null;
  amount?: number | null;
  notes?: string | null;
};

/* ---------- Endpoints ---------- */

export const field = {
  overview: (date?: string) => get<FieldOverview>("/field/overview", { date }),
  checkIn: (input: CheckInInput) => post<{ visit: FieldVisit | null }>("/field/checkin", input),
  checkOut: (visitId: string, input: CheckOutInput) => post<{ visit: FieldVisit | null }>(`/field/checkout/${visitId}`, input),
  setStatus: (input: { status: FieldStatus; note?: string | null; userId?: number }) => post<{ ok: true; status: FieldStatus }>("/field/status", input),
  ping: (fix: GeoFix) => post<{ ok: true; skipped: boolean }>("/field/ping", fix),
  day: (params: { userId?: number; date?: string } = {}) => get<FieldDayTrail>("/field/pings", params),
  tasks: (params: { status?: string; userId?: number; from?: string; to?: string; q?: string; limit?: number } = {}) => get<{ tasks: FieldTask[] }>("/field/tasks", params),
  task: (id: string) => get<{ task: FieldTask; visits: FieldVisit[] }>(`/field/tasks/${id}`),
  createTask: (input: FieldTaskInput) => post<{ task: FieldTask }>("/field/tasks", input),
  updateTask: (id: string, input: Partial<FieldTaskInput>) => patch<{ task: FieldTask }>(`/field/tasks/${id}`, input),
  history: (params: { from?: string; to?: string; userId?: number; q?: string; outcome?: string } = {}) => get<FieldHistory>("/field/history", params),
};

/* ---------- Maps ---------- */

/** OpenStreetMap embed centred on a point (≈ 1.2 km box unless `spanDeg` widens it) or fitted to several. */
export function osmEmbedUrl(points: ReadonlyArray<{ lat: number; lng: number }>, marker?: { lat: number; lng: number } | null, spanDeg = 0.012): string | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const pad = (a: number, b: number) => Math.max(spanDeg, (b - a) * 0.2);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const pLat = pad(minLat, maxLat);
  const pLng = pad(minLng, maxLng);
  const bbox = [minLng - pLng, minLat - pLat, maxLng + pLng, maxLat + pLat].map((n) => n.toFixed(5)).join(",");
  const m = marker ?? points[points.length - 1];
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${m.lat.toFixed(6)},${m.lng.toFixed(6)}`;
}

export const googleMapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
export const googleDirectionsUrl = (q: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;

/** Google Maps route through up to 10 evenly sampled points of a day's trail. */
export function googleRouteUrl(points: ReadonlyArray<{ lat: number; lng: number }>): string | null {
  if (points.length < 2) return null;
  const n = Math.min(10, points.length);
  const picked = Array.from({ length: n }, (_, i) => points[Math.round((i * (points.length - 1)) / (n - 1))]);
  return `https://www.google.com/maps/dir/${picked.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("/")}`;
}

/** `2h 05m` / `45m` from minutes. */
export function minutesText(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** Local `3:42 pm` from an ISO timestamp. */
export function timeOfDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}
