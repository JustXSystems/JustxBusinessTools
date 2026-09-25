import { describe, expect, it } from "vitest";
import {
  computeTotals,
  DEFAULT_COMPANY,
  mergeCompanyFromBusinessProfile,
  newQuotationDraft,
  sanitizeSignedNumStr,
} from "@/lib/quotation-v1";

describe("quotation-v1 computeTotals", () => {
  it("splits CGST/SGST for intra-state and folds extra charge into subtotal", () => {
    const q = newQuotationDraft("solar", "epc");
    q.customer.state = "Karnataka";
    q.items = [
      { id: "1", desc: "A", qty: 2, rate: 1000, gst: 18, discount: 0 },
      { id: "2", desc: "B", qty: 1, rate: 500, gst: 18, discount: 0 },
    ];
    q.extraCharge = { label: "Transport", amount: 100, gst: 18 };
    q.gstOverride = { mode: "auto", cgst: null, sgst: null, igst: null };
    const company = { ...DEFAULT_COMPANY, state: "Karnataka" };
    const t = computeTotals(q, company);
    expect(t.taxable).toBe(2600);
    expect(t.interState).toBe(false);
    expect(t.cgst + t.sgst).toBeCloseTo(450, 5);
    expect(t.exBase).toBe(100);
    expect(t.exGstAmt).toBeCloseTo(18, 5);
    expect(t.subtotal).toBe(2600);
    expect(t.subtotalGst).toBeCloseTo(468, 5);
    expect(t.totalGst).toBeCloseTo(468 + 450, 5);
    expect(t.grand).toBe(Math.round(2600 + 918));
  });

  it("uses manual CGST/SGST of zero so grand is subtotal + line GST", () => {
    const q = newQuotationDraft("solar", "epc");
    q.customer.state = "Karnataka";
    q.items = [{ id: "1", desc: "A", qty: 1, rate: 1000.4, gst: 18, discount: 0 }];
    q.extraCharge = { label: "Transport", amount: 100, gst: 0 };
    q.gstOverride = { mode: "manual", cgst: 0, sgst: 0, igst: null };
    const t = computeTotals(q, { ...DEFAULT_COMPANY, state: "Karnataka" });
    expect(t.subtotal).toBeCloseTo(1100.4, 5);
    expect(t.taxable).toBeCloseTo(t.subtotal, 5);
    expect(t.totalGst).toBeCloseTo(180.072, 5);
    expect(t.grand).toBe(1280);
    expect(t.subtotal + t.totalGst + t.roundOff).toBeCloseTo(t.grand, 5);
  });

  it("excludes negative line rates from subtotal and taxable, deducts them from grand", () => {
    const q = newQuotationDraft("solar", "epc");
    q.customer.state = "Karnataka";
    q.items = [
      { id: "1", desc: "Credit", qty: 1, rate: -500, gst: 18, discount: 0 },
      { id: "2", desc: "Item", qty: 1, rate: 1500, gst: 18, discount: 0 },
    ];
    q.extraCharge = { label: "x", amount: 0, gst: 0 };
    q.gstOverride = { mode: "auto", cgst: null, sgst: null, igst: null };
    const t = computeTotals(q, { ...DEFAULT_COMPANY, state: "Karnataka" });
    expect(t.taxable).toBe(1500);
    expect(t.subtotal).toBe(1500);
    expect(t.cgst + t.sgst).toBeCloseTo(270, 5);
    expect(t.oldBuybackLess).toBe(-500);
    expect(t.grand).toBe(Math.round(1500 + 270 + 270 - 500));
    expect(t.subtotal + t.totalGst + t.roundOff - Math.abs(t.oldBuybackLess)).toBeCloseTo(t.grand, 5);
  });

  it("computes Subtotal GST, Total GST and old buyback rows", () => {
    const q = newQuotationDraft("solar", "epc");
    q.customer.state = "Karnataka";
    q.items = [
      { id: "1", desc: "Item", qty: 2, rate: 1000, gst: 18, discount: 0 },
      { id: "2", desc: "Buyback", qty: 1, rate: -500, gst: 18, discount: 0 },
    ];
    q.extraCharge = { label: "Transport", amount: 100, gst: 18 };
    q.gstOverride = { mode: "auto", cgst: null, sgst: null, igst: null };
    const t = computeTotals(q, { ...DEFAULT_COMPANY, state: "Karnataka" });
    expect(t.subtotal).toBe(2100);
    expect(t.taxable).toBe(2100);
    expect(t.subtotalGst).toBeCloseTo(360 + 18, 5);
    expect(t.cgst + t.sgst).toBeCloseTo(360, 5);
    expect(t.totalGst).toBeCloseTo(378 + 360, 5);
    expect(t.oldBuybackLess).toBe(-500);
    expect(t.grand).toBe(Math.round(2100 + 738 - 500));
  });

  it("uses IGST for inter-state", () => {
    const q = newQuotationDraft("ups", "sale");
    q.customer.state = "Maharashtra";
    q.items = [{ id: "1", desc: "A", qty: 1, rate: 1000, gst: 18, discount: 0 }];
    q.extraCharge = { label: "x", amount: 0, gst: 0 };
    q.gstOverride = { mode: "auto", cgst: null, sgst: null, igst: null };
    const t = computeTotals(q, { ...DEFAULT_COMPANY, state: "Karnataka" });
    expect(t.interState).toBe(true);
    expect(t.igst).toBeCloseTo(180, 5);
    expect(t.cgst).toBe(0);
  });
});

describe("sanitizeSignedNumStr", () => {
  it("keeps a leading minus while typing and in final values", () => {
    expect(sanitizeSignedNumStr("-")).toBe("-");
    expect(sanitizeSignedNumStr("-12.5")).toBe("-12.5");
    expect(sanitizeSignedNumStr("12-3")).toBe("-123");
  });
});

describe("mergeCompanyFromBusinessProfile", () => {
  it("always applies Business Profile name and logo", () => {
    const merged = mergeCompanyFromBusinessProfile(
      { ...DEFAULT_COMPANY, name: "Old Letterhead", logo: null, phone: "999" },
      {
        businessName: "Acme Solar",
        logo: "/uploads/logo.png",
        phone: "111",
        addressLine1: "12 Main St",
        documentAccentColor: "#224466",
      },
    );
    expect(merged.name).toBe("Acme Solar");
    expect(merged.logo).toBe("/uploads/logo.png");
    expect(merged.phone).toBe("999");
    expect(merged.address).toBe("12 Main St");
    expect(merged.documentAccentColor).toBe("#224466");
  });
});
