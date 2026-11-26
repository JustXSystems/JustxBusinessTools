import type { PoolConnection } from "mysql2/promise";
import { exec, json, money, one, rows, type Queryable } from "./db.js";
import { round2, round3 } from "./logic.js";

export type StockSignals = {
  /** Qty reserved on unposted draft/verified BOM DCs and Sales Order DCs per itemId. */
  reserved: Map<string, number>;
  /** Remaining unreceived qty on open Purchase Orders (approved / sent / partially_received) per itemId. */
  onOrder: Map<string, number>;
};

function addQty(map: Map<string, number>, itemId: string | null | undefined, qty: number) {
  if (!itemId || !(qty > 0)) return;
  map.set(itemId, round3((map.get(itemId) ?? 0) + qty));
}

/** Aggregates remaining unreceived qty across approved/sent/partially_received purchase orders. */
export async function loadOpenPoQtyByItem(db: Queryable, tenantId: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const pos = await rows<{ lines: unknown }>(
      db,
      `SELECT \`lines\` FROM ims_purchase_orders
       WHERE tenant_id = :tenantId AND status IN ('approved', 'sent', 'partially_received')`,
      { tenantId },
    );
    for (const po of pos) {
      const lines = json<Array<{ itemId?: string | null; qty?: number; receivedQty?: number }>>(po.lines, []);
      for (const l of lines) {
        if (!l?.itemId) continue;
        const rem = round3(Math.max(0, money(l.qty) - money(l.receivedQty)));
        if (rem > 0) addQty(out, l.itemId, rem);
      }
    }
  } catch {
    /* Optional table in minimal test fixtures */
  }
  return out;
}

/** Aggregates stock reserved on unposted live delivery challans (BOM DCs & Sales Order DCs). */
export async function loadReservedQtyByItem(db: Queryable, tenantId: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const [bomRes, soRes] = await Promise.all([
    rows<{ item_id: string; qty: string }>(
      db,
      `SELECT l.item_id, SUM(l.qty) AS qty
       FROM ims_bom_dc_lines l
       INNER JOIN ims_bom_dcs d ON d.id = l.dc_id AND d.tenant_id = l.tenant_id
       WHERE l.tenant_id = :tenantId AND l.item_id IS NOT NULL
         AND d.status IN ('draft', 'verified') AND d.stock_posted = 0
       GROUP BY l.item_id`,
      { tenantId },
    ).catch(() => []),
    rows<{ lines: unknown }>(
      db,
      `SELECT \`lines\` FROM ims_so_dcs
       WHERE tenant_id = :tenantId AND status IN ('draft', 'verified') AND stock_posted = 0`,
      { tenantId },
    ).catch(() => []),
  ]);
  for (const r of bomRes) addQty(out, r.item_id, money(r.qty));
  for (const d of soRes) {
    const lines = json<Array<{ itemId?: string | null; qty?: number }>>(d.lines, []);
    for (const l of lines) addQty(out, l?.itemId, money(l?.qty));
  }
  return out;
}

/** Loads both `reserved` and `onOrder` stock signals in parallel for a tenant. */
export async function loadStockSignals(db: Queryable, tenantId: number): Promise<StockSignals> {
  const [reserved, onOrder] = await Promise.all([loadReservedQtyByItem(db, tenantId), loadOpenPoQtyByItem(db, tenantId)]);
  return { reserved, onOrder };
}

/**
 * Specific-identification unit cost for serialized items:
 * returns the exact average `purchase_price` of the specified serial codes (or null if none carry a cost).
 */
export async function serialsAvgCost(
  conn: Queryable,
  tenantId: number,
  itemId: string,
  serials: ReadonlyArray<string>,
): Promise<number | null> {
  const clean = [...new Set(serials.map((s) => s.trim()).filter(Boolean))];
  if (!clean.length) return null;
  const params: Record<string, unknown> = { tenantId, itemId };
  const placeholders = clean.map((code, i) => {
    params[`c${i}`] = code;
    return `:c${i}`;
  });
  const row = await one<{ cnt: number; avg_cost: string | null }>(
    conn,
    `SELECT COUNT(*) AS cnt, AVG(purchase_price) AS avg_cost
     FROM ims_item_serials
     WHERE tenant_id = :tenantId AND item_id = :itemId
       AND serial_no IN (${placeholders.join(", ")})
       AND purchase_price IS NOT NULL AND purchase_price > 0`,
    params,
  );
  if (!row || Number(row.cnt) <= 0 || row.avg_cost == null) return null;
  return round2(money(row.avg_cost));
}

/**
 * Re-synchronizes a serialized item's `purchase_price` to the exact Specific-Identification
 * average cost of its remaining `in_stock` serials (when those serials record unit purchase prices).
 * No-op if the item is not serialized or has no remaining costed `in_stock` serials.
 */
export async function syncSerializedItemCost(conn: PoolConnection, tenantId: number, itemId: string): Promise<void> {
  const row = await one<{ cnt: number; avg_cost: string | null }>(
    conn,
    `SELECT COUNT(*) AS cnt, AVG(purchase_price) AS avg_cost
     FROM ims_item_serials
     WHERE tenant_id = :tenantId AND item_id = :itemId
       AND status = 'in_stock'
       AND purchase_price IS NOT NULL AND purchase_price > 0`,
    { tenantId, itemId },
  );
  if (!row || Number(row.cnt) <= 0 || row.avg_cost == null) return;
  await exec(
    conn,
    `UPDATE ims_items SET purchase_price = :avgCost WHERE tenant_id = :tenantId AND id = :itemId AND track_serials = 1`,
    { avgCost: round2(money(row.avg_cost)), tenantId, itemId },
  );
}
