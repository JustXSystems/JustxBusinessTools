"use client";

import Link from "next/link";
import { useSidebarLayout } from "@/components/layout/SidebarLayoutProvider";
import type { SidebarAttachment } from "@/lib/sidebar-layout";

const OPTIONS: ReadonlyArray<{
  id: SidebarAttachment;
  label: string;
  hint: string;
}> = [
  { id: "edge", label: "Edge", hint: "Classic resizable sidebar" },
  { id: "floating", label: "Float", hint: "Movable mini dock over content" },
];

type SidebarAttachmentToggleProps = {
  onLogout?: () => void;
  /** Admin: compact Operator app jump as a colored dot. */
  operatorHref?: string;
};

/**
 * Compact chrome: show only the inactive layout mode (Edge ↔ Float) plus actions.
 * Active mode is implied by the sidebar itself — no status label.
 */
export function SidebarAttachmentToggle({
  onLogout,
  operatorHref,
}: SidebarAttachmentToggleProps) {
  const { attachment, setAttachment } = useSidebarLayout();
  const alternatives = OPTIONS.filter((o) => o.id !== attachment);
  const hasActions = Boolean(onLogout || operatorHref);

  return (
    <div
      className="sidebar-attach-toggle"
      role="group"
      aria-label="Sidebar chrome"
    >
      {alternatives.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          className={`sidebar-attach-btn sidebar-attach-${id}`}
          title={`Switch to ${label} — ${hint}`}
          aria-label={`Switch to ${label}`}
          onClick={() => setAttachment(id)}
        >
          <span className="sidebar-attach-dot" aria-hidden="true" />
          <span className="sidebar-attach-label">{label}</span>
        </button>
      ))}

      {hasActions ? <span className="sidebar-attach-sep" aria-hidden="true" /> : null}

      {operatorHref ? (
        <Link
          href={operatorHref}
          className="sidebar-attach-btn sidebar-attach-operator"
          title="Operator — Open the operator app"
          aria-label="Operator app"
        >
          <span className="sidebar-attach-dot" aria-hidden="true" />
          <span className="sidebar-attach-label">Operator</span>
        </Link>
      ) : null}

      {onLogout ? (
        <button
          type="button"
          className="sidebar-attach-btn sidebar-attach-logout"
          title="Log out — Sign out of this session"
          aria-label="Log out"
          onClick={() => onLogout()}
        >
          <span className="sidebar-attach-dot" aria-hidden="true" />
          <span className="sidebar-attach-label">Log out</span>
        </button>
      ) : null}
    </div>
  );
}
