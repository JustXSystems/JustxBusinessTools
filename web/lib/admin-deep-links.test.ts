import { describe, expect, it } from "vitest";
import { adminDeepLink } from "@/lib/admin-deep-links";

describe("adminDeepLink tool capabilities", () => {
  it("points IMS modules at Access Fabric", () => {
    expect(adminDeepLink.imsModules(12)).toBe("/admin/profiles?id=12&tab=fabric&focus=ims");
    expect(adminDeepLink.imsModules()).toBe("/admin/profiles?tab=fabric&focus=ims");
  });

  it("builds toolCapabilities with focus", () => {
    expect(adminDeepLink.toolCapabilities(5, "imsdealer")).toBe(
      "/admin/profiles?id=5&tab=fabric&focus=ims",
    );
    expect(adminDeepLink.toolCapabilities(5, "bos")).toBe(
      "/admin/profiles?id=5&tab=fabric&focus=bos",
    );
  });
});
