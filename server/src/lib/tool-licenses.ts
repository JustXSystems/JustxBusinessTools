import { pool } from "../db.js";
import {
  ensureToolSkuSchema,
  listToolSkus,
  paidSkuIds,
  type ToolSku,
} from "./tool-skus.js";
import { notifyLicensesGranted, notifyLicensesRevoked } from "./notification-billing.js";

export type ToolLicense = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
  sourceClaimId: number | null;
};

let schemaReady: Promise<void> | null = null;

export async function ensureLicenseSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureToolSkuSchema();
  }
  await schemaReady;
}

export async function listActiveLicenses(orgId: number): Promise<ToolLicense[]> {
  await ensureLicenseSchema();
  const [rows] = await pool.query(
    `SELECT l.tool_id, l.status, l.current_period_end, l.source_claim_id, s.name
     FROM org_tool_licenses l
     LEFT JOIN tool_skus s ON s.tool_id = l.tool_id
     WHERE l.organization_id = :orgId
       AND l.status = 'active'
       AND (l.current_period_end IS NULL OR l.current_period_end > NOW())
     ORDER BY s.sort_order, l.tool_id`,
    { orgId },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      toolId: String(r.tool_id),
      name: String(r.name ?? r.tool_id),
      status: String(r.status),
      periodEnd: r.current_period_end ? String(r.current_period_end) : null,
      sourceClaimId: r.source_claim_id == null ? null : Number(r.source_claim_id),
    };
  });
}

export async function licensedToolIdSet(orgId: number): Promise<Set<string>> {
  const rows = await listActiveLicenses(orgId);
  return new Set(rows.map((r) => r.toolId));
}

export async function isToolLicensed(orgId: number, toolId: string): Promise<boolean> {
  const set = await licensedToolIdSet(orgId);
  return set.has(toolId);
}

export async function grantToolLicenses(
  orgId: number,
  toolIds: string[],
  periodEnd: Date,
  sourceClaimId?: number | null,
): Promise<void> {
  await ensureLicenseSchema();
  for (const toolId of toolIds) {
    await pool.query(
      `INSERT INTO org_tool_licenses
         (organization_id, tool_id, status, source_claim_id, current_period_end)
       VALUES (:orgId, :toolId, 'active', :claimId, :periodEnd)
       ON DUPLICATE KEY UPDATE
         status = 'active',
         source_claim_id = COALESCE(:claimId, source_claim_id),
         current_period_end = :periodEnd`,
      { orgId, toolId, claimId: sourceClaimId ?? null, periodEnd },
    );
  }
  await refreshOrgMrr(orgId);
  notifyLicensesGranted({
    organizationId: orgId,
    toolIds,
    periodEnd,
    source: sourceClaimId ? `claim #${sourceClaimId}` : "license grant",
  });
}

/** Extend an active license (or grant) by N days from max(now, current end). */
export async function extendToolLicenses(
  orgId: number,
  toolIds: string[],
  days: number,
): Promise<Date> {
  const addMs = Math.max(1, days) * 24 * 60 * 60 * 1000;
  await ensureLicenseSchema();
  const existing = await listActiveLicenses(orgId);
  const byId = new Map(existing.map((l) => [l.toolId, l]));
  let farthest = new Date(Date.now() + addMs);
  for (const toolId of toolIds) {
    const cur = byId.get(toolId);
    const base = cur?.periodEnd ? new Date(cur.periodEnd) : new Date();
    const from = base.getTime() > Date.now() ? base : new Date();
    const periodEnd = new Date(from.getTime() + addMs);
    if (periodEnd > farthest) farthest = periodEnd;
    await grantToolLicenses(orgId, [toolId], periodEnd);
  }
  return farthest;
}

export async function revokeToolLicenses(orgId: number, toolIds?: string[]): Promise<void> {
  await ensureLicenseSchema();
  if (toolIds && toolIds.length > 0) {
    for (const toolId of toolIds) {
      await pool.query(
        `UPDATE org_tool_licenses SET status = 'cancelled'
         WHERE organization_id = :orgId AND tool_id = :toolId`,
        { orgId, toolId },
      );
    }
  } else {
    await pool.query(
      `UPDATE org_tool_licenses SET status = 'cancelled' WHERE organization_id = :orgId`,
      { orgId },
    );
  }
  await refreshOrgMrr(orgId);
  notifyLicensesRevoked({ organizationId: orgId, toolIds });
}

export async function grantAllPaidSkus(orgId: number, periodEnd: Date): Promise<string[]> {
  const skus = await listToolSkus();
  const paid = paidSkuIds(skus);
  await grantToolLicenses(orgId, paid, periodEnd);
  return paid;
}

/** Idempotent: grant any missing paid SKUs for All Tools Pack tenants (no notification spam). */
export async function ensureAllPaidLicenses(orgId: number, periodEnd: Date): Promise<string[]> {
  await ensureLicenseSchema();
  const skus = await listToolSkus();
  const paid = paidSkuIds(skus);
  if (paid.length === 0) return [];
  const have = await licensedToolIdSet(orgId);
  const missing = paid.filter((id) => !have.has(id));
  if (missing.length === 0) return [];
  for (const toolId of missing) {
    await pool.query(
      `INSERT INTO org_tool_licenses
         (organization_id, tool_id, status, source_claim_id, current_period_end)
       VALUES (:orgId, :toolId, 'active', NULL, :periodEnd)
       ON DUPLICATE KEY UPDATE
         status = 'active',
         current_period_end = COALESCE(current_period_end, :periodEnd)`,
      { orgId, toolId, periodEnd },
    );
  }
  await refreshOrgMrr(orgId);
  return missing;
}

export async function licensedOrIncluded(
  orgId: number,
  toolId: string,
  sku?: ToolSku | null,
): Promise<boolean> {
  const row = sku ?? (await listToolSkus()).find((s) => s.toolId === toolId) ?? null;
  if (row?.includedFree || (row && row.priceInr <= 0)) return true;
  return isToolLicensed(orgId, toolId);
}

export async function refreshOrgMrr(orgId: number): Promise<number> {
  const licenses = await listActiveLicenses(orgId);
  const skus = await listToolSkus();
  const byId = new Map(skus.map((s) => [s.toolId, s]));
  const mrr = licenses.reduce((sum, lic) => {
    const sku = byId.get(lic.toolId);
    if (!sku || sku.includedFree) return sum;
    return sum + sku.priceInr;
  }, 0);
  await pool.query(`UPDATE org_subscriptions SET mrr_inr = :mrr WHERE organization_id = :orgId`, {
    mrr,
    orgId,
  });
  try {
    const { syncSubscriptionItemsFromLicenses } = await import("./subscription-items.js");
    await syncSubscriptionItemsFromLicenses(orgId);
  } catch {
    /* line-item ledger optional until schema ready */
  }
  return mrr;
}

export function catalogPayload(skus: ToolSku[], licensed: Set<string>) {
  return skus
    .filter((s) => s.available)
    .map((s) => ({
      toolId: s.toolId,
      name: s.name,
      category: s.category,
      tagline: s.tagline,
      priceInr: s.priceInr,
      annualPriceInr: s.annualPriceInr,
      billingInterval: s.billingInterval,
      includedFree: s.includedFree || s.priceInr <= 0,
      accessPolicy: s.accessPolicy,
      featured: s.featured,
      trialDays: s.trialDays,
      licensed: licensed.has(s.toolId) || s.includedFree || s.priceInr <= 0,
    }));
}
