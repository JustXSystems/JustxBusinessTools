"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus contract: focus moves into `panel` on open, Tab cycles inside it,
 * Escape calls `onEscape`, and focus returns to the opener on close.
 */
export function useOverlayFocus(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  onEscape: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const escRef = useRef(onEscape);
  useEffect(() => {
    escRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const focusFirst = () => {
      const target = initialFocus?.current ?? node?.querySelector<HTMLElement>(FOCUSABLE) ?? node;
      target?.focus({ preventScroll: true });
    };
    const raf = window.requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        escRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.({ preventScroll: true });
    };
  }, [open, panel, initialFocus]);
}
