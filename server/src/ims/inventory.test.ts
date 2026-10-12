import { describe, expect, it } from "vitest";
import { countDifference, honoursDamagedFlag, isFutureDate, movementEffect, refundAmountFor, restorePlan, summarizeCount, type MovementType } from "./logic.js";

describe("honoursDamagedFlag", () => {
  it("only lets returns target the quarantine bucket", () => {
    expect(honoursDamagedFlag("RETURN_IN")).toBe(true);
    expect(honoursDamagedFlag("RETURN_OUT")).toBe(true);
    for (const t of ["IN", "OUT", "DAMAGE", "WRITE_OFF", "ADJUSTMENT", "OPENING"] as MovementType[]) expect(honoursDamagedFlag(t)).toBe(false);
  });
});

describe("restorePlan", () => {
  it("moves units from quarantine back to saleable stock with no net change in total units", () => {
    const plan = restorePlan(4);
    const net = plan.reduce(
      (acc, step) => {
        const e = movementEffect(step.type, step.qty, { damaged: step.damaged });
        return { saleable: acc.saleable + e.saleable, damaged: acc.damaged + e.damaged };
      },
      { saleable: 0, damaged: 0 },
    );
    expect(net).toEqual({ saleable: 4, damaged: -4 });
  });

  it("takes from quarantine first so an over-restore fails before stock is added", () => {
    const [first] = restorePlan(2.5);
    expect(first).toEqual({ type: "RETURN_OUT", qty: 2.5, damaged: true });
  });

  it("normalises the sign and rounds to 3 decimals", () => {
    expect(restorePlan(-1.23456).map((s) => s.qty)).toEqual([1.235, 1.235]);
  });
});

describe("isFutureDate", () => {
  it("compares ISO dates", () => {
    expect(isFutureDate("2026-10-13", "2026-10-12")).toBe(true);
    expect(isFutureDate("2026-10-12", "2026-10-12")).toBe(false);
    expect(isFutureDate("2025-12-31", "2026-01-01")).toBe(false);
  });
});

describe("countDifference", () => {
  it("is zero for uncounted lines and signed otherwise", () => {
    expect(countDifference(10, null)).toBe(0);
    expect(countDifference(10, 7)).toBe(-3);
    expect(countDifference(1.1, 1.3)).toBe(0.2);
  });
});

describe("summarizeCount", () => {
  it("splits shortages and excess and ignores uncounted lines", () => {
    const { lines, summary } = summarizeCount([
      { systemQty: 10, physicalQty: 8, unitCost: 50 },
      { systemQty: 5, physicalQty: 6, unitCost: 20 },
      { systemQty: 3, physicalQty: 3, unitCost: 99 },
      { systemQty: 7, physicalQty: null, unitCost: 10 },
    ]);
    expect(lines.map((l) => l.difference)).toEqual([-2, 1, 0, 0]);
    expect(summary).toEqual({
      counted: 3,
      mismatches: 2,
      varianceQty: -1,
      varianceValue: -80,
      shortQty: 2,
      shortValue: 100,
      excessQty: 1,
      excessValue: 20,
    });
  });

  it("keeps extra line fields", () => {
    const { lines } = summarizeCount([{ itemId: "a", systemQty: 1, physicalQty: 0, unitCost: 1 }]);
    expect(lines[0]).toMatchObject({ itemId: "a", difference: -1 });
  });

  it("handles an empty sheet", () => {
    expect(summarizeCount([]).summary.counted).toBe(0);
  });
});

describe("refundAmountFor", () => {
  it("uses the explicit amount when given", () => {
    expect(refundAmountFor("pending", 500, 120.555)).toBe(120.56);
    expect(refundAmountFor("none", 500, 0)).toBe(0);
  });

  it("defaults to the full total when a refund is expected", () => {
    expect(refundAmountFor("pending", 500)).toBe(500);
    expect(refundAmountFor("credit_note", 99.999)).toBe(100);
    expect(refundAmountFor("none", 500)).toBe(0);
  });
});
