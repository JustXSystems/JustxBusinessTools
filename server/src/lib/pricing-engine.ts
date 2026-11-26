import { isValidGstin, normalizeGstin } from "./gstin.js";

export type BillingCycle = "month" | "year";
export type UserCategory = "individual" | "business" | "enterprise";

export type PricingSkuInput = {
  toolId: string;
  name: string;
  category: string;
  priceInr: number;
  annualPriceInr: number | null;
  billingInterval: string;
  includedFree: boolean;
  available: boolean;
};

export type ResolvedSkuPricing = {
  monthlyPriceInr: number;
  annualPriceInr: number;
  unitPriceInr: number;
  monthlyEquivalentInr: number;
  annualSavingsInr: number;
  annualSavingsPct: number;
  billingCycle: BillingCycle;
  durationDays: number;
};

export type PackRecommendation = {
  packId: string;
  packName: string;
  packPriceInr: number;
  cartPriceInr: number;
  savingsInr: number;
  extraToolCount: number;
  extraToolIds: string[];
  reason: "cheaper" | "more_value";
  billingCycle: BillingCycle;
};

/** Default annual multiplier when an explicit annualPriceInr is not configured (2 months free). */
export const DEFAULT_ANNUAL_MONTHS = 10;

/** Paid licenses within this many days of expiry may be renewed early in self-serve checkout. */
export const RENEWAL_WINDOW_DAYS = 7;

export function isLicenseConvertibleOrRenewable(input: {
  isTrial?: boolean;
  periodEnd?: string | null;
  renewalWindowDays?: number;
  now?: Date;
}): boolean {
  if (input.isTrial) return true;
  if (!input.periodEnd) return false;
  const end = new Date(input.periodEnd);
  if (Number.isNaN(end.getTime())) return false;
  const now = input.now ?? new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  const windowDays = input.renewalWindowDays ?? RENEWAL_WINDOW_DAYS;
  return daysLeft <= windowDays;
}

/**
 * Stack renewal duration onto existing active paid periodEnd so early renewals
 * never forfeit remaining paid days. Trials and expired licenses start from `now`.
 */
export function computeRenewedPeriodEnd(input: {
  existingPeriodEnd?: string | Date | null;
  isTrial?: boolean;
  durationDays: number;
  stackDays?: boolean;
  now?: Date;
}): Date {
  const now = input.now ?? new Date();
  const addMs = Math.max(1, input.durationDays) * 86_400_000;
  if (input.stackDays !== false && !input.isTrial && input.existingPeriodEnd) {
    const existing =
      input.existingPeriodEnd instanceof Date
        ? input.existingPeriodEnd
        : new Date(input.existingPeriodEnd);
    if (!Number.isNaN(existing.getTime()) && existing.getTime() > now.getTime()) {
      return new Date(existing.getTime() + addMs);
    }
  }
  return new Date(now.getTime() + addMs);
}

export function normalizeBillingCycle(raw: unknown): BillingCycle {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "year" || v === "yearly" || v === "annual" || v === "annually" ? "year" : "month";
}

export function cycleDurationDays(
  cycle: BillingCycle,
  opts?: { monthlyDurationDays?: number; annualDurationDays?: number },
): number {
  return cycle === "year" ? (opts?.annualDurationDays ?? 365) : (opts?.monthlyDurationDays ?? 30);
}

export function periodEndForCycle(
  cycle: BillingCycle,
  from: Date = new Date(),
  opts?: { monthlyDurationDays?: number; annualDurationDays?: number },
): Date {
  return new Date(from.getTime() + cycleDurationDays(cycle, opts) * 24 * 60 * 60 * 1000);
}

/**
 * Classify workspace into Individual (no valid GSTIN), Business (single GSTIN branch),
 * or Enterprise (multi-branch GSTIN organization).
 */
export function resolveUserCategory(input: {
  gstin?: string | null;
  branchCount?: number | null;
  enterpriseMinBranches?: number;
}): UserCategory {
  const gstin = normalizeGstin(input.gstin);
  if (!isValidGstin(gstin)) return "individual";
  const branches = Math.max(1, Number(input.branchCount ?? 1) || 1);
  const threshold = Math.max(2, Number(input.enterpriseMinBranches ?? 2) || 2);
  return branches >= threshold ? "enterprise" : "business";
}

/**
 * Resolve effective monthly & annual pricing for a single SKU.
 * - Free/included tools resolve to 0.
 * - If SKU has explicit `annualPriceInr > 0`, use it.
 * - If SKU's native `billingInterval === "year"`, `priceInr` is treated as yearly and monthly is derived.
 * - Otherwise annual defaults to `priceInr * 10` (2 months free, ~17% off).
 */
export function resolveSkuPricing(
  sku: Pick<PricingSkuInput, "priceInr" | "annualPriceInr" | "billingInterval" | "includedFree">,
  cycle: BillingCycle = "month",
): ResolvedSkuPricing {
  const durationDays = cycleDurationDays(cycle);
  if (sku.includedFree || sku.priceInr <= 0) {
    return {
      monthlyPriceInr: 0,
      annualPriceInr: 0,
      unitPriceInr: 0,
      monthlyEquivalentInr: 0,
      annualSavingsInr: 0,
      annualSavingsPct: 0,
      billingCycle: cycle,
      durationDays,
    };
  }

  const isNativeAnnual = String(sku.billingInterval ?? "").toLowerCase() === "year";
  const monthlyPriceInr = isNativeAnnual
    ? Math.max(1, Math.round(sku.priceInr / 12))
    : Math.max(0, Math.round(sku.priceInr));

  const annualPriceInr =
    sku.annualPriceInr != null && sku.annualPriceInr > 0
      ? Math.round(sku.annualPriceInr)
      : isNativeAnnual
        ? Math.round(sku.priceInr)
        : Math.round(monthlyPriceInr * DEFAULT_ANNUAL_MONTHS);

  const fullYearList = monthlyPriceInr * 12;
  const annualSavingsInr = Math.max(0, fullYearList - annualPriceInr);
  const annualSavingsPct =
    fullYearList > 0 ? Math.round((annualSavingsInr / fullYearList) * 100) : 0;

  const unitPriceInr = cycle === "year" ? annualPriceInr : monthlyPriceInr;
  const monthlyEquivalentInr =
    cycle === "year" ? Math.round(annualPriceInr / 12) : monthlyPriceInr;

  return {
    monthlyPriceInr,
    annualPriceInr,
    unitPriceInr,
    monthlyEquivalentInr,
    annualSavingsInr,
    annualSavingsPct,
    billingCycle: cycle,
    durationDays,
  };
}

/**
 * Resolve bundle list price and payable price for a given billing cycle.
 * Fixed-price packs scale by `DEFAULT_ANNUAL_MONTHS` on annual billing unless prorated on remaining tools.
 */
export function resolveBundleCyclePricing(input: {
  toolIds: string[];
  skusById: Map<string, PricingSkuInput>;
  discountPct: number;
  fixedPriceInr: number | null;
  cycle: BillingCycle;
  /** Optional subset of tools actually being purchased (e.g. excluding already licensed). */
  remainingToolIds?: string[];
}): {
  fullListPriceInr: number;
  listPriceInr: number;
  totalInr: number;
  savingsInr: number;
  durationDays: number;
} {
  const { toolIds, skusById, discountPct, fixedPriceInr, cycle } = input;
  const activeIds = input.remainingToolIds ?? toolIds;

  const sumCycle = (ids: string[]) =>
    ids.reduce((sum, id) => {
      const sku = skusById.get(id);
      if (!sku || !sku.available || sku.includedFree || sku.priceInr <= 0) return sum;
      return sum + resolveSkuPricing(sku, cycle).unitPriceInr;
    }, 0);

  const fullListPriceInr = sumCycle(toolIds);
  const listPriceInr = sumCycle(activeIds);

  let totalInr: number;
  if (fixedPriceInr != null && fixedPriceInr >= 0) {
    const cycleFixed =
      cycle === "year" ? Math.round(fixedPriceInr * DEFAULT_ANNUAL_MONTHS) : Math.round(fixedPriceInr);
    const ratio = fullListPriceInr > 0 ? listPriceInr / fullListPriceInr : 1;
    totalInr = Math.round(cycleFixed * ratio);
  } else {
    const pct = Math.max(0, Math.min(100, Number(discountPct) || 0));
    totalInr = Math.round(listPriceInr * (1 - pct / 100));
  }

  return {
    fullListPriceInr,
    listPriceInr,
    totalInr,
    savingsInr: Math.max(0, listPriceInr - totalInr),
    durationDays: cycleDurationDays(cycle),
  };
}

/**
 * Evaluate whether a pack is suitable for a Personal (no-GSTIN) workspace.
 * A pack is personal-compatible if at least one of its paid tools is marked `personalUsage`.
 * Returns counts so UI can clearly show eligibility.
 */
export function evaluatePackPersonalCompatibility(
  toolIds: string[],
  personalUsageMap: Record<string, boolean>,
): { personalToolIds: string[]; personalCompatible: boolean; allPersonal: boolean } {
  const personalToolIds = toolIds.filter((id) => Boolean(personalUsageMap[id]));
  return {
    personalToolIds,
    personalCompatible: personalToolIds.length > 0 && personalToolIds.length === toolIds.length,
    allPersonal: toolIds.length > 0 && personalToolIds.length === toolIds.length,
  };
}

/**
 * Auto-Save Intelligence: given a set of selected (or high-usage) unlicensed tools,
 * find the best available pack that either:
 * 1) covers all selected tools for strictly less money ("cheaper"), OR
 * 2) covers all selected tools and unlocks >=1 extra tool for at most +20% cost ("more_value").
 */
export function recommendPackForSelection(input: {
  selectedToolIds: string[];
  licensedToolIds: Set<string>;
  skus: PricingSkuInput[];
  packs: Array<{
    id: string;
    name: string;
    available: boolean;
    discountPct: number;
    fixedPriceInr: number | null;
    toolIds: string[];
  }>;
  cycle: BillingCycle;
  userCategory?: UserCategory;
  personalUsageMap?: Record<string, boolean>;
}): PackRecommendation | null {
  const { selectedToolIds, licensedToolIds, skus, packs, cycle, userCategory, personalUsageMap } =
    input;
  const skusById = new Map(skus.map((s) => [s.toolId, s]));
  const selected = [...new Set(selectedToolIds)].filter((id) => {
    const sku = skusById.get(id);
    return sku && sku.available && !sku.includedFree && sku.priceInr > 0 && !licensedToolIds.has(id);
  });
  if (selected.length === 0) return null;

  const cartPriceInr = selected.reduce(
    (sum, id) => sum + resolveSkuPricing(skusById.get(id)!, cycle).unitPriceInr,
    0,
  );
  if (cartPriceInr <= 0) return null;

  let best: PackRecommendation | null = null;

  for (const pack of packs) {
    if (!pack.available) continue;
    if (userCategory === "individual" && personalUsageMap) {
      const compat = evaluatePackPersonalCompatibility(pack.toolIds, personalUsageMap);
      if (!compat.personalCompatible) continue;
    }

    const packSet = new Set(pack.toolIds);
    const coversAll = selected.every((id) => packSet.has(id));
    if (!coversAll) continue;

    const remaining = pack.toolIds.filter((id) => {
      const sku = skusById.get(id);
      return sku && sku.available && !sku.includedFree && sku.priceInr > 0 && !licensedToolIds.has(id);
    });
    if (remaining.length === 0) continue;

    const quoted = resolveBundleCyclePricing({
      toolIds: pack.toolIds,
      skusById,
      discountPct: pack.discountPct,
      fixedPriceInr: pack.fixedPriceInr,
      cycle,
      remainingToolIds: remaining,
    });

    const extraToolIds = remaining.filter((id) => !selected.includes(id));
    const savingsVsCart = cartPriceInr - quoted.totalInr;

    let candidate: PackRecommendation | null = null;
    if (savingsVsCart > 0) {
      candidate = {
        packId: pack.id,
        packName: pack.name,
        packPriceInr: quoted.totalInr,
        cartPriceInr,
        savingsInr: savingsVsCart,
        extraToolCount: extraToolIds.length,
        extraToolIds,
        reason: "cheaper",
        billingCycle: cycle,
      };
    } else if (
      selected.length >= 2 &&
      extraToolIds.length > 0 &&
      quoted.totalInr <= Math.round(cartPriceInr * 1.2)
    ) {
      candidate = {
        packId: pack.id,
        packName: pack.name,
        packPriceInr: quoted.totalInr,
        cartPriceInr,
        savingsInr: quoted.savingsInr,
        extraToolCount: extraToolIds.length,
        extraToolIds,
        reason: "more_value",
        billingCycle: cycle,
      };
    }

    if (!candidate) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    // Prefer outright savings first, then higher savings, then more extra tools.
    if (candidate.reason === "cheaper" && best.reason !== "cheaper") {
      best = candidate;
    } else if (candidate.reason === best.reason) {
      if (
        candidate.savingsInr > best.savingsInr ||
        (candidate.savingsInr === best.savingsInr && candidate.extraToolCount > best.extraToolCount)
      ) {
        best = candidate;
      }
    }
  }

  return best;
}
