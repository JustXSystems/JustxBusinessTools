/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { isGuestAllowedPath, isPublicPath } from "./AuthProvider";

describe("isPublicPath", () => {
  it("keeps the existing public pages public", () => {
    for (const p of ["/login", "/login/reset", "/register", "/status", "/q/abc123", "/bom/proposal/abc123"]) expect(isPublicPath(p)).toBe(true);
  });

  it("lets the standalone BOS app render its own sign-in", () => {
    expect(isPublicPath("/bos")).toBe(true);
    expect(isPublicPath("/bos/")).toBe(true);
  });

  it("lets the standalone IMS app render its own sign-in", () => {
    expect(isPublicPath("/ims")).toBe(true);
    expect(isPublicPath("/ims/")).toBe(true);
  });

  it("does not open look-alike or operator routes", () => {
    for (const p of ["/", "/boss", "/bosdesign", "/imsx", "/tools/bos", "/tools/bosdesign", "/tools/imsdealer", "/invoices", "/admin/tools", "/settings"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe("isGuestAllowedPath", () => {
  it("allows marketing root for guests without treating it as a public ACL bypass for signed-in users", () => {
    expect(isGuestAllowedPath("/")).toBe(true);
    expect(isGuestAllowedPath("")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
  });

  it("still allows the classic public prefixes", () => {
    expect(isGuestAllowedPath("/login")).toBe(true);
    expect(isGuestAllowedPath("/register")).toBe(true);
    expect(isGuestAllowedPath("/status")).toBe(true);
  });

  it("does not open operator routes to guests", () => {
    for (const p of ["/tools/gstcalc", "/invoices", "/admin", "/profile", "/subscription"]) {
      expect(isGuestAllowedPath(p)).toBe(false);
    }
  });
});
