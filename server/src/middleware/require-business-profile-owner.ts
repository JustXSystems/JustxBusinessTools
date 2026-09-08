import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../lib/request-context.js";

/**
 * Business Profile details (including document accent + send channels) may be
 * edited by Business Owner or org Admin. Staff / Viewer are read-only.
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
  if (ctx.role === "owner" || ctx.role === "admin" || ctx.role === "legacy") {
    next();
    return;
  }
  res.status(403).json({
    error: "Only the Business Owner or Admin can edit Business Profile details",
  });
}
