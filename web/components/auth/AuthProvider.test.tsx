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

  it("does not open look-alike or operator routes", () => {
    for (const p of ["/", "/boss", "/bosdesign", "/tools/bos", "/tools/bosdesign", "/invoices", "/admin/tools", "/settings"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
