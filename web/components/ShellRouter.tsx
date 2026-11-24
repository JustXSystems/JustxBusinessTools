"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { isPublicHomePreview } from "@/lib/auth-access";

export function ShellRouter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();

  if (pathname.startsWith("/admin")) {
    return <AdminShell>{children}</AdminShell>;
  }

  // Public marketing home at `/` — guests, or platform `?preview=public`.
  if (pathname === "/" || pathname === "") {
    if (loading || !user || isPublicHomePreview(pathname, searchParams)) {
      return <ConfigProvider>{children}</ConfigProvider>;
    }
    return <AppShell>{children}</AppShell>;
  }

  // Public / gate pages: no operator chrome (login, Impersonate gate, status, standalone BOS / IMS).
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname === "/enter" ||
    pathname.startsWith("/enter/") ||
    pathname.startsWith("/status") ||
    pathname.startsWith("/q") ||
    pathname.startsWith("/bom/proposal") ||
    pathname === "/bos" ||
    pathname.startsWith("/bos/") ||
    pathname === "/ims" ||
    pathname.startsWith("/ims/") ||
    pathname === "/pinway" ||
    pathname.startsWith("/pinway/")
  ) {
    return (
      <ConfigProvider>
        {children}
      </ConfigProvider>
    );
  }

  return <AppShell>{children}</AppShell>;
}
