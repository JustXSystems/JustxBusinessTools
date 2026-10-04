import { describe, expect, it } from "vitest";
import { computeDonutSegments, scaleBars, sparklinePoints } from "./charts";
import { formatBosClock, initialsOf } from "./clock";

describe("computeDonutSegments", () => {
  it("lays segments end-to-end around the circle", () => {
    const segs = computeDonutSegments([{ value: 63 }, { value: 24 }, { value: 13 }], 52);
    const c = 2 * Math.PI * 52;
    expect(segs.map((s) => s.fraction)).toEqual([0.63, 0.24, 0.13]);
    expect(segs[0].dashOffset).toBe(-0);
    expect(segs[1].dashOffset).toBeCloseTo(-(0.63 * c), 0);
    expect(segs[2].dashOffset).toBeCloseTo(-(0.87 * c), 0);
  });

  it("returns empty arcs for an all-zero series", () => {
    const segs = computeDonutSegments([{ value: 0 }, { value: 0 }], 10);
    expect(segs.every((s) => s.fraction === 0)).toBe(true);
  });

  it("subtracts the gap from each visible arc", () => {
    const [seg] = computeDonutSegments([{ value: 1 }], 10, 4);
    const visible = parseFloat(seg.dashArray.split(" ")[0]);
    expect(visible).toBeCloseTo(2 * Math.PI * 10 - 4, 0);
  });
});

describe("scaleBars / sparklinePoints", () => {
  it("scales against the series max with a floor", () => {
    expect(scaleBars([50, 100, 0], 110, 4)).toEqual([55, 110, 4]);
    expect(scaleBars([0, 0], 100, 2)).toEqual([2, 2]);
  });

  it("fits a sparkline into the box", () => {
    const pts = sparklinePoints([1, 3, 2], 200, 100, 10);
    expect(pts).toEqual([
      [0, 100],
      [100, 10],
      [200, 55],
    ]);
    expect(sparklinePoints([], 10, 10)).toEqual([]);
  });
});

describe("clock + initials", () => {
  it("formats the live clock like the design", () => {
    expect(formatBosClock(new Date(2026, 6, 27, 8, 17), "en-GB")).toBe("Mon 27 Jul · 08:17");
  });

  it("derives initials", () => {
    expect(initialsOf("James Workman")).toBe("JW");
    expect(initialsOf("  anita ")).toBe("AN");
    expect(initialsOf("")).toBe("?");
  });
});
