import { pool } from "../../db.js";
import { getActiveOrgId, getActiveUserId } from "../request-context.js";
import { publishNotification } from "../notification-publish.js";

export function jsonVal(value: unknown): Record<string, unknown> | unknown[] | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

export async function createApproval(input: {
  entityType: string;
  entityId: string;
  action: string;
  note?: string;
}): Promise<number> {
  const orgId = getActiveOrgId();
  const userId = getActiveUserId();
  const [result] = await pool.query(
    `INSERT INTO approval_requests
      (organization_id, entity_type, entity_id, action, status, requested_by, note)
     VALUES (:orgId, :entityType, :entityId, :action, 'pending', :userId, :note)`,
    {
      orgId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      userId,
      note: input.note ?? null,
    },
  );
  const id = Number((result as { insertId: number }).insertId);
  await publishNotification({
    eventType: "approval.requested",
    title: "Approval requested",
    body: `${input.entityType.replace(/_/g, " ")} · ${input.action} requires review${input.note ? `: ${input.note}` : "."}`,
    href:
      input.entityType === "business_profile"
        ? "/admin/approvals?kind=profile"
        : input.entityType === "payment_op"
          ? "/admin/approvals?kind=payment_op"
          : input.entityType === "user"
            ? "/admin/approvals?kind=user"
            : "/admin/approvals",
    entityType: input.entityType,
    entityId: input.entityId,
    organizationId: orgId,
    businessProfileId: input.entityType === "business_profile" ? Number(input.entityId) || null : null,
    actorUserId: userId,
    targetUserId: userId,
    dedupeKey: `approval-req:${input.entityType}:${input.entityId}:${input.action}:${id}`,
    meta: { approvalId: id, action: input.action },
    expiresInHours: 336,
  });
  return id;
}

export async function reviewApproval(
  id: number,
  status: "approved" | "rejected",
  note?: string,
): Promise<void> {
  const userId = getActiveUserId();
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT requested_by, organization_id, entity_type, entity_id, action
     FROM approval_requests WHERE id = :id LIMIT 1`,
    { id },
  );
  const prev = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;

  await pool.query(
    `UPDATE approval_requests
     SET status = :status, reviewed_by = :userId, reviewed_at = CURRENT_TIMESTAMP, note = COALESCE(:note, note)
     WHERE id = :id AND organization_id = :orgId`,
    { status, userId, note: note ?? null, id, orgId },
  );

  const requesterId = prev?.requested_by == null ? null : Number(prev.requested_by);
  const notifyOrgId = prev?.organization_id == null ? orgId : Number(prev.organization_id);
  await publishNotification({
    eventType: "approval.decided",
    title: status === "approved" ? "Approval granted" : "Approval rejected",
    body: `${String(prev?.entity_type ?? "request").replace(/_/g, " ")} · ${String(prev?.action ?? "review")} was ${status}${note ? `: ${note}` : "."}`,
    href: "/admin/approvals",
    organizationId: notifyOrgId,
    entityType: "approval_request",
    entityId: String(id),
    actorUserId: userId,
    actorRole: "admin",
    targetUserId: requesterId,
    dedupeKey: `approval-dec:${id}:${status}`,
    severity: status === "rejected" ? "urgent" : "info",
    expiresInHours: 168,
    meta: {
      entityType: prev?.entity_type ?? null,
      entityId: prev?.entity_id ?? null,
      action: prev?.action ?? null,
    },
  });
}
