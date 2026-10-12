import { describe, expect, it } from "vitest";
import {
  applyPoReceipt,
  computeTotals,
  isIntraStateSupply,
  isStaleDraft,
  netUnitCost,
  panFromGstin,
  poNeedsApproval,
  poOverdue,
  poReceiptStatus,
  poRemaining,
  poShareText,
  receiptBillLines,
  resolvePartyState,
  stateCodeOf,
} from "./logic.js";

describe("stateCodeOf", () => {
  it("resolves names case-insensitively and normalises codes", () => {
    expect(stateCodeOf("Karnataka")).toBe("29");
    expect(stateCodeOf("tamil nadu")).toBe("33");
    expect(stateCodeOf("Andaman & Nicobar Islands")).toBe("35");
    expect(stateCodeOf("7")).toBe("07");
    expect(stateCodeOf("29")).toBe("29");
  });

  it("returns null for unknown or blank input", () => {
    expect(stateCodeOf("Atlantis")).toBeNull();
    expect(stateCodeOf("99")).toBeNull();
    expect(stateCodeOf("")).toBeNull();
    expect(stateCodeOf(null)).toBeNull();
  });
});

describe("resolvePartyState", () => {
  it("derives state and code from a valid GSTIN first", () => {
    expect(resolvePartyState({ gstin: "29ABCDE1234F1Z5" })).toEqual({ state: "Karnataka", stateCode: "29" });
    expect(resolvePartyState({ gstin: "27ABCDE1234F1Z5", state: "Maharashtra" })).toEqual({ state: "Maharashtra", stateCode: "27" });
  });

  it("falls back to the explicit code, then the state name", () => {
    expect(resolvePartyState({ stateCode: "33" })).toEqual({ state: "Tamil Nadu", stateCode: "33" });
    expect(resolvePartyState({ state: "Kerala" })).toEqual({ state: "Kerala", stateCode: "32" });
    expect(resolvePartyState({ gstin: "not-a-gstin", state: "Goa" })).toEqual({ state: "Goa", stateCode: "30" });
    expect(resolvePartyState({})).toEqual({ state: null, stateCode: null });
  });
});

describe("panFromGstin", () => {
  it("extracts characters 3–12 of a valid GSTIN", () => {
    expect(panFromGstin("29abcde1234f1z5")).toBe("ABCDE1234F");
    expect(panFromGstin("29ABCDE1234")).toBeNull();
  });
});

describe("isIntraStateSupply", () => {
  it("compares GST state codes when both sides have one", () => {
    expect(isIntraStateSupply({ stateCode: "29" }, { state: "Karnataka" })).toBe(true);
    expect(isIntraStateSupply({ state: "Karnataka", stateCode: "29" }, { stateCode: "27" })).toBe(false);
  });

  it("treats an unknown side as intra-state (CGST + SGST)", () => {
    expect(isIntraStateSupply({ stateCode: "29" }, {})).toBe(true);
    expect(isIntraStateSupply({}, { state: "Kerala" })).toBe(true);
  });
});

describe("PO receipts", () => {
  const lines = [
    { name: "LED Panel", itemId: "a", qty: 10, rate: 100, discountPct: 10, gstRate: 18, receivedQty: 4 },
    { name: "Freight", itemId: null, qty: 1, rate: 500, gstRate: 18 },
  ];

  it("computes what is left to receive", () => {
    expect(poRemaining(lines[0])).toBe(6);
    expect(poRemaining(lines[1])).toBe(1);
    expect(poRemaining({ qty: 2, receivedQty: 5 })).toBe(0);
  });

  it("values received units net of the line discount", () => {
    expect(netUnitCost(lines[0])).toBe(90);
    expect(netUnitCost({ rate: 99.99 })).toBe(99.99);
  });

  it("adds received quantities and sums repeated lines", () => {
    const out = applyPoReceipt(lines, [
      { lineIndex: 0, qty: 2 },
      { lineIndex: 0, qty: 4 },
    ]);
    expect(out.errors).toEqual([]);
    expect(out.lines[0].receivedQty).toBe(10);
    expect(out.lines[1].receivedQty).toBe(0);
    expect(poReceiptStatus(out.lines)).toBe("partially_received");
    const all = applyPoReceipt(out.lines, [{ lineIndex: 1, qty: 1 }]);
    expect(poReceiptStatus(all.lines)).toBe("received");
  });

  it("rejects over-receipts, unknown lines and empty receipts", () => {
    expect(applyPoReceipt(lines, [{ lineIndex: 0, qty: 7 }]).errors[0]).toMatch(/only 6 left/);
    expect(applyPoReceipt(lines, [{ lineIndex: 5, qty: 1 }]).errors[0]).toMatch(/isn't on this purchase order/);
    expect(applyPoReceipt(lines, [{ lineIndex: 0, qty: 0 }]).errors[0]).toMatch(/more than zero/);
    expect(applyPoReceipt(lines, []).errors[0]).toMatch(/at least one line/);
  });

  it("bills received quantities at the PO rate, or the receipt cost without the PO discount", () => {
    const bill = receiptBillLines(lines, [
      { lineIndex: 0, qty: 2 },
      { lineIndex: 1, qty: 1, unitCost: 450 },
    ]);
    expect(bill).toHaveLength(2);
    expect(bill[0]).toMatchObject({ itemId: "a", qty: 2, rate: 100, discountPct: 10, gstRate: 18 });
    expect(bill[1]).toMatchObject({ itemId: null, qty: 1, rate: 450, discountPct: 0 });
    const totals = computeTotals(bill, true);
    expect(totals.taxable).toBe(630);
    expect(totals.grandTotal).toBe(743.4);
  });
});

describe("PO approval and lifecycle rules", () => {
  it("needs approval at or above the limit only when a limit is set", () => {
    expect(poNeedsApproval(50_000, 50_000)).toBe(true);
    expect(poNeedsApproval(49_999.99, 50_000)).toBe(false);
    expect(poNeedsApproval(1e9, 0)).toBe(false);
  });

  it("flags open POs past their expected date as overdue", () => {
    expect(poOverdue({ status: "sent", expectedDate: "2026-10-01" }, "2026-10-12")).toBe(true);
    expect(poOverdue({ status: "partially_received", expectedDate: "2026-10-12" }, "2026-10-12")).toBe(false);
    expect(poOverdue({ status: "received", expectedDate: "2026-10-01" }, "2026-10-12")).toBe(false);
    expect(poOverdue({ status: "approved", expectedDate: null }, "2026-10-12")).toBe(false);
  });

  it("purges only drafts untouched for the configured days", () => {
    expect(isStaleDraft("draft", "2026-10-09", "2026-10-12", 3)).toBe(true);
    expect(isStaleDraft("draft", "2026-10-10", "2026-10-12", 3)).toBe(false);
    expect(isStaleDraft("approved", "2026-01-01", "2026-10-12", 3)).toBe(false);
    expect(isStaleDraft("draft", "2026-01-01", "2026-10-12", 0)).toBe(false);
  });
});

describe("poShareText", () => {
  it("lists lines, total, terms and delivery address", () => {
    const text = poShareText({
      poNo: "PO/26-27/0007",
      orderDate: "2026-10-12",
      expectedDate: "2026-10-19",
      businessName: "Sri Lakshmi Electricals",
      businessGstin: "29ABCDE1234F1Z5",
      supplierName: "Havells India",
      lines: [{ name: "LED Panel", qty: 10, unit: "pcs", rate: 100, amount: 1180 }],
      grandTotal: 1180,
      deliveryAddress: "12 MG Road, Bengaluru",
      paymentTermsDays: 30,
    });
    expect(text).toContain("PO/26-27/0007");
    expect(text).toContain("1. LED Panel — 10 pcs");
    expect(text).toContain("₹1,180.00");
    expect(text).toContain("Payment terms: 30 days");
    expect(text).toContain("Deliver to: 12 MG Road, Bengaluru");
    expect(text).toContain("12 Oct 2026");
  });
});
