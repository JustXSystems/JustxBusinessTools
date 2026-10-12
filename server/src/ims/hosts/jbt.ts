import type { Request } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { ensureDocumentAccentColorColumn } from "../../lib/document-accent.js";
import type { NotificationEventType } from "../../lib/notification-events.js";
import { publishNotificationAsync } from "../../lib/notification-publish.js";
import { getRequestContext } from "../../lib/request-context.js";
import { withFileAccessToken } from "../../lib/storage.js";
import { requireWriteAccess } from "../../middleware/require-write.js";
import type { ImsActor, ImsBrand, ImsHost, ImsHostRole, ImsHostUser, ImsNoticeKind } from "../host.js";

export const IMS_TOOL_ID = "imsdealer";

const EVENT_FOR: Record<ImsNoticeKind, NotificationEventType> = {
  approval_requested: "approval.requested",
  approval_decided: "approval.decided",
  activity: "activity.staff_major_event",
  alert: "activity.staff_major_event",
};

const USER_TTL_MS = 60_000;
const userCache = new Map<number, { at: number; name: string | null; email: string | null }>();

async function userInfo(userId: number): Promise<{ name: string | null; email: string | null }> {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit;
  const [rows] = await pool.query(`SELECT name, email FROM users WHERE id = :userId LIMIT 1`, { userId });
  const row = (Array.isArray(rows) ? rows[0] : null) as { name: string | null; email: string | null } | null;
  const info = { at: Date.now(), name: row?.name ?? null, email: row?.email ?? null };
  userCache.set(userId, info);
  return info;
}

const HOST_ROLES = new Set<ImsHostRole>(["owner", "admin", "staff", "viewer", "legacy"]);

/** IMS-Dealer running inside JBT: JBT sessions, business profile = tenant, JBT audit trail and notification inbox. */
export const jbtImsHost: ImsHost = {
  id: "jbt",
  appHref: `/tools/${IMS_TOOL_ID}`,

  async actor(_req: Request): Promise<ImsActor | null> {
    const ctx = getRequestContext();
    if (!ctx) return null;
    if (!ctx.userId && ctx.role !== "legacy") return null;
    const info = ctx.userId ? await userInfo(ctx.userId).catch(() => ({ name: null, email: null })) : { name: null, email: null };
    return { tenantId: ctx.businessProfileId, userId: ctx.userId, role: ctx.role, name: info.name, email: info.email };
  },

  /** Same rule as the web: the org's `imsdealer` catalog row is Live (Admin → Tools), or a platform admin. Fails closed. */
  async enabled(): Promise<boolean> {
    const ctx = getRequestContext();
    if (!ctx) return false;
    if (ctx.isPlatformAdmin) return true;
    try {
      const [rows] = await pool.query(
        `SELECT available FROM tool_catalog WHERE organization_id = :orgId AND tool_id = :toolId LIMIT 1`,
        { orgId: ctx.organizationId, toolId: IMS_TOOL_ID },
      );
      const row = (Array.isArray(rows) ? rows[0] : null) as { available: number } | null;
      return Number(row?.available) === 1;
    } catch (err) {
      console.warn("[ims] enabled check failed", err instanceof Error ? err.message : err);
      return false;
    }
  },

  requireWrite: requireWriteAccess,

  async audit(_actor, action, entityType, entityId, diff, ip) {
    await logAudit(`ims.${action}`, entityType, entityId, diff, ip);
  },

  notify(actor, notice) {
    publishNotificationAsync({
      eventType: EVENT_FOR[notice.kind],
      title: notice.title,
      body: notice.body,
      href: notice.href,
      entityType: notice.entityType,
      entityId: notice.entityId,
      dedupeKey: notice.dedupeKey ?? null,
      actorUserId: actor.userId,
      ...(notice.targetUserId !== undefined ? { targetUserId: notice.targetUserId } : {}),
      meta: { source: "ims" },
      expiresInHours: 336,
    });
  },

  async brand(tenantId: number): Promise<ImsBrand> {
    await ensureDocumentAccentColorColumn().catch(() => undefined);
    const [rows] = await pool.query(
      `SELECT business_name, gstin, state, state_code, address_line1, address_line2, email, phone,
              logo_data_url, document_accent_color
       FROM business_profiles WHERE id = :id LIMIT 1`,
      { id: tenantId },
    );
    const r = (Array.isArray(rows) ? rows[0] : null) as Record<string, string | null> | null;
    const address = [r?.address_line1, r?.address_line2].filter(Boolean).join(", ");
    return {
      name: r?.business_name || "",
      gstin: r?.gstin ?? null,
      state: r?.state ?? null,
      stateCode: r?.state_code ?? null,
      address: address || null,
      email: r?.email ?? null,
      phone: r?.phone ?? null,
      logoUrl: r?.logo_data_url ? withFileAccessToken(r.logo_data_url) : null,
      accent: r?.document_accent_color ?? null,
    };
  },

  /** Org members with access to this business profile (owners/admins always have it). */
  async users(actor): Promise<ImsHostUser[]> {
    const ctx = getRequestContext();
    if (!ctx) return [];
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.name, om.role
       FROM org_members om
       INNER JOIN users u ON u.id = om.user_id
       LEFT JOIN branch_access ba ON ba.user_id = u.id AND ba.business_profile_id = :profileId
       WHERE om.organization_id = :orgId AND (om.role IN ('owner', 'admin') OR ba.user_id IS NOT NULL)
       ORDER BY u.name, u.email`,
      { orgId: ctx.organizationId, profileId: actor.tenantId },
    );
    return (Array.isArray(rows) ? rows : []).map((p) => {
      const r = p as { id: number; email: string | null; name: string | null; role: string };
      return {
        userId: Number(r.id),
        name: r.name,
        email: r.email,
        role: HOST_ROLES.has(r.role as ImsHostRole) ? (r.role as ImsHostRole) : "staff",
      };
    });
  },
};
