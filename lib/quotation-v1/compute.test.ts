import { describe, expect, it } from "vitest";
import {
  computeTotals,
  DEFAULT_COMPANY,
  mergeCompanyFromBusinessProfile,
  newQuotationDraft,
} from "@/lib/quotation-v1";

describe("quotation-v1 computeTotals", () => {
  it("splits CGST/SGST for intra-state and keeps extra charge separate", () => {
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
    expect(t.taxable).toBe(2500);
    expect(t.interState).toBe(false);
    expect(t.cgst + t.sgst).toBeCloseTo(450, 5);
    expect(t.exBase).toBe(100);
    expect(t.exGstAmt).toBeCloseTo(18, 5);
    expect(t.grand).toBe(Math.round(2500 + 450 + 118));
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

describe("mergeCompanyFromBusinessProfile", () => {
  it("always applies Business Profile name and logo", () => {
    const merged = mergeCompanyFromBusinessProfile(
      { ...DEFAULT_COMPANY, name: "Old Letterhead", logo: null, phone: "999" },
      {
        businessName: "Acme Solar",
        logo: "/uploads/logo.png",
        phone: "111",
        addressLine1: "12 Main St",
      },
    );
    expect(merged.name).toBe("Acme Solar");
    expect(merged.logo).toBe("/uploads/logo.png");
    expect(merged.phone).toBe("999");
    expect(merged.address).toBe("12 Main St");
  });
});
