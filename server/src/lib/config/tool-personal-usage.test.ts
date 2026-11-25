import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONAL_USAGE_TOOL_IDS,
  resolvePersonalUsage,
} from "./tool-personal-usage.js";

describe("tool personal usage", () => {
  it("defaults calculators and Pinway to personal", () => {
    expect(DEFAULT_PERSONAL_USAGE_TOOL_IDS.has("gstcalc")).toBe(true);
    expect(DEFAULT_PERSONAL_USAGE_TOOL_IDS.has("gmap2mappls")).toBe(true);
    expect(resolvePersonalUsage("gstcalc", {})).toBe(true);
    expect(resolvePersonalUsage("invoice", {})).toBe(false);
  });

  it("lets overrides win", () => {
    expect(resolvePersonalUsage("invoice", { invoice: true })).toBe(true);
    expect(resolvePersonalUsage("gstcalc", { gstcalc: false })).toBe(false);
  });
});
