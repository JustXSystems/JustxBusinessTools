import { pool } from "../db.js";
import { jsonVal } from "./admin/approvals.js";

export type ToolSku = {
  toolId: string;
  name: string;
  category: string;
  priceInr: number;
  billingInterval: string;
  includedFree: boolean;
  available: boolean;
  sortOrder: number;
};

export const DEFAULT_TOOL_SKUS: Array<Omit<ToolSku, "billingInterval" | "available" | "sortOrder">> = [
  { toolId: "quotation", name: "Quotation Creator", category: "Sales & Business", priceInr: 149, includedFree: false },
  { toolId: "quotationv1", name: "Quotation Generator V1", category: "Sales & Business", priceInr: 199, includedFree: false },
  { toolId: "salesorder", name: "Sales Order Creator", category: "Sales & Business", priceInr: 149, includedFree: false },
  { toolId: "invoice", name: "Invoice Creator", category: "Sales & Business", priceInr: 199, includedFree: false },
  { toolId: "paymenttracker", name: "Payment Tracker", category: "Sales & Business", priceInr: 99, includedFree: false },
  { toolId: "po", name: "Purchase Order (PO) Creator", category: "Procurement", priceInr: 149, includedFree: false },
  { toolId: "vendors", name: "Vendor Directory", category: "Procurement", priceInr: 79, includedFree: false },
  { toolId: "stock", name: "Stock In / Stock Out", category: "Inventory", priceInr: 149, includedFree: false },
  { toolId: "projects", name: "Project Creator", category: "Projects & Service", priceInr: 129, includedFree: false },
  { toolId: "amc", name: "AMC Tracker", category: "Projects & Service", priceInr: 99, includedFree: false },
  { toolId: "servicetasks", name: "Service Task Creator", category: "Projects & Service", priceInr: 99, includedFree: false },
  { toolId: "installation", name: "Installation Report", category: "Projects & Service", priceInr: 99, includedFree: false },
  { toolId: "sitesurvey", name: "Solar Site Survey", category: "Solar Solutions", priceInr: 79, includedFree: false },
  { toolId: "sitesurveyv1", name: "Site Survey Generator V1", category: "Solar Solutions", priceInr: 149, includedFree: false },
  { toolId: "solarroi", name: "Solar ROI Calculator", category: "Solar Solutions", priceInr: 0, includedFree: true },
  { toolId: "gstcalc", name: "GST Calculator", category: "Finance & Calculators", priceInr: 0, includedFree: true },
  { toolId: "tdscalc", name: "TDS Calculator", category: "Finance & Calculators", priceInr: 0, includedFree: true },
  { toolId: "taxcalc", name: "Tax Calculator", category: "Finance & Calculators", priceInr: 0, includedFree: true },
  { toolId: "profitcalc", name: "Profit Calculator", category: "Finance & Calculators", priceInr: 0, includedFree: true },
  { toolId: "emicalc", name: "EMI Calculator", category: "Finance & Calculators", priceInr: 0, includedFree: true },
  { toolId: "loancalc", name: "Loan Calculator", category: "Finance & Calculators", priceInr: 0, includedFree: true },
  { toolId: "dealercommission", name: "Commission Calculator", category: "Dealers / Distributors", priceInr: 0, includedFree: true },
  { toolId: "pricelist", name: "Price List Manager", category: "Dealers / Distributors", priceInr: 99, includedFree: false },
  { toolId: "creditlimit", name: "Credit Limit Tracker", category: "Dealers / Distributors", priceInr: 99, includedFree: false },
  { toolId: "targettracker", name: "Target vs Achievement", category: "Dealers / Distributors", priceInr: 79, includedFree: false },
  { toolId: "dealerorders", name: "Dealer Order Tracker", category: "Dealers / Distributors", priceInr: 99, includedFree: false },
  { toolId: "visitors", name: "Visitor & Appointment Manager", category: "Utilities", priceInr: 49, includedFree: false },
  { toolId: "notifications", name: "Notifications", category: "Utilities", priceInr: 0, includedFree: true },
  { toolId: "qrscanner", name: "QR Code Scanner", category: "Utilities", priceInr: 0, includedFree: true },
];

let schemaReady: Promise<void> | null = null;

export async function ensureToolSkuSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tool_skus (
          tool_id VARCHAR(64) NOT NULL,
          name VARCHAR(120) NOT NULL,
          category VARCHAR(80) NOT NULL DEFAULT 'General',
          price_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
          billing_interval VARCHAR(20) NOT NULL DEFAULT 'month',
          included_free TINYINT(1) NOT NULL DEFAULT 0,
          available TINYINT(1) NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (tool_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS org_tool_licenses (
          organization_id INT UNSIGNED NOT NULL,
          tool_id VARCHAR(64) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          source_claim_id BIGINT UNSIGNED NULL,
          current_period_end TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (organization_id, tool_id),
          KEY idx_otl_org_status (organization_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      let order = 0;
      for (const sku of DEFAULT_TOOL_SKUS) {
        await pool.query(
          `INSERT IGNORE INTO tool_skus
             (tool_id, name, category, price_inr, billing_interval, included_free, available, sort_order)
           VALUES (:toolId, :name, :category, :price, 'month', :included, 1, :sortOrder)`,
          {
            toolId: sku.toolId,
            name: sku.name,
            category: sku.category,
            price: sku.priceInr,
            included: sku.includedFree ? 1 : 0,
            sortOrder: order++,
          },
        );
      }
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function mapSku(r: Record<string, unknown>): ToolSku {
  return {
    toolId: String(r.tool_id),
    name: String(r.name),
    category: String(r.category),
    priceInr: Number(r.price_inr ?? 0),
    billingInterval: String(r.billing_interval ?? "month"),
    includedFree: Boolean(r.included_free),
    available: Boolean(r.available),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

export async function listToolSkus(): Promise<ToolSku[]> {
  await ensureToolSkuSchema();
  const [rows] = await pool.query(
    `SELECT * FROM tool_skus ORDER BY sort_order, name`,
  );
  return (Array.isArray(rows) ? rows : []).map((row) => mapSku(row as Record<string, unknown>));
}

export async function getToolSku(toolId: string): Promise<ToolSku | null> {
  await ensureToolSkuSchema();
  const [rows] = await pool.query(`SELECT * FROM tool_skus WHERE tool_id = :id`, { id: toolId });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? mapSku(row as Record<string, unknown>) : null;
}

export async function updateToolSku(
  toolId: string,
  input: Partial<Pick<ToolSku, "name" | "category" | "priceInr" | "billingInterval" | "includedFree" | "available" | "sortOrder">>,
): Promise<ToolSku> {
  await ensureToolSkuSchema();
  const current = await getToolSku(toolId);
  if (!current) {
    throw Object.assign(new Error("Unknown tool SKU"), { status: 404 });
  }
  const next: ToolSku = {
    ...current,
    name: input.name?.trim() || current.name,
    category: input.category?.trim() || current.category,
    priceInr: input.priceInr == null ? current.priceInr : Math.max(0, Number(input.priceInr)),
    billingInterval: input.billingInterval || current.billingInterval,
    includedFree: input.includedFree ?? current.includedFree,
    available: input.available ?? current.available,
    sortOrder: input.sortOrder ?? current.sortOrder,
  };
  await pool.query(
    `UPDATE tool_skus SET
       name = :name, category = :category, price_inr = :price, billing_interval = :interval,
       included_free = :included, available = :available, sort_order = :sortOrder
     WHERE tool_id = :id`,
    {
      id: toolId,
      name: next.name,
      category: next.category,
      price: next.priceInr,
      interval: next.billingInterval,
      included: next.includedFree ? 1 : 0,
      available: next.available ? 1 : 0,
      sortOrder: next.sortOrder,
    },
  );
  return next;
}

export type CartLine = {
  toolId: string;
  name: string;
  category: string;
  priceInr: number;
  billingInterval: string;
};

export type CartQuote = {
  lines: CartLine[];
  totalInr: number;
  billingInterval: string;
};

export function parseToolIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  }
  if (typeof raw === "string") {
    const parsed = jsonVal(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((x) => String(x).trim()).filter(Boolean))];
    }
    return [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))];
  }
  return [];
}

export async function quoteToolCart(
  toolIds: string[],
  licensedIds: Set<string>,
): Promise<CartQuote> {
  const skus = await listToolSkus();
  const byId = new Map(skus.map((s) => [s.toolId, s]));
  const lines: CartLine[] = [];
  for (const id of parseToolIds(toolIds)) {
    const sku = byId.get(id);
    if (!sku || !sku.available) {
      throw Object.assign(new Error(`Tool "${id}" is not available for subscription`), { status: 400 });
    }
    if (sku.includedFree || sku.priceInr <= 0) {
      throw Object.assign(new Error(`${sku.name} is included — no subscription required`), { status: 400 });
    }
    if (licensedIds.has(id)) {
      throw Object.assign(new Error(`${sku.name} is already licensed`), { status: 400 });
    }
    lines.push({
      toolId: sku.toolId,
      name: sku.name,
      category: sku.category,
      priceInr: sku.priceInr,
      billingInterval: sku.billingInterval,
    });
  }
  if (lines.length === 0) {
    throw Object.assign(new Error("Select at least one paid tool"), { status: 400 });
  }
  const totalInr = lines.reduce((sum, line) => sum + line.priceInr, 0);
  return {
    lines,
    totalInr,
    billingInterval: lines[0]?.billingInterval ?? "month",
  };
}
