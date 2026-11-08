import { describe, expect, it } from "vitest";
import { clampImsContentWidthPct, DEFAULT_IMS_LAYOUT } from "./ims-layout.js";

describe("ims-layout", () => {
  it("defaults and clamps content width percent", () => {
    expect(DEFAULT_IMS_LAYOUT.contentWidthPct).toBe(90);
    expect(clampImsContentWidthPct(90)).toBe(90);
    expect(clampImsContentWidthPct(40)).toBe(50);
    expect(clampImsContentWidthPct(140)).toBe(100);
    expect(clampImsContentWidthPct("87.4")).toBe(87);
    expect(clampImsContentWidthPct("nope")).toBe(90);
  });
});
