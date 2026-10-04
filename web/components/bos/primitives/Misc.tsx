"use client";

import { Fragment, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { formatBosClock } from "@/lib/bos/clock";
import { cx } from "../cx";

export function FilterChip({
  active,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type={type} aria-pressed={active} className={cx("bos-filter-chip", active && "is-active", className)} {...rest} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="bos-kbd">{children}</kbd>;
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Live clock pill (`Mon 27 Jul · 08:17`) with the emerald "online" dot. */
export function TimePill({ className }: { className?: string }) {
  const now = useNow(1000);
  return (
    <span className={cx("bos-time-pill", className)} aria-live="off">
      <span className="bos-time-pill-dot" aria-hidden="true" />
      <time dateTime={now.toISOString()}>{formatBosClock(now)}</time>
    </span>
  );
}

export type BosCrumb = { label: ReactNode; onClick?: () => void; href?: string };

export function Breadcrumbs({ items }: { items: BosCrumb[] }) {
  return (
    <nav className="bos-breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {last ? (
              <span className="bos-breadcrumbs-current" aria-current="page">
                {item.label}
              </span>
            ) : item.href ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <button type="button" onClick={item.onClick}>
                {item.label}
              </button>
            )}
            {!last ? (
              <span className="bos-breadcrumbs-sep" aria-hidden="true">
                ›
              </span>
            ) : null}
          </Fragment>
        );
      })}
    </nav>
  );
}
