import { describe, expect, it } from "vitest";
import {
  generateTotpSecret,
  totpAt,
  totpOtpauthUrl,
  verifyTotp,
} from "./totp.js";

describe("totp", () => {
  it("generates base32 secrets and otpauth URLs", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(16);
    expect(totpOtpauthUrl({ secret, accountName: "a@b.c", issuer: "JustX" })).toContain(
      "otpauth://totp/",
    );
  });

  it("verifies codes for the current window", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const counter = Math.floor(Date.now() / 1000 / 30);
    const code = totpAt(secret, counter);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, "000000")).toBe(false);
  });
});
