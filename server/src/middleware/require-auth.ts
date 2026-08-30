import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../lib/request-context.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/**
 * `/api/admin/*` — platform admins and org role `admin` only.
 * Owner / Staff / Viewer are denied (Business Owner uses Business Profile instead).
 */
export async function requireAdminRole(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (ctx.isPlatformAdmin || ctx.role === "admin") {
    next();
    return;
  }
  res.status(403).json({ error: "Admin access required — Admin role only" });
}
