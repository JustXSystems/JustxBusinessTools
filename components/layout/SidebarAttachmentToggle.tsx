"use client";

import { useSidebarLayout } from "@/components/layout/SidebarLayoutProvider";
import type { SidebarAttachment } from "@/lib/sidebar-layout";

const OPTIONS: ReadonlyArray<{
  id: SidebarAttachment;
  label: string;
  shortLabel: string;
  hint: string;
}> = [
  {
    id: "edge",
    label: "Sidebar",
    shortLabel: "Side",
    hint: "Full menu beside the page",
  },
  {
    id: "floating",
    label: "Float",
    shortLabel: "Float",
    hint: "Compact floating menu over the page",
  },
];

function LayoutIcon({ id }: { id: SidebarAttachment }) {
  if (id === "floating") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="8" y="5" width="12" height="14" rx="2" />
        <path d="M5 8v11a2 2 0 0 0 2 2h9" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

type SidebarAttachmentToggleProps = {
  /** Compact / icon-rail: shorter labels */
  mini?: boolean;
};

/**
 * Layout mode as labeled pills (not macOS traffic-light dots).
 * Both options stay visible so non-technical users can see Sidebar vs Float.
 */
export function SidebarAttachmentToggle({ mini = false }: SidebarAttachmentToggleProps) {
  const { attachment, setAttachment } = useSidebarLayout();

  return (
    <div
      className={`sidebar-layout-pills${mini ? " is-mini" : ""}`}
      role="group"
      aria-label="Menu layout"
    >
      {!mini ? <span className="sidebar-layout-pills-label">Menu layout</span> : null}
      <div className="sidebar-layout-pills-track">
        {OPTIONS.map(({ id, label, shortLabel, hint }) => {
          const active = attachment === id;
          return (
            <button
              key={id}
              type="button"
              className={`sidebar-layout-pill${active ? " is-active" : ""}`}
              aria-pressed={active}
              title={hint}
              aria-label={`${label} — ${hint}`}
              onClick={() => setAttachment(id)}
            >
              <span className="sidebar-layout-pill-icon">
                <LayoutIcon id={id} />
              </span>
              <span className="sidebar-layout-pill-text">{mini ? shortLabel : label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
