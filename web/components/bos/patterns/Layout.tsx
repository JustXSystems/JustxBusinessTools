import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";

/**
 * Frosted top bar; children are laid out space-between. Use `sticky="desktop"` when
 * embedded under a host header that already sticks on phones.
 */
export function Topbar({ children, sticky = "always" }: { children: ReactNode; sticky?: "always" | "desktop" }) {
  return (
    <header className={cx("bos-topbar", sticky === "desktop" && "bos-topbar-sticky-desktop")}>
      <div className="bos-topbar-inner">{children}</div>
    </header>
  );
}

export function Brand({ logoSrc, name, sub }: { logoSrc: string; name: ReactNode; sub?: ReactNode }) {
  return (
    <div className="bos-brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset under the app base path */}
      <img className="bos-brand-mark" src={logoSrc} alt="" />
      <div>
        <div className="bos-brand-name">{name}</div>
        {sub ? <div className="bos-brand-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

export function Hero({ eyebrow, title, lede }: { eyebrow: ReactNode; title: ReactNode; lede?: ReactNode }) {
  return (
    <div className="bos-hero">
      <div className="bos-eyebrow">
        <span className="bos-eyebrow-dot" aria-hidden="true" />
        {eyebrow}
      </div>
      <h1 className="bos-display">{title}</h1>
      {lede ? <p className="bos-lede">{lede}</p> : null}
    </div>
  );
}

/** Numbered documentation section ("04 — Buttons"). */
export function Section({
  id,
  num,
  title,
  description,
  children,
}: {
  id?: string;
  num: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bos-section" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="bos-section-head">
        <div>
          <div className="bos-section-num">{num}</div>
          <h2 className="bos-section-title" id={id ? `${id}-title` : undefined}>
            {title}
          </h2>
        </div>
        {description ? <p className="bos-section-desc">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Responsive equal-column grid; collapses to auto-fit under 900px. */
export function Grid({
  cols = 3,
  template,
  min,
  gap,
  children,
  className,
  style,
}: {
  cols?: number;
  /** Explicit grid-template-columns, e.g. "1.3fr 1fr". */
  template?: string;
  /** Narrowest column (px) once the grid reflows under 900px. Default 200; use ~140 for KPI rows. */
  min?: number;
  gap?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const vars = {
    "--bos-cols": template ?? `repeat(${cols}, minmax(0, 1fr))`,
    ...(min !== undefined ? { "--bos-grid-min": `${min}px` } : null),
    ...(gap !== undefined ? { gap } : null),
    ...style,
  } as CSSProperties;
  return (
    <div className={cx("bos-grid", className)} style={vars}>
      {children}
    </div>
  );
}

export function BlockLabel({ children }: { children: ReactNode }) {
  return <div className="bos-block-label">{children}</div>;
}

export function Footnote({ children }: { children: ReactNode }) {
  return (
    <footer className="bos-footer">
      <div className="bos-footnote">{children}</div>
    </footer>
  );
}
