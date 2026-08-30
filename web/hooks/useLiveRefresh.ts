"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export const DATA_INVALIDATE_EVENT = "jbt:data-invalidate";

/** Broadcast that mutable server data changed — listeners should re-fetch from DB. */
export function invalidateLiveData(detail?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(DATA_INVALIDATE_EVENT, { detail }));
  } catch {
    /* ignore */
  }
}

/** Invalidate domain caches and always refresh notification badges/inbox. */
export function invalidateAdminData(...details: string[]): void {
  for (const detail of details) invalidateLiveData(detail);
  invalidateLiveData("notifications");
}

type LiveRefreshOptions = {
  /** Poll interval while the tab is visible. Null/0 disables polling. Default 45s. */
  intervalMs?: number | null;
  enabled?: boolean;
  /** Also refresh when the Next.js route changes (default true). */
  onPathChange?: boolean;
  /** Extra deps that should trigger an immediate refresh (e.g. date range). */
  deps?: unknown[];
};

/**
 * Keeps client state aligned with MySQL: refresh on mount, focus, visibility,
 * route change, auth/branch switch, and optional polling / invalidate events.
 */
export function useLiveRefresh(
  refresh: () => void | Promise<void>,
  opts: LiveRefreshOptions = {},
): void {
  const {
    intervalMs = 45_000,
    enabled = true,
    onPathChange = true,
    deps = [],
  } = opts;
  const pathname = usePathname();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void Promise.resolve(refreshRef.current()).catch(() => {
        /* caller owns error UI */
      });
    };

    run();

    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    window.addEventListener("jbt:auth-context-changed", run);
    window.addEventListener(DATA_INVALIDATE_EVENT, run);

    let tick: number | undefined;
    if (intervalMs && intervalMs > 0) {
      tick = window.setInterval(() => {
        if (document.visibilityState === "visible") run();
      }, intervalMs);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
      window.removeEventListener("jbt:auth-context-changed", run);
      window.removeEventListener(DATA_INVALIDATE_EVENT, run);
      if (tick) window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps passed explicitly by callers
  }, [enabled, intervalMs, ...deps]);

  useEffect(() => {
    if (!enabled || !onPathChange) return;
    void Promise.resolve(refreshRef.current()).catch(() => undefined);
  }, [enabled, onPathChange, pathname]);
}
