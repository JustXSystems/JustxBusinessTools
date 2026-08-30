import { pool } from "../db.js";
import { ensureToolSkuSchema, listToolSkus, type ToolSku } from "./tool-skus.js";
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
  const paid = skus.filter((s) => s.available && !s.includedFree && s.priceInr > 0).map((s) => s.toolId);
  await grantToolLicenses(orgId, paid, periodEnd);
  return paid;
}

export async function licensedOrIncluded(orgId: number, toolId: string, sku?: ToolSku | null): Promise<boolean> {
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
  await pool.query(
    `UPDATE org_subscriptions SET mrr_inr = :mrr WHERE organization_id = :orgId`,
    { mrr, orgId },
  );
  return mrr;
}

export function catalogPayload(
  skus: ToolSku[],
  licensed: Set<string>,
) {
  return skus
    .filter((s) => s.available)
    .map((s) => ({
      toolId: s.toolId,
      name: s.name,
      category: s.category,
      priceInr: s.priceInr,
      billingInterval: s.billingInterval,
      includedFree: s.includedFree || s.priceInr <= 0,
      licensed: licensed.has(s.toolId) || s.includedFree || s.priceInr <= 0,
    }));
}
