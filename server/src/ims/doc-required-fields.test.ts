import { describe, expect, it } from "vitest";
import {
  assertDocRequiredFields,
  emptyDocRequiredFields,
  normalizeDocRequiredFieldsSetting,
} from "./doc-required-fields.js";

describe("normalizeDocRequiredFieldsSetting", () => {
  it("returns empty lists when unset and legacy flag is off", () => {
    expect(normalizeDocRequiredFieldsSetting(null, false)).toEqual(emptyDocRequiredFields());
    expect(normalizeDocRequiredFieldsSetting(undefined)).toEqual(emptyDocRequiredFields());
  });

  it("seeds bom.quotationRef when unset and legacy bom_require_quotation_ref is on", () => {
    expect(normalizeDocRequiredFieldsSetting(null, true)).toEqual({
      ...emptyDocRequiredFields(),
      bom: ["quotationRef"],
    });
  });

  it("ignores legacy flag once doc_required_fields_json is explicitly saved", () => {
    expect(normalizeDocRequiredFieldsSetting({ bom: [] }, true)).toEqual(emptyDocRequiredFields());
  });

  it("parses JSON strings, strips unknown fields, deduplicates, and keeps canonical order", () => {
    const parsed = normalizeDocRequiredFieldsSetting(
      JSON.stringify({
        bom: ["location", "quotationRef", "location", "bogus"],
        dc: ["shipTo", "transporter"],
        returns: ["notes", "reason"],
        po: ["terms", "expectedDate", "paymentTermsDays"],
        invoice: ["shipToAddress", "customerPoNo"],
      }),
    );
    expect(parsed).toEqual({
      bom: ["quotationRef", "location"],
      dc: ["transporter", "shipTo"],
      returns: ["reason", "notes"],
      po: ["expectedDate", "paymentTermsDays", "terms"],
      invoice: ["customerPoNo", "shipToAddress"],
    });
  });
});

describe("assertDocRequiredFields", () => {
  it("passes when no fields are required or all required fields are present", () => {
    expect(() =>
      assertDocRequiredFields("bom", emptyDocRequiredFields(), {}, "confirming this BOM"),
    ).not.toThrow();

    const cfg = normalizeDocRequiredFieldsSetting({
      po: ["expectedDate", "paymentTermsDays"],
    });
    expect(() =>
      assertDocRequiredFields(
        "po",
        cfg,
        { expectedDate: "2026-12-01", paymentTermsDays: 0 },
        "submitting this purchase order",
      ),
    ).not.toThrow();
  });

  it("throws 409 conflict listing every missing field label", () => {
    const cfg = normalizeDocRequiredFieldsSetting({
      dc: ["transporter", "vehicleNo", "shipTo"],
    });
    expect(() =>
      assertDocRequiredFields(
        "dc",
        cfg,
        { transporter: "BlueDart", vehicleNo: "  ", shipTo: null },
        "approving this delivery challan",
      ),
    ).toThrow(/Required before approving this delivery challan: Vehicle number, Ship-to address/);
  });

  it("treats null/undefined/empty paymentTermsDays as missing", () => {
    const cfg = normalizeDocRequiredFieldsSetting({ po: ["paymentTermsDays"] });
    expect(() =>
      assertDocRequiredFields("po", cfg, { paymentTermsDays: null }, "submitting this purchase order"),
    ).toThrow(/Payment terms \(days\)/);
  });
});
