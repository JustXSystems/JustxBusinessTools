import type { SessionUser } from "@/lib/types/auth";

/** Who may open the admin console (matches server role matrix adminConsole defaults). */
export function canAccessAdmin(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return user.role === "owner" || user.role === "admin";
}
