import { describe, expect, it } from "vitest";
import { addDays, computeInvoice, formatINR, formatInvoiceDate, toAmount, toISODate } from "./invoice";

describe("computeInvoice", () => {
  it("matches the design's default invoice (₹1,57,000 + 18% GST)", () => {
    const totals = computeInvoice(
      [
        { id: "a", description: "Solar panel installation — 5kW system", quantity: 1, rate: 145000 },
        { id: "b", description: "Annual maintenance contract", quantity: 1, rate: 12000 },
      ],
      18,
    );
    expect(totals.subtotal).toBe(157000);
    expect(totals.taxAmount).toBeCloseTo(28260);
    expect(totals.total).toBeCloseTo(185260);
    expect(totals.lines.map((l) => l.amount)).toEqual([145000, 12000]);
  });

  it("treats blank, negative and non-numeric input as zero", () => {
    const totals = computeInvoice(
      [{ id: "a", description: "", quantity: Number.NaN, rate: -5 }],
      "abc",
    );
    expect(totals).toMatchObject({ subtotal: 0, taxRate: 0, taxAmount: 0, total: 0 });
  });

  it("handles an empty item list", () => {
    expect(computeInvoice([], 18).total).toBe(0);
  });
});

describe("formatting helpers", () => {
  it("formats rupees with Indian grouping", () => {
    expect(formatINR(157000)).toBe("₹1,57,000");
    expect(formatINR(42_10_000)).toBe("₹42,10,000");
    expect(formatINR(Number.NaN)).toBe("₹0");
  });

  it("parses amounts defensively", () => {
    expect(toAmount("12.5")).toBe(12.5);
    expect(toAmount("")).toBe(0);
    expect(toAmount(undefined)).toBe(0);
  });

  it("round-trips local ISO dates and formats them for the paper", () => {
    const d = new Date(2026, 6, 30);
    expect(toISODate(d)).toBe("2026-07-30");
    expect(toISODate(addDays(d, 15))).toBe("2026-08-14");
    expect(formatInvoiceDate("2026-08-14")).toBe("14 Aug 2026");
    expect(formatInvoiceDate("")).toBe("—");
    expect(formatInvoiceDate("not-a-date")).toBe("—");
  });
});
