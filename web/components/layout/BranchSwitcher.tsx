"use client";

import { useAuth } from "@/components/auth/AuthProvider";

/**
 * Operator Business Profile switcher for live org users.
 * Platform supers use `/enter` (Impersonate gate) instead of switching here.
 */
export function BranchSwitcher() {
  const { user, switchBranch, isPlatformAdmin } = useAuth();

  if (!user || isPlatformAdmin) return null;
  if ((user.branches?.length ?? 0) <= 1) return null;

  return (
    <label className="branch-switcher">
      <span className="branch-switcher-label">Branch</span>
      <select
        value={user.businessProfileId}
        onChange={(e) => void switchBranch(Number(e.target.value))}
        aria-label="Switch business branch"
      >
        {user.branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.businessName}
            {b.gstin ? ` (${b.gstin})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
