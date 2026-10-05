import { addDaysISO } from "./logic.js";

export const SERVICE_TYPES = ["helpdesk", "certificate", "id_card", "kit", "other"] as const;
export const CERTIFICATE_KINDS = ["employment", "experience", "salary"] as const;
export const SERVICE_PRIORITIES = ["low", "normal", "high"] as const;
export const SERVICE_STATUSES = ["open", "in_progress", "resolved", "cancelled"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];
export type ServicePriority = (typeof SERVICE_PRIORITIES)[number];
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** Window for the average resolution time, compared with the window before it. */
export const RESOLUTION_WINDOW_DAYS = 30;

export const isOpenRequest = (s: ServiceStatus): boolean => s === "open" || s === "in_progress";

/** Days from raising to resolving, to one decimal. Timestamps are "YYYY-MM-DD HH:MM:SS" in the database's time zone. */
export function resolutionDays(createdAt: string, resolvedAt: string): number {
  const ms = Date.parse(resolvedAt.replace(" ", "T")) - Date.parse(createdAt.replace(" ", "T"));
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 8_640_000) / 10) : 0;
}

/** Why a certificate can't be issued for this employee, or null. Experience letters are for people who have left or are leaving. */
export function letterProblem(kind: CertificateKind, employee: { status: string; exitDate: string | null; ctcAnnual: number | null }): string | null {
  if (kind === "experience" && employee.status !== "exited" && employee.status !== "notice" && !employee.exitDate) return "An experience letter is for someone who has left or is serving notice — issue an employment certificate instead";
  if (kind === "salary" && !employee.ctcAnnual) return "Add the CTC on the employee record before issuing a salary certificate";
  if (kind !== "experience" && employee.status === "exited") return "This person has left — issue an experience letter instead";
  return null;
}

export type ServiceRequestLite = { type: ServiceType; status: ServiceStatus; createdAt: string; resolvedAt: string | null };

export function serviceTotals(requests: ReadonlyArray<ServiceRequestLite>, today: string) {
  const open = requests.filter((r) => isOpenRequest(r.status));
  const helpdesk = open.filter((r) => r.type === "helpdesk");
  const recentFrom = addDaysISO(today, -RESOLUTION_WINDOW_DAYS);
  const prevFrom = addDaysISO(today, -2 * RESOLUTION_WINDOW_DAYS);
  const resolved = requests.filter((r) => r.status === "resolved" && r.resolvedAt);
  const avg = (list: ReadonlyArray<ServiceRequestLite>) =>
    list.length ? Math.round((list.reduce((s, r) => s + resolutionDays(r.createdAt, r.resolvedAt!), 0) / list.length) * 10) / 10 : null;
  const recent = resolved.filter((r) => r.resolvedAt!.slice(0, 10) > recentFrom);
  const previous = resolved.filter((r) => r.resolvedAt!.slice(0, 10) > prevFrom && r.resolvedAt!.slice(0, 10) <= recentFrom);
  return {
    open: open.length,
    unassigned: open.filter((r) => r.status === "open").length,
    helpdeskOpen: helpdesk.length,
    helpdeskUnassigned: helpdesk.filter((r) => r.status === "open").length,
    certificatesOpen: open.filter((r) => r.type === "certificate").length,
    kitsOpen: open.filter((r) => r.type === "id_card" || r.type === "kit").length,
    resolvedRecent: recent.length,
    avgResolutionDays: avg(recent),
    avgResolutionPrevDays: avg(previous),
  };
}
export type ServiceTotals = ReturnType<typeof serviceTotals>;
