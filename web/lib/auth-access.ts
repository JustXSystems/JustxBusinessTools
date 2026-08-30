import type { SessionUser } from "@/lib/types/auth";

/**
 * Who may open `/admin` (full admin console).
 * Hard rule: platform admins and org role `admin` only — not Owner, Staff, or Viewer.
 */
export function canAccessAdmin(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return user.role === "admin";
}

/**
 * Business Owner may edit Business Profile details.
 * Admin / Staff / Viewer under the same profile see those details as read-only.
 */
export function canEditBusinessProfile(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  // Platform admins are not org members of customer profiles — Owner only.
  return user.role === "owner";
}

/** Owner / staff / org admin may run Sync Center and register a desktop agent. */
export function canUseSyncCenter(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === "owner" || user.role === "staff" || user.role === "admin";
}
