"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConfigProvider } from "@/components/config/ConfigProvider";

export function ShellRouter({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return <AdminShell>{children}</AdminShell>;
  }

  // Public pages: no operator chrome / subscription gate (approval links, login, status).
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/status") ||
    pathname.startsWith("/q")
  ) {
    return (
      <ConfigProvider>
        {children}
      </ConfigProvider>
    );
  }

  return <AppShell>{children}</AppShell>;
}
