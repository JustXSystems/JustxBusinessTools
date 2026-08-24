"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { useAuth } from "@/components/auth/AuthProvider";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import { FloatingNavDock } from "@/components/layout/FloatingNavDock";
import { SidebarAttachmentToggle } from "@/components/layout/SidebarAttachmentToggle";
import { SidebarIdentityChip } from "@/components/layout/SidebarIdentityChip";
import { SidebarResizeHandle } from "@/components/layout/SidebarResizeHandle";
import { useSidebarLayout } from "@/components/layout/SidebarLayoutProvider";
import { navigationConfig, type NavItem } from "@/config/navigation.config";
import { NavIcon } from "@/components/layout/NavIcon";
import { NotificationDot } from "@/components/layout/NotificationDot";
import { useSubscriptionContext } from "@/components/subscription/SubscriptionProvider";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLink({
  item,
  active,
  badge,
  mini,
}: {
  item: NavItem;
  active: boolean;
  badge?: ReactNode;
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
      {badge}
    </Link>
  );
}

export function DesktopSidebar() {
  const pathname = usePathname();
  const { user, isAdmin, logout } = useAuth();
  const { subscription, isUnlimited, isPro } = useSubscriptionContext();
  const { mode, density } = useSidebarLayout();
  const mini = density === "mini";
  const compact = density === "docked";
  const floating = mode === "floating";

  const planLabel =
    subscription?.planName ||
    (isUnlimited || isPro ? "Unlimited" : subscription?.planId ? "Plan" : "Free");

  const floatItems = [
    ...navigationConfig.workspace.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      active: isActive(pathname, item.href),
      badge:
        item.icon === "notifications" ? (
          <span className="ds-nav-badge-slot">
            <NotificationDot />
          </span>
        ) : undefined,
    })),
    ...navigationConfig.account.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      active: isActive(pathname, item.href),
    })),
    ...(isAdmin
      ? [
          {
            href: "/admin",
            label: "Admin Console",
            icon: "admin" as const,
            active: pathname.startsWith("/admin"),
          },
        ]
      : []),
  ];

  if (floating) {
    return (
      <FloatingNavDock
        homeHref="/"
        items={floatItems}
        footer={
          <button
            type="button"
            className="float-dock-item float-dock-logout"
            aria-label="Log out"
            title="Log out"
            onClick={() => void logout()}
          >
            <span className="float-dock-icon">
              <NavIcon id="logout" />
            </span>
          </button>
        }
      />
    );
  }

  return (
    <aside
      className={`desktop-sidebar no-print sidebar-mode-${mode}`}
      aria-label="Sidebar"
      data-sidebar-mode={mode}
      data-sidebar-density={density}
    >
      <SidebarResizeHandle variant="operator" />

      <div className="desktop-sidebar-brand">
        <div className="ds-brand-panel">
          <PlatformBrandMark
            href="/"
            size="md"
            layout="row"
            showText={!mini}
            className="ds-brand-mark"
          />
          {!mini ? (
            <>
              <div className="ds-brand-meta">
                {!compact ? <span className="ds-brand-eyebrow">Workspace</span> : null}
                <div className="ds-brand-status">
                  <span className="ds-brand-status-dot" aria-hidden="true" />
                  <span className="ds-brand-pill">{planLabel}</span>
                </div>
                {!compact ? (
                  <span className="ds-brand-org">
                    {user?.organizationName || "Your business workspace"}
                  </span>
                ) : null}
              </div>
              {!compact ? <BranchSwitcher /> : null}
            </>
          ) : null}

          <div className={`ds-brand-account${mini ? " is-mini" : ""}`}>
            <SidebarIdentityChip
              name={user?.name}
              email={user?.email}
              mini={mini}
            />
            <SidebarAttachmentToggle onLogout={() => void logout()} />
          </div>
        </div>
      </div>

      <nav className="desktop-sidebar-nav" aria-label="Primary">
        <div className="ds-nav-section">
          {!mini && !compact ? <p className="ds-nav-section-label">Workspace</p> : null}
          {navigationConfig.workspace.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              mini={mini}
              active={isActive(pathname, item.href)}
              badge={
                item.icon === "notifications" ? (
                  <span className="ds-nav-badge-slot">
                    <NotificationDot />
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>

        <div className="ds-nav-section">
          {!mini && !compact ? <p className="ds-nav-section-label">Account</p> : null}
          {navigationConfig.account.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              mini={mini}
              active={isActive(pathname, item.href)}
            />
          ))}
          {isAdmin ? (
            <NavLink
              item={{ href: "/admin", label: "Admin Console", icon: "admin" }}
              mini={mini}
              active={pathname.startsWith("/admin")}
            />
          ) : null}
        </div>
      </nav>
    </aside>
  );
}
