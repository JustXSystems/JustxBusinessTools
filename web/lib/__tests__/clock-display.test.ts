import { describe, expect, it } from "vitest";
import {
  formatClockDisplay,
  getClockChromeParts,
  normalizeClockDisplayFormat,
  normalizeClockDisplaySettings,
} from "@/lib/clock-display";

describe("clock-display", () => {
  it("normalizes unknown format to default", () => {
    expect(normalizeClockDisplayFormat("nope")).toBe("dd_mmm_yyyy_hm_a");
    expect(normalizeClockDisplaySettings({ visible: "0", format: "hm_a" })).toEqual({
      visible: false,
      format: "hm_a",
    });
  });

  it("formats IST wall clock", () => {
    // 2026-09-09 09:00:00 UTC = 14:30 IST
    const d = new Date("2026-09-09T09:00:00.000Z");
    expect(formatClockDisplay(d, "dd_mm_yyyy_hm")).toBe("09/09/2026 14:30");
    expect(formatClockDisplay(d, "dd_mmm_yyyy_hm_a")).toBe("09 Sep 2026, 02:30 PM");
    expect(formatClockDisplay(d, "ddd_dd_mmm_yyyy_hm_a_ist")).toMatch(/Sep 2026 · 02:30 PM IST$/);
    expect(formatClockDisplay(d, "yyyy_mm_dd_hm")).toBe("2026-09-09 14:30");
  });

  it("builds corporate chrome parts", () => {
    const d = new Date("2026-09-09T09:00:00.000Z");
    const parts = getClockChromeParts(d, "ddd_dd_mmm_yyyy_hm_a");
    expect(parts.weekday).toBe("WED");
    expect(parts.dateLine).toBe("09 Sep 2026");
    expect(parts.timeLine).toBe("02:30 PM");
    expect(parts.showTzChip).toBe(true);
  });
});
