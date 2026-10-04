"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { BosTheme } from "../tokens";
import { cx } from "../cx";
import { revealInline } from "../scroll";

export type BosSegmentOption<V extends string> = {
  value: V;
  label: ReactNode;
  /** Accessible label when `label` is an icon. */
  ariaLabel?: string;
};

export type BosSegmentedProps<V extends string> = {
  options: ReadonlyArray<BosSegmentOption<V>>;
  value: V;
  onChange: (value: V) => void;
  /** `tabs` for view switchers (role=tablist), `radio` for filters. */
  role?: "tabs" | "radio";
  size?: "md" | "sm";
  /** Horizontal scroll instead of wrapping (long filter sets). */
  scroll?: boolean;
  wrap?: boolean;
  /** Full-width, equal segments (login method switcher). */
  block?: boolean;
  "aria-label"?: string;
  className?: string;
};

/**
 * macOS System Preferences segmented control. Arrow keys move selection
 * (roving tabindex) so it behaves like native tabs / radio groups.
 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  role = "tabs",
  size = "md",
  scroll,
  wrap,
  block,
  className,
  ...aria
}: BosSegmentedProps<V>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    revealInline(rootRef.current, refs.current[activeIndex]);
  }, [activeIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const jump = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
    if (!delta && jump < 0) return;
    e.preventDefault();
    const next = jump >= 0 ? jump : (activeIndex + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const isTabs = role === "tabs";
  return (
    <div
      ref={rootRef}
      role={isTabs ? "tablist" : "radiogroup"}
      aria-label={aria["aria-label"]}
      className={cx(
        "bos-segmented",
        size === "sm" && "bos-segmented-sm",
        scroll && "bos-segmented-scroll",
        wrap && "bos-segmented-wrap",
        block && "bos-segmented-block",
        className,
      )}
      onKeyDown={onKeyDown}
    >
      {options.map((opt, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={isTabs ? "tab" : "radio"}
            aria-selected={isTabs ? active : undefined}
            aria-checked={isTabs ? undefined : active}
            aria-label={opt.ariaLabel}
            tabIndex={active ? 0 : -1}
            className={cx("bos-segment", active && "is-active")}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Light / Dark pill toggle (mono caps), as in the BOS top bar. */
export function ThemeToggle({ theme, onChange }: { theme: BosTheme; onChange: (theme: BosTheme) => void }) {
  return (
    <div className="bos-theme-toggle" role="radiogroup" aria-label="Color theme">
      {(["light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          className={cx(theme === t && "is-active")}
          onClick={() => onChange(t)}
        >
          {t === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}
