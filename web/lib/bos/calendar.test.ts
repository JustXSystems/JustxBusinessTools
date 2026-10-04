import { describe, expect, it } from "vitest";
import { buildMonthGrid, monthLabel, shiftMonth } from "./calendar";

describe("buildMonthGrid", () => {
  it("reproduces the design's July 2026 grid (Mon-first, 29–30 Jun lead, 1–2 Aug tail)", () => {
    const cells = buildMonthGrid(2026, 6, new Date(2026, 6, 27));
    expect(cells).toHaveLength(35);
    expect(cells.slice(0, 3).map((c) => [c.day, c.inMonth])).toEqual([
      [29, false],
      [30, false],
      [1, true],
    ]);
    expect(cells.slice(-2).map((c) => [c.day, c.inMonth])).toEqual([
      [1, false],
      [2, false],
    ]);
    const today = cells.filter((c) => c.isToday);
    expect(today).toHaveLength(1);
    expect(today[0].key).toBe("2026-07-27");
  });

  it("always returns whole weeks", () => {
    for (let m = 0; m < 12; m += 1) {
      expect(buildMonthGrid(2027, m).length % 7).toBe(0);
    }
  });

  it("pads a month that starts on Monday with no leading days", () => {
    const cells = buildMonthGrid(2026, 5);
    expect(cells[0]).toMatchObject({ day: 1, inMonth: true });
  });
});

describe("month helpers", () => {
  it("labels and shifts across year boundaries", () => {
    expect(monthLabel(2026, 6)).toBe("July 2026");
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });
});
