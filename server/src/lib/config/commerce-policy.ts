import { pool } from "../../db.js";
import type { BillingCycle, UserCategory } from "../pricing-engine.js";

const KEY = "commerce_policy";

export type GstPricingMode = "inclusive" | "exclusive";

export type CommercePolicy = {
  // 1. Billing Cycle & Pricing
  annualEnabled: boolean;
  defaultBillingCycle: BillingCycle;
  defaultAnnualMonths: number;
  monthlyDurationDays: number;
  annualDurationDays: number;
  autoSavePackNudgeEnabled: boolean;

  // 2. User Category Rules & Multipliers
  enterpriseMinBranches: number;
  categoryDiscountPct: {
    individual: number;
    business: number;
    enterprise: number;
  };
  allowPersonalBusinessPreview: boolean;
  showTierComparisonMatrix: boolean;

  // 3. Trial, Conversion & Renewal Controls
  allowBatchStartAllTrials: boolean;
  maxConcurrentTrialsPerOrg: number | null;
  earlyRenewalWindowDays: number;
  stackEarlyRenewalDays: boolean;
  renewalSweepDays: number;
  urgentWarningDays: number;

  // 4. Tax, Proforma Quote & Receipt Controls
  gstEnabled: boolean;
  gstRatePct: number;
  gstPricingMode: GstPricingMode;
  sacCode: string;
  sellerGstin: string | null;
  proformaQuoteEnabled: boolean;
  proformaValidityDays: number;
  proformaFooterNote: string;

  // 5. Promo Engine Guardrails
  promosEnabled: boolean;
  showFeaturedPromoChips: boolean;
  maxFeaturedPromoChips: number;
  defaultMaxPerOrg: number | null;
  allowPromoOnPacks: boolean;
  allowPromoOnAnnual: boolean;
  maxCombinedDiscountPct: number;

  // 6. Usage Telemetry & Proactive Nudges
  nearLimitThresholdPct: number;
  showHomeSubscriptionStrip: boolean;
  defaultCheckoutCycleFromNudge: BillingCycle;
};

export const DEFAULT_COMMERCE_POLICY: CommercePolicy = {
  annualEnabled: true,
  defaultBillingCycle: "month",
  defaultAnnualMonths: 10,
  monthlyDurationDays: 30,
  annualDurationDays: 365,
  autoSavePackNudgeEnabled: true,

  enterpriseMinBranches: 2,
  categoryDiscountPct: {
    individual: 0,
    business: 0,
    enterprise: 0,
  },
  allowPersonalBusinessPreview: true,
  showTierComparisonMatrix: true,

  allowBatchStartAllTrials: true,
  maxConcurrentTrialsPerOrg: null,
  earlyRenewalWindowDays: 7,
  stackEarlyRenewalDays: true,
  renewalSweepDays: 14,
  urgentWarningDays: 3,

  gstEnabled: true,
  gstRatePct: 18,
  gstPricingMode: "inclusive",
  sacCode: "998314",
  sellerGstin: null,
  proformaQuoteEnabled: true,
  proformaValidityDays: 7,
  proformaFooterNote:
    "Computer-generated proforma estimate. Licenses activate automatically on payment confirmation.",

  promosEnabled: true,
  showFeaturedPromoChips: true,
  maxFeaturedPromoChips: 4,
  defaultMaxPerOrg: 1,
  allowPromoOnPacks: true,
  allowPromoOnAnnual: true,
  maxCombinedDiscountPct: 50,

  nearLimitThresholdPct: 80,
  showHomeSubscriptionStrip: true,
  defaultCheckoutCycleFromNudge: "year",
};

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampPct(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

function boolVal(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function parseCycle(raw: unknown, fallback: BillingCycle): BillingCycle {
  if (raw === "year" || raw === "month") return raw;
  return fallback;
}

function nullablePositiveInt(raw: unknown, max: number, fallback: number | null): number | null {
  if (raw === undefined) return fallback;
  if (raw === null || raw === "" || Number(raw) <= 0) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

/** Pure normalizer/validator merging any partial or stored JSON with safe clamped defaults. */
export function normalizeCommercePolicy(raw: unknown): CommercePolicy {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  const src =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const d = DEFAULT_COMMERCE_POLICY;
  const catRaw =
    src.categoryDiscountPct && typeof src.categoryDiscountPct === "object"
      ? (src.categoryDiscountPct as Record<string, unknown>)
      : {};

  const annualEnabled = boolVal(src.annualEnabled, d.annualEnabled);
  const rawDefaultCycle = parseCycle(src.defaultBillingCycle, d.defaultBillingCycle);
  const rawNudgeCycle = parseCycle(
    src.defaultCheckoutCycleFromNudge,
    d.defaultCheckoutCycleFromNudge,
  );
  const sacClean = String(src.sacCode ?? d.sacCode)
    .trim()
    .replace(/[^A-Za-z0-9-]/g, "")
    .slice(0, 16);
  const gstinClean =
    src.sellerGstin == null
      ? d.sellerGstin
      : String(src.sellerGstin).trim().toUpperCase().slice(0, 20) || null;
  const footerClean =
    typeof src.proformaFooterNote === "string"
      ? src.proformaFooterNote.trim().slice(0, 280)
      : d.proformaFooterNote;

  return {
    annualEnabled,
    defaultBillingCycle: annualEnabled ? rawDefaultCycle : "month",
    defaultAnnualMonths: clampInt(src.defaultAnnualMonths, 1, 12, d.defaultAnnualMonths),
    monthlyDurationDays: clampInt(src.monthlyDurationDays, 7, 60, d.monthlyDurationDays),
    annualDurationDays: clampInt(src.annualDurationDays, 300, 400, d.annualDurationDays),
    autoSavePackNudgeEnabled: boolVal(src.autoSavePackNudgeEnabled, d.autoSavePackNudgeEnabled),

    enterpriseMinBranches: clampInt(src.enterpriseMinBranches, 2, 20, d.enterpriseMinBranches),
    categoryDiscountPct: {
      individual: clampPct(catRaw.individual, 0, 50, d.categoryDiscountPct.individual),
      business: clampPct(catRaw.business, 0, 50, d.categoryDiscountPct.business),
      enterprise: clampPct(catRaw.enterprise, 0, 50, d.categoryDiscountPct.enterprise),
    },
    allowPersonalBusinessPreview: boolVal(
      src.allowPersonalBusinessPreview,
      d.allowPersonalBusinessPreview,
    ),
    showTierComparisonMatrix: boolVal(src.showTierComparisonMatrix, d.showTierComparisonMatrix),

    allowBatchStartAllTrials: boolVal(src.allowBatchStartAllTrials, d.allowBatchStartAllTrials),
    maxConcurrentTrialsPerOrg: nullablePositiveInt(
      src.maxConcurrentTrialsPerOrg,
      50,
      d.maxConcurrentTrialsPerOrg,
    ),
    earlyRenewalWindowDays: clampInt(src.earlyRenewalWindowDays, 1, 60, d.earlyRenewalWindowDays),
    stackEarlyRenewalDays: boolVal(src.stackEarlyRenewalDays, d.stackEarlyRenewalDays),
    renewalSweepDays: clampInt(src.renewalSweepDays, 1, 90, d.renewalSweepDays),
    urgentWarningDays: clampInt(src.urgentWarningDays, 1, 14, d.urgentWarningDays),

    gstEnabled: boolVal(src.gstEnabled, d.gstEnabled),
    gstRatePct: clampPct(src.gstRatePct, 0, 28, d.gstRatePct),
    gstPricingMode: src.gstPricingMode === "exclusive" ? "exclusive" : "inclusive",
    sacCode: sacClean || d.sacCode,
    sellerGstin: gstinClean,
    proformaQuoteEnabled: boolVal(src.proformaQuoteEnabled, d.proformaQuoteEnabled),
    proformaValidityDays: clampInt(src.proformaValidityDays, 1, 90, d.proformaValidityDays),
    proformaFooterNote: footerClean || d.proformaFooterNote,

    promosEnabled: boolVal(src.promosEnabled, d.promosEnabled),
    showFeaturedPromoChips: boolVal(src.showFeaturedPromoChips, d.showFeaturedPromoChips),
    maxFeaturedPromoChips: clampInt(src.maxFeaturedPromoChips, 0, 8, d.maxFeaturedPromoChips),
    defaultMaxPerOrg: nullablePositiveInt(src.defaultMaxPerOrg, 100, d.defaultMaxPerOrg),
    allowPromoOnPacks: boolVal(src.allowPromoOnPacks, d.allowPromoOnPacks),
    allowPromoOnAnnual: boolVal(src.allowPromoOnAnnual, d.allowPromoOnAnnual),
    maxCombinedDiscountPct: clampPct(src.maxCombinedDiscountPct, 0, 100, d.maxCombinedDiscountPct),

    nearLimitThresholdPct: clampInt(src.nearLimitThresholdPct, 50, 99, d.nearLimitThresholdPct),
    showHomeSubscriptionStrip: boolVal(
      src.showHomeSubscriptionStrip,
      d.showHomeSubscriptionStrip,
    ),
    defaultCheckoutCycleFromNudge: annualEnabled ? rawNudgeCycle : "month",
  };
}

/** Apply global category pricing discount (e.g. Enterprise 10% volume or Personal discount). */
export function applyCategoryDiscountInr(
  subtotalInr: number,
  category: UserCategory,
  policy: Pick<CommercePolicy, "categoryDiscountPct">,
): { discountPct: number; discountInr: number; finalInr: number } {
  const pct = Math.max(0, Math.min(50, Number(policy.categoryDiscountPct?.[category] ?? 0)));
  const cleanSubtotal = Math.max(0, Math.round(subtotalInr));
  if (pct <= 0 || cleanSubtotal <= 0) {
    return { discountPct: 0, discountInr: 0, finalInr: cleanSubtotal };
  }
  const discountInr = Math.round((cleanSubtotal * pct) / 100);
  return {
    discountPct: pct,
    discountInr,
    finalInr: Math.max(0, cleanSubtotal - discountInr),
  };
}

/** Enforce policy promo guardrails (kill-switch, pack/annual stacking, and combined discount safety cap). */
export function enforcePromoPolicyGuardrails(input: {
  policy: CommercePolicy;
  isPack: boolean;
  billingCycle: BillingCycle;
  subtotalInr: number;
  baseListPriceInr?: number;
  rawDiscountInr: number;
}): { allowed: true; discountInr: number; capped: boolean } | { allowed: false; error: string } {
  const { policy, isPack, billingCycle } = input;
  if (!policy.promosEnabled) {
    return { allowed: false, error: "Promo codes are currently disabled" };
  }
  if (isPack && !policy.allowPromoOnPacks) {
    return { allowed: false, error: "Promo codes cannot be combined with discounted packs" };
  }
  if (billingCycle === "year" && !policy.allowPromoOnAnnual) {
    return { allowed: false, error: "Promo codes cannot be stacked with yearly billing discounts" };
  }

  const subtotal = Math.max(0, Math.round(input.subtotalInr));
  const rawDisc = Math.max(0, Math.min(subtotal, Math.round(input.rawDiscountInr)));
  const capPct = Math.max(0, Math.min(100, policy.maxCombinedDiscountPct));
  if (capPct >= 100 || subtotal <= 0) {
    return { allowed: true, discountInr: rawDisc, capped: false };
  }

  const referenceList = Math.max(subtotal, Math.round(input.baseListPriceInr ?? subtotal));
  const minAllowedFinal = Math.round((referenceList * (100 - capPct)) / 100);
  const maxAllowedDiscount = Math.max(0, subtotal - minAllowedFinal);
  if (rawDisc > maxAllowedDiscount) {
    return { allowed: true, discountInr: maxAllowedDiscount, capped: true };
  }
  return { allowed: true, discountInr: rawDisc, capped: false };
}

export async function getCommercePolicy(): Promise<CommercePolicy> {
  try {
    const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
      key: KEY,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { ...DEFAULT_COMMERCE_POLICY, categoryDiscountPct: { ...DEFAULT_COMMERCE_POLICY.categoryDiscountPct } };
    return normalizeCommercePolicy((row as { value: unknown }).value);
  } catch {
    return { ...DEFAULT_COMMERCE_POLICY, categoryDiscountPct: { ...DEFAULT_COMMERCE_POLICY.categoryDiscountPct } };
  }
}

export async function saveCommercePolicy(patch: Partial<CommercePolicy>): Promise<CommercePolicy> {
  const current = await getCommercePolicy();
  const merged = normalizeCommercePolicy({
    ...current,
    ...patch,
    categoryDiscountPct: {
      ...current.categoryDiscountPct,
      ...(patch.categoryDiscountPct ?? {}),
    },
  });
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(merged) },
  );
  return merged;
}

export async function resetCommercePolicy(): Promise<CommercePolicy> {
  const fresh = normalizeCommercePolicy(DEFAULT_COMMERCE_POLICY);
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(fresh) },
  );
  return fresh;
}
