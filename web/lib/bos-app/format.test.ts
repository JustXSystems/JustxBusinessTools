import { describe, expect, it } from "vitest";
import { addDaysISO, computeGstTotals, dateLabel, dateRange, initialsOf, inr, inrCompact, inrExact, invoiceBadge, isIntraState, timeAgo, toneFor } from "./format";

describe("money", () => {
  it("formats rupees with Indian grouping", () => {
    expect(inr(157000)).toBe("₹1,57,000");
    expect(inr(-4200)).toBe("−₹4,200");
    expect(inrExact(176560)).toBe("₹1,76,560.00");
  });

  it("compacts dashboard figures", () => {
    expect(inrCompact(19_400_000)).toBe("₹1.94Cr");
    expect(inrCompact(7_340_000)).toBe("₹73.4L");
    expect(inrCompact(42_500)).toBe("₹42.5K");
    expect(inrCompact(950)).toBe("₹950");
    expect(inrCompact(0)).toBe("₹0");
  });

  it("computes GST like the API (intra-state splits, inter-state IGST)", () => {
    const lines = [
      { description: "Solar panel installation", quantity: 1, rate: 145000, taxRate: 12 },
      { description: "AMC", quantity: 1, rate: 12000, taxRate: 18 },
    ];
    const intra = computeGstTotals(lines, true);
    expect(intra.subtotal).toBe(157000);
    expect(intra.taxTotal).toBe(19560);
    expect(intra.cgst + intra.sgst).toBe(19560);
    expect(intra.igst).toBe(0);
    expect(intra.grandTotal).toBe(176560);

    const inter = computeGstTotals([{ description: "x", quantity: 2, rate: 1000, discountPct: 10, taxRate: 18 }], false);
    expect(inter.lines[0]).toMatchObject({ gross: 2000, discount: 200, taxable: 1800, tax: 324, amount: 2124 });
    expect(inter.igst).toBe(324);
    expect(inter.cgst).toBe(0);
  });

  it("treats unknown states as intra-state", () => {
    expect(isIntraState("Karnataka", "karnataka")).toBe(true);
    expect(isIntraState("Karnataka", "")).toBe(true);
    expect(isIntraState("Karnataka", "Kerala")).toBe(false);
  });
});

describe("dates & people", () => {
  it("formats dates and ranges", () => {
    expect(dateLabel("2026-08-14")).toBe("14 Aug 2026");
    expect(dateLabel(null)).toBe("—");
    expect(dateRange("2026-07-29", "2026-07-31")).toBe("29 Jul – 31 Jul");
    expect(dateRange("2026-07-29", "2026-07-29")).toBe("29 Jul");
    expect(addDaysISO("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("renders relative time", () => {
    const now = new Date("2026-10-04T12:00:00");
    expect(timeAgo("2026-10-04 11:58:00", now)).toBe("2m ago");
    expect(timeAgo("2026-10-04 09:00:00", now)).toBe("3h ago");
    expect(timeAgo("2026-10-02 12:00:00", now)).toBe("2d ago");
  });

  it("derives initials and stable tones", () => {
    expect(initialsOf("Anita Desai")).toBe("AD");
    expect(initialsOf("Rahul")).toBe("RA");
    expect(initialsOf("")).toBe("?");
    expect(toneFor("Meridian Solar")).toBe(toneFor("Meridian Solar"));
  });

  it("maps invoice states to badges", () => {
    expect(invoiceBadge("overdue")).toEqual({ text: "OVERDUE", tone: "coral" });
    expect(invoiceBadge("paid").tone).toBe("emerald");
  });
});
