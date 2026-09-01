import { pool } from "../db.js";
import { ensureTablesUtf8mb4UnicodeCi, INNODB_UTF8MB4_UNICODE } from "./mysql-charset.js";
import { listToolSkus } from "./tool-skus.js";
import { listActiveLicenses } from "./tool-licenses.js";

export type SubscriptionItem = {
  toolId: string;
  name: string;
  unitPriceInr: number;
  status: string;
  source: string | null;
  externalRef: string | null;
  periodEnd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

let schemaReady: Promise<void> | null = null;

export async function ensureSubscriptionItemsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS org_subscription_items (
          organization_id INT UNSIGNED NOT NULL,
          tool_id VARCHAR(64) NOT NULL,
          unit_price_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          source VARCHAR(40) NULL,
          external_ref VARCHAR(128) NULL,
          current_period_end TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (organization_id, tool_id),
          KEY idx_osi_org_status (organization_id, status)
        ) ${INNODB_UTF8MB4_UNICODE}
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS checkout_intents (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          organization_id INT UNSIGNED NOT NULL,
          profile_id INT NOT NULL,
          session_id VARCHAR(128) NOT NULL,
          tool_ids JSON NOT NULL,
          amount_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
          provider VARCHAR(40) NOT NULL DEFAULT 'mock',
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uk_checkout_session (session_id),
          KEY idx_checkout_org (organization_id, status)
        ) ${INNODB_UTF8MB4_UNICODE}
      `);
      await ensureTablesUtf8mb4UnicodeCi([
        "org_subscription_items",
        "checkout_intents",
      ]);
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

export async function listSubscriptionItems(orgId: number): Promise<SubscriptionItem[]> {
  await ensureSubscriptionItemsSchema();
  const [rows] = await pool.query(
    `SELECT i.tool_id, i.unit_price_inr, i.status, i.source, i.external_ref,
            i.current_period_end, i.created_at, i.updated_at, s.name
     FROM org_subscription_items i
     LEFT JOIN tool_skus s ON s.tool_id = i.tool_id
     WHERE i.organization_id = :orgId AND i.status = 'active'
     ORDER BY s.sort_order, i.tool_id`,
    { orgId },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      toolId: String(r.tool_id),
      name: String(r.name ?? r.tool_id),
      unitPriceInr: Number(r.unit_price_inr ?? 0),
      status: String(r.status),
      source: r.source == null ? null : String(r.source),
      externalRef: r.external_ref == null ? null : String(r.external_ref),
      periodEnd: r.current_period_end ? String(r.current_period_end) : null,
      createdAt: r.created_at ? String(r.created_at) : null,
      updatedAt: r.updated_at ? String(r.updated_at) : null,
    };
  });
}

/**
 * Rebuild active billing line items from active licenses + current SKU list prices.
 * Keeps org_subscriptions.mrr_inr aligned with the commercial ledger.
 */
export async function syncSubscriptionItemsFromLicenses(
  orgId: number,
  meta?: { source?: string | null; externalRef?: string | null },
): Promise<SubscriptionItem[]> {
  await ensureSubscriptionItemsSchema();
  const [licenses, skus] = await Promise.all([listActiveLicenses(orgId), listToolSkus()]);
  const byId = new Map(skus.map((s) => [s.toolId, s]));

  await pool.query(
    `UPDATE org_subscription_items SET status = 'cancelled'
     WHERE organization_id = :orgId AND status = 'active'`,
    { orgId },
  );

  for (const lic of licenses) {
    const sku = byId.get(lic.toolId);
    const listPrice = sku && !sku.includedFree ? sku.priceInr : 0;
    await pool.query(
      `INSERT INTO org_subscription_items
         (organization_id, tool_id, unit_price_inr, status, source, external_ref, current_period_end)
       VALUES (:orgId, :toolId, :price, 'active', :source, :externalRef, :periodEnd)
       ON DUPLICATE KEY UPDATE
         unit_price_inr = CASE
           WHEN :source = 'trial' THEN 0
           WHEN source = 'trial' AND :source IS NULL THEN 0
           ELSE :price
         END,
         status = 'active',
         source = COALESCE(:source, source),
         external_ref = COALESCE(:externalRef, external_ref),
         current_period_end = :periodEnd`,
      {
        orgId,
        toolId: lic.toolId,
        price: meta?.source === "trial" ? 0 : listPrice,
        source: meta?.source ?? null,
        externalRef: meta?.externalRef ?? null,
        periodEnd: lic.periodEnd ? new Date(lic.periodEnd) : null,
      },
    );
  }

  return listSubscriptionItems(orgId);
}

/**
 * When platform SKU list price changes, update active billing lines (except trials)
 * and recompute MRR for affected organizations.
 */
export async function repriceActiveItemsForSku(
  toolId: string,
  priceInr: number,
  opts?: { includedFree?: boolean },
): Promise<void> {
  await ensureSubscriptionItemsSchema();
  const nextPrice = opts?.includedFree ? 0 : Math.max(0, Number(priceInr) || 0);
  await pool.query(
    `UPDATE org_subscription_items
     SET unit_price_inr = :price
     WHERE tool_id = :toolId
       AND status = 'active'
       AND (source IS NULL OR source <> 'trial')`,
    { toolId, price: nextPrice },
  );
  await pool.query(
    `UPDATE org_subscriptions os
     SET mrr_inr = (
       SELECT COALESCE(SUM(i.unit_price_inr), 0)
       FROM org_subscription_items i
       WHERE i.organization_id = os.organization_id AND i.status = 'active'
     )
     WHERE EXISTS (
       SELECT 1 FROM org_subscription_items x
       WHERE x.organization_id = os.organization_id
         AND x.tool_id = :toolId
         AND x.status = 'active'
     )`,
    { toolId },
  );
}

/** Align one org's active non-trial line prices with current SKU list prices. */
export async function alignOrgItemPricesWithSkus(orgId: number): Promise<number> {
  await ensureSubscriptionItemsSchema();
  const skus = await listToolSkus();
  for (const sku of skus) {
    const price = sku.includedFree ? 0 : sku.priceInr;
    await pool.query(
      `UPDATE org_subscription_items
       SET unit_price_inr = :price
       WHERE organization_id = :orgId
         AND tool_id = :toolId
         AND status = 'active'
         AND (source IS NULL OR source <> 'trial')`,
      { orgId, toolId: sku.toolId, price },
    );
  }
  const [sumRows] = await pool.query(
    `SELECT COALESCE(SUM(unit_price_inr), 0) AS mrr
     FROM org_subscription_items
     WHERE organization_id = :orgId AND status = 'active'`,
    { orgId },
  );
  const mrr = Number(
    (Array.isArray(sumRows) ? (sumRows[0] as { mrr: number }) : { mrr: 0 }).mrr ?? 0,
  );
  try {
    await pool.query(`UPDATE org_subscriptions SET mrr_inr = :mrr WHERE organization_id = :orgId`, {
      mrr,
      orgId,
    });
  } catch {
    /* mrr_inr column may be missing on older DBs */
  }
  return mrr;
}

export async function createCheckoutIntent(input: {
  orgId: number;
  profileId: number;
  sessionId: string;
  toolIds: string[];
  amountInr: number;
  provider: string;
}): Promise<void> {
  await ensureSubscriptionItemsSchema();
  await pool.query(
    `INSERT INTO checkout_intents
       (organization_id, profile_id, session_id, tool_ids, amount_inr, provider, status)
     VALUES (:orgId, :profileId, :sessionId, :toolIds, :amount, :provider, 'pending')
     ON DUPLICATE KEY UPDATE
       tool_ids = VALUES(tool_ids),
       amount_inr = VALUES(amount_inr),
       status = 'pending',
       completed_at = NULL`,
    {
      orgId: input.orgId,
      profileId: input.profileId,
      sessionId: input.sessionId,
      toolIds: JSON.stringify(input.toolIds),
      amount: input.amountInr,
      provider: input.provider,
    },
  );
}

function parseToolIdsJson(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export async function getCheckoutIntent(sessionId: string): Promise<{
  orgId: number;
  profileId: number;
  toolIds: string[];
  amountInr: number;
  status: string;
} | null> {
  await ensureSubscriptionItemsSchema();
  const [rows] = await pool.query(
    `SELECT organization_id, profile_id, tool_ids, amount_inr, status
     FROM checkout_intents WHERE session_id = :sessionId LIMIT 1`,
    { sessionId },
  );
  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  return {
    orgId: Number(row.organization_id),
    profileId: Number(row.profile_id),
    toolIds: parseToolIdsJson(row.tool_ids),
    amountInr: Number(row.amount_inr ?? 0),
    status: String(row.status ?? ""),
  };
}

export async function completeCheckoutIntent(sessionId: string): Promise<{
  orgId: number;
  profileId: number;
  toolIds: string[];
  amountInr: number;
} | null> {
  const row = await getCheckoutIntent(sessionId);
  if (!row) return null;
  if (row.status !== "completed") {
    await pool.query(
      `UPDATE checkout_intents SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE session_id = :sessionId`,
      { sessionId },
    );
  }
  return {
    orgId: row.orgId,
    profileId: row.profileId,
    toolIds: row.toolIds,
    amountInr: row.amountInr,
  };
}
