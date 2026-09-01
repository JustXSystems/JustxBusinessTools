import { pool } from "../db.js";
import { jsonVal } from "./admin/approvals.js";

export type AccessPolicy = "soft_cap" | "hard_lock";

export type ToolSku = {
  toolId: string;
  name: string;
  category: string;
  tagline: string | null;
  description: string | null;
  priceInr: number;
  annualPriceInr: number | null;
  billingInterval: string;
  includedFree: boolean;
  available: boolean;
  sortOrder: number;
  trialDays: number;
  /** soft_cap = freemium records; hard_lock = no creates until licensed */
  accessPolicy: AccessPolicy;
  /** Override platform free record cap when unlicensed; null = use plan default */
  unlicensedRecordLimit: number | null;
  featured: boolean;
};

export const DEFAULT_TOOL_SKUS: Array<
  Omit<
    ToolSku,
    | "billingInterval"
    | "available"
    | "sortOrder"
    | "tagline"
    | "description"
    | "annualPriceInr"
    | "trialDays"
    | "accessPolicy"
    | "unlicensedRecordLimit"
    | "featured"
  >
> = [
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

async function tryAlter(sql: string): Promise<void> {
  try {
    await pool.query(sql);
  } catch {
    /* column / table already exists */
  }
}

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
      await tryAlter(`ALTER TABLE tool_skus ADD COLUMN tagline VARCHAR(160) NULL`);
      await tryAlter(`ALTER TABLE tool_skus ADD COLUMN description TEXT NULL`);
      await tryAlter(`ALTER TABLE tool_skus ADD COLUMN annual_price_inr DECIMAL(12, 2) NULL`);
      await tryAlter(`ALTER TABLE tool_skus ADD COLUMN trial_days INT NOT NULL DEFAULT 0`);
      await tryAlter(
        `ALTER TABLE tool_skus ADD COLUMN access_policy VARCHAR(20) NOT NULL DEFAULT 'soft_cap'`,
      );
      await tryAlter(`ALTER TABLE tool_skus ADD COLUMN unlicensed_record_limit INT NULL`);
      await tryAlter(`ALTER TABLE tool_skus ADD COLUMN featured TINYINT(1) NOT NULL DEFAULT 0`);

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

      // One-time conversion defaults: hard-lock high-ARPU tools + 14-day trial.
      // Skips rows already customized (non-default policy). Never fail SKU boot on this.
      try {
        const [flagRows] = await pool.query(
          `SELECT config_key FROM platform_config WHERE config_key = 'commerce_defaults_v1' LIMIT 1`,
        );
        if (!Array.isArray(flagRows) || flagRows.length === 0) {
          await pool.query(
            `UPDATE tool_skus
             SET access_policy = 'hard_lock',
                 trial_days = IF(trial_days > 0, trial_days, 14)
             WHERE tool_id IN ('invoice', 'quotation', 'quotationv1')
               AND access_policy = 'soft_cap'`,
          );
          await pool.query(
            `INSERT INTO platform_config (config_key, value)
             VALUES ('commerce_defaults_v1', CAST(:value AS JSON))`,
            {
              value: JSON.stringify({
                hardLock: ["invoice", "quotation", "quotationv1"],
                trialDays: 14,
              }),
            },
          );
        }
      } catch (err) {
        console.warn("[tool-skus] commerce_defaults_v1 skipped:", err);
      }
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function parseAccessPolicy(raw: unknown): AccessPolicy {
  return String(raw ?? "").toLowerCase() === "hard_lock" ? "hard_lock" : "soft_cap";
}

function mapSku(r: Record<string, unknown>): ToolSku {
  return {
    toolId: String(r.tool_id),
    name: String(r.name),
    category: String(r.category),
    tagline: r.tagline == null ? null : String(r.tagline),
    description: r.description == null ? null : String(r.description),
    priceInr: Number(r.price_inr ?? 0),
    annualPriceInr: r.annual_price_inr == null ? null : Number(r.annual_price_inr),
    billingInterval: String(r.billing_interval ?? "month"),
    includedFree: Boolean(r.included_free),
    available: Boolean(r.available),
    sortOrder: Number(r.sort_order ?? 0),
    trialDays: Math.max(0, Number(r.trial_days ?? 0)),
    accessPolicy: parseAccessPolicy(r.access_policy),
    unlicensedRecordLimit:
      r.unlicensed_record_limit == null ? null : Math.max(0, Number(r.unlicensed_record_limit)),
    featured: Boolean(r.featured),
  };
}

export async function listToolSkus(): Promise<ToolSku[]> {
  await ensureToolSkuSchema();
  const [rows] = await pool.query(`SELECT * FROM tool_skus ORDER BY sort_order, name`);
  return (Array.isArray(rows) ? rows : []).map((row) => mapSku(row as Record<string, unknown>));
}

export async function getToolSku(toolId: string): Promise<ToolSku | null> {
  await ensureToolSkuSchema();
  const [rows] = await pool.query(`SELECT * FROM tool_skus WHERE tool_id = :id`, { id: toolId });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? mapSku(row as Record<string, unknown>) : null;
}

export type ToolSkuPatch = Partial<
  Pick<
    ToolSku,
    | "name"
    | "category"
    | "tagline"
    | "description"
    | "priceInr"
    | "annualPriceInr"
    | "billingInterval"
    | "includedFree"
    | "available"
    | "sortOrder"
    | "trialDays"
    | "accessPolicy"
    | "unlicensedRecordLimit"
    | "featured"
  >
>;

export async function updateToolSku(toolId: string, input: ToolSkuPatch): Promise<ToolSku> {
  await ensureToolSkuSchema();
  const current = await getToolSku(toolId);
  if (!current) {
    throw Object.assign(new Error("Unknown tool SKU"), { status: 404 });
  }
  const next: ToolSku = {
    ...current,
    name: input.name?.trim() || current.name,
    category: input.category?.trim() || current.category,
    tagline:
      input.tagline === undefined
        ? current.tagline
        : input.tagline?.trim()
          ? String(input.tagline).trim().slice(0, 160)
          : null,
    description:
      input.description === undefined
        ? current.description
        : input.description?.trim()
          ? String(input.description).trim()
          : null,
    priceInr: input.priceInr == null ? current.priceInr : Math.max(0, Number(input.priceInr)),
    annualPriceInr:
      input.annualPriceInr === undefined
        ? current.annualPriceInr
        : input.annualPriceInr == null
          ? null
          : Math.max(0, Number(input.annualPriceInr)),
    billingInterval: input.billingInterval || current.billingInterval,
    includedFree: input.includedFree ?? current.includedFree,
    available: input.available ?? current.available,
    sortOrder: input.sortOrder ?? current.sortOrder,
    trialDays:
      input.trialDays == null ? current.trialDays : Math.max(0, Math.min(365, Number(input.trialDays))),
    accessPolicy: input.accessPolicy ? parseAccessPolicy(input.accessPolicy) : current.accessPolicy,
    unlicensedRecordLimit:
      input.unlicensedRecordLimit === undefined
        ? current.unlicensedRecordLimit
        : input.unlicensedRecordLimit == null
          ? null
          : Math.max(0, Number(input.unlicensedRecordLimit)),
    featured: input.featured ?? current.featured,
  };
  await pool.query(
    `UPDATE tool_skus SET
       name = :name, category = :category, tagline = :tagline, description = :description,
       price_inr = :price, annual_price_inr = :annual, billing_interval = :interval,
       included_free = :included, available = :available, sort_order = :sortOrder,
       trial_days = :trialDays, access_policy = :accessPolicy,
       unlicensed_record_limit = :unlicensedLimit, featured = :featured
     WHERE tool_id = :id`,
    {
      id: toolId,
      name: next.name,
      category: next.category,
      tagline: next.tagline,
      description: next.description,
      price: next.priceInr,
      annual: next.annualPriceInr,
      interval: next.billingInterval,
      included: next.includedFree ? 1 : 0,
      available: next.available ? 1 : 0,
      sortOrder: next.sortOrder,
      trialDays: next.trialDays,
      accessPolicy: next.accessPolicy,
      unlicensedLimit: next.unlicensedRecordLimit,
      featured: next.featured ? 1 : 0,
    },
  );
  if (
    current.priceInr !== next.priceInr ||
    current.includedFree !== next.includedFree
  ) {
    try {
      const { repriceActiveItemsForSku } = await import("./subscription-items.js");
      await repriceActiveItemsForSku(toolId, next.priceInr, {
        includedFree: next.includedFree,
      });
    } catch {
      /* ledger table may not exist yet on fresh installs */
    }
  }
  return next;
}

/** Publish a commercial offer for a tool (create or update). */
export async function upsertToolSku(
  toolId: string,
  input: {
    name: string;
    category?: string;
    priceInr?: number;
    includedFree?: boolean;
    available?: boolean;
  } & ToolSkuPatch,
): Promise<ToolSku> {
  await ensureToolSkuSchema();
  const id = toolId.trim();
  if (!id) throw Object.assign(new Error("toolId required"), { status: 400 });
  const existing = await getToolSku(id);
  if (!existing) {
    const [maxRows] = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrd FROM tool_skus`,
    );
    const nextOrd = Number(
      (Array.isArray(maxRows) ? (maxRows[0] as { nextOrd: number }) : { nextOrd: 1 }).nextOrd,
    );
    await pool.query(
      `INSERT INTO tool_skus
         (tool_id, name, category, price_inr, billing_interval, included_free, available, sort_order)
       VALUES (:id, :name, :category, :price, 'month', :included, :available, :sortOrder)`,
      {
        id,
        name: input.name.trim() || id,
        category: (input.category ?? "General").trim() || "General",
        price: Math.max(0, Number(input.priceInr ?? 0)),
        included: input.includedFree ? 1 : 0,
        available: input.available === false ? 0 : 1,
        sortOrder: nextOrd,
      },
    );
  }
  return updateToolSku(id, {
    ...input,
    name: input.name.trim() || existing?.name || id,
  });
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
      throw Object.assign(new Error(`Tool "${id}" is not available for subscription`), {
        status: 400,
      });
    }
    if (sku.includedFree || sku.priceInr <= 0) {
      throw Object.assign(new Error(`${sku.name} is included — no subscription required`), {
        status: 400,
      });
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

export function paidSkuIds(skus: ToolSku[]): string[] {
  return skus.filter((s) => s.available && !s.includedFree && s.priceInr > 0).map((s) => s.toolId);
}
