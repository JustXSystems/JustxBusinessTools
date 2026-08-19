import { describe, expect, it } from "vitest";
import { DOCUMENT_CONFIGS } from "@/config/tools.config";
import { calcGst } from "@/lib/calculators/gst";
import { docComputeTotals, docMissingFields, numberToWordsIndian } from "@/lib/document-math";
import { EMPTY_PROFILE } from "@/lib/types/business-profile";
import type { DocumentState } from "@/lib/types/document";

describe("calcGst", () => {
  it("adds GST on base amount", () => {
    const result = calcGst(1000, 18, "add");
    expect(result.base).toBe(1000);
    expect(result.gstAmt).toBe(180);
    expect(result.total).toBe(1180);
  });

  it("removes GST from inclusive total", () => {
    const result = calcGst(1180, 18, "remove");
    expect(result.total).toBe(1180);
    expect(result.base).toBeCloseTo(1000, 2);
    expect(result.gstAmt).toBeCloseTo(180, 2);
  });
});

describe("docComputeTotals", () => {
  it("sums line tax and grand total", () => {
    const state: DocumentState = {
      id: null,
      docNo: "INV/1",
      docDate: "2026-03-01",
      extraDate: "2026-03-01",
      party: { name: "A", address: "", phone: "", gstin: "", state: "" },
      items: [{ id: 1, name: "Item", hsn: "", qty: 2, unit: "NOS", rate: 500 }],
      igstPct: 18,
      cgstPct: 0,
      sgstPct: 0,
      cgstSgstEnabled: false,
      notes: "",
      status: "draft",
    };
    const totals = docComputeTotals(state);
    expect(totals.taxable).toBe(1000);
    expect(totals.igst).toBe(180);
    expect(totals.grand).toBe(1180);
  });
});

describe("docMissingFields", () => {
  it("requires business name and party", () => {
    const state: DocumentState = {
      id: null,
      docNo: "QTN/1",
      docDate: "2026-03-01",
      extraDate: "2026-03-01",
      party: { name: "", address: "", phone: "", gstin: "", state: "" },
      items: [{ id: 1, name: "X", hsn: "", qty: 1, unit: "NOS", rate: 100 }],
      igstPct: 18,
      cgstPct: 0,
      sgstPct: 0,
      cgstSgstEnabled: false,
      notes: "",
      status: "draft",
    };
    const missing = docMissingFields(state, EMPTY_PROFILE, DOCUMENT_CONFIGS.quotation);
    expect(missing.some((m) => m.includes("Business Profile"))).toBe(true);
    expect(missing).toContain("Customer name");
  });
});

describe("numberToWordsIndian", () => {
  it("formats lakh amounts", () => {
    expect(numberToWordsIndian(125000)).toContain("Lakh");
  });
});
