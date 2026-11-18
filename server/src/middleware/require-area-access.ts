import type { NextFunction, Request, Response } from "express";
import { getRequestContext, type OrgRole } from "../lib/request-context.js";

/** Areas that map to Operator / Admin Console menu access. */
export type AccessArea =
  | "syncCenter"
  | "emailOutbox"
  | "businessProfileWrite"
  | "adminConsole";

const AREA_ROLES: Record<AccessArea, ReadonlySet<OrgRole | "platform">> = {
  // Owner (+ Admin full access). Staff/Viewer denied per role hierarchy.
  // Platform supers use act-as role (not a bare "platform" shortcut).
  syncCenter: new Set(["owner", "admin"]),
  // Owner + Staff (+ Admin). Viewer denied.
  emailOutbox: new Set(["owner", "staff", "admin"]),
  businessProfileWrite: new Set(["owner", "admin"]),
  // Platform super users only — org Admin uses Business Profile, not /admin.
  adminConsole: new Set(["platform"]),
};

function roleAllowed(
  area: AccessArea,
  role: string | null | undefined,
  isPlatformAdmin: boolean,
  actAsRole: OrgRole | null | undefined,
): boolean {
  const allowed = AREA_ROLES[area];
  if (area === "adminConsole") {
    return Boolean(isPlatformAdmin && allowed.has("platform"));
  }
  // Platform supers must act-as an org role for operator areas (see /enter).
  if (isPlatformAdmin && !actAsRole) return false;
  if (!role || role === "legacy") return true; // legacy / auth-off sessions
  return allowed.has(role as OrgRole);
}

/**
 * Require the session role to include the given operator area.
 * Agent Bearer tokens bypass (already profile-scoped).
 * Platform act-as uses the simulated role for operator areas; Admin Console ignores act-as.
 */
export function requireAreaAccess(area: AccessArea) {
  return function requireAreaAccessMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ctx = getRequestContext();
    if (!ctx?.userId) {
      // Unauthenticated handled elsewhere; allow legacy through.
      next();
      return;
    }
    if (ctx.viaAgentToken) {
      next();
      return;
    }
    if (roleAllowed(area, ctx.role, ctx.isPlatformAdmin, ctx.actAsRole ?? null)) {
      next();
      return;
    }
    const messages: Record<AccessArea, string> = {
      syncCenter: "Sync Center access requires Business Owner or Admin",
      emailOutbox: "Email Outbox access requires Owner, Staff, or Admin",
      businessProfileWrite: "Only the Business Owner or Admin can edit Business Profile",
      adminConsole: "JBT Admin Console requires a Justxsystems platform super user",
    };
    res.status(403).json({ error: messages[area] });
  };
}
