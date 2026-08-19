"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationConfig } from "@/config/navigation.config";

export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="desktop-sidebar no-print" aria-label="Sidebar">
      <nav className="desktop-sidebar-nav">
        {navigationConfig.primary.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
        <Link
          href="/subscription"
          className={pathname.startsWith("/subscription") ? "active" : ""}
        >
          <span>⭐</span>
          <span>Subscription</span>
        </Link>
      </nav>
    </aside>
  );
}
