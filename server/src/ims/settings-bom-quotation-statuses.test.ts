import { describe, expect, it } from "vitest";
import { normalizeBomQuotationStatusesSetting } from "./settings.js";

describe("normalizeBomQuotationStatusesSetting", () => {
  it("defaults to approved only when unset or empty", () => {
    expect(normalizeBomQuotationStatusesSetting(null)).toEqual(["approved"]);
    expect(normalizeBomQuotationStatusesSetting(undefined)).toEqual(["approved"]);
    expect(normalizeBomQuotationStatusesSetting("")).toEqual(["approved"]);
    expect(normalizeBomQuotationStatusesSetting([])).toEqual(["approved"]);
    expect(normalizeBomQuotationStatusesSetting("[]")).toEqual(["approved"]);
  });

  it("accepts arrays and JSON strings, returns statuses in canonical order without duplicates", () => {
    expect(normalizeBomQuotationStatusesSetting(["approved", "submitted"])).toEqual(["submitted", "approved"]);
    expect(normalizeBomQuotationStatusesSetting('["sent","submitted","sent"]')).toEqual(["submitted", "sent"]);
    expect(normalizeBomQuotationStatusesSetting(["SENT", " Approved "])).toEqual(["sent", "approved"]);
  });

  it("drops unknown statuses and falls back to default when nothing valid remains", () => {
    expect(normalizeBomQuotationStatusesSetting(["rejected", "draft", "sent"])).toEqual(["sent"]);
    expect(normalizeBomQuotationStatusesSetting(["rejected", "draft"])).toEqual(["approved"]);
    expect(normalizeBomQuotationStatusesSetting("not json")).toEqual(["approved"]);
  });
});
