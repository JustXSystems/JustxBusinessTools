"use client";

import { AdminRedirect } from "@/components/admin/AdminRedirect";

/** Legacy Branding page → Experience Branding tab */
export default function AdminConfigRedirectPage() {
  return (
    <AdminRedirect href="/admin/experience?tab=branding" label="Redirecting to Experience → Branding…" />
  );
}
