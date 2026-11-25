/** Client-side password strength helpers for the profile change-password UI. */

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordCheck = {
  id: "length" | "letter" | "number" | "special" | "match" | "different";
  label: string;
  ok: boolean;
};

export function passwordStrengthScore(password: string): number {
  const p = String(password ?? "");
  if (!p) return 0;
  let score = 0;
  if (p.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (p.length >= 12) score += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
  else if (/[a-zA-Z]/.test(p)) score += 0.5;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score += 1;
  else if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) score += 0.5;
  return Math.min(4, Math.round(score));
}

export function passwordStrengthLabel(score: number): string {
  if (score <= 0) return "Empty";
  if (score === 1) return "Weak";
  if (score === 2) return "Fair";
  if (score === 3) return "Strong";
  return "Excellent";
}

export function buildPasswordChecks(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): PasswordCheck[] {
  const { currentPassword, newPassword, confirmPassword } = input;
  return [
    {
      id: "length",
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      ok: newPassword.length >= MIN_PASSWORD_LENGTH,
    },
    {
      id: "letter",
      label: "Contains a letter",
      ok: /[a-zA-Z]/.test(newPassword),
    },
    {
      id: "number",
      label: "Contains a number",
      ok: /\d/.test(newPassword),
    },
    {
      id: "special",
      label: "Contains a symbol (recommended)",
      ok: /[^A-Za-z0-9]/.test(newPassword),
    },
    {
      id: "match",
      label: "Confirmation matches",
      ok: Boolean(confirmPassword) && confirmPassword === newPassword,
    },
    {
      id: "different",
      label: "Different from current password",
      ok: Boolean(newPassword) && newPassword !== currentPassword,
    },
  ];
}

export function canSubmitPasswordChange(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): boolean {
  const checks = buildPasswordChecks(input);
  return (
    Boolean(input.currentPassword) &&
    checks.find((c) => c.id === "length")!.ok &&
    checks.find((c) => c.id === "match")!.ok &&
    checks.find((c) => c.id === "different")!.ok
  );
}
