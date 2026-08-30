"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy Theme page → Experience Theme tab */
export default function AdminThemeRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/experience?tab=theme");
  }, [router]);
  return (
    <div className="admin-page">
      <p className="muted">Redirecting to Experience → Theme…</p>
    </div>
  );
}
