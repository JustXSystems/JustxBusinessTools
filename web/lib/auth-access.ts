import type { SessionUser } from "@/lib/types/auth";

/**
 * Who may open `/admin` (full admin console).
 * - JustX platform admins (`isPlatformAdmin` / PLATFORM_ADMIN_EMAIL)
 * - Org role `admin` only — not Owner, Staff, or Viewer
 *
 * Note: Business Profile Owner does not get Admin Console. To operate JustX platform
 * tooling, use a platform-admin email (e.g. admin@justxsystems.com) or set is_platform_admin.
 * Elevating the sole Owner to org role Admin is blocked (cannot demote last owner).
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
