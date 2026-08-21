"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";

const NAV = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/approvals", label: "Approvals" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/profiles", label: "Business profiles" },
  { href: "/admin/tools", label: "Tools" },
  { href: "/admin/team", label: "Users" },
  { href: "/admin/subscriptions", label: "Plans & entitlements" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/gateways", label: "Gateways" },
  { href: "/admin/experience", label: "Experience" },
  { href: "/admin/audit", label: "Audit" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <ConfigProvider>
      <div className="admin-shell">
      <aside className="admin-sidebar no-print">
        <div className="admin-brand">
          <PlatformBrandMark href="/admin" size="md" layout="stack" />
          <span className="brand-sub admin-brand-role">
            {user?.isPlatformAdmin ? "Platform super admin" : user?.organizationName}
          </span>
        </div>
        <nav className="admin-nav">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="admin-sidebar-footer">
          <Link href="/" className="btn btn-ghost btn-sm">← Operator app</Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
            Log out
          </button>
          <PoweredByFooter />
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar no-print">
          <h1>Platform administration</h1>
          <span className="admin-user">{user?.email}</span>
        </header>
        <div className="admin-content">{children}</div>
      </div>
    </div>
    </ConfigProvider>
  );
}
