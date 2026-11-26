import { describe, expect, it } from "vitest";
import {
  cycleDurationDays,
  evaluatePackPersonalCompatibility,
  normalizeBillingCycle,
  periodEndForCycle,
  recommendPackForSelection,
  resolveBundleCyclePricing,
  resolveSkuPricing,
  resolveUserCategory,
  type PricingSkuInput,
} from "../pricing-engine.js";

const SAMPLE_SKUS: PricingSkuInput[] = [
  {
    toolId: "quotation",
    name: "Quotation Creator",
    category: "Sales & Business",
    priceInr: 149,
    annualPriceInr: null,
    billingInterval: "month",
    includedFree: false,
    available: true,
  },
  {
    toolId: "salesorder",
    name: "Sales Order Creator",
    category: "Sales & Business",
    priceInr: 149,
    annualPriceInr: null,
    billingInterval: "month",
    includedFree: false,
    available: true,
  },
  {
    toolId: "invoice",
    name: "Invoice Creator",
    category: "Sales & Business",
    priceInr: 199,
    annualPriceInr: 1900,
    billingInterval: "month",
    includedFree: false,
    available: true,
  },
  {
    toolId: "paymenttracker",
    name: "Payment Tracker",
    category: "Sales & Business",
    priceInr: 99,
    annualPriceInr: null,
    billingInterval: "month",
    includedFree: false,
    available: true,
  },
  {
    toolId: "gmap2mappls",
    name: "Google Maps to Mappls",
    category: "Utilities",
    priceInr: 100,
    annualPriceInr: 1000,
    billingInterval: "month",
    includedFree: false,
    available: true,
  },
  {
    toolId: "gstcalc",
    name: "GST Calculator",
    category: "Finance",
    priceInr: 0,
    annualPriceInr: null,
    billingInterval: "month",
    includedFree: true,
    available: true,
  },
];

describe("pricing-engine", () => {
  it("normalizes billing cycles and computes duration days", () => {
    expect(normalizeBillingCycle("year")).toBe("year");
    expect(normalizeBillingCycle("yearly")).toBe("year");
    expect(normalizeBillingCycle("ANNUAL")).toBe("year");
    expect(normalizeBillingCycle("month")).toBe("month");
    expect(normalizeBillingCycle(undefined)).toBe("month");
    expect(cycleDurationDays("month")).toBe(30);
    expect(cycleDurationDays("year")).toBe(365);

    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(periodEndForCycle("month", start).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(periodEndForCycle("year", start).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("classifies individual, business, and enterprise user categories", () => {
    expect(resolveUserCategory({ gstin: null, branchCount: 1 })).toBe("individual");
    expect(resolveUserCategory({ gstin: "INVALID", branchCount: 3 })).toBe("individual");
    expect(resolveUserCategory({ gstin: "27ABCDE1234F1Z5", branchCount: 1 })).toBe("business");
    expect(resolveUserCategory({ gstin: "27ABCDE1234F1Z5", branchCount: 2 })).toBe("enterprise");
  });

  it("resolves explicit and derived annual SKU pricing", () => {
    const explicit = resolveSkuPricing(SAMPLE_SKUS[4], "year"); // gmap2mappls 100/mo, 1000/yr
    expect(explicit.monthlyPriceInr).toBe(100);
    expect(explicit.annualPriceInr).toBe(1000);
    expect(explicit.unitPriceInr).toBe(1000);
    expect(explicit.annualSavingsInr).toBe(200);
    expect(explicit.annualSavingsPct).toBe(17);

    const derived = resolveSkuPricing(SAMPLE_SKUS[0], "year"); // quotation 149/mo -> 1490/yr
    expect(derived.annualPriceInr).toBe(1490);
    expect(derived.unitPriceInr).toBe(1490);
    expect(derived.annualSavingsInr).toBe(298);
    expect(derived.annualSavingsPct).toBe(17);

    const free = resolveSkuPricing(SAMPLE_SKUS[5], "year");
    expect(free.unitPriceInr).toBe(0);
    expect(free.annualSavingsInr).toBe(0);
  });

  it("computes bundle pricing for monthly and annual cycles with proration", () => {
    const byId = new Map(SAMPLE_SKUS.map((s) => [s.toolId, s]));
    const monthly = resolveBundleCyclePricing({
      toolIds: ["quotation", "salesorder", "invoice", "paymenttracker"],
      skusById: byId,
      discountPct: 10,
      fixedPriceInr: null,
      cycle: "month",
    });
    expect(monthly.listPriceInr).toBe(596);
    expect(monthly.totalInr).toBe(536);
    expect(monthly.savingsInr).toBe(60);

    const yearly = resolveBundleCyclePricing({
      toolIds: ["quotation", "salesorder", "invoice", "paymenttracker"],
      skusById: byId,
      discountPct: 10,
      fixedPriceInr: null,
      cycle: "year",
    });
    // 1490 + 1490 + 1900 + 990 = 5870; 10% off = 5283
    expect(yearly.listPriceInr).toBe(5870);
    expect(yearly.totalInr).toBe(5283);
    expect(yearly.durationDays).toBe(365);
  });

  it("recommends a pack when cart tools are cheaper or unlock extra value in a bundle", () => {
    const packs = [
      {
        id: "sales_pack",
        name: "Sales Pack",
        available: true,
        discountPct: 15,
        fixedPriceInr: null,
        toolIds: ["quotation", "salesorder", "invoice", "paymenttracker"],
      },
    ];
    // Selecting 3 of 4 sales tools: cart = 497, pack = round(596 * 0.85) = 507 -> <= 20% more for +1 extra tool
    const moreValue = recommendPackForSelection({
      selectedToolIds: ["quotation", "salesorder", "invoice"],
      licensedToolIds: new Set(),
      skus: SAMPLE_SKUS,
      packs,
      cycle: "month",
      userCategory: "business",
    });
    expect(moreValue).not.toBeNull();
    expect(moreValue?.packId).toBe("sales_pack");
    expect(moreValue?.reason).toBe("more_value");
    expect(moreValue?.extraToolCount).toBe(1);

    // Selecting all 4 tools -> pack is strictly cheaper
    const cheaper = recommendPackForSelection({
      selectedToolIds: ["quotation", "salesorder", "invoice", "paymenttracker"],
      licensedToolIds: new Set(),
      skus: SAMPLE_SKUS,
      packs,
      cycle: "month",
      userCategory: "business",
    });
    expect(cheaper?.reason).toBe("cheaper");
    expect(cheaper?.savingsInr).toBe(89);
  });

  it("does not recommend business-only packs to individual users", () => {
    const packs = [
      {
        id: "sales_pack",
        name: "Sales Pack",
        available: true,
        discountPct: 20,
        fixedPriceInr: null,
        toolIds: ["quotation", "invoice"],
      },
    ];
    const personalMap = { gmap2mappls: true, quotation: false, invoice: false };
    expect(evaluatePackPersonalCompatibility(["quotation", "invoice"], personalMap).personalCompatible).toBe(
      false,
    );
    expect(evaluatePackPersonalCompatibility(["gmap2mappls"], personalMap).personalCompatible).toBe(
      true,
    );
    const rec = recommendPackForSelection({
      selectedToolIds: ["quotation", "invoice"],
      licensedToolIds: new Set(),
      skus: SAMPLE_SKUS,
      packs,
      cycle: "month",
      userCategory: "individual",
      personalUsageMap: personalMap,
    });
    expect(rec).toBeNull();
  });
});
