import { describe, expect, it } from "vitest";
import { applyMarginToExplodeRates, bomHasShortfall, computeBomTotals, parseCapacityNumber, qtyForCapacity } from "./bom.js";

describe("computeBomTotals", () => {
  it("sums materials then applies margin and tax on the running total", () => {
    const t = computeBomTotals(
      [
        { qty: 2, rate: 100 },
        { qty: 1, rate: 50 },
      ],
      10,
      18,
    );
    // materials 250 → margin 25 → 275 → tax 49.5 → 324.5
    expect(t.materialsTotal).toBe(250);
    expect(t.marginAmount).toBe(25);
    expect(t.taxAmount).toBe(49.5);
    expect(t.grandTotal).toBe(324.5);
  });

  it("tolerates zero margin and tax", () => {
    const t = computeBomTotals([{ qty: 3, rate: 10 }], 0, 0);
    expect(t).toEqual({ materialsTotal: 30, marginAmount: 0, taxAmount: 0, grandTotal: 30 });
  });
});

describe("qtyForCapacity", () => {
  it("parses capacity labels", () => {
    expect(parseCapacityNumber("3KW")).toBe(3);
    expect(parseCapacityNumber("Residential 5.5 kW")).toBe(5.5);
    expect(parseCapacityNumber("Size S")).toBeNull();
  });

  it("scales only when flagged and capacity is numeric", () => {
    expect(qtyForCapacity(10, true, "3KW")).toBe(30);
    expect(qtyForCapacity(10, false, "3KW")).toBe(10);
    expect(qtyForCapacity(10, true, "Size S")).toBe(10);
  });
});

describe("applyMarginToExplodeRates", () => {
  it("spreads margin so materials+margin is preserved in line rates", () => {
    const lines = [
      { qty: 2, rate: 100 },
      { qty: 1, rate: 50 },
    ];
    // materials 250, margin 25 → factor 1.1
    const rates = applyMarginToExplodeRates(lines, 25);
    expect(rates).toEqual([110, 55]);
    const taxable = rates.reduce((s, r, i) => s + lines[i]!.qty * r, 0);
    expect(taxable).toBe(275);
  });

  it("leaves rates alone when margin is zero", () => {
    expect(applyMarginToExplodeRates([{ qty: 1, rate: 40 }], 0)).toEqual([40]);
  });
});

describe("bomHasShortfall", () => {
  it("detects positive shortfalls", () => {
    expect(bomHasShortfall([{ itemId: "1", name: "A", unit: "nos", need: 2, have: 2, shortfall: 0 }])).toBe(false);
    expect(bomHasShortfall([{ itemId: "1", name: "A", unit: "nos", need: 3, have: 1, shortfall: 2 }])).toBe(true);
  });
});
