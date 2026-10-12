/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { isPublicPath } from "./AuthProvider";

describe("isPublicPath", () => {
  it("keeps the existing public pages public", () => {
    for (const p of ["/login", "/login/reset", "/register", "/status", "/q/abc123"]) expect(isPublicPath(p)).toBe(true);
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
