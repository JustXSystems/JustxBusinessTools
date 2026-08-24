"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { useAuth } from "@/components/auth/AuthProvider";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import { NavIcon } from "@/components/layout/NavIcon";
import { navigationConfig } from "@/config/navigation.config";

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

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav no-print" aria-label="Primary">
      {navigationConfig.mobileBottom.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""}>
            <span className="bottom-nav-icon">
              <NavIcon id={item.icon} />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
