"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy Branding page → Experience Branding tab */
export default function AdminConfigRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/experience?tab=branding");
  }, [router]);
  return (
    <div className="admin-page">
      <p className="muted">Redirecting to Experience → Branding…</p>
    </div>
  );
}
