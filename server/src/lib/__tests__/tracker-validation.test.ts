import { describe, expect, it } from "vitest";
import { BUILTIN_TRACKER_FIELDS, validateTrackerData, ValidationError } from "@jbt/shared";

describe("validateTrackerData", () => {
  it("accepts valid vendor row", () => {
    const data = validateTrackerData(BUILTIN_TRACKER_FIELDS.vendors, {
      name: "Acme Supplies",
      category: "Panels",
    });
    expect(data.name).toBe("Acme Supplies");
  });

  it("rejects missing required field", () => {
    expect(() => validateTrackerData(BUILTIN_TRACKER_FIELDS.vendors, { name: "" })).toThrow(
      ValidationError,
    );
  });

  it("rejects unknown keys on strict schema", () => {
    expect(() =>
      validateTrackerData(BUILTIN_TRACKER_FIELDS.vendors, { name: "Test", extraField: "x" }),
    ).toThrow(ValidationError);
  });
});
