"use client";

import { useId, useState, type ReactNode } from "react";

type Props = {
  title: ReactNode;
  /** One-line description shown under the title (visible while collapsed). */
  hint?: ReactNode;
  /** Status chip on the header, e.g. "On" or "2 pending". */
  badge?: ReactNode;
  badgeTone?: "default" | "accent" | "warn";
  /** Controlled open state; omit to let the section manage it (collapsed by default). */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
};

/**
 * Panel with a full-width header button. Body stays mounted while collapsed so
 * in-progress edits and child state survive toggling.
 */
export function CollapsibleSection({
  title,
  hint,
  badge,
  badgeTone = "default",
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: Props) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const isOpen = open ?? innerOpen;
  const headId = useId();
  const bodyId = useId();

  function toggle() {
    const next = !isOpen;
    if (open === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  }

  return (
    <section
      className={`panel collapsible-section${isOpen ? " is-open" : ""}${className ? ` ${className}` : ""}`}
    >
      <h3 className="collapsible-section-heading">
        <button
          type="button"
          id={headId}
          className="collapsible-section-toggle"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span className="collapsible-section-text">
            <span className="collapsible-section-title">{title}</span>
            {hint ? <span className="collapsible-section-hint">{hint}</span> : null}
          </span>
          {badge ? (
            <span className={`collapsible-section-badge is-${badgeTone}`}>{badge}</span>
          ) : null}
          <span className="collapsible-section-chevron" aria-hidden />
        </button>
      </h3>
      <div
        id={bodyId}
        role="region"
        aria-labelledby={headId}
        className="collapsible-section-body"
        hidden={!isOpen}
      >
        {children}
      </div>
    </section>
  );
}
