import { pool } from "../db.js";
import {
  eventMeta,
  expandAudienceForActor,
  type NotificationAudience,
  type NotificationEventType,
  type NotificationSeverity,
} from "./notification-events.js";
import { ensureNotificationSchema } from "./notification-schema.js";
import {
  getActiveOrgId,
  getActiveProfileId,
  getActiveRole,
  getActiveUserId,
  type OrgRole,
} from "./request-context.js";

export type PublishNotificationInput = {
  eventType: NotificationEventType;
  title: string;
  body: string;
  organizationId?: number;
  businessProfileId?: number | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorUserId?: number | null;
  /** Override catalogue audience when needed. */
  targetRoles?: NotificationAudience[];
  /**
   * Personal inbox target. When omitted, defaults to the actor (notify self).
   * Pass `null` to skip a personal target (roles-only).
   * Pass a specific user id (e.g. UPI submitter) to notify that person in addition to roles.
   */
  targetUserId?: number | null;
  /** Idempotency key within an organization (unique). */
  dedupeKey?: string | null;
  meta?: Record<string, unknown> | null;
  dueAt?: string | null;
  severity?: NotificationSeverity;
  icon?: string | null;
  /** Hours until expiry; omit for no expiry. */
  expiresInHours?: number | null;
  /** Override actor role used for audience expansion. */
  actorRole?: OrgRole | "legacy" | null;
};

export type PublishedNotification = {
  id: number;
  created: boolean;
};

function normalizeRoles(roles: NotificationAudience[]): OrgRole[] {
  const set = new Set<OrgRole>();
  for (const r of roles) {
    if (r === "platform") {
      set.add("admin");
      continue;
    }
    set.add(r);
  }
  return [...set];
}

/**
 * Persist a corporate in-app notification for the target audience.
 *
 * Hierarchy (Admin → Owner → Staff):
 * - Catalogue + expandAudienceForActor set role fans (Owner/Admin).
 * - Staff are not role-broadcast; they only get `targetUserId` (defaults to actor,
 *   or an explicit affected user such as UPI submitter / approved member).
 */
export async function publishNotification(
  input: PublishNotificationInput,
): Promise<PublishedNotification | null> {
  try {
    await ensureNotificationSchema();
    const meta = eventMeta(input.eventType);
    const orgId = input.organizationId ?? getActiveOrgId();
    const profileId =
      input.businessProfileId === undefined ? getActiveProfileId() : input.businessProfileId;
    const actorRole = input.actorRole === undefined ? getActiveRole() : input.actorRole;
    const catalogRoles = input.targetRoles ?? meta.audience;
    const roles = normalizeRoles(expandAudienceForActor(catalogRoles, actorRole));
    const severity = input.severity ?? meta.severity;
    const icon = input.icon ?? meta.icon;
    const actorUserId = input.actorUserId === undefined ? getActiveUserId() : input.actorUserId;
    // Personal copy: actor by default, or explicit related user (staff-minimal path).
    const targetUserId =
      input.targetUserId === undefined ? actorUserId : input.targetUserId;
    const dedupeKey = input.dedupeKey?.slice(0, 160) ?? null;

    let expiresAt: string | null = null;
    if (input.expiresInHours != null && input.expiresInHours > 0) {
      expiresAt = new Date(Date.now() + input.expiresInHours * 3600_000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    }

    if (dedupeKey) {
      const [existing] = await pool.query(
        `SELECT id FROM app_notifications
         WHERE organization_id = :orgId AND dedupe_key = :dedupeKey LIMIT 1`,
        { orgId, dedupeKey },
      );
      const row = Array.isArray(existing)
        ? (existing[0] as { id: number } | undefined)
        : undefined;
      if (row) return { id: Number(row.id), created: false };
    }

    const [result] = await pool.query(
      `INSERT INTO app_notifications
        (organization_id, business_profile_id, event_type, category, severity,
         title, body, icon, href, entity_type, entity_id, actor_user_id,
         target_roles, target_user_id, dedupe_key, meta, due_at, expires_at)
       VALUES
        (:orgId, :profileId, :eventType, :category, :severity,
         :title, :body, :icon, :href, :entityType, :entityId, :actorUserId,
         :targetRoles, :targetUserId, :dedupeKey, :meta, :dueAt, :expiresAt)`,
      {
        orgId,
        profileId,
        eventType: input.eventType,
        category: meta.category,
        severity,
        title: input.title.slice(0, 200),
        body: input.body,
        icon,
        href: input.href ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actorUserId,
        targetRoles: JSON.stringify(roles),
        targetUserId,
        dedupeKey,
        meta: input.meta
          ? JSON.stringify({ ...input.meta, actorRole: actorRole ?? null })
          : JSON.stringify({ actorRole: actorRole ?? null }),
        dueAt: input.dueAt ?? null,
        expiresAt,
      },
    );
    return { id: Number((result as { insertId: number }).insertId), created: true };
  } catch (err) {
    console.warn("[notifications] publish failed", err);
    return null;
  }
}

/** Convenience: publish without awaiting (fire-and-forget). */
export function publishNotificationAsync(input: PublishNotificationInput): void {
  void publishNotification(input);
}
