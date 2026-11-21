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
import { BosPortal, Input } from "@/components/bos";

export type SuggestOption<T = unknown> = {
  id: string;
  /** Value written into the input when picked. */
  value: string;
  /** Primary row text. */
  label: string;
  /** Secondary line (customer, city, amount…). */
  meta?: ReactNode;
  /** Optional trailing detail (amount, date). */
  trailing?: ReactNode;
  /** Extra searchable text (when meta is a React node). */
  searchText?: string;
  data?: T;
};

type Props<T> = {
  value: string;
  onChange: (value: string) => void;
  /** Fired when an option is chosen from the list (not on free typing). */
  onPick?: (option: SuggestOption<T>) => void;
  options: ReadonlyArray<SuggestOption<T>>;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  loading?: boolean;
  size?: "sm" | "md";
  /** Allow keeping typed text that isn’t in the list (default true). */
  allowFreeText?: boolean;
  /** Parent already filtered options — skip local string filter. */
  filterLocal?: boolean;
  maxVisible?: number;
  emptyLabel?: string;
  /** Open list when focused even if value is empty. */
  openOnFocus?: boolean;
  className?: string;
  inputClassName?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

type PanelPos = { left: number; width: number; maxH: number; placeAbove: boolean; anchorTop: number; anchorBottom: number };

function matchOption(opt: SuggestOption, q: string): boolean {
  if (!q) return true;
  const metaText = typeof opt.meta === "string" ? opt.meta : "";
  const hay = `${opt.value} ${opt.label} ${opt.searchText ?? ""} ${metaText}`.toLowerCase();
  return hay.includes(q);
}

/**
 * Free-text + select combobox for composer reference fields.
 * Portal panel avoids clipping inside BOM/DC overflow panes.
 */
export function SuggestInput<T = unknown>({
  value,
  onChange,
  onPick,
  options,
  id,
  placeholder,
  disabled,
  required,
  loading,
  size = "md",
  allowFreeText = true,
  filterLocal = true,
  maxVisible = 12,
  emptyLabel = "No matches",
  openOnFocus = true,
  className,
  inputClassName,
  ...aria
}: Props<T>) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);

  useEffect(() => setMounted(true), []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = filterLocal ? options.filter((o) => matchOption(o, q)) : [...options];
    return list.slice(0, maxVisible);
  }, [options, value, filterLocal, maxVisible]);

  const showList = open && !disabled && (filtered.length > 0 || loading || Boolean(value.trim()));

  const syncPos = useCallback(() => {
    const el = inputWrapRef.current?.querySelector("input") ?? inputWrapRef.current;
    if (!el) {
      setPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - gap - 8;
    const spaceAbove = r.top - gap - 8;
    const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxH = Math.max(120, Math.min(280, placeAbove ? spaceAbove : spaceBelow));
    const width = Math.max(r.width, Math.min(420, window.innerWidth - 16));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({
      left,
      width,
      maxH,
      placeAbove,
      anchorTop: r.top,
      anchorBottom: r.bottom,
    });
  }, []);

  useLayoutEffect(() => {
    if (!showList) return;
    syncPos();
    const onScroll = () => syncPos();
    window.addEventListener("resize", syncPos);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", syncPos);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [showList, syncPos, filtered.length, value]);

  useEffect(() => {
    setActive(0);
  }, [value, open, filtered.length]);

  useEffect(() => {
    if (!showList) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showList]);

  useEffect(() => {
    if (!showList || !panelRef.current) return;
    const el = panelRef.current.querySelector<HTMLElement>(`[data-suggest-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, showList]);

  const pick = (opt: SuggestOption<T>) => {
    onChange(opt.value);
    onPick?.(opt);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (filtered.length) setActive((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length) setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter" && open && filtered[active]) {
      e.preventDefault();
      pick(filtered[active]);
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (e.key === "Tab") setOpen(false);
  };

  const panelStyle: CSSProperties | undefined = pos
    ? {
        position: "fixed",
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxH,
        zIndex: 1200,
        ...(pos.placeAbove
          ? { top: "auto", bottom: Math.max(8, window.innerHeight - pos.anchorTop + 4) }
          : { top: pos.anchorBottom + 4, bottom: "auto" }),
      }
    : undefined;

  const panel =
    showList && mounted ? (
      <BosPortal>
        <div
          ref={panelRef}
          id={listId}
          className="ims-suggest-panel is-portal"
          role="listbox"
          style={panelStyle}
        >
          {loading && !filtered.length ? <div className="ims-suggest-empty">Loading…</div> : null}
          {!loading && !filtered.length ? (
            <div className="ims-suggest-empty">
              {allowFreeText && value.trim() ? `Keep “${value.trim()}” as free text` : emptyLabel}
            </div>
          ) : null}
          {filtered.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              id={`${listId}-${opt.id}`}
              role="option"
              aria-selected={i === active}
              data-suggest-idx={i}
              className={`ims-suggest-option${i === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(opt)}
            >
              <span className="ims-suggest-option-main">
                <span className="ims-suggest-option-label">{opt.label}</span>
                {opt.meta ? <span className="ims-suggest-option-meta">{opt.meta}</span> : null}
              </span>
              {opt.trailing ? <span className="ims-suggest-option-trailing">{opt.trailing}</span> : null}
            </button>
          ))}
        </div>
      </BosPortal>
    ) : null;

  return (
    <div ref={rootRef} className={`ims-suggest${className ? ` ${className}` : ""}`}>
      <div ref={inputWrapRef}>
        <Input
          id={id}
          size={size}
          className={inputClassName}
          value={value}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
          aria-label={aria["aria-label"]}
          aria-invalid={aria["aria-invalid"]}
          aria-describedby={aria["aria-describedby"]}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (openOnFocus) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {panel}
    </div>
  );
}
