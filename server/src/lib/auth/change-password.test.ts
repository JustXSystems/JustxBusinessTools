import { describe, expect, it } from "vitest";
import { passwordStrengthScore, validatePasswordChangeInput } from "./change-password.js";

describe("validatePasswordChangeInput", () => {
  it("accepts a valid change", () => {
    expect(
      validatePasswordChangeInput({
        currentPassword: "old-secret",
        newPassword: "new-secret1",
        confirmPassword: "new-secret1",
      }),
    ).toEqual({
      ok: true,
      currentPassword: "old-secret",
      newPassword: "new-secret1",
    });
  });

  it("rejects short / mismatched / unchanged passwords", () => {
    expect(validatePasswordChangeInput({ currentPassword: "", newPassword: "abcdefgh" }).ok).toBe(
      false,
    );
    expect(
      validatePasswordChangeInput({ currentPassword: "old-secret", newPassword: "short" }).ok,
    ).toBe(false);
    expect(
      validatePasswordChangeInput({
        currentPassword: "old-secret",
        newPassword: "new-secret1",
        confirmPassword: "other",
      }).ok,
    ).toBe(false);
    expect(
      validatePasswordChangeInput({
        currentPassword: "same-pass",
        newPassword: "same-pass",
      }).ok,
    ).toBe(false);
  });
});

describe("passwordStrengthScore", () => {
  it("scores empty low and strong passwords higher", () => {
    expect(passwordStrengthScore("")).toBe(0);
    expect(passwordStrengthScore("abcdefgh")).toBeGreaterThanOrEqual(1);
    expect(passwordStrengthScore("Abcdefgh1!")).toBeGreaterThanOrEqual(3);
  });
});
