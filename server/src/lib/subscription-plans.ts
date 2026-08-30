import { pool } from "../db.js";
import { jsonVal } from "./admin/approvals.js";
import { FREE_RECORD_LIMIT } from "./constants.js";

export type AccessMode = "limited" | "unlimited";

export type CatalogPlan = {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  priceInr: number;
  billingInterval: string;
  recordLimit: number | null;
  accessMode: AccessMode;
  features: string[];
  available: boolean;
  highlighted: boolean;
  /** Free trial length when assigning / upgrading to this plan (0 = none). */
  trialDays: number;
  /** Marketing tier label e.g. Starter, Growth. */
  tierLabel: string | null;
};

let schemaReady: Promise<void> | null = null;

export async function ensureSubscriptionPlanSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      try {
        await pool.query(
          `ALTER TABLE subscription_plans
           ADD COLUMN access_mode VARCHAR(20) NOT NULL DEFAULT 'limited'`,
        );
      } catch {
        /* column already exists */
      }
      try {
        await pool.query(
          `ALTER TABLE subscription_plans
           ADD COLUMN trial_days INT NOT NULL DEFAULT 0`,
        );
      } catch {
        /* exists */
      }
      try {
        await pool.query(
          `ALTER TABLE subscription_plans
           ADD COLUMN tier_label VARCHAR(40) NULL`,
        );
      } catch {
        /* exists */
      }
      await pool.query(
        `UPDATE subscription_plans
         SET access_mode = 'limited', record_limit = COALESCE(record_limit, :fallback)
         WHERE id = 'free'`,
        { fallback: FREE_RECORD_LIMIT },
      );
      await pool.query(
        `UPDATE subscription_plans
         SET access_mode = 'unlimited', record_limit = NULL,
             tier_label = COALESCE(tier_label, 'Growth')
         WHERE id = 'pro'`,
      );
      await pool.query(
        `UPDATE subscription_plans
         SET tier_label = COALESCE(tier_label, 'Starter')
         WHERE id = 'free'`,
      );
      await pool.query(
        `UPDATE subscription_plans SET available = 0 WHERE id NOT IN ('free', 'pro')`,
      );
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function featuresOf(raw: unknown): string[] {
  const v = jsonVal(raw);
  if (Array.isArray(v)) return v.map(String);
  return [];
}

export function mapCatalogPlan(r: Record<string, unknown>): CatalogPlan {
  const id = String(r.id);
  const rawMode = String(r.access_mode ?? "").toLowerCase();
  const recordLimit = r.record_limit == null ? null : Number(r.record_limit);
  const accessMode: AccessMode =
    rawMode === "unlimited" || rawMode === "paid" || (rawMode !== "limited" && recordLimit == null && id !== "free")
      ? "unlimited"
      : "limited";
  return {
    id,
    name: String(r.name),
    tagline: (r.tagline as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    priceInr: Number(r.price_inr ?? 0),
    billingInterval: String(r.billing_interval ?? "month"),
    recordLimit: accessMode === "unlimited" ? null : (recordLimit ?? FREE_RECORD_LIMIT),
    accessMode,
    features: featuresOf(r.features),
    available: Boolean(r.available),
    highlighted: Boolean(r.highlighted),
    trialDays: Math.max(0, Number(r.trial_days ?? 0)),
    tierLabel: (r.tier_label as string | null) ?? null,
  };
}

export async function listCatalogPlans(): Promise<CatalogPlan[]> {
  await ensureSubscriptionPlanSchema();
  const [rows] = await pool.query(
    `SELECT * FROM subscription_plans WHERE id IN ('free', 'pro') ORDER BY sort_order, id`,
  );
  return (Array.isArray(rows) ? rows : []).map((row) => mapCatalogPlan(row as Record<string, unknown>));
}

export async function getCatalogPlan(id: string): Promise<CatalogPlan | null> {
  await ensureSubscriptionPlanSchema();
  const [rows] = await pool.query(`SELECT * FROM subscription_plans WHERE id = :id`, { id });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? mapCatalogPlan(row as Record<string, unknown>) : null;
}

export async function getLimitedPlan(): Promise<CatalogPlan> {
  const plans = await listCatalogPlans();
  return (
    plans.find((p) => p.accessMode === "limited") ?? {
      id: "free",
      name: "Free",
      tagline: null,
      description: null,
      priceInr: 0,
      billingInterval: "month",
      recordLimit: FREE_RECORD_LIMIT,
      accessMode: "limited",
      features: [],
      available: true,
      highlighted: false,
      trialDays: 0,
      tierLabel: "Starter",
    }
  );
}

export async function getUnlimitedPlan(): Promise<CatalogPlan> {
  const plans = await listCatalogPlans();
  return (
    plans.find((p) => p.accessMode === "unlimited") ?? {
      id: "pro",
      name: "Pro",
      tagline: null,
      description: null,
      priceInr: Number(process.env.SUBSCRIPTION_PRO_PRICE_INR ?? 499),
      billingInterval: "month",
      recordLimit: null,
      accessMode: "unlimited",
      features: [],
      available: true,
      highlighted: true,
      trialDays: 0,
      tierLabel: "Growth",
    }
  );
}

export function publicPlanPayload(plan: CatalogPlan) {
  return {
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    description: plan.description,
    recordLimit: plan.recordLimit,
    priceInr: plan.priceInr,
    billingInterval: plan.billingInterval,
    accessMode: plan.accessMode,
    features: plan.features,
    available: plan.available,
    trialDays: plan.trialDays,
    tierLabel: plan.tierLabel,
  };
}
