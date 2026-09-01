import { describe, expect, it } from "vitest";
import { isUnauthenticatedApiPath } from "../public-paths.js";

describe("isUnauthenticatedApiPath", () => {
  it("allows public quotation and health", () => {
    expect(isUnauthenticatedApiPath("/api/health")).toBe(true);
    expect(isUnauthenticatedApiPath("/api/public/quotation-v1/abc")).toBe(true);
    expect(isUnauthenticatedApiPath("/api/webhooks/payments/razorpay")).toBe(true);
    expect(isUnauthenticatedApiPath("/api/files/logos/x.png")).toBe(true);
  });

  it("requires auth for app APIs", () => {
    expect(isUnauthenticatedApiPath("/api/profile")).toBe(false);
    expect(isUnauthenticatedApiPath("/api/quotation-v1/list")).toBe(false);
    expect(isUnauthenticatedApiPath("/api/admin/users")).toBe(false);
  });
});
