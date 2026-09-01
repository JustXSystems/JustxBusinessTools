/**
 * Process role for splitting HTTP API vs background workers.
 *
 * - `all` (default): API process also runs schedulers — local/dev friendly
 * - `api`: HTTP only; jobs run in a separate PM2 worker
 * - `worker`: background jobs only (no HTTP listen)
 */
export type JbtProcessRole = "all" | "api" | "worker";

export function getProcessRole(): JbtProcessRole {
  const raw = (process.env.JBT_PROCESS_ROLE ?? "all").trim().toLowerCase();
  if (raw === "api" || raw === "worker") return raw;
  return "all";
}

export function shouldRunBackgroundJobsInApi(): boolean {
  return getProcessRole() !== "api";
}

export function shouldRunBackgroundJobsInWorker(): boolean {
  const role = getProcessRole();
  return role === "worker" || role === "all";
}
