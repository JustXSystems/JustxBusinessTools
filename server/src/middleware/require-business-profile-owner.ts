import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../lib/request-context.js";

/**
 * Business Profile details (including send channels) may only be edited by the
 * Business Owner (org role `owner`). Admin / Staff / Viewer are read-only.
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
  if (ctx.role === "owner" || ctx.role === "legacy") {
    next();
    return;
  }
  res.status(403).json({
    error: "Only the Business Owner can edit Business Profile details",
  });
}
