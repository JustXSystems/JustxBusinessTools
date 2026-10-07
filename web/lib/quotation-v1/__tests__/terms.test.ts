import { describe, expect, it } from "vitest";
import {
  BASE_TERMS,
  buildTerms,
  ENGAGEMENTS,
  newQuotationDraft,
  quoteTermsForOptions,
} from "@/lib/quotation-v1";

describe("buildTerms with Business Profile terms per For", () => {
  it("uses the profile terms for the selected For", () => {
    expect(buildTerms("ups", "amc", { amc: "1. Custom AMC" })).toBe("1. Custom AMC");
    expect(buildTerms("ups", "sale", { sale: "1. Custom sale" })).toBe("1. Custom sale");
  });

  it("falls back to the built-in terms when the For has none", () => {
    expect(buildTerms("solar", "amc", { amc: "   " })).toBe(BASE_TERMS.amc);
    expect(buildTerms("solar", "amc", null)).toBe(BASE_TERMS.amc);
    expect(buildTerms("ups", "sale", { amc: "1. Custom AMC" })).toBe(buildTerms("ups", "sale"));
  });

  it("fills {WARRANTY} in profile terms", () => {
    expect(buildTerms("ups", "amc", { amc: "Warranty: {WARRANTY}" })).toContain("UPS system carries");
  });

  it("seeds a new draft with the profile terms for its For", () => {
    const q = newQuotationDraft("solar", "epc", "", { epc: "EPC terms" });
    expect(q.notes).toBe("EPC terms");
  });
});

describe("quoteTermsForOptions", () => {
  it("lists every For once with its composer labels and categories", () => {
    const options = quoteTermsForOptions();
    expect(options.map((o) => o.key).sort()).toEqual(Object.keys(ENGAGEMENTS).sort());
    expect(options.find((o) => o.key === "amc")).toMatchObject({
      label: "Annual Maintenance -AMC",
      categories: "Solar, UPS",
    });
    expect(options.find((o) => o.key === "setup")?.categories).toBe("UPS, Inverter");
  });
});
