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
 * `/api/admin/*` — Justxsystems platform super users only.
 * Org Owner / Admin / Staff / Viewer use Business Profile / operator APIs instead.
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
  if (ctx.isPlatformAdmin) {
    next();
    return;
  }
  res.status(403).json({
    error: "JBT Admin Console requires a Justxsystems platform super user",
  });
}
