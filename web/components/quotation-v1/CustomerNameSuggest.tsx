"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { SuggestedCustomer } from "@/lib/quotation-v1";

const MOBILE_MQ = "(max-width: 720px)";

function useIsMobileSuggest() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

function customerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (q.length < 3) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="qgv1-cs-mark">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function formatPhoneChip(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 5)} ${d.slice(5)}`;
  return phone.trim();
}

type AnchorPos = { top: number; left: number; width: number; maxH: number; placeAbove: boolean };

type Props = {
  value: string;
  suggestions: SuggestedCustomer[];
  open: boolean;
  activeIndex: number;
  onOpenChange: (open: boolean) => void;
  onActiveIndexChange: (index: number) => void;
  onValueChange: (value: string) => void;
  onSelect: (customer: SuggestedCustomer) => void;
};

export function CustomerNameSuggest({
  value,
  suggestions,
  open,
  activeIndex,
  onOpenChange,
  onActiveIndexChange,
  onValueChange,
  onSelect,
}: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<AnchorPos | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const mobile = useIsMobileSuggest();
  const showPanel = open && suggestions.length > 0;

  useEffect(() => setMounted(true), []);

  const syncAnchor = useCallback(() => {
    const input = inputRef.current;
    if (!input || mobile) {
      setPos(null);
      return;
    }
    const r = input.getBoundingClientRect();
    const gap = 8;
    const spaceBelow = window.innerHeight - r.bottom - gap - 12;
    const spaceAbove = r.top - gap - 12;
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxH = Math.max(160, Math.min(320, placeAbove ? spaceAbove : spaceBelow));
    setPos({
      top: placeAbove ? r.top - gap : r.bottom + gap,
      left: Math.max(12, Math.min(r.left, window.innerWidth - Math.max(r.width, 280) - 12)),
      width: Math.max(r.width, Math.min(360, window.innerWidth - 24)),
      maxH,
      placeAbove,
    });
  }, [mobile]);

  useLayoutEffect(() => {
    if (!showPanel) return;
    syncAnchor();
    const onScroll = () => syncAnchor();
    window.addEventListener("resize", syncAnchor);
    window.addEventListener("scroll", onScroll, true);
    const vv = window.visualViewport;
    const onVv = () => {
      if (vv) {
        const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        setKeyboardInset(inset);
      }
      syncAnchor();
    };
    vv?.addEventListener("resize", onVv);
    vv?.addEventListener("scroll", onVv);
    onVv();
    return () => {
      window.removeEventListener("resize", syncAnchor);
      window.removeEventListener("scroll", onScroll, true);
      vv?.removeEventListener("resize", onVv);
      vv?.removeEventListener("scroll", onVv);
    };
  }, [showPanel, syncAnchor, suggestions.length, value]);

  useEffect(() => {
    if (!showPanel || !mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showPanel, mobile]);

  useEffect(() => {
    if (!showPanel) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      onOpenChange(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [showPanel, onOpenChange]);

  useEffect(() => {
    if (!showPanel || !mobile) return;
    // Let the sheet paint before focusing (iOS keyboard).
    const id = window.setTimeout(() => {
      const el = mobileSearchRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const len = el.value.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* some mobile browsers */
      }
    }, 220);
    return () => window.clearTimeout(id);
  }, [showPanel, mobile]);

  useEffect(() => {
    if (!showPanel || !panelRef.current) return;
    const active = panelRef.current.querySelector<HTMLElement>(`[data-cs-idx="${activeIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, showPanel]);

  const countLabel = useMemo(() => {
    const n = suggestions.length;
    return n === 1 ? "1 match from records" : `${n} matches from records`;
  }, [suggestions.length]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showPanel) {
      if (e.key === "ArrowDown" && suggestions.length > 0) {
        e.preventDefault();
        onOpenChange(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      onActiveIndexChange(Math.min(activeIndex + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onActiveIndexChange(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[activeIndex];
      if (pick) onSelect(pick);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  }

  const panel = showPanel && mounted
    ? createPortal(
        <div
          className={
            mobile
              ? "qgv1-cs-layer is-mobile"
              : `qgv1-cs-layer is-desktop${pos?.placeAbove ? " is-above" : ""}`
          }
          style={
            mobile
              ? ({ ["--qgv1-cs-kb" as string]: `${keyboardInset}px` } as CSSProperties)
              : pos
                ? ({
                    ["--qgv1-cs-top" as string]: `${pos.top}px`,
                    ["--qgv1-cs-left" as string]: `${pos.left}px`,
                    ["--qgv1-cs-width" as string]: `${pos.width}px`,
                    ["--qgv1-cs-maxh" as string]: `${pos.maxH}px`,
                  } as CSSProperties)
                : undefined
          }
          role="presentation"
        >
          {mobile ? (
            <button
              type="button"
              className="qgv1-cs-backdrop"
              aria-label="Dismiss customer matches"
              onClick={() => onOpenChange(false)}
            />
          ) : null}
          <div
            ref={panelRef}
            id={listId}
            className="qgv1-cs-panel"
            role="listbox"
            aria-label="Matching customers"
          >
            {mobile ? <div className="qgv1-cs-grab" aria-hidden /> : null}
            <div className="qgv1-cs-head">
              <div className="qgv1-cs-head-text">
                <span className="qgv1-cs-kicker">Customer intelligence</span>
                <strong>{countLabel}</strong>
              </div>
              {mobile ? (
                <button
                  type="button"
                  className="qgv1-cs-close"
                  onClick={() => onOpenChange(false)}
                  aria-label="Close"
                >
                  Done
                </button>
              ) : (
                <span className="qgv1-cs-hint">↑↓ Enter</span>
              )}
            </div>
            {mobile ? (
              <div className="qgv1-cs-mobile-search">
                <input
                  ref={mobileSearchRef}
                  value={value}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  inputMode="text"
                  placeholder="Keep typing to refine…"
                  aria-label="Refine customer search"
                  onChange={(e) => {
                    onValueChange(e.target.value);
                  }}
                  onKeyDown={onKeyDown}
                />
              </div>
            ) : null}
            <ul className="qgv1-cs-list">
              {suggestions.map((s, idx) => {
                const active = idx === activeIndex;
                const place = [s.city, s.state].filter(Boolean).join(", ");
                return (
                  <li key={s.key} role="presentation">
                    <button
                      type="button"
                      id={`${listId}-opt-${idx}`}
                      role="option"
                      data-cs-idx={idx}
                      aria-selected={active}
                      className={active ? "qgv1-cs-item is-active" : "qgv1-cs-item"}
                      onMouseEnter={() => onActiveIndexChange(idx)}
                      onPointerDown={(ev) => {
                        // Prevent input blur before select (mouse + touch).
                        if (ev.pointerType === "mouse") ev.preventDefault();
                      }}
                      onClick={() => onSelect(s)}
                    >
                      <span className="qgv1-cs-avatar" aria-hidden>
                        {customerInitials(s.name)}
                      </span>
                      <span className="qgv1-cs-body">
                        <span className="qgv1-cs-name">{highlightMatch(s.name, value)}</span>
                        {s.company ? (
                          <span className="qgv1-cs-company">{highlightMatch(s.company, value)}</span>
                        ) : null}
                        <span className="qgv1-cs-chips">
                          {s.phone ? (
                            <span className="qgv1-cs-chip">{formatPhoneChip(s.phone)}</span>
                          ) : null}
                          {place ? <span className="qgv1-cs-chip">{place}</span> : null}
                          {s.gstin ? <span className="qgv1-cs-chip is-muted">{s.gstin}</span> : null}
                        </span>
                      </span>
                      <span className="qgv1-cs-action" aria-hidden>
                        Autofill
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className={`field qgv1-customer-name-field${showPanel ? " is-open" : ""}`}
      ref={wrapRef}
    >
      <span>Customer / Site Owner Name *</span>
      <div className="qgv1-cs-input-shell">
        <input
          ref={inputRef}
          value={value}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          inputMode="text"
          placeholder="Type 3+ letters to find existing customers"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={showPanel ? listId : undefined}
          aria-activedescendant={
            showPanel ? `${listId}-opt-${activeIndex}` : undefined
          }
          onChange={(e) => onValueChange(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) onOpenChange(true);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {panel}
    </div>
  );
}
