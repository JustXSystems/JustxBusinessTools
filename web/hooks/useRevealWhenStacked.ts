"use client";

import { useCallback, useRef } from "react";

/** Matches the admin list/detail breakpoint where panes stack into one column. */
const STACKED_MQ = "(max-width: 960px)";

/**
 * When a directory and its detail pane are stacked (phones / small tablets),
 * picking a row renders the detail below the fold. `reveal()` scrolls it into
 * view after the next paint; it is a no-op on side-by-side layouts.
 */
export function useRevealWhenStacked<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const reveal = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia(STACKED_MQ).matches) return;
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  return { ref, reveal };
}
