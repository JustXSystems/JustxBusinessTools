import { describe, expect, it } from "vitest";
import {
  docRequiredFieldsSummary,
  emptyDocRequiredFields,
  isDocFieldRequired,
  normalizeDocRequiredFields,
} from "../doc-required-fields";

describe("doc-required-fields", () => {
  it("seeds bom.quotationRef from legacy flag when unset", () => {
    expect(normalizeDocRequiredFields(undefined, true)).toEqual({
      ...emptyDocRequiredFields(),
      bom: ["quotationRef"],
    });
    expect(isDocFieldRequired({ bomRequireQuotationRef: true }, "bom", "quotationRef")).toBe(true);
  });

  it("normalizes order and drops unknown fields", () => {
    const out = normalizeDocRequiredFields({
      bom: ["location", "quotationRef", "unknown"],
      dc: ["shipTo", "transporter"],
      invoice: ["customerPoNo"],
    });
    expect(out.bom).toEqual(["quotationRef", "location"]);
    expect(out.dc).toEqual(["transporter", "shipTo"]);
    expect(out.invoice).toEqual(["customerPoNo"]);
  });

  it("formats human-readable summary", () => {
    expect(docRequiredFieldsSummary(undefined, false)).toBe("None");
    expect(
      docRequiredFieldsSummary({
        bom: ["quotationRef"],
        dc: ["vehicleNo"],
      }),
    ).toBe("BOM: Quotation reference · Delivery Challan: Vehicle number");
  });
});
