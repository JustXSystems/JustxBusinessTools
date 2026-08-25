"use client";

import Link from "next/link";
import { NavIcon } from "@/components/layout/NavIcon";

type SidebarSessionFooterProps = {
  onLogout: () => void;
  /** Admin: jump back to the operator app */
  operatorHref?: string;
  mini?: boolean;
};

/**
 * Session exit actions at the bottom of the sidebar — where business users
 * expect “leave / sign out”, with clear icons and labels (not colored dots).
 */
export function SidebarSessionFooter({
  onLogout,
  operatorHref,
  mini = false,
}: SidebarSessionFooterProps) {
  return (
    <div className={`sidebar-session-footer${mini ? " is-mini" : ""}`}>
      {operatorHref ? (
        <Link
          href={operatorHref}
          className="sidebar-session-btn sidebar-session-operator"
          title="Open the operator business app"
          aria-label="Operator app"
        >
          <span className="sidebar-session-icon" aria-hidden="true">
            <NavIcon id="home" />
          </span>
          {!mini ? <span className="sidebar-session-text">Operator app</span> : null}
        </Link>
      ) : null}

      <button
        type="button"
        className="sidebar-session-btn sidebar-session-logout"
        title="Sign out of this session"
        aria-label="Log out"
        onClick={() => onLogout()}
      >
        <span className="sidebar-session-icon" aria-hidden="true">
          <NavIcon id="logout" />
        </span>
        {!mini ? <span className="sidebar-session-text">Log out</span> : null}
      </button>
    </div>
  );
}
