"use client";

import { AdminRedirect } from "@/components/admin/AdminRedirect";

/** Legacy Theme page → Experience Theme tab */
export default function AdminThemeRedirectPage() {
  return <AdminRedirect href="/admin/experience?tab=theme" label="Redirecting to Experience → Theme…" />;
}
