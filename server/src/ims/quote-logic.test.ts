import { describe, expect, it } from "vitest";
import {
  computeQuoteTotals,
  DEFAULT_IMS_QUOTE_SETTINGS,
  formatV1QuoteNo,
  normalizeImsQuoteSettings,
  parseQuoteTrailingSeq,
  quoteEngMeta,
} from "./quote-logic.js";

describe("IMS quote-logic (V1 parity)", () => {
  it("computes intra-state CGST + SGST and extra charge identically to Quotation V1", () => {
    const t = computeQuoteTotals({
      items: [
        { desc: "5kW Solar Kit", qty: 1, rate: 100000, gst: 18, discount: 10 },
        { desc: "Installation", qty: 1, rate: 10000, gst: 18, discount: 0 },
      ],
      extraCharge: { label: "Transport", amount: 5000, gst: 18 },
      gstOverride: { mode: "auto", cgst: null, sgst: null, igst: null },
      customerState: "Karnataka",
      companyState: "Karnataka",
    });

    expect(t.interState).toBe(false);
    expect(t.subtotal).toBe(115000);
    expect(t.discountTotal).toBe(10000);
    expect(t.exBase).toBe(5000);
    expect(t.exGstAmt).toBe(900);
    expect(t.cgst).toBe(9000);
    expect(t.sgst).toBe(9000);
    expect(t.igst).toBe(0);
    expect(t.grand).toBe(Math.round(t.subtotal + t.totalGst));
  });

  it("handles inter-state IGST and negative buyback lines without taxing buyback", () => {
    const t = computeQuoteTotals({
      items: [
        { desc: "Inverter 5kVA", qty: 2, rate: 25000, gst: 18 },
        { desc: "Old Battery Buyback", qty: 1, rate: -8000, gst: 18 },
      ],
      customerState: "Maharashtra",
      companyState: "Karnataka",
    });

    expect(t.interState).toBe(true);
    expect(t.subtotal).toBe(50000);
    expect(t.oldBuybackLess).toBe(-8000);
    expect(t.igst).toBe(9000);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
    expect(t.grand).toBe(Math.round(50000 + t.totalGst - 8000));
  });

  it("supports manual GST override", () => {
    const t = computeQuoteTotals({
      items: [{ desc: "Battery", qty: 1, rate: 10000, gst: 28 }],
      gstOverride: { mode: "manual", cgst: 9, sgst: 9, igst: null },
      customerState: "Karnataka",
      companyState: "Karnataka",
    });

    expect(t.isManual).toBe(true);
    expect(t.cgstRate).toBe(9);
    expect(t.sgstRate).toBe(9);
    expect(t.cgst).toBe(900);
    expect(t.sgst).toBe(900);
  });

  it("formats V1 category/engagement quote numbers and parses trailing sequence", () => {
    const no = formatV1QuoteNo({
      prefix: "zign",
      category: "solar",
      engagement: "epc",
      dateIso: "2026-11-27",
      seq: 42,
    });
    expect(no).toBe("ZIGN-SOL/INST-2026/11-0042");
    expect(parseQuoteTrailingSeq(no)).toBe(42);
    expect(parseQuoteTrailingSeq(`${no}-R2`)).toBe(42);
    expect(quoteEngMeta("ups", "sale").code).toBe("SEL");
  });

  it("normalizes IMS quote settings safely", () => {
    const s = normalizeImsQuoteSettings({
      quotePrefix: "qt-01!",
      numberingMode: "ims_fy",
      defaultValidityDays: 30,
      defaultShowGstColumns: false,
      termsByEngagement: { epc: "Custom EPC terms", bogus: "ignore" },
    });
    expect(s.quotePrefix).toBe("QT01");
    expect(s.numberingMode).toBe("ims_fy");
    expect(s.defaultValidityDays).toBe(30);
    expect(s.defaultShowGstColumns).toBe(false);
    expect(s.termsByEngagement).toEqual({ epc: "Custom EPC terms" });
    expect(normalizeImsQuoteSettings(null)).toEqual(DEFAULT_IMS_QUOTE_SETTINGS);
  });
});
