"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy UPI page → Payments UPI tab */
export default function AdminUpiRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/payments?tab=upi");
  }, [router]);
  return (
    <div className="admin-page">
      <p className="muted">Redirecting to Payments → UPI…</p>
    </div>
  );
}
