import { describe, expect, it } from "vitest";
import { collectAssignedToolIds, isActiveAssignment } from "./assigned.js";
import type { ToolLicense } from "../tool-licenses.js";

function lic(partial: Partial<ToolLicense> & Pick<ToolLicense, "toolId">): ToolLicense {
  return {
    name: partial.toolId,
    status: "active",
    periodEnd: null,
    sourceClaimId: null,
    recordLimitOverride: null,
    businessProfileId: 1,
    ...partial,
  };
}

describe("isActiveAssignment", () => {
  it("accepts active open-ended licenses", () => {
    expect(isActiveAssignment(lic({ toolId: "imsdealer" }))).toBe(true);
  });

  it("rejects cancelled and revoked", () => {
    expect(isActiveAssignment(lic({ toolId: "imsdealer", status: "cancelled" }))).toBe(false);
    expect(isActiveAssignment(lic({ toolId: "imsdealer", status: "revoked" }))).toBe(false);
  });

  it("rejects expired period ends", () => {
    expect(
      isActiveAssignment(lic({ toolId: "imsdealer", periodEnd: "2020-01-01T00:00:00.000Z" })),
    ).toBe(false);
  });
});

describe("collectAssignedToolIds", () => {
  it("keeps only active licenses and maps SKU names", () => {
    const { assigned, names } = collectAssignedToolIds(
      [
        lic({ toolId: "imsdealer", name: "IMS" }),
        lic({ toolId: "quotation", status: "cancelled", name: "Quote" }),
      ],
      [{ toolId: "bos", name: "BOS" }],
    );
    expect([...assigned]).toEqual(["imsdealer"]);
    expect(names.get("imsdealer")).toBe("IMS");
    expect(names.get("bos")).toBe("BOS");
    expect(names.get("quotation")).toBeUndefined();
  });
});
