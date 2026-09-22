"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type ToolPageHeroProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  meta?: ReactNode;
  backHref?: string;
  actions?: ReactNode;
};

/** Corporate tool page header — shared by Quotation V1, Site Survey V1, and future tools. */
export function ToolPageHero({
  title,
  subtitle,
  eyebrow,
  meta,
  backHref = "/",
  actions,
}: ToolPageHeroProps) {
  return (
    <header className="tool-shell-hero">
      <div className="tool-shell-hero-glow" aria-hidden />
      <div className="tool-shell-hero-grid">
        <Link href={backHref} className="back-btn tool-shell-back" aria-label="Back to home">
          ←
        </Link>
        <div className="tool-shell-hero-copy">
          {eyebrow ? <p className="tool-shell-eyebrow">{eyebrow}</p> : null}
          <h1 className="tool-shell-title">{title}</h1>
          {subtitle ? <p className="tool-shell-subtitle">{subtitle}</p> : null}
          {meta ? <div className="tool-shell-meta">{meta}</div> : null}
        </div>
        {actions ? <div className="tool-shell-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
