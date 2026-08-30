"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Settings page removed — redirect legacy bookmarks to Home. */
export default function SettingsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return (
    <div className="empty-state">
      <div className="es-title">Redirecting…</div>
    </div>
  );
}
