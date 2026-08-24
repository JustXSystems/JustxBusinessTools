import type { SessionUser } from "@/lib/types/auth";

/** Who may open the admin console (matches server role matrix adminConsole defaults). */
export function canAccessAdmin(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return user.role === "owner" || user.role === "admin";
}

/**
 * Business Owner (profile creator) may edit Business Profile details.
 * Other roles under the same profile see those details as read-only.
 */
export function canEditBusinessProfile(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return user.role === "owner";
}
