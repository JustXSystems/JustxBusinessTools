import type { Request } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { getOrgFeatureSwitches, isFeatureSwitchKey } from "../../lib/feature-switches.js";
import { ensureDocumentAccentColorColumn } from "../../lib/document-accent.js";
import type { NotificationEventType } from "../../lib/notification-events.js";
import { publishNotificationAsync } from "../../lib/notification-publish.js";
import { getRequestContext } from "../../lib/request-context.js";
import { withFileAccessToken } from "../../lib/storage.js";
import { requireWriteAccess } from "../../middleware/require-write.js";
import type { BosActor, BosBrand, BosHost, BosNoticeKind } from "../host.js";

const EVENT_FOR: Record<BosNoticeKind, NotificationEventType> = {
  approval_requested: "approval.requested",
  approval_decided: "approval.decided",
  activity: "activity.staff_major_event",
  workflow: "workflow.stage_changed",
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

/** BOS running inside JBT: JBT sessions, branch = tenant, JBT audit trail and notification inbox. */
export const jbtHost: BosHost = {
  id: "jbt",
  appHref: "/tools/bos",

  async actor(_req: Request): Promise<BosActor | null> {
    const ctx = getRequestContext();
    if (!ctx) return null;
    if (!ctx.userId && ctx.role !== "legacy") return null;
    const info = ctx.userId ? await userInfo(ctx.userId).catch(() => ({ name: null, email: null })) : { name: null, email: null };
    return { tenantId: ctx.businessProfileId, userId: ctx.userId, role: ctx.role, name: info.name, email: info.email };
  },

  /** Same rule as the web: the org's `bos` catalog row is Live (Admin → Tools), or a platform admin. */
  async enabled(): Promise<boolean> {
    const ctx = getRequestContext();
    if (!ctx) return false;
    if (ctx.isPlatformAdmin) return true;
    try {
      const [rows] = await pool.query(`SELECT available FROM tool_catalog WHERE organization_id = :orgId AND tool_id = 'bos' LIMIT 1`, { orgId: ctx.organizationId });
      const row = (Array.isArray(rows) ? rows[0] : null) as { available: number } | null;
      return Number(row?.available) === 1;
    } catch (err) {
      console.warn("[bos] enabled check failed", err instanceof Error ? err.message : err);
      return false;
    }
  },

  /** Admin → Tools → Justx BOS → Switches. Unregistered keys and read errors count as off. */
  async feature(_actor, key): Promise<boolean> {
    const ctx = getRequestContext();
    if (!ctx || !isFeatureSwitchKey(key)) return false;
    return (await getOrgFeatureSwitches(ctx.organizationId))[key];
  },

  requireWrite: requireWriteAccess,

  async audit(_actor, action, entityType, entityId, diff, ip) {
    await logAudit(`bos.${action}`, entityType, entityId, diff, ip);
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
      meta: { source: "bos" },
      expiresInHours: 336,
    });
  },

  async brand(tenantId: number): Promise<BosBrand> {
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
};
