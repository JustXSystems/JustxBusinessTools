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

/** True when the user is actively focused inside an editable form control. */
export function isUserEditing(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const ctrl = el as HTMLInputElement;
    if (ctrl.readOnly || ctrl.disabled) return false;
    return true;
  }
  return Boolean(el.isContentEditable);
}

type LiveRefreshOptions = {
  /** Poll interval while the tab is visible. Null/0 disables polling. Default 45s. */
  intervalMs?: number | null;
  enabled?: boolean;
  /** Also refresh when the Next.js route changes (default true). */
  onPathChange?: boolean;
  /** Skip passive background refreshes (interval/focus/visibility/online) while editing a form field (default true). */
  pauseWhileEditing?: boolean;
  /** Refresh when window regains focus or tab becomes visible (default true). */
  refreshOnFocus?: boolean;
  /** Extra deps that should trigger an immediate refresh (e.g. date range). */
  deps?: unknown[];
};

const PASSIVE_COOLDOWN_MS = 1_500;

/**
 * Keeps client state aligned with MySQL: refresh on mount, focus, visibility,
 * route change, auth/branch switch, and optional polling / invalidate events.
 * Passive background triggers pause while the user is actively editing a form
 * field and coalesce rapid bursts (e.g. visibilitychange + focus).
 */
export function useLiveRefresh(
  refresh: () => void | Promise<void>,
  opts: LiveRefreshOptions = {},
): void {
  const {
    intervalMs = 45_000,
    enabled = true,
    onPathChange = true,
    pauseWhileEditing = true,
    refreshOnFocus = true,
    deps = [],
  } = opts;
  const pathname = usePathname();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const inFlightRef = useRef(false);
  const lastRunAtRef = useRef(0);
  const lastPathnameRef = useRef(pathname);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const run = (passive: boolean) => {
      if (cancelled) return;
      if (passive) {
        if (pauseWhileEditing && isUserEditing()) return;
        if (inFlightRef.current) return;
        if (Date.now() - lastRunAtRef.current < PASSIVE_COOLDOWN_MS) return;
      }
      inFlightRef.current = true;
      lastRunAtRef.current = Date.now();
      void Promise.resolve(refreshRef.current())
        .catch(() => {
          /* caller owns error UI */
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };

    const runImmediate = () => run(false);
    const runPassive = () => run(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") run(true);
    };

    runImmediate();

    if (refreshOnFocus) {
      window.addEventListener("focus", runPassive);
      document.addEventListener("visibilitychange", onVisible);
    }
    window.addEventListener("online", runPassive);
    window.addEventListener("jbt:auth-context-changed", runImmediate);
    window.addEventListener(DATA_INVALIDATE_EVENT, runImmediate);

    let tick: number | undefined;
    if (intervalMs && intervalMs > 0) {
      tick = window.setInterval(() => {
        if (document.visibilityState === "visible") run(true);
      }, intervalMs);
    }

    return () => {
      cancelled = true;
      if (refreshOnFocus) {
        window.removeEventListener("focus", runPassive);
        document.removeEventListener("visibilitychange", onVisible);
      }
      window.removeEventListener("online", runPassive);
      window.removeEventListener("jbt:auth-context-changed", runImmediate);
      window.removeEventListener(DATA_INVALIDATE_EVENT, runImmediate);
      if (tick) window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps passed explicitly by callers
  }, [enabled, intervalMs, pauseWhileEditing, refreshOnFocus, ...deps]);

  useEffect(() => {
    if (lastPathnameRef.current === pathname) return;
    lastPathnameRef.current = pathname;
    if (!enabled || !onPathChange) return;
    void Promise.resolve(refreshRef.current()).catch(() => undefined);
  }, [enabled, onPathChange, pathname]);
}
