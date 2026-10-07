import { describe, expect, it } from "vitest";
import { BASE_TERMS, buildTerms, newQuotationDraft } from "@/lib/quotation-v1";

describe("buildTerms with Business Profile AMC terms", () => {
  it("uses the profile AMC terms when For is AMC", () => {
    expect(buildTerms("ups", "amc", { amcTerms: "1. Custom AMC" })).toBe("1. Custom AMC");
  });

  it("falls back to the built-in AMC terms when the profile has none", () => {
    expect(buildTerms("solar", "amc", { amcTerms: "   " })).toBe(BASE_TERMS.amc);
    expect(buildTerms("solar", "amc", null)).toBe(BASE_TERMS.amc);
  });

  it("leaves other engagements on their built-in terms", () => {
    expect(buildTerms("ups", "sale", { amcTerms: "1. Custom AMC" })).toBe(buildTerms("ups", "sale"));
  });

  it("fills {WARRANTY} in profile terms", () => {
    expect(buildTerms("ups", "amc", { amcTerms: "Warranty: {WARRANTY}" })).toContain("UPS system carries");
  });

  it("seeds a new AMC draft with the profile terms", () => {
    const q = newQuotationDraft("solar", "amc", "", { amcTerms: "AMC terms" });
    expect(q.notes).toBe("AMC terms");
  });
});
