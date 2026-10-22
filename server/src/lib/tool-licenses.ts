import { pool } from "../db.js";
import {
  ensureToolSkuSchema,
  listToolSkus,
  paidSkuIds,
  type ToolSku,
} from "./tool-skus.js";
import { notifyLicensesGranted, notifyLicensesRevoked } from "./notification-billing.js";
import { ensureTablesUtf8mb4UnicodeCi, INNODB_UTF8MB4_UNICODE } from "./mysql-charset.js";

export type ToolLicense = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
  sourceClaimId: number | null;
  /** Freemium record-cap override for this profile+tool; null = use SKU/plan default */
  recordLimitOverride: number | null;
  businessProfileId: number;
};

let schemaReady: Promise<void> | null = null;
let migrated = false;

async function tryAlter(sql: string): Promise<void> {
  try {
    await pool.query(sql);
  } catch {
    /* column / table already exists */
  }
}

async function migrateOrgLicensesToProfiles(): Promise<void> {
  if (migrated) return;
  try {
    await pool.query(`
      INSERT INTO profile_tool_licenses
        (business_profile_id, tool_id, status, source_claim_id, current_period_end)
      SELECT bp.id, otl.tool_id, otl.status, otl.source_claim_id, otl.current_period_end
      FROM org_tool_licenses otl
      INNER JOIN business_profiles bp ON bp.organization_id = otl.organization_id
      ON DUPLICATE KEY UPDATE
        status = IF(
          profile_tool_licenses.status = 'active'
            AND (profile_tool_licenses.current_period_end IS NULL
                 OR profile_tool_licenses.current_period_end > NOW()),
          profile_tool_licenses.status,
          VALUES(status)
        ),
        source_claim_id = COALESCE(profile_tool_licenses.source_claim_id, VALUES(source_claim_id)),
        current_period_end = COALESCE(
          profile_tool_licenses.current_period_end,
          VALUES(current_period_end)
        )
    `);
  } catch {
    /* org_tool_licenses may not exist on fresh installs */
  }
  migrated = true;
}

export async function ensureLicenseSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensureToolSkuSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS profile_tool_licenses (
          business_profile_id INT UNSIGNED NOT NULL,
          tool_id VARCHAR(64) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          source_claim_id BIGINT UNSIGNED NULL,
          current_period_end TIMESTAMP NULL,
          record_limit_override INT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (business_profile_id, tool_id),
          KEY idx_ptl_status (status),
          KEY idx_ptl_tool (tool_id)
        ) ${INNODB_UTF8MB4_UNICODE}
      `);
      await ensureTablesUtf8mb4UnicodeCi(["profile_tool_licenses"]);
      await tryAlter(
        `ALTER TABLE profile_tool_licenses ADD COLUMN record_limit_override INT NULL`,
      );
      await tryAlter(
        `ALTER TABLE org_subscription_items ADD COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1`,
      );
      await migrateOrgLicensesToProfiles();
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function mapLicense(r: Record<string, unknown>): ToolLicense {
  return {
    toolId: String(r.tool_id),
    name: String(r.name ?? r.tool_id),
    status: String(r.status),
    periodEnd: r.current_period_end ? String(r.current_period_end) : null,
    sourceClaimId: r.source_claim_id == null ? null : Number(r.source_claim_id),
    recordLimitOverride:
      r.record_limit_override == null ? null : Math.max(0, Number(r.record_limit_override)),
    businessProfileId: Number(r.business_profile_id),
  };
}

export async function listActiveLicenses(profileId: number): Promise<ToolLicense[]> {
  await ensureLicenseSchema();
  const [rows] = await pool.query(
    `SELECT l.business_profile_id, l.tool_id, l.status, l.current_period_end,
            l.source_claim_id, l.record_limit_override, s.name
     FROM profile_tool_licenses l
     LEFT JOIN tool_skus s ON s.tool_id = l.tool_id
     WHERE l.business_profile_id = :profileId
       AND l.status = 'active'
       AND (l.current_period_end IS NULL OR l.current_period_end > NOW())
     ORDER BY s.sort_order, l.tool_id`,
    { profileId },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => mapLicense(row as Record<string, unknown>));
}

/** All entitlement rows for a profile (including cancelled / limit-only overrides). */
export async function listProfileEntitlements(profileId: number): Promise<ToolLicense[]> {
  await ensureLicenseSchema();
  const [rows] = await pool.query(
    `SELECT l.business_profile_id, l.tool_id, l.status, l.current_period_end,
            l.source_claim_id, l.record_limit_override, s.name
     FROM profile_tool_licenses l
     LEFT JOIN tool_skus s ON s.tool_id = l.tool_id
     WHERE l.business_profile_id = :profileId
     ORDER BY s.sort_order, l.tool_id`,
    { profileId },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => mapLicense(row as Record<string, unknown>));
}

/** All active profile licenses under an org (for billing / admin org view). */
export async function listActiveLicensesForOrg(orgId: number): Promise<ToolLicense[]> {
  await ensureLicenseSchema();
  const [rows] = await pool.query(
    `SELECT l.business_profile_id, l.tool_id, l.status, l.current_period_end,
            l.source_claim_id, l.record_limit_override, s.name
     FROM profile_tool_licenses l
     INNER JOIN business_profiles bp ON bp.id = l.business_profile_id
     LEFT JOIN tool_skus s ON s.tool_id = l.tool_id
     WHERE bp.organization_id = :orgId
       AND l.status = 'active'
       AND (l.current_period_end IS NULL OR l.current_period_end > NOW())
     ORDER BY l.business_profile_id, s.sort_order, l.tool_id`,
    { orgId },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => mapLicense(row as Record<string, unknown>));
}

export async function getProfileToolEntitlement(
  profileId: number,
  toolId: string,
): Promise<ToolLicense | null> {
  await ensureLicenseSchema();
  const [rows] = await pool.query(
    `SELECT l.business_profile_id, l.tool_id, l.status, l.current_period_end,
            l.source_claim_id, l.record_limit_override, s.name
     FROM profile_tool_licenses l
     LEFT JOIN tool_skus s ON s.tool_id = l.tool_id
     WHERE l.business_profile_id = :profileId AND l.tool_id = :toolId
     LIMIT 1`,
    { profileId, toolId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? mapLicense(row as Record<string, unknown>) : null;
}

export async function licensedToolIdSet(profileId: number): Promise<Set<string>> {
  const rows = await listActiveLicenses(profileId);
  return new Set(rows.map((r) => r.toolId));
}

export async function isToolLicensed(profileId: number, toolId: string): Promise<boolean> {
  const set = await licensedToolIdSet(profileId);
  return set.has(toolId);
}

async function profileIdsForOrg(orgId: number): Promise<number[]> {
  const [rows] = await pool.query(
    `SELECT id FROM business_profiles WHERE organization_id = :orgId`,
    { orgId },
  );
  return (Array.isArray(rows) ? rows : []).map((r) => Number((r as { id: number }).id));
}

export async function grantToolLicenses(
  profileId: number,
  toolIds: string[],
  periodEnd: Date,
  sourceClaimId?: number | null,
): Promise<void> {
  await ensureLicenseSchema();
  for (const toolId of toolIds) {
    await pool.query(
      `INSERT INTO profile_tool_licenses
         (business_profile_id, tool_id, status, source_claim_id, current_period_end)
       VALUES (:profileId, :toolId, 'active', :claimId, :periodEnd)
       ON DUPLICATE KEY UPDATE
         status = 'active',
         source_claim_id = COALESCE(:claimId, source_claim_id),
         current_period_end = :periodEnd`,
      { profileId, toolId, claimId: sourceClaimId ?? null, periodEnd },
    );
  }
  const orgId = await orgIdForProfile(profileId);
  if (orgId) {
    await refreshOrgMrr(orgId);
    notifyLicensesGranted({
      organizationId: orgId,
      toolIds,
      periodEnd,
      source: sourceClaimId ? `claim #${sourceClaimId}` : "license grant",
    });
  }
}

/** Grant the same tools to every business profile under an org (All Tools Pack). */
export async function grantToolLicensesToOrg(
  orgId: number,
  toolIds: string[],
  periodEnd: Date,
  sourceClaimId?: number | null,
): Promise<void> {
  await ensureLicenseSchema();
  const profileIds = await profileIdsForOrg(orgId);
  for (const profileId of profileIds) {
    for (const toolId of toolIds) {
      await pool.query(
        `INSERT INTO profile_tool_licenses
           (business_profile_id, tool_id, status, source_claim_id, current_period_end)
         VALUES (:profileId, :toolId, 'active', :claimId, :periodEnd)
         ON DUPLICATE KEY UPDATE
           status = 'active',
           source_claim_id = COALESCE(:claimId, source_claim_id),
           current_period_end = :periodEnd`,
        { profileId, toolId, claimId: sourceClaimId ?? null, periodEnd },
      );
    }
  }
  await refreshOrgMrr(orgId);
  notifyLicensesGranted({
    organizationId: orgId,
    toolIds,
    periodEnd,
    source: sourceClaimId ? `claim #${sourceClaimId}` : "org pack grant",
  });
}

/** Extend an active license (or grant) by N days from max(now, current end). */
export async function extendToolLicenses(
  profileId: number,
  toolIds: string[],
  days: number,
): Promise<Date> {
  const addMs = Math.max(1, days) * 24 * 60 * 60 * 1000;
  await ensureLicenseSchema();
  const existing = await listActiveLicenses(profileId);
  const byId = new Map(existing.map((l) => [l.toolId, l]));
  let farthest = new Date(Date.now() + addMs);
  for (const toolId of toolIds) {
    const cur = byId.get(toolId);
    const base = cur?.periodEnd ? new Date(cur.periodEnd) : new Date();
    const from = base.getTime() > Date.now() ? base : new Date();
    const periodEnd = new Date(from.getTime() + addMs);
    if (periodEnd > farthest) farthest = periodEnd;
    await grantToolLicenses(profileId, [toolId], periodEnd);
  }
  return farthest;
}

/**
 * Raise (or clear) the freemium record cap for a profile+tool without requiring a paid license.
 * Pass null to clear the override.
 */
export async function setRecordLimitOverride(
  profileId: number,
  toolId: string,
  recordLimit: number | null,
): Promise<ToolLicense> {
  await ensureLicenseSchema();
  const limit =
    recordLimit == null || Number.isNaN(Number(recordLimit))
      ? null
      : Math.max(0, Math.floor(Number(recordLimit)));
  await pool.query(
    `INSERT INTO profile_tool_licenses
       (business_profile_id, tool_id, status, record_limit_override)
     VALUES (:profileId, :toolId, 'cancelled', :limit)
     ON DUPLICATE KEY UPDATE
       record_limit_override = :limit`,
    { profileId, toolId, limit },
  );
  const row = await getProfileToolEntitlement(profileId, toolId);
  if (!row) {
    throw Object.assign(new Error("Could not set record limit"), { status: 500 });
  }
  return row;
}

export async function revokeToolLicenses(profileId: number, toolIds?: string[]): Promise<void> {
  await ensureLicenseSchema();
  if (toolIds && toolIds.length > 0) {
    for (const toolId of toolIds) {
      await pool.query(
        `UPDATE profile_tool_licenses SET status = 'cancelled'
         WHERE business_profile_id = :profileId AND tool_id = :toolId`,
        { profileId, toolId },
      );
    }
  } else {
    await pool.query(
      `UPDATE profile_tool_licenses SET status = 'cancelled' WHERE business_profile_id = :profileId`,
      { profileId },
    );
  }
  const orgId = await orgIdForProfile(profileId);
  if (orgId) {
    await refreshOrgMrr(orgId);
    notifyLicensesRevoked({ organizationId: orgId, toolIds });
  }
}

export async function revokeToolLicensesForOrg(orgId: number, toolIds?: string[]): Promise<void> {
  await ensureLicenseSchema();
  const profileIds = await profileIdsForOrg(orgId);
  for (const profileId of profileIds) {
    if (toolIds && toolIds.length > 0) {
      for (const toolId of toolIds) {
        await pool.query(
          `UPDATE profile_tool_licenses SET status = 'cancelled'
           WHERE business_profile_id = :profileId AND tool_id = :toolId`,
          { profileId, toolId },
        );
      }
    } else {
      await pool.query(
        `UPDATE profile_tool_licenses SET status = 'cancelled' WHERE business_profile_id = :profileId`,
        { profileId },
      );
    }
  }
  await refreshOrgMrr(orgId);
  notifyLicensesRevoked({ organizationId: orgId, toolIds });
}

export async function grantAllPaidSkus(orgId: number, periodEnd: Date): Promise<string[]> {
  const skus = await listToolSkus();
  const paid = paidSkuIds(skus);
  await grantToolLicensesToOrg(orgId, paid, periodEnd);
  return paid;
}

/** Idempotent: grant any missing paid SKUs for All Tools Pack (all profiles under org). */
export async function ensureAllPaidLicenses(orgId: number, periodEnd: Date): Promise<string[]> {
  await ensureLicenseSchema();
  const skus = await listToolSkus();
  const paid = paidSkuIds(skus);
  if (paid.length === 0) return [];
  const profileIds = await profileIdsForOrg(orgId);
  const missing = new Set<string>();
  for (const profileId of profileIds) {
    const have = await licensedToolIdSet(profileId);
    for (const toolId of paid) {
      if (have.has(toolId)) continue;
      missing.add(toolId);
      await pool.query(
        `INSERT INTO profile_tool_licenses
           (business_profile_id, tool_id, status, source_claim_id, current_period_end)
         VALUES (:profileId, :toolId, 'active', NULL, :periodEnd)
         ON DUPLICATE KEY UPDATE
           status = 'active',
           current_period_end = COALESCE(current_period_end, :periodEnd)`,
        { profileId, toolId, periodEnd },
      );
    }
  }
  if (missing.size > 0) await refreshOrgMrr(orgId);
  return [...missing];
}

export async function licensedOrIncluded(
  profileId: number,
  toolId: string,
  sku?: ToolSku | null,
): Promise<boolean> {
  const row = sku ?? (await listToolSkus()).find((s) => s.toolId === toolId) ?? null;
  if (row?.includedFree || (row && row.priceInr <= 0)) return true;
  return isToolLicensed(profileId, toolId);
}

export async function hasEverLicensedTool(profileId: number, toolId: string): Promise<boolean> {
  await ensureLicenseSchema();
  const [rows] = await pool.query(
    `SELECT 1 AS ok FROM profile_tool_licenses
     WHERE business_profile_id = :profileId AND tool_id = :toolId
     LIMIT 1`,
    { profileId, toolId },
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function everLicensedToolIdSet(profileId: number): Promise<Set<string>> {
  await ensureLicenseSchema();
  const [rows] = await pool.query(
    `SELECT tool_id FROM profile_tool_licenses WHERE business_profile_id = :profileId`,
    { profileId },
  );
  return new Set(
    (Array.isArray(rows) ? rows : []).map((r) => String((r as { tool_id: string }).tool_id)),
  );
}

/**
 * Tools that already used a trial or any commercial billing row for this profile.
 * Cancelled license rows alone (admin mistake, no ledger) do not block a fresh trial.
 */
export async function trialConsumedToolIdSet(profileId: number): Promise<Set<string>> {
  await ensureLicenseSchema();
  try {
    const { ensureSubscriptionItemsSchema } = await import("./subscription-items.js");
    await ensureSubscriptionItemsSchema();
    const orgId = await orgIdForProfile(profileId);
    if (!orgId) return everLicensedToolIdSet(profileId);
    // Seat ledger is still org-scoped; trial consumption is tracked per profile via licenses
    // that were granted with a trial period, plus any org item created from a trial on this profile.
    const [rows] = await pool.query(
      `SELECT DISTINCT tool_id FROM profile_tool_licenses
       WHERE business_profile_id = :profileId
         AND (
           status = 'active'
           OR source_claim_id IS NOT NULL
           OR (current_period_end IS NOT NULL AND current_period_end <= NOW())
         )`,
      { profileId },
    );
    const fromLicenses = new Set(
      (Array.isArray(rows) ? rows : []).map((r) => String((r as { tool_id: string }).tool_id)),
    );
    const [itemRows] = await pool.query(
      `SELECT DISTINCT tool_id FROM org_subscription_items
       WHERE organization_id = :orgId AND source = 'trial'`,
      { orgId },
    );
    for (const r of Array.isArray(itemRows) ? itemRows : []) {
      fromLicenses.add(String((r as { tool_id: string }).tool_id));
    }
    return fromLicenses;
  } catch {
    return everLicensedToolIdSet(profileId);
  }
}

async function orgIdForProfile(profileId: number): Promise<number | null> {
  const [rows] = await pool.query(
    `SELECT organization_id FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: profileId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { organization_id: number } | undefined) : undefined;
  return row?.organization_id != null ? Number(row.organization_id) : null;
}

export async function refreshOrgMrr(orgId: number): Promise<number> {
  try {
    const { syncSubscriptionItemsFromLicenses } = await import("./subscription-items.js");
    await syncSubscriptionItemsFromLicenses(orgId);
    const [sumRows] = await pool.query(
      `SELECT COALESCE(SUM(unit_price_inr * COALESCE(quantity, 1)), 0) AS mrr
       FROM org_subscription_items
       WHERE organization_id = :orgId AND status = 'active'`,
      { orgId },
    );
    const raw = Number(
      (Array.isArray(sumRows) ? (sumRows[0] as { mrr: number }) : { mrr: 0 }).mrr ?? 0,
    );
    const mrr = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    await pool.query(`UPDATE org_subscriptions SET mrr_inr = :mrr WHERE organization_id = :orgId`, {
      mrr,
      orgId,
    });
    return mrr;
  } catch {
    const licenses = await listActiveLicensesForOrg(orgId);
    const skus = await listToolSkus();
    const byId = new Map(skus.map((s) => [s.toolId, s]));
    const seats = new Map<string, number>();
    for (const lic of licenses) {
      seats.set(lic.toolId, (seats.get(lic.toolId) ?? 0) + 1);
    }
    let mrr = 0;
    for (const [toolId, qty] of seats) {
      const sku = byId.get(toolId);
      if (!sku || sku.includedFree) continue;
      const line = Number(sku.priceInr) * qty;
      if (Number.isFinite(line)) mrr += line;
    }
    await pool.query(`UPDATE org_subscriptions SET mrr_inr = :mrr WHERE organization_id = :orgId`, {
      mrr,
      orgId,
    });
    return mrr;
  }
}

export function catalogPayload(
  skus: ToolSku[],
  licensed: Set<string>,
  trialConsumed: Set<string> = new Set(),
) {
  return skus
    .filter((s) => s.available)
    .map((s) => {
      const includedFree = s.includedFree || s.priceInr <= 0;
      const isLicensed = licensed.has(s.toolId) || includedFree;
      return {
        toolId: s.toolId,
        name: s.name,
        category: s.category,
        tagline: s.tagline,
        priceInr: s.priceInr,
        annualPriceInr: s.annualPriceInr,
        billingInterval: s.billingInterval,
        includedFree,
        accessPolicy: s.accessPolicy,
        featured: s.featured,
        trialDays: s.trialDays,
        licensed: isLicensed,
        trialEligible:
          !includedFree &&
          !isLicensed &&
          s.trialDays > 0 &&
          !trialConsumed.has(s.toolId),
      };
    });
}
