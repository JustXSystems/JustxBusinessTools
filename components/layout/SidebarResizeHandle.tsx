"use client";

import { useEffect, useRef } from "react";
import { useSidebarLayout } from "@/components/layout/SidebarLayoutProvider";
import { SIDEBAR_LAYOUT_META } from "@/lib/sidebar-layout";

/**
 * OS-style resize rail: drag to slide width, release to magnetic-snap,
 * double-click to collapse/expand (Finder / Explorer pattern).
 */
export function SidebarResizeHandle({ variant = "operator" }: { variant?: "operator" | "admin" }) {
  const {
    mode,
    dragging,
    previewLabel,
    beginResize,
    updateResize,
    endResize,
    toggleMini,
    stepSnap,
  } = useSidebarLayout();
  const activeRef = useRef(false);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!activeRef.current) return;
      updateResize(e.clientX);
    };
    const onUp = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      endResize();
      document.body.classList.remove("is-sidebar-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [updateResize, endResize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) {
          return;
        }
      }
      if (e.key === "[") {
        e.preventDefault();
        stepSnap(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        stepSnap(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepSnap]);

  return (
    <>
      <div
        className={`sidebar-resize-handle sidebar-resize-handle-${variant}${dragging ? " is-active" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize navigation. Drag to slide between Mini, Docked, and Normal. Double-click to collapse or expand."
        aria-valuetext={SIDEBAR_LAYOUT_META[mode].label}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          activeRef.current = true;
          document.body.classList.add("is-sidebar-resizing");
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          beginResize(e.clientX);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          toggleMini();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleMini();
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            stepSnap(-1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            stepSnap(1);
          }
        }}
      >
        <span className="sidebar-resize-grip" aria-hidden="true" />
      </div>

      {dragging && previewLabel ? (
        <div className="sidebar-snap-hud" role="status" aria-live="polite">
          <span className="sidebar-snap-hud-label">{previewLabel}</span>
          <span className="sidebar-snap-hud-hint">Release to snap · Double-click toggles Mini</span>
        </div>
      ) : null}
    </>
  );
}
