import { pool } from "../db.js";
import { ensureTablesUtf8mb4UnicodeCi, INNODB_UTF8MB4_UNICODE } from "./mysql-charset.js";
import type { BillingCycle, UserCategory } from "./pricing-engine.js";

export type PromoDiscountType = "percent" | "flat_inr";
export type PromoUserScope = "all" | UserCategory;
export type PromoCycleScope = "all" | BillingCycle;

export type PromoCode = {
  code: string;
  description: string | null;
  discountType: PromoDiscountType;
  discountValue: number;
  userCategory: PromoUserScope;
  billingCycle: PromoCycleScope;
  minAmountInr: number;
  maxRedemptions: number | null;
  redemptionsCount: number;
  expiresAt: string | null;
  active: boolean;
};

export type PromoEvaluationOk = {
  ok: true;
  code: string;
  description: string | null;
  discountType: PromoDiscountType;
  discountValue: number;
  discountInr: number;
  finalTotalInr: number;
  label: string;
};

export type PromoEvaluationErr = {
  ok: false;
  error: string;
};

export type PromoEvaluation = PromoEvaluationOk | PromoEvaluationErr;

let schemaReady: Promise<void> | null = null;

export function normalizePromoCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 40);
}

export async function ensurePromoCodeSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS promo_codes (
          code VARCHAR(40) NOT NULL,
          description VARCHAR(180) NULL,
          discount_type VARCHAR(16) NOT NULL DEFAULT 'percent',
          discount_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
          user_category VARCHAR(20) NOT NULL DEFAULT 'all',
          billing_cycle VARCHAR(12) NOT NULL DEFAULT 'all',
          min_amount_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
          max_redemptions INT NULL,
          redemptions_count INT NOT NULL DEFAULT 0,
          expires_at TIMESTAMP NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (code)
        ) ${INNODB_UTF8MB4_UNICODE}
      `);
      await ensureTablesUtf8mb4UnicodeCi(["promo_codes"]);
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function mapPromo(r: Record<string, unknown>): PromoCode {
  const dt = String(r.discount_type ?? "").toLowerCase();
  const uc = String(r.user_category ?? "all").toLowerCase();
  const bc = String(r.billing_cycle ?? "all").toLowerCase();
  return {
    code: String(r.code),
    description: r.description == null ? null : String(r.description),
    discountType: dt === "flat_inr" ? "flat_inr" : "percent",
    discountValue: Math.max(0, Number(r.discount_value ?? 0)),
    userCategory:
      uc === "individual" || uc === "business" || uc === "enterprise" ? uc : "all",
    billingCycle: bc === "month" || bc === "year" ? bc : "all",
    minAmountInr: Math.max(0, Number(r.min_amount_inr ?? 0)),
    maxRedemptions: r.max_redemptions == null ? null : Math.max(1, Number(r.max_redemptions)),
    redemptionsCount: Math.max(0, Number(r.redemptions_count ?? 0)),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    active: Boolean(r.active),
  };
}

/** Pure deterministic promo evaluator & discount calculator. */
export function evaluatePromoCode(
  promo: PromoCode | null,
  ctx: {
    subtotalInr: number;
    userCategory: UserCategory;
    billingCycle: BillingCycle;
    now?: Date;
  },
): PromoEvaluation {
  if (!promo) {
    return { ok: false, error: "Invalid promo code" };
  }
  if (!promo.active) {
    return { ok: false, error: `Promo code ${promo.code} is no longer active` };
  }
  const now = ctx.now ?? new Date();
  if (promo.expiresAt) {
    const exp = new Date(promo.expiresAt);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < now.getTime()) {
      return { ok: false, error: `Promo code ${promo.code} has expired` };
    }
  }
  if (promo.maxRedemptions != null && promo.redemptionsCount >= promo.maxRedemptions) {
    return { ok: false, error: `Promo code ${promo.code} has reached its redemption limit` };
  }
  if (promo.userCategory !== "all" && promo.userCategory !== ctx.userCategory) {
    const target =
      promo.userCategory === "individual"
        ? "Personal"
        : promo.userCategory === "enterprise"
          ? "Enterprise"
          : "Business";
    return {
      ok: false,
      error: `Promo code ${promo.code} is only valid for ${target} accounts`,
    };
  }
  if (promo.billingCycle !== "all" && promo.billingCycle !== ctx.billingCycle) {
    return {
      ok: false,
      error: `Promo code ${promo.code} applies only to ${promo.billingCycle === "year" ? "Yearly" : "Monthly"} billing`,
    };
  }
  const subtotal = Math.max(0, Math.round(ctx.subtotalInr));
  if (subtotal < promo.minAmountInr) {
    return {
      ok: false,
      error: `Minimum order of ₹${Math.round(promo.minAmountInr)} required for ${promo.code}`,
    };
  }

  let discountInr = 0;
  let label = "";
  if (promo.discountType === "percent") {
    const pct = Math.max(0, Math.min(100, promo.discountValue));
    discountInr = Math.round((subtotal * pct) / 100);
    label = `${pct}% off`;
  } else {
    discountInr = Math.round(promo.discountValue);
    label = `₹${Math.round(promo.discountValue)} off`;
  }
  discountInr = Math.max(0, Math.min(subtotal, discountInr));

  return {
    ok: true,
    code: promo.code,
    description: promo.description,
    discountType: promo.discountType,
    discountValue: promo.discountValue,
    discountInr,
    finalTotalInr: Math.max(0, subtotal - discountInr),
    label,
  };
}

export async function listPromoCodes(): Promise<PromoCode[]> {
  await ensurePromoCodeSchema();
  const [rows] = await pool.query(`SELECT * FROM promo_codes ORDER BY active DESC, created_at DESC`);
  return (Array.isArray(rows) ? rows : []).map((row) => mapPromo(row as Record<string, unknown>));
}

export async function getPromoCode(rawCode: string): Promise<PromoCode | null> {
  const code = normalizePromoCode(rawCode);
  if (!code) return null;
  await ensurePromoCodeSchema();
  const [rows] = await pool.query(`SELECT * FROM promo_codes WHERE code = :code LIMIT 1`, { code });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? mapPromo(row as Record<string, unknown>) : null;
}

export async function upsertPromoCode(input: {
  code: string;
  description?: string | null;
  discountType?: PromoDiscountType;
  discountValue: number;
  userCategory?: PromoUserScope;
  billingCycle?: PromoCycleScope;
  minAmountInr?: number;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
  active?: boolean;
}): Promise<PromoCode> {
  await ensurePromoCodeSchema();
  const code = normalizePromoCode(input.code);
  if (code.length < 3) {
    throw Object.assign(new Error("Promo code must be at least 3 letters/numbers"), { status: 400 });
  }
  const discountType: PromoDiscountType = input.discountType === "flat_inr" ? "flat_inr" : "percent";
  const rawVal = Math.max(0, Number(input.discountValue) || 0);
  const discountValue = discountType === "percent" ? Math.min(100, rawVal) : rawVal;
  if (discountValue <= 0) {
    throw Object.assign(new Error("Discount value must be greater than 0"), { status: 400 });
  }
  const uc = String(input.userCategory ?? "all").toLowerCase();
  const userCategory: PromoUserScope =
    uc === "individual" || uc === "business" || uc === "enterprise" ? uc : "all";
  const bc = String(input.billingCycle ?? "all").toLowerCase();
  const billingCycle: PromoCycleScope = bc === "month" || bc === "year" ? bc : "all";
  const minAmountInr = Math.max(0, Number(input.minAmountInr ?? 0) || 0);
  const maxRedemptions =
    input.maxRedemptions == null || Number(input.maxRedemptions) <= 0
      ? null
      : Math.floor(Number(input.maxRedemptions));
  const expiresAt = input.expiresAt?.trim() ? input.expiresAt.trim() : null;
  const active = input.active === false ? 0 : 1;

  await pool.query(
    `INSERT INTO promo_codes
       (code, description, discount_type, discount_value, user_category, billing_cycle,
        min_amount_inr, max_redemptions, expires_at, active)
     VALUES (:code, :description, :discountType, :discountValue, :userCategory, :billingCycle,
        :minAmountInr, :maxRedemptions, :expiresAt, :active)
     ON DUPLICATE KEY UPDATE
       description = VALUES(description),
       discount_type = VALUES(discount_type),
       discount_value = VALUES(discount_value),
       user_category = VALUES(user_category),
       billing_cycle = VALUES(billing_cycle),
       min_amount_inr = VALUES(min_amount_inr),
       max_redemptions = VALUES(max_redemptions),
       expires_at = VALUES(expires_at),
       active = VALUES(active)`,
    {
      code,
      description: input.description?.trim()?.slice(0, 180) || null,
      discountType,
      discountValue,
      userCategory,
      billingCycle,
      minAmountInr,
      maxRedemptions,
      expiresAt,
      active,
    },
  );
  const saved = await getPromoCode(code);
  if (!saved) throw Object.assign(new Error("Could not save promo code"), { status: 500 });
  return saved;
}

export async function deletePromoCode(rawCode: string): Promise<void> {
  await ensurePromoCodeSchema();
  const code = normalizePromoCode(rawCode);
  if (!code) return;
  await pool.query(`DELETE FROM promo_codes WHERE code = :code`, { code });
}

export async function incrementPromoRedemption(rawCode: string): Promise<void> {
  const code = normalizePromoCode(rawCode);
  if (!code) return;
  try {
    await ensurePromoCodeSchema();
    await pool.query(
      `UPDATE promo_codes SET redemptions_count = redemptions_count + 1 WHERE code = :code`,
      { code },
    );
  } catch {
    /* ignore */
  }
}
