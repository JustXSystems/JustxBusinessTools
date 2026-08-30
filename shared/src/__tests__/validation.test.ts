import { describe, expect, it } from "vitest";
import { validateDocumentState } from "../validation/document";
import { validateTrackerData, ValidationError } from "../validation/tracker";
import { BUILTIN_TRACKER_FIELDS } from "../validation/fields";

describe("validateDocumentState", () => {
  it("accepts numeric item ids (client editor uses numbers)", () => {
    const data = validateDocumentState({
      party: { name: "Customer A" },
      items: [{ id: 1, name: "Panel", qty: 1, unit: "NOS", rate: 5000 }],
    });
    expect(data.party).toMatchObject({ name: "Customer A" });
  });

  it("rejects zero rate", () => {
    expect(() =>
      validateDocumentState({
        party: { name: "Customer A" },
        items: [{ id: 1, name: "Panel", qty: 1, rate: 0 }],
      }),
    ).toThrow(ValidationError);
  });
});

describe("shared validateTrackerData", () => {
  it("accepts valid vendor", () => {
    const data = validateTrackerData(BUILTIN_TRACKER_FIELDS.vendors, { name: "Acme" });
    expect(data.name).toBe("Acme");
  });

  it("rejects empty required field", () => {
    expect(() => validateTrackerData(BUILTIN_TRACKER_FIELDS.vendors, { name: "" })).toThrow(
      ValidationError,
    );
  });
});
