import { describe, expect, it } from "vitest";
import {
  describeToolUsage,
  describeUserCategory,
  filterStoreCatalog,
  filterStorePacks,
  resolveClientPackPrice,
  resolveClientSkuPrice,
} from "../subscription-store-helpers";
import type { ProductPack, ToolCatalogSku } from "../types/subscription";

const SKUS: ToolCatalogSku[] = [
  {
    toolId: "gmap2mappls",
    name: "Google Maps to Mappls",
    category: "Utilities",
    priceInr: 100,
    annualPriceInr: 1000,
    resolvedAnnualPriceInr: 1000,
    annualSavingsInr: 200,
    annualSavingsPct: 17,
    billingInterval: "month",
    includedFree: false,
    licensed: false,
    trialDays: 14,
    trialEligible: true,
    personalUsage: true,
    usage: {
      toolId: "gmap2mappls",
      recordCount: 0,
      limit: 0,
      utilizationPct: 100,
      nearLimit: false,
      atLimit: true,
      status: "hard_locked",
      isTrial: false,
      daysLeft: null,
      periodEnd: null,
    },
  },
  {
    toolId: "invoice",
    name: "Invoice Creator",
    category: "Sales & Business",
    priceInr: 199,
    billingInterval: "month",
    includedFree: false,
    licensed: false,
    trialDays: 14,
    trialEligible: true,
    personalUsage: false,
    usage: {
      toolId: "invoice",
      recordCount: 26,
      limit: 28,
      utilizationPct: 93,
      nearLimit: true,
      atLimit: false,
      status: "near_limit",
      isTrial: false,
      daysLeft: null,
      periodEnd: null,
    },
  },
  {
    toolId: "gstcalc",
    name: "GST Calculator",
    category: "Finance",
    priceInr: 0,
    billingInterval: "month",
    includedFree: true,
    licensed: true,
    personalUsage: true,
  },
];

describe("subscription-store-helpers", () => {
  it("resolves monthly and annual SKU & pack pricing", () => {
    const monthly = resolveClientSkuPrice(SKUS[0], "month");
    expect(monthly.priceInr).toBe(100);
    expect(monthly.periodSuffix).toBe("/mo");

    const yearly = resolveClientSkuPrice(SKUS[0], "year");
    expect(yearly.priceInr).toBe(1000);
    expect(yearly.annualSavingsInr).toBe(200);
    expect(yearly.annualSavingsPct).toBe(17);
    expect(yearly.periodSuffix).toBe("/yr");

    const pack: ProductPack = {
      id: "sales_pack",
      name: "Sales Pack",
      discountPct: 10,
      listPriceInr: 500,
      priceInr: 450,
      annualListPriceInr: 5000,
      annualPriceInr: 4500,
      toolIds: ["invoice"],
      toolCount: 1,
      savingsInr: 50,
      personalCompatible: false,
    };
    expect(resolveClientPackPrice(pack, "month").priceInr).toBe(450);
    expect(resolveClientPackPrice(pack, "year").priceInr).toBe(4500);
    expect(resolveClientPackPrice(pack, "year").savingsInr).toBe(500);
  });

  it("filters personal vs business catalog and usage alert chips cleanly", () => {
    const personalOnly = filterStoreCatalog(SKUS, {
      query: "",
      chip: "all",
      userCategory: "individual",
      scope: "personal",
    });
    expect(personalOnly.map((s) => s.toolId)).toEqual(["gmap2mappls", "gstcalc"]);

    const previewAll = filterStoreCatalog(SKUS, {
      query: "",
      chip: "all",
      userCategory: "individual",
      scope: "all",
    });
    expect(previewAll).toHaveLength(3);

    const alerts = filterStoreCatalog(SKUS, {
      query: "",
      chip: "usage_alerts",
      userCategory: "business",
      scope: "all",
    });
    expect(alerts.map((s) => s.toolId)).toEqual(["invoice"]);

    const packs: ProductPack[] = [
      {
        id: "sales_pack",
        name: "Sales Pack",
        discountPct: 10,
        listPriceInr: 500,
        priceInr: 450,
        toolIds: ["invoice"],
        toolCount: 1,
        savingsInr: 50,
        personalCompatible: false,
      },
    ];
    expect(filterStorePacks(packs, { userCategory: "individual", scope: "personal" })).toHaveLength(0);
    expect(filterStorePacks(packs, { userCategory: "business", scope: "all" })).toHaveLength(1);
  });

  it("formats user category badges and urgent usage metadata", () => {
    expect(describeUserCategory("individual").badge).toContain("Personal");
    expect(describeUserCategory("business").badge).toContain("GSTIN");
    expect(describeUserCategory("enterprise", 4).badge).toContain("4 Branches");

    const near = describeToolUsage(SKUS[1].usage);
    expect(near?.urgent).toBe(true);
    expect(near?.tone).toBe("amber");
  });
});
