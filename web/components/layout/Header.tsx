"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { useAuth } from "@/components/auth/AuthProvider";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import { NavIcon } from "@/components/layout/NavIcon";
import { SidebarAttachmentToggle } from "@/components/layout/SidebarAttachmentToggle";
import { mobileNavForUser, operatorNavForUser, type NavItem } from "@/config/navigation.config";

/** Mobile-only chrome. Desktop navigation lives in the left sidebar. */
export function Header() {
  const { logout } = useAuth();

  return (
    <header className="app-topbar app-topbar-mobile no-print">
      <div className="app-topbar-inner">
        <PlatformBrandMark href="/" size="sm" />
        <div className="topbar-spacer" />
        <BranchSwitcher />
        <button
          type="button"
          className="topbar-logout-btn"
          onClick={() => void logout()}
          title="Log out"
          aria-label="Log out"
        >
          <NavIcon id="logout" />
        </button>
      </div>
    </header>
  );
}

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function BottomNavigation() {
  const pathname = usePathname();
  const { user, isAdmin, logout } = useAuth();
  const items = mobileNavForUser(user);
  const { workspace, account } = operatorNavForUser(user);
  const menuItems: NavItem[] = [
    ...workspace,
    ...account,
    ...(isAdmin ? [{ href: "/admin", label: "Admin Console", icon: "admin" as const }] : []),
  ];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuActive =
    menuOpen || !items.some((item) => isActivePath(pathname, item.href));

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      {menuOpen ? (
        <div className="mobile-menu no-print">
          <button
            type="button"
            className="mobile-menu-backdrop"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="mobile-menu-sheet" role="dialog" aria-label="Menu">
            <div
              className="mobile-menu-layout"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) setMenuOpen(false);
              }}
            >
              <SidebarAttachmentToggle />
            </div>
            <nav className="mobile-menu-list" aria-label="All pages">
              {menuItems.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`mobile-menu-link${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="bottom-nav-icon">
                      <NavIcon id={item.icon} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
              <button
                type="button"
                className="mobile-menu-link mobile-menu-logout"
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
              >
                <span className="bottom-nav-icon">
                  <NavIcon id="logout" />
                </span>
                <span>Log out</span>
              </button>
            </nav>
          </div>
        </div>
      ) : null}
      <nav className="bottom-nav no-print" aria-label="Primary">
        {items.map((item) => {
          const active = !menuOpen && isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "active" : ""}
              onClick={() => setMenuOpen(false)}
            >
              <span className="bottom-nav-icon">
                <NavIcon id={item.icon} />
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`bottom-nav-menu-btn${menuActive ? " active" : ""}`}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="bottom-nav-icon">
            <NavIcon id="menu" />
          </span>
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}
