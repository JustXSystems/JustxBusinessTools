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
 * - Platform super user (`isPlatformAdmin`): Admin Console (`/admin`) always;
 *   Operator menus require `actAsRole` from `/enter` (troubleshooting)
 * - Org Admin: Operator only — Business Profile settings/team like Owner; no `/admin`
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
    adminConsole: "none",
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

function normalizeRole(role: string | null | undefined): OrgRole | null {
  if (!role) return null;
  const key = role.toLowerCase() as OrgRole;
  return ROLE_AREA_ACCESS[key] ? key : null;
}

/** Effective org role for operator menus (honors platform act-as). */
export function effectiveOrgRole(user: SessionUser | null | undefined): OrgRole | null {
  if (!user) return null;
  if (user.isPlatformAdmin && user.actAsRole) {
    return normalizeRole(user.actAsRole);
  }
  return normalizeRole(user.role);
}

export function areaAccessLevel(
  user: SessionUser | null | undefined,
  area: AccessArea,
): AccessLevel {
  if (!user) return "none";
  if (area === "adminConsole") {
    return user.isPlatformAdmin ? "write" : "none";
  }
  // Platform without act-as has no Operator area access (must use /enter).
  if (user.isPlatformAdmin && !user.actAsRole) {
    return "none";
  }
  const role = effectiveOrgRole(user);
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
 * Who may open `/admin` (JBT Admin Console).
 * Platform super users only (`isPlatformAdmin` / PLATFORM_ADMIN_EMAIL).
 * Org Owner / Admin / Staff / Viewer use the operator Business Profile flow.
 * Act-as does not remove Admin Console access.
 */
export function canAccessAdmin(user: SessionUser | null | undefined): boolean {
  return Boolean(user?.isPlatformAdmin);
}

/** Whether this session may manage org team on Business Profile (Owner or org Admin). */
export function canManageBusinessTeam(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin && !user.actAsRole) return false;
  const role = effectiveOrgRole(user);
  return role === "owner" || role === "admin";
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
  if (pathname === "/enter" || pathname.startsWith("/enter/")) return null;
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

/** Platform Impersonate gate route. */
export function isEnterPath(pathname: string): boolean {
  return pathname === "/enter" || pathname.startsWith("/enter/");
}

/**
 * Operator app paths that require an active act-as context for platform supers.
 * Admin Console, Impersonate gate, public/auth, and public proposal links are excluded.
 * Standalone BOS/IMS are included — they share Operator session APIs.
 */
export function isOperatorAppPath(pathname: string): boolean {
  if (!pathname || pathname.startsWith("/admin")) return false;
  if (isEnterPath(pathname)) return false;
  if (pathname.startsWith("/login") || pathname.startsWith("/register")) return false;
  if (pathname.startsWith("/status") || pathname.startsWith("/q/") || pathname === "/q") return false;
  if (pathname.startsWith("/bom/")) return false;
  return true;
}

/** Guest marketing preview while signed in as platform (`/?preview=public`). */
export function isPublicHomePreview(
  pathname: string,
  searchParams?: URLSearchParams | { get(name: string): string | null } | null,
): boolean {
  if (pathname !== "/" && pathname !== "") return false;
  return searchParams?.get("preview") === "public";
}

/** Pathname + query for safe `next=` redirects (drops hash). */
export function pathWithSearch(
  pathname: string,
  searchParams?: URLSearchParams | { toString(): string } | null,
): string {
  const base = pathname || "/";
  const qs =
    searchParams && typeof searchParams.toString === "function"
      ? searchParams.toString()
      : "";
  return qs ? `${base}?${qs}` : base;
}

/**
 * Safe in-app path for login/enter `next=` redirects.
 * Rejects protocol-relative (`//`), backslashes, and absolute URLs.
 * Returns `fallback` when invalid (default `/`).
 */
export function safeAppPath(
  raw: string | null | undefined,
  opts?: { fallback?: string; denyPrefixes?: string[] },
): string {
  const fallback = opts?.fallback ?? "/";
  const deny = opts?.denyPrefixes ?? ["/login", "/register"];
  if (raw == null) return fallback;
  const trimmed = String(raw).trim();
  if (!trimmed) return fallback;
  // Must be a single-site path: /… but not //host or /\host
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }
  if (trimmed.includes("\\") || trimmed.includes("://")) return fallback;
  const pathOnly = (trimmed.split("?")[0] ?? trimmed).split("#")[0] ?? trimmed;
  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//")) return fallback;
  for (const prefix of deny) {
    if (pathOnly === prefix || pathOnly.startsWith(`${prefix}/`)) return fallback;
  }
  return trimmed;
}

/** Live profiles suitable for Operator act-as by default. */
export function isEnterableBranch(branch: {
  approvalStatus?: string;
  archivedAt?: string | null;
}): boolean {
  if (branch.archivedAt) return false;
  const status = String(branch.approvalStatus ?? "approved").toLowerCase();
  return status === "approved";
}

/**
 * Platform supers must pick Business Profile + role on `/enter` before Operator chrome.
 * Live org users are never gated. Public-home preview is exempt.
 */
export function platformNeedsOperatorEnter(
  user: SessionUser | null | undefined,
  pathname: string,
  searchParams?: URLSearchParams | { get(name: string): string | null } | null,
): boolean {
  if (!user?.isPlatformAdmin) return false;
  if (user.actAsRole) return false;
  if (isPublicHomePreview(pathname, searchParams)) return false;
  return isOperatorAppPath(pathname);
}
