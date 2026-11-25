import { describe, expect, it } from "vitest";
import {
  buildPasswordChecks,
  canSubmitPasswordChange,
  passwordStrengthLabel,
  passwordStrengthScore,
} from "@/lib/password-strength";

describe("password-strength", () => {
  it("scores and labels strength", () => {
    expect(passwordStrengthScore("")).toBe(0);
    expect(passwordStrengthLabel(0)).toBe("Empty");
    expect(passwordStrengthScore("abcdefgh")).toBeGreaterThanOrEqual(1);
    expect(passwordStrengthLabel(4)).toBe("Excellent");
  });

  it("builds requirement checks and submit gate", () => {
    const checks = buildPasswordChecks({
      currentPassword: "old-secret",
      newPassword: "new-secret1!",
      confirmPassword: "new-secret1!",
    });
    expect(checks.find((c) => c.id === "length")?.ok).toBe(true);
    expect(checks.find((c) => c.id === "match")?.ok).toBe(true);
    expect(
      canSubmitPasswordChange({
        currentPassword: "old-secret",
        newPassword: "new-secret1!",
        confirmPassword: "new-secret1!",
      }),
    ).toBe(true);
    expect(
      canSubmitPasswordChange({
        currentPassword: "old-secret",
        newPassword: "short",
        confirmPassword: "short",
      }),
    ).toBe(false);
  });
});
