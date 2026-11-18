import type { NextFunction, Request, Response } from "express";
import { getActiveRole, getRequestContext, isActingAsOrgRole } from "../lib/request-context.js";

/**
 * Business Profile details (including document accent + send channels) may be
 * edited by Business Owner or org Admin. Staff / Viewer are read-only.
 * Platform supers keep access unless they are acting as a limited role.
 */
export async function requireBusinessProfileOwner(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    next();
    return;
  }
  if (ctx.isPlatformAdmin && !isActingAsOrgRole()) {
    res.status(403).json({
      error: "Enter Operator as a Business Profile role first (/enter)",
      code: "NEED_ACT_AS",
    });
    return;
  }
  const role = getActiveRole();
  if (role === "owner" || role === "admin" || role === "legacy") {
    next();
    return;
  }
  res.status(403).json({
    error: "Only the Business Owner or Admin can edit Business Profile details",
  });
}
