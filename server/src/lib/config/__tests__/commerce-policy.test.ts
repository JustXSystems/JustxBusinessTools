import { describe, expect, it } from "vitest";
import {
  applyCategoryDiscountInr,
  DEFAULT_COMMERCE_POLICY,
  enforcePromoPolicyGuardrails,
  normalizeCommercePolicy,
} from "../commerce-policy.js";

describe("commerce-policy", () => {
  it("returns safe defaults and clamps out-of-range inputs", () => {
    const p = normalizeCommercePolicy({
      defaultAnnualMonths: 99,
      gstRatePct: 45,
      enterpriseMinBranches: 1,
      maxCombinedDiscountPct: 150,
      nearLimitThresholdPct: 10,
      categoryDiscountPct: { individual: -5, business: 12, enterprise: 80 },
      annualEnabled: false,
      defaultBillingCycle: "year",
      defaultCheckoutCycleFromNudge: "year",
    });

    expect(p.defaultAnnualMonths).toBe(12);
    expect(p.gstRatePct).toBe(28);
    expect(p.enterpriseMinBranches).toBe(2);
    expect(p.maxCombinedDiscountPct).toBe(100);
    expect(p.nearLimitThresholdPct).toBe(50);
    expect(p.categoryDiscountPct).toEqual({ individual: 0, business: 12, enterprise: 50 });
    // When annual billing is disabled globally, default cycles coerce back to month
    expect(p.defaultBillingCycle).toBe("month");
    expect(p.defaultCheckoutCycleFromNudge).toBe("month");
  });

  it("computes category discount cleanly", () => {
    const res = applyCategoryDiscountInr(1000, "enterprise", {
      categoryDiscountPct: { individual: 0, business: 5, enterprise: 15 },
    });
    expect(res).toEqual({ discountPct: 15, discountInr: 150, finalInr: 850 });
  });

  it("enforces promo kill-switch, pack/annual stacking rules, and combined discount safety cap", () => {
    const disabled = enforcePromoPolicyGuardrails({
      policy: { ...DEFAULT_COMMERCE_POLICY, promosEnabled: false },
      isPack: false,
      billingCycle: "month",
      subtotalInr: 1000,
      rawDiscountInr: 200,
    });
    expect(disabled.allowed).toBe(false);

    const noPackStack = enforcePromoPolicyGuardrails({
      policy: { ...DEFAULT_COMMERCE_POLICY, allowPromoOnPacks: false },
      isPack: true,
      billingCycle: "month",
      subtotalInr: 800,
      rawDiscountInr: 100,
    });
    expect(noPackStack.allowed).toBe(false);

    const noAnnualStack = enforcePromoPolicyGuardrails({
      policy: { ...DEFAULT_COMMERCE_POLICY, allowPromoOnAnnual: false },
      isPack: false,
      billingCycle: "year",
      subtotalInr: 5000,
      rawDiscountInr: 500,
    });
    expect(noAnnualStack.allowed).toBe(false);

    // Reference list price 1200, already discounted to 800 (33% off); cap 50% -> min allowed final 600 -> max extra promo = 200
    const capped = enforcePromoPolicyGuardrails({
      policy: { ...DEFAULT_COMMERCE_POLICY, maxCombinedDiscountPct: 50 },
      isPack: true,
      billingCycle: "year",
      subtotalInr: 800,
      baseListPriceInr: 1200,
      rawDiscountInr: 400,
    });
    expect(capped).toEqual({ allowed: true, discountInr: 200, capped: true });
  });
});
