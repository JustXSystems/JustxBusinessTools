import type { NextFunction, Request, Response } from "express";
import { pool } from "../db.js";
import { getActiveOrgId } from "../lib/request-context.js";
import { isPlatformAdmin, orgEqualsSql, orgScopeParams } from "../lib/platform-admin.js";

/** Ensure target user belongs to the caller's org scope (or platform admin). */
export async function assertOrgMember(
  userId: number,
): Promise<{ ok: true; orgId: number } | { ok: false; status: number; error: string }> {
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, status: 400, error: "Invalid member" };
  }
  const [rows] = await pool.query(
    `SELECT m.organization_id AS orgId
     FROM org_members m
     WHERE m.user_id = :userId AND ${orgEqualsSql("m.organization_id")}
     LIMIT 1`,
    { userId, ...orgScopeParams() },
  );
  const row = Array.isArray(rows) ? (rows[0] as { orgId: number } | undefined) : undefined;
  if (!row) {
    return { ok: false, status: 404, error: "Member not found" };
  }
  return { ok: true, orgId: Number(row.orgId) };
}

/** Resolve invite/assign org id; non–platform-admins cannot target another org. */
export function resolveAdminOrgId(requested: unknown): number | { error: string; status: number } {
  const active = getActiveOrgId();
  const raw = Number(requested);
  const orgId = Number.isInteger(raw) && raw > 0 ? raw : active;
  if (!isPlatformAdmin() && orgId !== active) {
    return { error: "Cannot act on another organization", status: 403 };
  }
  return isPlatformAdmin() ? orgId : active;
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required" });
    return;
  }
  next();
}
