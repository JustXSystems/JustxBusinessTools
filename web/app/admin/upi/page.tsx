"use client";

import { AdminRedirect } from "@/components/admin/AdminRedirect";

/** Legacy UPI page → Payments UPI tab */
export default function AdminUpiRedirectPage() {
  return <AdminRedirect href="/admin/payments?tab=upi" label="Redirecting to Payments → UPI…" />;
}
