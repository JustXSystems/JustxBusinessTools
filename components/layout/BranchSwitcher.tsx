"use client";

import { useAuth } from "@/components/auth/AuthProvider";

export function BranchSwitcher() {
  const { user, switchBranch } = useAuth();

  if (!user || (user.branches?.length ?? 0) <= 1) return null;

  return (
    <label className="branch-switcher">
      <span className="branch-switcher-label">Branch</span>
      <select
        value={user.businessProfileId}
        onChange={(e) => switchBranch(Number(e.target.value))}
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
