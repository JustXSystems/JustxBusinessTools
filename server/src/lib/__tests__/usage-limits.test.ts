import { describe, expect, it } from "vitest";
import { buildUsagePayload, LimitReachedError } from "../usage-limits.js";

describe("buildUsagePayload", () => {
  it("marks near limit at 24 of 28", () => {
    const usage = buildUsagePayload("payment", 24, 28);
    expect(usage.nearLimit).toBe(true);
    expect(usage.atLimit).toBe(false);
  });

  it("marks at limit at 28", () => {
    const usage = buildUsagePayload("invoice", 28, 28);
    expect(usage.atLimit).toBe(true);
    expect(usage.nearLimit).toBe(true);
  });

  it("never limits Pro (null limit)", () => {
    const usage = buildUsagePayload("invoice", 100, null);
    expect(usage.limit).toBeNull();
    expect(usage.atLimit).toBe(false);
    expect(usage.nearLimit).toBe(false);
  });
});

describe("LimitReachedError", () => {
  it("carries limit and code", () => {
    const err = new LimitReachedError(28);
    expect(err.code).toBe("FREE_LIMIT_REACHED");
    expect(err.limit).toBe(28);
  });
});
