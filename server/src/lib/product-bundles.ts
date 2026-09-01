import { pool } from "../db.js";
import { listToolSkus, paidSkuIds, type ToolSku } from "./tool-skus.js";

export type ProductBundle = {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  discountPct: number;
  fixedPriceInr: number | null;
  available: boolean;
  highlighted: boolean;
  sortOrder: number;
  toolIds: string[];
  /** Resolved list price before discount (sum of SKUs, or fixed). */
  listPriceInr: number;
  /** Payable after discount / fixed override. */
  priceInr: number;
};

let schemaReady: Promise<void> | null = null;

export async function ensureProductBundleSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS product_bundles (
          id VARCHAR(64) NOT NULL,
          name VARCHAR(120) NOT NULL,
          tagline VARCHAR(160) NULL,
          description TEXT NULL,
          discount_pct DECIMAL(5, 2) NOT NULL DEFAULT 0,
          fixed_price_inr DECIMAL(12, 2) NULL,
          available TINYINT(1) NOT NULL DEFAULT 1,
          highlighted TINYINT(1) NOT NULL DEFAULT 0,
          sort_order INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS product_bundle_items (
          bundle_id VARCHAR(64) NOT NULL,
          tool_id VARCHAR(64) NOT NULL,
          PRIMARY KEY (bundle_id, tool_id),
          KEY idx_pbi_tool (tool_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(
        `INSERT IGNORE INTO product_bundles
           (id, name, tagline, description, discount_pct, fixed_price_inr, available, highlighted, sort_order)
         VALUES
           ('all_tools', 'All Tools Pack', 'Every paid business tool',
            'Grants a license for every paid tool SKU. À la carte remains available per tool.',
            0, NULL, 1, 1, 0)`,
      );
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function resolvePrice(toolIds: string[], skus: ToolSku[], discountPct: number, fixed: number | null) {
  const byId = new Map(skus.map((s) => [s.toolId, s]));
  const listPriceInr = toolIds.reduce((sum, id) => {
    const sku = byId.get(id);
    if (!sku || sku.includedFree) return sum;
    return sum + sku.priceInr;
  }, 0);
  if (fixed != null && fixed >= 0) {
    return { listPriceInr, priceInr: fixed };
  }
  const pct = Math.max(0, Math.min(100, discountPct));
  return { listPriceInr, priceInr: Math.round(listPriceInr * (1 - pct / 100)) };
}

async function loadBundleItems(bundleId: string): Promise<string[]> {
  const [rows] = await pool.query(
    `SELECT tool_id FROM product_bundle_items WHERE bundle_id = :id ORDER BY tool_id`,
    { id: bundleId },
  );
  return (Array.isArray(rows) ? rows : []).map((r) => String((r as { tool_id: string }).tool_id));
}

async function mapBundle(
  r: Record<string, unknown>,
  skus: ToolSku[],
  toolIdsOverride?: string[],
): Promise<ProductBundle> {
  const id = String(r.id);
  let toolIds = toolIdsOverride ?? (await loadBundleItems(id));
  if (id === "all_tools" && toolIds.length === 0) {
    toolIds = paidSkuIds(skus);
  }
  const discountPct = Number(r.discount_pct ?? 0);
  const fixedPriceInr = r.fixed_price_inr == null ? null : Number(r.fixed_price_inr);
  const { listPriceInr, priceInr } = resolvePrice(toolIds, skus, discountPct, fixedPriceInr);
  return {
    id,
    name: String(r.name),
    tagline: r.tagline == null ? null : String(r.tagline),
    description: r.description == null ? null : String(r.description),
    discountPct,
    fixedPriceInr,
    available: Boolean(r.available),
    highlighted: Boolean(r.highlighted),
    sortOrder: Number(r.sort_order ?? 0),
    toolIds,
    listPriceInr,
    priceInr,
  };
}

export async function listProductBundles(): Promise<ProductBundle[]> {
  await ensureProductBundleSchema();
  const skus = await listToolSkus();
  const [rows] = await pool.query(`SELECT * FROM product_bundles ORDER BY sort_order, name`);
  const list: ProductBundle[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    list.push(await mapBundle(row as Record<string, unknown>, skus));
  }
  return list;
}

export async function getProductBundle(id: string): Promise<ProductBundle | null> {
  await ensureProductBundleSchema();
  const [rows] = await pool.query(`SELECT * FROM product_bundles WHERE id = :id`, { id });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return mapBundle(row as Record<string, unknown>, await listToolSkus());
}

export async function upsertProductBundle(input: {
  id: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  discountPct?: number;
  fixedPriceInr?: number | null;
  available?: boolean;
  highlighted?: boolean;
  sortOrder?: number;
  toolIds?: string[];
}): Promise<ProductBundle> {
  await ensureProductBundleSchema();
  const id = String(input.id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  if (!id) throw Object.assign(new Error("bundle id required"), { status: 400 });
  const name = String(input.name ?? "").trim();
  if (!name) throw Object.assign(new Error("bundle name required"), { status: 400 });

  await pool.query(
    `INSERT INTO product_bundles
       (id, name, tagline, description, discount_pct, fixed_price_inr, available, highlighted, sort_order)
     VALUES (:id, :name, :tagline, :description, :discount, :fixed, :available, :highlighted, :sortOrder)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       tagline = VALUES(tagline),
       description = VALUES(description),
       discount_pct = VALUES(discount_pct),
       fixed_price_inr = VALUES(fixed_price_inr),
       available = VALUES(available),
       highlighted = VALUES(highlighted),
       sort_order = VALUES(sort_order)`,
    {
      id,
      name,
      tagline: input.tagline?.trim() || null,
      description: input.description?.trim() || null,
      discount: Math.max(0, Math.min(100, Number(input.discountPct ?? 0))),
      fixed: input.fixedPriceInr == null ? null : Math.max(0, Number(input.fixedPriceInr)),
      available: input.available === false ? 0 : 1,
      highlighted: input.highlighted ? 1 : 0,
      sortOrder: Number(input.sortOrder ?? 0),
    },
  );

  if (Array.isArray(input.toolIds)) {
    await pool.query(`DELETE FROM product_bundle_items WHERE bundle_id = :id`, { id });
    const unique = [...new Set(input.toolIds.map(String).filter(Boolean))];
    for (const toolId of unique) {
      await pool.query(
        `INSERT INTO product_bundle_items (bundle_id, tool_id) VALUES (:id, :toolId)`,
        { id, toolId },
      );
    }
  }

  const bundle = await getProductBundle(id);
  if (!bundle) throw Object.assign(new Error("Bundle save failed"), { status: 500 });
  return bundle;
}

export async function deleteProductBundle(id: string): Promise<void> {
  await ensureProductBundleSchema();
  if (id === "all_tools") {
    throw Object.assign(new Error("Cannot delete the All Tools Pack"), { status: 400 });
  }
  await pool.query(`DELETE FROM product_bundle_items WHERE bundle_id = :id`, { id });
  await pool.query(`DELETE FROM product_bundles WHERE id = :id`, { id });
}

/** Resolve tool ids a pack should grant (all_tools expands to every paid SKU). */
export async function resolveBundleToolIds(bundleId: string): Promise<string[]> {
  const bundle = await getProductBundle(bundleId);
  if (!bundle) throw Object.assign(new Error("Unknown pack"), { status: 404 });
  return bundle.toolIds;
}
