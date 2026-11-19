"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/bos";

/** Shared legacy-route redirect surface inside AdminShell (already under BosRoot). */
export function AdminRedirect({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);

  return (
    <div className="admin-cc-page" aria-busy="true" aria-label={label}>
      <Skeleton width={220} height={16} radius={6} />
      <div style={{ height: 12 }} />
      <Skeleton width="60%" height={12} radius={4} />
      <p className="bos-text-muted" style={{ marginTop: 14, fontSize: 13 }}>
        {label}
      </p>
    </div>
  );
}
