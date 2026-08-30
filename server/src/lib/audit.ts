import { pool } from "../db.js";
import { getActiveOrgId, getActiveUserId, getRequestContext } from "./request-context.js";

export async function logAudit(
  action: string,
  entityType?: string,
  entityId?: string,
  diff?: Record<string, unknown>,
  ip?: string,
): Promise<void> {
  const ctx = getRequestContext();
  await pool.query(
    `INSERT INTO audit_events
     (organization_id, business_profile_id, user_id, action, entity_type, entity_id, diff, ip)
     VALUES (:orgId, :profileId, :userId, :action, :entityType, :entityId, :diff, :ip)`,
    {
      orgId: ctx?.organizationId ?? getActiveOrgId(),
      profileId: ctx?.businessProfileId ?? null,
      userId: getActiveUserId(),
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      diff: diff ? JSON.stringify(diff) : null,
      ip: ip ?? null,
    },
  );
}
