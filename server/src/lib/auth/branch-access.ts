import { pool } from "../../db.js";
import { getActiveOrgId, getActiveProfileId, getActiveUserId, getRequestContext } from "../request-context.js";

export async function userHasBranchAccess(
  userId: number,
  businessProfileId: number,
  role: string,
): Promise<boolean> {
  if (getRequestContext()?.isPlatformAdmin) return true;
  if (role === "owner" || role === "admin") return true;

  const [grantRows] = await pool.query(
    `SELECT 1 FROM branch_access WHERE user_id = :userId AND business_profile_id = :profileId LIMIT 1`,
    { userId, profileId: businessProfileId },
  );
  if (Array.isArray(grantRows) && grantRows[0]) return true;

  const [anyRows] = await pool.query(
    `SELECT 1 FROM branch_access WHERE user_id = :userId LIMIT 1`,
    { userId },
  );
  // No explicit grants → staff can access all branches in org (default onboarding)
  if (!Array.isArray(anyRows) || !anyRows[0]) return true;

  return false;
}

export async function listAuditEvents(limit = 50): Promise<
  Array<{
    id: number;
    action: string;
    entityType: string | null;
    entityId: string | null;
    userId: number | null;
    createdAt: string;
    ip: string | null;
  }>
> {
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT id, action, entity_type, entity_id, user_id, created_at, ip
     FROM audit_events
     WHERE organization_id = :orgId
     ORDER BY created_at DESC
     LIMIT :limit`,
    { orgId, limit },
  );

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      action: String(r.action),
      entityType: r.entity_type as string | null,
      entityId: r.entity_id as string | null,
      userId: r.user_id != null ? Number(r.user_id) : null,
      createdAt: String(r.created_at),
      ip: r.ip as string | null,
    };
  });
}

export async function grantBranchAccess(userId: number, businessProfileId: number): Promise<void> {
  if (!getRequestContext()?.isPlatformAdmin) {
    const orgId = getActiveOrgId();
    const [profileRows] = await pool.query(
      `SELECT id FROM business_profiles WHERE id = :id AND organization_id = :orgId`,
      { id: businessProfileId, orgId },
    );
    if (!Array.isArray(profileRows) || !profileRows[0]) {
      throw new Error("Branch not found in organization");
    }
  } else {
    const [profileRows] = await pool.query(`SELECT id FROM business_profiles WHERE id = :id`, {
      id: businessProfileId,
    });
    if (!Array.isArray(profileRows) || !profileRows[0]) {
      throw new Error("Branch not found");
    }
  }

  await pool.query(
    `INSERT IGNORE INTO branch_access (user_id, business_profile_id) VALUES (:userId, :profileId)`,
    { userId, profileId: businessProfileId },
  );
}

export async function revokeBranchAccess(userId: number, businessProfileId: number): Promise<void> {
  await pool.query(
    `DELETE FROM branch_access WHERE user_id = :userId AND business_profile_id = :profileId`,
    { userId, profileId: businessProfileId },
  );
}

export async function listBranchAccessForUser(userId: number): Promise<number[]> {
  const [rows] = await pool.query(
    getRequestContext()?.isPlatformAdmin
      ? `SELECT business_profile_id FROM branch_access WHERE user_id = :userId`
      : `SELECT ba.business_profile_id
         FROM branch_access ba
         INNER JOIN business_profiles bp ON bp.id = ba.business_profile_id
         WHERE ba.user_id = :userId AND bp.organization_id = :orgId`,
    { userId, orgId: getActiveOrgId() },
  );
  return (Array.isArray(rows) ? rows : []).map((r) =>
    Number((r as { business_profile_id: number }).business_profile_id),
  );
}
