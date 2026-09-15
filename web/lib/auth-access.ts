import type { SessionUser } from "@/lib/types/auth";

export type OrgRole = "owner" | "admin" | "staff" | "viewer";

/** Operator / console areas used for nav + route guards. */
export type AccessArea =
  | "home"
  | "businessProfile"
  | "syncCenter"
  | "emailOutbox"
  | "notifications"
  | "myTools"
  | "adminConsole";

export type AccessLevel = "none" | "read" | "write";

/**
 * Role hierarchy (Operator View vs Admin Console):
 *
 * - Admin: full access; Admin Console only; default landing = Admin Console
 * - Owner: Operator only; R/W Home, Business Profile, Sync Center, Email Outbox,
 *   Notifications, My Tools; scoped to their Business Profile
 * - Staff: Operator only; Home(read), Business Profile(read), Email Outbox(write),
 *   Notifications(read), My Tools(write); no Sync Center / Admin Console
 * - Viewer: Operator only; Home(read), My Tools(write); no Admin Console
 */
const ROLE_AREA_ACCESS: Record<OrgRole, Record<AccessArea, AccessLevel>> = {
  admin: {
    home: "write",
    businessProfile: "write",
    syncCenter: "write",
    emailOutbox: "write",
    notifications: "write",
    myTools: "write",
    adminConsole: "write",
  },
  owner: {
    home: "write",
    businessProfile: "write",
    syncCenter: "write",
    emailOutbox: "write",
    notifications: "write",
    myTools: "write",
    adminConsole: "none",
  },
  staff: {
    home: "read",
    businessProfile: "read",
    syncCenter: "none",
    emailOutbox: "write",
    notifications: "read",
    myTools: "write",
    adminConsole: "none",
  },
  viewer: {
    home: "read",
    businessProfile: "none",
    syncCenter: "none",
    emailOutbox: "none",
    notifications: "none",
    myTools: "write",
    adminConsole: "none",
  },
};

function normalizeRole(user: SessionUser | null | undefined): OrgRole | null {
  if (!user?.role) return null;
  const role = user.role.toLowerCase() as OrgRole;
  return ROLE_AREA_ACCESS[role] ? role : null;
}

export function areaAccessLevel(
  user: SessionUser | null | undefined,
  area: AccessArea,
): AccessLevel {
  if (!user) return "none";
  if (user.isPlatformAdmin) {
    return area === "adminConsole" ? "write" : "write";
  }
  const role = normalizeRole(user);
  if (!role) return "none";
  return ROLE_AREA_ACCESS[role][area];
}

export function canAccessArea(
  user: SessionUser | null | undefined,
  area: AccessArea,
): boolean {
  return areaAccessLevel(user, area) !== "none";
}

export function canWriteArea(
  user: SessionUser | null | undefined,
  area: AccessArea,
): boolean {
  return areaAccessLevel(user, area) === "write";
}

/**
 * Who may open `/admin` (full admin console).
 * - JustX platform admins (`isPlatformAdmin` / PLATFORM_ADMIN_EMAIL)
 * - Org role `admin` only — not Owner, Staff, or Viewer
 */
export function canAccessAdmin(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return user.role === "admin";
}

/** Business Owner or org Admin may edit Business Profile details. */
export function canEditBusinessProfile(user: SessionUser | null | undefined): boolean {
  return canWriteArea(user, "businessProfile");
}

/** Owner / org admin may open Sync Center (Staff and Viewer cannot). */
export function canUseSyncCenter(user: SessionUser | null | undefined): boolean {
  return canAccessArea(user, "syncCenter");
}

/** Owner / Staff / Admin may manage Email Outbox. */
export function canUseEmailOutbox(user: SessionUser | null | undefined): boolean {
  return canAccessArea(user, "emailOutbox");
}

/** Owner / Staff / Admin may open Notifications. */
export function canViewNotifications(user: SessionUser | null | undefined): boolean {
  return canAccessArea(user, "notifications");
}

/** Map an operator pathname to an access area (null = no area gate). */
export function accessAreaForPath(pathname: string): AccessArea | null {
  if (pathname.startsWith("/admin")) return "adminConsole";
  if (pathname === "/" || pathname === "") return "home";
  if (pathname.startsWith("/profile")) return "businessProfile";
  if (pathname.startsWith("/sync")) return "syncCenter";
  if (pathname.startsWith("/email-outbox")) return "emailOutbox";
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/subscription")) return "myTools";
  if (pathname.startsWith("/tools")) return "myTools";
  return null;
}

/** Whether the signed-in user may open this operator/admin path. */
export function canAccessPath(
  user: SessionUser | null | undefined,
  pathname: string,
): boolean {
  const area = accessAreaForPath(pathname);
  if (!area) return true;
  return canAccessArea(user, area);
}
