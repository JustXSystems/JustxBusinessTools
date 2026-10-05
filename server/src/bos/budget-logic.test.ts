import { describe, expect, it } from "vitest";
import { attributeSpend, budgetToDate, evaluateHead, fyEnd, fyMonths, headKey, normaliseMonths, seedMonths } from "./budget-logic.js";

const FY = "2026-04-01";
const flat = (n: number) => Array.from({ length: 12 }, () => n);

describe("financial-year months", () => {
  it("lists twelve months from the start, across the calendar year", () => {
    const months = fyMonths(FY);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-04");
    expect(months[11]).toBe("2027-03");
    expect(fyEnd(FY)).toBe("2027-03-31");
    expect(fyMonths("2026-01-01")[11]).toBe("2026-12");
  });

  it("normalises stored month arrays to twelve non-negative amounts", () => {
    expect(normaliseMonths("[100, -5, \"20.555\"]")).toEqual([100, 0, 20.56, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(normaliseMonths("not json")).toEqual(flat(0));
    expect(normaliseMonths(null)).toHaveLength(12);
  });
});

describe("headKey", () => {
  it("matches categories regardless of case and spacing, and groups blanks", () => {
    expect(headKey("  Site   Materials ")).toBe("site materials");
    expect(headKey("site materials")).toBe(headKey("Site Materials"));
    expect(headKey(null)).toBe("uncategorised");
    expect(headKey("  ")).toBe("uncategorised");
  });
});

describe("budgetToDate", () => {
  it("counts finished months in full and the current month by days gone", () => {
    expect(budgetToDate(flat(3000), FY, "2026-06-15")).toBe(3000 + 3000 + 1500);
    expect(budgetToDate(flat(3000), FY, "2026-03-31")).toBe(0);
    expect(budgetToDate(flat(3000), FY, "2027-05-01")).toBe(36000);
  });
});

describe("evaluateHead", () => {
  it("is on track when spending follows the plan", () => {
    const actual = [10000, 10000, 4000, ...flat(0).slice(3)];
    const f = evaluateHead(flat(10000), actual, FY, "2026-06-12");
    expect(f).toMatchObject({ annual: 120000, actual: 24000, toDate: 24000, remaining: 96000, usedPct: 20, projected: 120000, status: "ok" });
  });

  it("warns when spending runs ahead of plan", () => {
    const f = evaluateHead(flat(10000), [30000, ...flat(0).slice(1)], FY, "2026-04-30");
    expect(f.projected).toBe(140000);
    expect(f.status).toBe("watch");
  });

  it("warns at 90% used and flags anything past the annual budget", () => {
    expect(evaluateHead([100000, ...flat(0).slice(1)], [92000, ...flat(0).slice(1)], FY, "2026-04-30").status).toBe("watch");
    expect(evaluateHead(flat(1000), [13000, ...flat(0).slice(1)], FY, "2026-04-30").status).toBe("over");
  });

  it("treats spend without a budget as over, with no percentage", () => {
    const f = evaluateHead(flat(0), [500, ...flat(0).slice(1)], FY, "2026-04-10");
    expect(f.usedPct).toBeNull();
    expect(f.status).toBe("over");
  });

  it("projects a past year at its actual and a future year at its plan", () => {
    expect(evaluateHead(flat(1000), flat(900), FY, "2027-06-01").projected).toBe(10800);
    expect(evaluateHead(flat(1000), flat(0), FY, "2026-01-15")).toMatchObject({ projected: 12000, status: "ok" });
  });
});

describe("seedMonths", () => {
  it("scales last year's pattern to whole rupees", () => {
    expect(seedMonths([1000, 2500.4, 0], 10).slice(0, 3)).toEqual([1100, 2750, 0]);
    expect(seedMonths(flat(1000), -100)).toEqual(flat(0));
  });
});

describe("attributeSpend", () => {
  const spend = {
    bills: [
      { ym: "2026-04", amount: 5000, category: "Travel" },
      { ym: "2026-05", amount: 2000, category: null },
      { ym: "2027-04", amount: 999, category: "Travel" },
    ],
    expenses: [
      { ym: "2026-04", amount: 1200, category: "travel ", departmentId: "d1" },
      { ym: "2026-05", amount: 800, category: "Meals", departmentId: null },
    ],
    payroll: [
      { ym: "2026-04", amount: 90000, departmentName: "Field Operations" },
      { ym: "2026-04", amount: 40000, departmentName: "Old Team" },
    ],
  };
  const departments = [{ id: "d1", name: "Field Operations" }];

  it("groups bills and claims by category and keeps payroll apart", () => {
    const book = attributeSpend("category", FY, spend, departments);
    expect(book.months("category", "travel")[0]).toBe(6200);
    expect(book.months("category", "uncategorised")[1]).toBe(2000);
    expect(book.heads.get("category:uncategorised")?.label).toBe("Uncategorised");
    expect(book.months("payroll", "")[0]).toBe(130000);
    expect(book.total).toBe(5000 + 2000 + 1200 + 800 + 130000);
  });

  it("splits by department, with bills and unknown departments company-wide", () => {
    const book = attributeSpend("department", FY, spend, departments);
    expect(book.months("department", "d1")[0]).toBe(1200 + 90000);
    expect(book.heads.get("department:d1")?.label).toBe("Field Operations");
    expect(book.months("company", "")[0]).toBe(5000 + 40000);
    expect(book.months("company", "")[1]).toBe(2000 + 800);
    expect(book.total).toBe(attributeSpend("category", FY, spend, departments).total);
  });
});
