import { describe, expect, it } from "vitest";
import {
  formatClockDisplay,
  normalizeClockDisplayFormat,
  normalizeClockDisplaySettings,
} from "../clock-display.js";

describe("clock-display", () => {
  it("normalizes settings", () => {
    expect(normalizeClockDisplayFormat("")).toBe("dd_mmm_yyyy_hm_a");
    expect(normalizeClockDisplaySettings({ visible: false, format: "hms" })).toEqual({
      visible: false,
      format: "hms",
    });
  });

  it("formats in Asia/Kolkata", () => {
    const d = new Date("2026-09-09T09:00:00.000Z");
    expect(formatClockDisplay(d, "hm_a")).toBe("02:30 PM");
    expect(formatClockDisplay(d, "dd_mm_yyyy")).toBe("09/09/2026");
  });
});
