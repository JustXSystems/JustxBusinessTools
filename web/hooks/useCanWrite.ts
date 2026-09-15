"use client";

import { useAuth } from "@/components/auth/AuthProvider";
import { canWriteArea } from "@/lib/auth-access";

/**
 * Whether the user may create/edit tool records (quotations, surveys, etc.).
 * Legacy sessions (no login) can write. Viewer may use My Tools (R/W/action)
 * but is blocked from Business Profile / Sync / Email / Notifications menus.
 */
export function useCanWrite(): boolean {
  const { user } = useAuth();
  if (!user) return true;
  return canWriteArea(user, "myTools");
}
