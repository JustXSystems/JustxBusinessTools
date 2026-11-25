import { GSTIN_RE } from "@/lib/register-gstin";
import type { SessionUser } from "@/lib/types/auth";

/** Valid Indian GSTIN (15 chars). */
export function hasValidGstin(value: string | null | undefined): boolean {
  return GSTIN_RE.test(String(value ?? "").trim().toUpperCase());
}

/** Active branch GSTIN for the signed-in session. */
export function activeBranchGstin(user: SessionUser | null | undefined): string | null {
  if (!user) return null;
  const branch = user.branches?.find((b) => b.id === user.businessProfileId);
  return branch?.gstin ?? null;
}

/**
 * Personal (individual) workspace: active branch exists and has no valid GSTIN.
 * Business users with a valid GSTIN keep the full tool catalog and operator menus.
 * If the session has no branch row yet, we do not assume personal (avoids locking down
 * incomplete sessions / unit fixtures).
 */
export function isPersonalAccount(
  user: SessionUser | null | undefined,
  profileGstin?: string | null,
): boolean {
  if (!user) return false;
  if (hasValidGstin(profileGstin)) return false;
  const branch = user.branches?.find((b) => b.id === user.businessProfileId);
  if (!branch) return false;
  return !hasValidGstin(branch.gstin);
}
