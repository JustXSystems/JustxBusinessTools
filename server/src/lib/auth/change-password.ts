/** Shared password-change validation (API + tests). */

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword?: string;
};

export type PasswordChangeValidation =
  | { ok: true; currentPassword: string; newPassword: string }
  | { ok: false; error: string };

export function validatePasswordChangeInput(raw: {
  currentPassword?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
}): PasswordChangeValidation {
  const currentPassword = String(raw.currentPassword ?? "");
  const newPassword = String(raw.newPassword ?? "");
  const confirmPassword =
    raw.confirmPassword === undefined || raw.confirmPassword === null
      ? undefined
      : String(raw.confirmPassword);

  if (!currentPassword) {
    return { ok: false, error: "Current password is required" };
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (confirmPassword !== undefined && confirmPassword !== newPassword) {
    return { ok: false, error: "New password and confirmation do not match" };
  }
  if (currentPassword === newPassword) {
    return { ok: false, error: "New password must be different from your current password" };
  }
  return { ok: true, currentPassword, newPassword };
}

/** Client-side strength score 0–4 for the meter (not a security gate). */
export function passwordStrengthScore(password: string): number {
  const p = String(password ?? "");
  if (!p) return 0;
  let score = 0;
  if (p.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (p.length >= 12) score += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score += 1;
  else if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) score += 0.5;
  return Math.min(4, Math.floor(score));
}
