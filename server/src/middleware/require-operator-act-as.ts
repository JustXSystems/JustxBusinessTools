import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../lib/request-context.js";

/**
 * Paths platform supers may call without an Operator act-as context.
 * Everything else under /api is Operator-scoped and requires actAsRole.
 */
function isExemptFromOperatorActAs(path: string): boolean {
  if (path === "/api/health" || path.startsWith("/api/health/")) return true;
  if (path.startsWith("/api/auth")) return true;
  if (path.startsWith("/api/admin")) return true;
  if (path.startsWith("/api/public")) return true;
  if (path.startsWith("/api/webhooks")) return true;
  if (path.startsWith("/api/config")) return true;
  if (path.startsWith("/api/files")) return true;
  return false;
}

/**
 * Hard gate: platform supers must pick Business Profile + role on `/enter`
 * before Operator APIs. Admin Console, auth, public, and config stay open.
 * Live org users are never affected.
 */
export function requireOperatorActAs(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isExemptFromOperatorActAs(req.path)) {
    next();
    return;
  }
  const ctx = getRequestContext();
  if (!ctx?.userId || !ctx.isPlatformAdmin) {
    next();
    return;
  }
  if (ctx.viaAgentToken) {
    next();
    return;
  }
  if (ctx.actAsRole) {
    next();
    return;
  }
  res.status(403).json({
    error: "Enter Operator as a Business Profile role first (/enter)",
    code: "NEED_ACT_AS",
  });
}
