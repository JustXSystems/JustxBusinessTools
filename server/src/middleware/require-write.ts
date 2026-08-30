import type { NextFunction, Request, Response } from "express";
import { userHasBranchAccess } from "../lib/auth/branch-access.js";
import { roleAllows } from "../lib/roles/matrix.js";
import { getRequestContext } from "../lib/request-context.js";

/** Block roles without writeRecords (default: viewer). Legacy (no session) remains writable. */
export async function requireWriteAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    next();
    return;
  }
  try {
    const ok = await roleAllows(ctx.role, "writeRecords");
    if (!ok) {
      res.status(403).json({ error: "Read-only access — this role cannot modify data" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Ensure authenticated staff can only access granted branches. */
export async function requireBranchAccess(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    next();
    return;
  }

  try {
    const ok = await userHasBranchAccess(ctx.userId!, ctx.businessProfileId, ctx.role);
    if (!ok) {
      res.status(403).json({ error: "No access to this business branch" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
