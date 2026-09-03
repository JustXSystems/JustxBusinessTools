import { pool } from "../../db.js";
import { logAudit } from "../audit.js";

/**
 * Suspend every member of an organization and delete all their sessions
 * (forces immediate logout). Used when JustX rejects a business registration.
 */
export async function suspendOrganizationAccess(
  orgId: number,
  opts?: { note?: string; actorIp?: string | null; profileId?: number | null },
): Promise<{ userIds: number[]; sessionsRevoked: number }> {
  const [memberRows] = await pool.query(
    `SELECT user_id AS userId FROM org_members WHERE organization_id = :orgId`,
    { orgId },
  );
  const userIds = (Array.isArray(memberRows) ? memberRows : [])
    .map((r) => Number((r as { userId: number }).userId))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!userIds.length) {
    return { userIds: [], sessionsRevoked: 0 };
  }

  await pool.query(
    `UPDATE users SET status = 'suspended'
     WHERE id IN (${userIds.map((_, i) => `:u${i}`).join(",")})`,
    Object.fromEntries(userIds.map((id, i) => [`u${i}`, id])),
  );

  const [sessionResult] = await pool.query(
    `DELETE FROM sessions WHERE user_id IN (${userIds.map((_, i) => `:u${i}`).join(",")})`,
    Object.fromEntries(userIds.map((id, i) => [`u${i}`, id])),
  );
  const sessionsRevoked = Number((sessionResult as { affectedRows?: number })?.affectedRows ?? 0);

  await logAudit(
    "org.suspend_access",
    "organization",
    String(orgId),
    {
      userIds,
      sessionsRevoked,
      note: opts?.note ?? null,
      profileId: opts?.profileId ?? null,
    },
    opts?.actorIp ?? undefined,
  );

  return { userIds, sessionsRevoked };
}
