import { describe, expect, it } from "vitest";
import { bookValue, depreciationSchedule, yearFigures, type DepreciableAsset } from "./asset-logic.js";

const asset = (over: Partial<DepreciableAsset> = {}): DepreciableAsset => ({ cost: 100000, salvage: 0, method: "slm", rate: 10, purchaseDate: "2026-04-01", ...over });

describe("depreciationSchedule", () => {
  it("charges SLM on cost each full year, including a leap year", () => {
    const rows = depreciationSchedule(asset(), "2029-03-31");
    expect(rows.map((r) => r.label)).toEqual(["26-27", "27-28", "28-29"]);
    expect(rows.map((r) => r.depreciation)).toEqual([10000, 10000, 10000]);
    expect(rows[1].days).toBe(366);
    expect(rows[2].closing).toBe(70000);
  });

  it("charges WDV on the opening book value", () => {
    const rows = depreciationSchedule(asset({ method: "wdv", rate: 15 }), "2028-03-31");
    expect(rows.map((r) => [r.opening, r.depreciation, r.closing])).toEqual([
      [100000, 15000, 85000],
      [85000, 12750, 72250],
    ]);
  });

  it("is pro-rata to the days held in the first year and up to the date asked", () => {
    expect(depreciationSchedule(asset({ purchaseDate: "2026-10-01" }), "2027-03-31")[0]).toMatchObject({ days: 182, depreciation: 4986.3 });
    expect(depreciationSchedule(asset(), "2026-04-30")[0]).toMatchObject({ days: 30, depreciation: 821.92 });
  });

  it("never goes below the salvage value", () => {
    const rows = depreciationSchedule(asset({ cost: 10000, salvage: 1000, rate: 40 }), "2030-03-31");
    expect(rows.map((r) => r.depreciation)).toEqual([4000, 4000, 1000, 0]);
    expect(rows[3].closing).toBe(1000);
  });

  it("stops at disposal and charges nothing without a method", () => {
    const rows = depreciationSchedule(asset({ disposedOn: "2027-06-30" }), "2030-03-31");
    expect(rows).toHaveLength(2);
    expect(rows[1].days).toBe(91);
    expect(depreciationSchedule(asset({ method: "none", rate: 10 }), "2028-03-31").every((r) => r.depreciation === 0)).toBe(true);
  });

  it("follows a calendar financial year when it starts in January", () => {
    const rows = depreciationSchedule(asset({ purchaseDate: "2026-07-01" }), "2027-12-31", 1);
    expect(rows.map((r) => [r.fyStart, r.fyEnd])).toEqual([
      ["2026-01-01", "2026-12-31"],
      ["2027-01-01", "2027-12-31"],
    ]);
    expect(rows[0].days).toBe(184);
  });
});

describe("bookValue", () => {
  it("is the cost before purchase and the depreciated value after", () => {
    expect(bookValue(asset(), "2026-03-01")).toBe(100000);
    expect(bookValue(asset(), "2027-03-31")).toBe(90000);
  });
});

describe("yearFigures", () => {
  const sold = asset({ purchaseDate: "2025-04-01", disposedOn: "2026-09-30" });

  it("shows an addition in the purchase year", () => {
    expect(yearFigures(sold, "2025-04-01")).toEqual({ opening: 0, additions: 100000, depreciation: 10000, disposals: 0, closing: 90000 });
  });

  it("removes the book value in the disposal year and leaves later years empty", () => {
    expect(yearFigures(sold, "2026-04-01")).toEqual({ opening: 90000, additions: 0, depreciation: 5013.7, disposals: 84986.3, closing: 0 });
    expect(yearFigures(sold, "2027-04-01")).toEqual({ opening: 0, additions: 0, depreciation: 0, disposals: 0, closing: 0 });
  });
});
