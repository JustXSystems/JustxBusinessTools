"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { NavIcon } from "@/components/layout/NavIcon";
import { useSidebarLayout } from "@/components/layout/SidebarLayoutProvider";
import type { NavIconId } from "@/config/navigation.config";

export type FloatDockItem = {
  href: string;
  label: string;
  icon: NavIconId;
  active?: boolean;
  badge?: ReactNode;
};

type Props = {
  homeHref: string;
  items: FloatDockItem[];
  footer?: ReactNode;
};

type TipState = { label: string; top: number; left: number; placeLeft: boolean } | null;

/**
 * True floating navigation: collapsed pebble (logo + dots), expands to icon rail,
 * labels appear beside the hovered control (not a fixed HUD).
 */
export function FloatingNavDock({ homeHref, items, footer }: Props) {
  const {
    floatX,
    floatY,
    floatOpen,
    floatPinned,
    setFloatOpen,
    setFloatPinned,
    setAttachment,
    beginFloatDrag,
    updateFloatDrag,
    endFloatDrag,
  } = useSidebarLayout();

  const dragRef = useRef(false);
  const movedRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const [tip, setTip] = useState<TipState>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      movedRef.current = true;
      updateFloatDrag(e.clientX, e.clientY);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = false;
      endFloatDrag();
      document.body.classList.remove("is-float-dock-dragging");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [updateFloatDrag, endFloatDrag]);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    if (floatPinned) return;
    closeTimer.current = window.setTimeout(() => setFloatOpen(false), 220);
  };

  const showTipFor = (el: HTMLElement, label: string) => {
    const rect = el.getBoundingClientRect();
    const tipWidth = Math.min(220, Math.max(72, label.length * 7.5 + 24));
    const spaceRight = window.innerWidth - rect.right;
    const placeLeft = spaceRight < tipWidth + 16;
    setTip({
      label,
      top: rect.top + rect.height / 2,
      left: placeLeft ? rect.left - 10 : rect.right + 10,
      placeLeft,
    });
  };

  const hideTip = () => setTip(null);

  return (
    <>
      <div
        className={`float-dock${floatOpen ? " is-open" : " is-collapsed"}${floatPinned ? " is-pinned" : ""}`}
        style={{ left: floatX, top: floatY }}
        onMouseEnter={() => {
          clearCloseTimer();
          setFloatOpen(true);
        }}
          onMouseLeave={() => {
          hideTip();
          scheduleClose();
        }}
        onMouseOver={(e) => {
          const target = (e.target as HTMLElement).closest(
            ".float-dock-item, .float-dock-action",
          ) as HTMLElement | null;
          if (!target || !floatOpen) return;
          const label =
            target.getAttribute("aria-label") ||
            target.getAttribute("title") ||
            target.textContent?.trim() ||
            "";
          if (label) showTipFor(target, label);
        }}
        onFocusCapture={(e) => {
          const target = e.target as HTMLElement;
          if (!target.classList.contains("float-dock-item") && !target.classList.contains("float-dock-action")) {
            return;
          }
          const label =
            target.getAttribute("aria-label") ||
            target.getAttribute("title") ||
            target.textContent?.trim() ||
            "";
          if (label) showTipFor(target, label);
        }}
        onBlurCapture={hideTip}
        role="navigation"
        aria-label="Floating navigation"
      >
        <button
          type="button"
          className="float-dock-drag"
          aria-label="Move navigation dock"
          title="Drag to move"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            dragRef.current = true;
            movedRef.current = false;
            document.body.classList.add("is-float-dock-dragging");
            beginFloatDrag(e.clientX, e.clientY);
          }}
        >
          <span className="float-dock-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>

        <div className="float-dock-brand">
          <PlatformBrandMark href={homeHref} size="sm" showText={false} />
        </div>

        <button
          type="button"
          className="float-dock-toggle"
          aria-expanded={floatOpen}
          aria-label={floatOpen ? "Collapse navigation" : "Expand navigation"}
          onClick={() => {
            if (movedRef.current) return;
            setFloatOpen(!floatOpen);
          }}
        >
          <span className="float-dock-dots float-dock-dots-v" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>

        <div className="float-dock-rail">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`float-dock-item${item.active ? " active" : ""}`}
              aria-label={item.label}
              aria-current={item.active ? "page" : undefined}
            >
              <span className={`float-dock-icon${item.active ? " is-glow" : ""}`}>
                <NavIcon id={item.icon} />
              </span>
              {item.badge}
            </Link>
          ))}
          {footer}
        </div>

        <div className="float-dock-actions">
          <button
            type="button"
            className={`float-dock-action${floatPinned ? " active" : ""}`}
            title={floatPinned ? "Unpin dock" : "Pin dock open"}
            aria-label={floatPinned ? "Unpin dock" : "Pin dock open"}
            aria-pressed={floatPinned}
            onClick={() => setFloatPinned(!floatPinned)}
          >
            Pin
          </button>
          <button
            type="button"
            className="float-dock-action"
            title="Switch to full sidebar menu"
            aria-label="Switch to sidebar"
            onClick={() => setAttachment("edge")}
          >
            Sidebar
          </button>
        </div>
      </div>

      {mounted && tip && floatOpen
        ? createPortal(
            <div
              className={`float-dock-tip${tip.placeLeft ? " is-left" : ""}`}
              style={{ top: tip.top, left: tip.left }}
              role="tooltip"
            >
              {tip.label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
