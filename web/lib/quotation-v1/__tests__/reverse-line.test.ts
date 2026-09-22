import { describe, expect, it } from "vitest";
import {
  lineInclusiveTotal,
  reverseLineFromInclusiveTotal,
} from "@/lib/quotation-v1";

describe("quotation-v1 reverse line calc", () => {
  it("derives rate from GST-inclusive total", () => {
    const r = reverseLineFromInclusiveTotal({
      inclusiveTotal: 11800,
      gstPercent: 18,
      qty: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rate).toBe(10000);
    expect(r.taxable).toBe(10000);
    expect(r.gstAmount).toBe(1800);
  });

  it("splits rate across quantity", () => {
    const r = reverseLineFromInclusiveTotal({
      inclusiveTotal: 2360,
      gstPercent: 18,
      qty: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rate).toBe(1000);
    expect(r.gross).toBe(2000);
  });

  it("accounts for discount before GST", () => {
    // gross 1000, disc 10% → taxable 900, GST 18% → inclusive 1062
    const r = reverseLineFromInclusiveTotal({
      inclusiveTotal: 1062,
      gstPercent: 18,
      qty: 1,
      discountPercent: 10,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rate).toBe(1000);
    expect(r.taxable).toBe(900);
  });

  it("rejects zero quantity", () => {
    const r = reverseLineFromInclusiveTotal({
      inclusiveTotal: 1000,
      gstPercent: 18,
      qty: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("accepts negative inclusive total for credit lines", () => {
    const r = reverseLineFromInclusiveTotal({
      inclusiveTotal: -11800,
      gstPercent: 18,
      qty: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rate).toBe(-10000);
    expect(r.taxable).toBe(-10000);
    expect(r.gstAmount).toBe(-1800);
  });

  it("seeds inclusive total from line fields", () => {
    expect(
      lineInclusiveTotal({ qty: 2, rate: 1000, gst: 18, discount: 0 }),
    ).toBe(2360);
  });
});
