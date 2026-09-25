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

type TipState = {
  label: string;
  top: number;
  left: number;
  placeLeft: boolean;
  placeBelow: boolean;
} | null;

/**
 * True floating navigation: collapsed pebble (logo + dots), expands to icon rail,
 * labels appear beside (or below, in landscape) the hovered control.
 */
export function FloatingNavDock({ homeHref, items, footer }: Props) {
  const {
    floatX,
    floatY,
    floatOpen,
    floatPinned,
    floatHorizontal,
    setFloatOpen,
    setFloatPinned,
    setAttachment,
    beginFloatDrag,
    updateFloatDrag,
    endFloatDrag,
  } = useSidebarLayout();

  const dockRef = useRef<HTMLDivElement>(null);
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

  // Touch has no mouseleave, so an open dock would never collapse on its own.
  useEffect(() => {
    if (!floatOpen || floatPinned || floatHorizontal) return;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (dockRef.current?.contains(e.target as Node)) return;
      setFloatOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [floatOpen, floatPinned, floatHorizontal, setFloatOpen]);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    if (floatPinned || floatHorizontal) return;
    closeTimer.current = window.setTimeout(() => setFloatOpen(false), 220);
  };

  const showTipFor = (el: HTMLElement, label: string) => {
    const rect = el.getBoundingClientRect();
    if (floatHorizontal) {
      const tipWidth = Math.min(220, Math.max(72, label.length * 7.5 + 24));
      const left = Math.min(
        window.innerWidth - tipWidth / 2 - 8,
        Math.max(tipWidth / 2 + 8, rect.left + rect.width / 2),
      );
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeBelow = spaceBelow >= 44;
      setTip({
        label,
        top: placeBelow ? rect.bottom + 10 : rect.top - 10,
        left,
        placeLeft: false,
        placeBelow,
      });
      return;
    }
    const tipWidth = Math.min(220, Math.max(72, label.length * 7.5 + 24));
    const spaceRight = window.innerWidth - rect.right;
    const placeLeft = spaceRight < tipWidth + 16;
    setTip({
      label,
      top: rect.top + rect.height / 2,
      left: placeLeft ? rect.left - 10 : rect.right + 10,
      placeLeft,
      placeBelow: false,
    });
  };

  const hideTip = () => setTip(null);

  // Touch devices emulate mouseover on tap, which would leave tooltips stuck.
  const canHover = () => window.matchMedia("(hover: hover)").matches;

  const closeAfterTouchNav = () => {
    if (!floatPinned && !floatHorizontal && !canHover()) setFloatOpen(false);
  };

  return (
    <>
      <div
        ref={dockRef}
        className={`float-dock${floatOpen ? " is-open" : " is-collapsed"}${floatPinned ? " is-pinned" : ""}${floatHorizontal ? " is-horizontal" : ""}`}
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
          if (!target || !floatOpen || !canHover()) return;
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
          if (!canHover()) return;
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
        data-orientation={floatHorizontal ? "horizontal" : "vertical"}
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
          <span
            className={`float-dock-dots${floatHorizontal ? "" : " float-dock-dots-v"}`}
            aria-hidden="true"
          >
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
              onClick={closeAfterTouchNav}
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
          {!floatHorizontal ? (
            <button
              type="button"
              className="float-dock-action"
              title="Switch to full sidebar menu"
              aria-label="Switch to sidebar"
              onClick={() => setAttachment("edge")}
            >
              Sidebar
            </button>
          ) : null}
        </div>
      </div>

      {mounted && tip && floatOpen
        ? createPortal(
            <div
              className={`float-dock-tip${tip.placeLeft ? " is-left" : ""}${
                floatHorizontal ? (tip.placeBelow ? " is-below" : " is-above") : ""
              }`}
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
