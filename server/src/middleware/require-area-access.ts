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
  syncCenter: new Set(["owner", "admin", "platform"]),
  // Owner + Staff (+ Admin). Viewer denied.
  emailOutbox: new Set(["owner", "staff", "admin", "platform"]),
  businessProfileWrite: new Set(["owner", "admin", "platform"]),
  adminConsole: new Set(["admin", "platform"]),
};

function roleAllowed(area: AccessArea, role: string | null | undefined, isPlatformAdmin: boolean): boolean {
  const allowed = AREA_ROLES[area];
  if (isPlatformAdmin && allowed.has("platform")) return true;
  if (!role || role === "legacy") return true; // legacy / auth-off sessions
  return allowed.has(role as OrgRole);
}

/**
 * Require the session role to include the given operator area.
 * Agent Bearer tokens bypass (already profile-scoped).
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
    if (roleAllowed(area, ctx.role, ctx.isPlatformAdmin)) {
      next();
      return;
    }
    const messages: Record<AccessArea, string> = {
      syncCenter: "Sync Center access requires Business Owner or Admin",
      emailOutbox: "Email Outbox access requires Owner, Staff, or Admin",
      businessProfileWrite: "Only the Business Owner or Admin can edit Business Profile",
      adminConsole: "Admin access required — Admin role only",
    };
    res.status(403).json({ error: messages[area] });
  };
}
