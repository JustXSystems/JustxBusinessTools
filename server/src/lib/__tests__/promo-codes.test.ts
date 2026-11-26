import { describe, expect, it } from "vitest";
import { evaluatePromoCode, normalizePromoCode, type PromoCode } from "../promo-codes.js";

function makePromo(partial: Partial<PromoCode> = {}): PromoCode {
  return {
    code: "LAUNCH20",
    description: "20% launch offer",
    discountType: "percent",
    discountValue: 20,
    userCategory: "all",
    billingCycle: "all",
    minAmountInr: 0,
    maxRedemptions: null,
    redemptionsCount: 0,
    expiresAt: null,
    active: true,
    ...partial,
  };
}

describe("promo-codes", () => {
  it("normalizes promo code input", () => {
    expect(normalizePromoCode("  welcome 20! ")).toBe("WELCOME20");
    expect(normalizePromoCode("annual_500")).toBe("ANNUAL_500");
  });

  it("applies percentage and flat INR discounts cleanly", () => {
    const pct = evaluatePromoCode(makePromo({ discountType: "percent", discountValue: 20 }), {
      subtotalInr: 1000,
      userCategory: "business",
      billingCycle: "year",
    });
    expect(pct.ok).toBe(true);
    if (pct.ok) {
      expect(pct.discountInr).toBe(200);
      expect(pct.finalTotalInr).toBe(800);
      expect(pct.label).toBe("20% off");
    }

    const flat = evaluatePromoCode(
      makePromo({ code: "FLAT500", discountType: "flat_inr", discountValue: 500 }),
      {
        subtotalInr: 350,
        userCategory: "individual",
        billingCycle: "month",
      },
    );
    expect(flat.ok).toBe(true);
    if (flat.ok) {
      expect(flat.discountInr).toBe(350); // clamped to subtotal
      expect(flat.finalTotalInr).toBe(0);
    }
  });

  it("enforces user category, billing cycle, min amount, expiry, and redemption cap", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");

    const wrongCategory = evaluatePromoCode(makePromo({ userCategory: "enterprise" }), {
      subtotalInr: 1000,
      userCategory: "individual",
      billingCycle: "year",
      now,
    });
    expect(wrongCategory.ok).toBe(false);

    const wrongCycle = evaluatePromoCode(makePromo({ billingCycle: "year" }), {
      subtotalInr: 1000,
      userCategory: "business",
      billingCycle: "month",
      now,
    });
    expect(wrongCycle.ok).toBe(false);

    const belowMin = evaluatePromoCode(makePromo({ minAmountInr: 500 }), {
      subtotalInr: 200,
      userCategory: "business",
      billingCycle: "month",
      now,
    });
    expect(belowMin.ok).toBe(false);

    const expired = evaluatePromoCode(makePromo({ expiresAt: "2026-06-01T00:00:00.000Z" }), {
      subtotalInr: 1000,
      userCategory: "business",
      billingCycle: "month",
      now,
    });
    expect(expired.ok).toBe(false);

    const maxed = evaluatePromoCode(makePromo({ maxRedemptions: 5, redemptionsCount: 5 }), {
      subtotalInr: 1000,
      userCategory: "business",
      billingCycle: "month",
      now,
    });
    expect(maxed.ok).toBe(false);
  });
});
