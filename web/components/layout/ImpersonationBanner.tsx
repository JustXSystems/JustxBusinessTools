"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

/** Platform-only strip while enacting an org role in the Operator app. */
export function ImpersonationBanner() {
  const { user, isPlatformAdmin, setOperatorContext } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!isPlatformAdmin || !user?.actAsRole) return null;

  const branch = user.branches?.find((b) => b.id === user.businessProfileId);
  const profileLabel = branch
    ? `${branch.organizationName ? `${branch.organizationName} — ` : ""}${branch.businessName}`
    : `Profile #${user.businessProfileId}`;

  async function exit() {
    setBusy(true);
    try {
      await setOperatorContext(user!.businessProfileId, null);
      router.replace("/admin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="impersonation-banner no-print" role="status">
      <div className="impersonation-banner-inner">
        <p>
          Impersonating <strong>{user.actAsRole}</strong>
          <span className="muted"> · {profileLabel}</span>
        </p>
        <div className="admin-form-row">
          <Link href="/enter" className="btn btn-ghost btn-sm">
            Change
          </Link>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void exit()}
          >
            {busy ? "Exiting…" : "Exit to Admin"}
          </button>
        </div>
      </div>
    </div>
  );
}
