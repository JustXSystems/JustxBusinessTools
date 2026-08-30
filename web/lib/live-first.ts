/**
 * Live-first data policy for JustX Business Tools.
 *
 * 1. Always attempt a fresh network/DB fetch when online.
 * 2. Persist successful responses as contingency only (offline / outage).
 * 3. Never prefer contingency over a successful live response.
 * 4. On reconnect (`online`), invalidate and re-fetch immediately.
 */

export type LiveSource = "live" | "contingency" | "default";

export type LiveResult<T> = {
  data: T;
  source: LiveSource;
};

export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Fetch live data first. Use contingency storage only when offline or the
 * live request fails/times out.
 */
export async function liveFirstFetch<T>(options: {
  fetchLive: (signal?: AbortSignal) => Promise<T>;
  readContingency: () => T | null | undefined;
  defaults: T;
  /** Max wait for live before falling back (default 8s). 0 disables. */
  timeoutMs?: number;
}): Promise<LiveResult<T>> {
  const { fetchLive, readContingency, defaults, timeoutMs = 8_000 } = options;

  const contingency = () => {
    try {
      return readContingency() ?? null;
    } catch {
      return null;
    }
  };

  if (!isBrowserOnline()) {
    const cached = contingency();
    return { data: cached ?? defaults, source: cached ? "contingency" : "default" };
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    timeoutMs > 0 && controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

  try {
    const data = await fetchLive(controller?.signal);
    return { data, source: "live" };
  } catch {
    const cached = contingency();
    return { data: cached ?? defaults, source: cached ? "contingency" : "default" };
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

/** Write-through contingency mirror after a confirmed live payload. */
export function writeContingencyJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function readContingencyJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearContingency(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
