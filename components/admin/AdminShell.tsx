"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { NavIcon } from "@/components/layout/NavIcon";
import { FloatingNavDock } from "@/components/layout/FloatingNavDock";
import { SidebarLayoutProvider, useSidebarLayout } from "@/components/layout/SidebarLayoutProvider";
import { SidebarResizeHandle } from "@/components/layout/SidebarResizeHandle";
import {
  adminNavigation,
  type AdminNavItem,
} from "@/config/admin-navigation.config";
import { ADMIN_SIDEBAR_KEY } from "@/lib/sidebar-layout";

function isActive(pathname: string, item: AdminNavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function initials(name: string | null | undefined, email: string | undefined) {
  const raw = (name || email || "?").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return raw.slice(0, 2).toUpperCase();
}

function AdminNavLink({
  item,
  active,
  mini,
}: {
  item: AdminNavItem;
  active: boolean;
  mini: boolean;
}) {
  return (
    <Link
      href={item.href}
      className={`ds-nav-link${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      title={item.label}
      aria-label={item.label}
    >
      <span className={`ds-nav-icon${active && mini ? " is-glow" : ""}`}>
        <NavIcon id={item.icon} />
      </span>
      <span className="ds-nav-label">{item.label}</span>
    </Link>
  );
}

function AdminShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { mode, density, width, dragging } = useSidebarLayout();
  const mini = density === "mini";
  const compact = density === "docked";
  const floating = mode === "floating";

  const roleLabel = user?.isPlatformAdmin
    ? "Platform super admin"
    : user?.role
      ? `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`
      : "Admin";

  const floatItems = adminNavigation.flatMap((section) =>
    section.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      active: isActive(pathname, item),
    })),
  );

  return (
    <div
      className="admin-shell"
      data-sidebar-mode={mode}
      data-sidebar-density={density}
      data-sidebar-dragging={dragging ? "1" : "0"}
      style={floating ? undefined : { ["--sidebar-rail" as string]: `${width}px` }}
    >
      {floating ? (
        <FloatingNavDock
          homeHref="/admin"
          items={floatItems}
          footer={
            <>
              <Link
                href="/"
                className="float-dock-item"
                aria-label="Operator app"
                title="Operator app"
              >
                <span className="float-dock-icon">
                  <NavIcon id="arrowLeft" />
                </span>
              </Link>
              <button
                type="button"
                className="float-dock-item"
                aria-label="Log out"
                title="Log out"
                onClick={() => logout()}
              >
                <span className="float-dock-icon">
                  <NavIcon id="logout" />
                </span>
              </button>
            </>
          }
        />
      ) : (
        <aside
          className={`admin-sidebar no-print sidebar-mode-${mode}`}
          aria-label="Admin sidebar"
          data-sidebar-mode={mode}
          data-sidebar-density={density}
        >
          <SidebarResizeHandle variant="admin" />

          <div className="admin-brand">
            <div className="admin-brand-panel">
              <PlatformBrandMark
                href="/admin"
                size="md"
                layout="row"
                showText={!mini}
                className="admin-brand-mark"
              />
              {!mini ? (
                <div className="admin-brand-meta">
                  {!compact ? <span className="admin-brand-eyebrow">Control center</span> : null}
                  <div className="admin-brand-status">
                    <span className="admin-brand-status-dot" aria-hidden="true" />
                    <span className="admin-brand-pill">{roleLabel}</span>
                  </div>
                  {!compact ? (
                    user?.organizationName && !user?.isPlatformAdmin ? (
                      <span className="admin-brand-org">{user.organizationName}</span>
                    ) : (
                      <span className="admin-brand-org">Enterprise administration</span>
                    )
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <nav className="admin-nav" aria-label="Admin">
            {adminNavigation.map((section) => (
              <div key={section.id} className="ds-nav-section">
                {!mini && !compact ? (
                  <p className="ds-nav-section-label">{section.label}</p>
                ) : null}
                {section.items.map((item) => (
                  <AdminNavLink
                    key={item.href}
                    item={item}
                    mini={mini}
                    active={isActive(pathname, item)}
                  />
                ))}
              </div>
            ))}
          </nav>

          <div className="admin-sidebar-footer">
            <div className="ds-user-card admin-user-card" title={user?.email || "Admin"}>
              <span className="ds-user-avatar" aria-hidden="true">
                {initials(user?.name, user?.email)}
              </span>
              <span className="ds-user-meta">
                <span className="ds-user-name">{user?.name || user?.email || "Admin"}</span>
                <span className="ds-user-org">{user?.email}</span>
              </span>
            </div>

            {!mini ? (
              <div className="admin-footer-actions">
                <Link href="/" className="admin-footer-btn">
                  <NavIcon id="arrowLeft" />
                  <span>Operator app</span>
                </Link>
                <button type="button" className="admin-footer-btn" onClick={() => logout()}>
                  <NavIcon id="logout" />
                  <span>Log out</span>
                </button>
              </div>
            ) : (
              <div className="admin-footer-actions admin-footer-actions-mini">
                <Link href="/" className="admin-footer-btn" title="Operator app" aria-label="Operator app">
                  <NavIcon id="arrowLeft" />
                </Link>
                <button
                  type="button"
                  className="admin-footer-btn"
                  onClick={() => logout()}
                  title="Log out"
                  aria-label="Log out"
                >
                  <NavIcon id="logout" />
                </button>
              </div>
            )}
          </div>
        </aside>
      )}

      <div className="admin-main">
        <header className="admin-topbar no-print">
          <div className="admin-topbar-copy">
            <p className="admin-topbar-kicker">Control center</p>
            <h1>Platform administration</h1>
          </div>
          <span className="admin-user-chip">
            <span className="admin-user-chip-dot" aria-hidden="true" />
            {user?.email}
          </span>
        </header>
        <div className="admin-content">{children}</div>
        <PoweredByFooter variant="bar" />
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <SidebarLayoutProvider storageKey={ADMIN_SIDEBAR_KEY}>
        <AdminShellInner>{children}</AdminShellInner>
      </SidebarLayoutProvider>
    </ConfigProvider>
  );
}
