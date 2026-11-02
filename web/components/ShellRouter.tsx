"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { useAuth } from "@/components/auth/AuthProvider";

export function ShellRouter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  if (pathname.startsWith("/admin")) {
    return <AdminShell>{children}</AdminShell>;
  }

  // Public marketing home at `/` — no operator chrome for guests.
  if (pathname === "/" || pathname === "") {
    if (loading || !user) {
      return <ConfigProvider>{children}</ConfigProvider>;
    }
    return <AppShell>{children}</AppShell>;
  }

  // Public pages: no operator chrome / subscription gate (approval links, login, status, standalone BOS / IMS).
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/status") ||
    pathname.startsWith("/q") ||
    pathname === "/bos" ||
    pathname.startsWith("/bos/") ||
    pathname === "/ims" ||
    pathname.startsWith("/ims/")
  ) {
    return (
      <ConfigProvider>
        {children}
      </ConfigProvider>
    );
  }

  return <AppShell>{children}</AppShell>;
}
