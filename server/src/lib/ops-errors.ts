/**
 * In-process ring buffer of recent errors for Admin Operations.
 * Survives only while the API process is up — Grafana/GlitchTip are the system of record.
 */
export type OpsErrorEvent = {
  id: string;
  at: string;
  message: string;
  path?: string;
  method?: string;
  userId?: number | null;
  requestId?: string;
  kind?: string;
};

const MAX = 80;
const buffer: OpsErrorEvent[] = [];

export function recordOpsError(event: Omit<OpsErrorEvent, "id" | "at"> & { at?: string }): void {
  buffer.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: event.at ?? new Date().toISOString(),
    message: String(event.message).slice(0, 500),
    path: event.path,
    method: event.method,
    userId: event.userId,
    requestId: event.requestId,
    kind: event.kind,
  });
  if (buffer.length > MAX) buffer.length = MAX;
}

export function listOpsErrors(limit = 40): OpsErrorEvent[] {
  return buffer.slice(0, Math.min(Math.max(limit, 1), MAX));
}

export function opsErrorCount(): number {
  return buffer.length;
}
