/**
 * When JBT grants tool id `seo-meridian`, auto-mint a Meridian SaaS license via webhook.
 * Env on JBT server:
 *   MERIDIAN_SAAS_URL=https://justxsystems.com/jbt/tools/seo-meridian
 *   MERIDIAN_JBT_WEBHOOK_SECRET=<same as Meridian JBT_WEBHOOK_SECRET>
 */
import { pool } from "../db.js";
import { publishNotificationAsync } from "./notifications.js";

const TOOL_ID = "seo-meridian";

export function isMeridianSaasTool(toolId: string): boolean {
  return toolId === TOOL_ID || toolId === "seo_meridian";
}

async function buyerEmailForOrg(orgId: number): Promise<string | null> {
  try {
    const [rows] = await pool.query(
      `SELECT u.email AS email
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = :orgId
       ORDER BY m.role = 'owner' DESC, m.id ASC
       LIMIT 1`,
      { orgId },
    );
    const list = rows as Array<{ email?: string }>;
    return list[0]?.email?.toLowerCase() || null;
  } catch {
    return null;
  }
}

export async function provisionMeridianSaasLicenses(input: {
  orgId: number;
  toolIds: string[];
  externalRef?: string | null;
}): Promise<void> {
  if (!input.toolIds.some(isMeridianSaasTool)) return;

  const base = (process.env.MERIDIAN_SAAS_URL || "").replace(/\/$/, "");
  const secret =
    (process.env.MERIDIAN_JBT_WEBHOOK_SECRET || process.env.JBT_WEBHOOK_SECRET || "").trim();
  if (!base || !secret) {
    console.warn(
      "[meridian-saas] skip provision — set MERIDIAN_SAAS_URL + MERIDIAN_JBT_WEBHOOK_SECRET on JBT server",
    );
    return;
  }

  const email = await buyerEmailForOrg(input.orgId);
  const externalRef = `jbt-org-${input.orgId}-seo-meridian`;

  try {
    const res = await fetch(`${base}/api/jbt/webhooks/license`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "license.activated",
        plan: "growth",
        externalRef,
        buyerEmail: email,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      licenseKey?: string;
      redeemUrl?: string;
      error?: string;
    };
    if (!res.ok) {
      console.error("[meridian-saas] provision failed", data.error || res.status);
      return;
    }

    const redeem = data.redeemUrl || `${base}/redeem`;
    publishNotificationAsync({
      eventType: "billing.license_granted",
      title: "Meridian SEO license ready",
      body: data.licenseKey
        ? `Your Meridian key: ${data.licenseKey} — redeem at ${redeem}`
        : `Open Meridian to redeem: ${redeem}`,
      organizationId: input.orgId,
      businessProfileId: null,
      href: redeem,
      entityType: "meridian_saas",
      entityId: String(input.orgId),
      dedupeKey: `meridian-saas:${input.orgId}:${externalRef}`,
      meta: { licenseKey: data.licenseKey, redeemUrl: redeem },
      expiresInHours: 720,
    });
  } catch (e) {
    console.error("[meridian-saas] provision error", e);
  }
}

export async function revokeMeridianSaasLicenses(input: {
  orgId: number;
  toolIds?: string[];
}): Promise<void> {
  if (input.toolIds && !input.toolIds.some(isMeridianSaasTool)) return;
  const base = (process.env.MERIDIAN_SAAS_URL || "").replace(/\/$/, "");
  const secret =
    (process.env.MERIDIAN_JBT_WEBHOOK_SECRET || process.env.JBT_WEBHOOK_SECRET || "").trim();
  if (!base || !secret) return;
  try {
    await fetch(`${base}/api/jbt/webhooks/license`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "license.revoked",
        externalRef: `jbt-org-${input.orgId}-seo-meridian`,
      }),
    });
  } catch (e) {
    console.error("[meridian-saas] revoke error", e);
  }
}
