import { describe, expect, it } from "vitest";
import {
  bomQuotationStatusLabel,
  bomQuotationStatusesSummary,
  normalizeBomQuotationStatuses,
} from "../bom-quotation-status";

describe("normalizeBomQuotationStatuses", () => {
  it("returns canonical order without duplicates", () => {
    expect(normalizeBomQuotationStatuses(["approved", "submitted", "approved"])).toEqual(["submitted", "approved"]);
    expect(normalizeBomQuotationStatuses(["sent", "submitted", "approved"])).toEqual(["submitted", "sent", "approved"]);
  });

  it("falls back to approved when empty, missing, or only unknown values", () => {
    expect(normalizeBomQuotationStatuses([])).toEqual(["approved"]);
    expect(normalizeBomQuotationStatuses(undefined)).toEqual(["approved"]);
    expect(normalizeBomQuotationStatuses(["draft", "rejected"])).toEqual(["approved"]);
  });
});

describe("bomQuotationStatusLabel", () => {
  it("labels known statuses and title-cases unknown ones", () => {
    expect(bomQuotationStatusLabel("submitted")).toBe("Submitted");
    expect(bomQuotationStatusLabel("SENT")).toBe("Sent");
    expect(bomQuotationStatusLabel("draft")).toBe("Draft");
    expect(bomQuotationStatusLabel("")).toBe("");
  });
});

describe("bomQuotationStatusesSummary", () => {
  it("summarises the selected statuses in canonical order", () => {
    expect(bomQuotationStatusesSummary(["approved", "submitted"])).toBe("Submitted, Approved");
    expect(bomQuotationStatusesSummary(undefined)).toBe("Approved");
  });
});
