"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import { navigationConfig } from "@/config/navigation.config";
import { NotificationDot } from "@/components/layout/NotificationDot";
import { fetchProfile } from "@/lib/api";

export function Header() {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();
  const [businessName, setBusinessName] = useState("");

  useEffect(() => {
    fetchProfile()
      .then((p) => setBusinessName(p.businessName || ""))
      .catch(() => setBusinessName(""));
  }, [pathname, user?.businessProfileId]);

  return (
    <header className="app-topbar no-print">
      <div className="app-topbar-inner">
        <Link href="/" className="brand">
          <div className="brand-text">
            <span className="brand-name">JustX Business Tools</span>
            <span className="brand-sub">JBT</span>
          </div>
        </Link>
        <div className="topbar-spacer" />
        <BranchSwitcher />
        <Link href="/profile" className="topbar-btn">
          <span>🏢</span>
          <span>{businessName || "Business Profile"}</span>
        </Link>
        <Link href="/subscription" className="topbar-icon-btn" aria-label="Subscribe">
          🛒
        </Link>
        {isAdmin ? (
          <Link href="/admin" className="topbar-icon-btn" aria-label="Admin">
            ⚙️
          </Link>
        ) : null}
        <Link
          href="/notifications"
          className="topbar-icon-btn"
          aria-label="Notifications"
          suppressHydrationWarning
        >
          🔔
          <NotificationDot />
        </Link>
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
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
