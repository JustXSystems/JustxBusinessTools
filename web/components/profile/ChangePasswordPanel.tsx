"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { CollapsibleSection } from "@/components/common/CollapsibleSection";
import {
  buildPasswordChecks,
  canSubmitPasswordChange,
  passwordStrengthLabel,
  passwordStrengthScore,
} from "@/lib/password-strength";

type FieldKey = "current" | "next" | "confirm" | "mfa";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 3l18 18M10.6 10.7a2.5 2.5 0 003.5 3.5M9.9 5.2A10.4 10.4 0 0112 5c5 0 9.3 3.1 11 7.5a12.4 12.4 0 01-4.2 5.1M6.1 6.1A12.3 12.3 0 001 12.5C2.7 16.9 7 20 12 20c1.7 0 3.3-.4 4.7-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M1 12.5C2.7 8.1 7 5 12 5s9.3 3.1 11 7.5C21.3 16.9 17 20 12 20S2.7 16.9 1 12.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.5" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  revealed,
  onToggleReveal,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  revealed: boolean;
  onToggleReveal: () => void;
  placeholder?: string;
}) {
  return (
    <label className="pwd-field" htmlFor={id}>
      <span className="pwd-field-label">{label}</span>
      <span className="pwd-field-control">
        <input
          id={id}
          className="pwd-input"
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          spellCheck={false}
        />
        <button
          type="button"
          className="pwd-reveal"
          onClick={onToggleReveal}
          aria-label={revealed ? "Hide password" : "Show password"}
          tabIndex={0}
        >
          <EyeIcon open={revealed} />
        </button>
      </span>
    </label>
  );
}

/** Self-service password change — available to every signed-in account. */
export function ChangePasswordPanel() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [reveal, setReveal] = useState<Record<FieldKey, boolean>>({
    current: false,
    next: false,
    confirm: false,
    mfa: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ message: string; revoked: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void api<{ enabled: boolean }>("/auth/mfa/status")
      .then((r) => {
        if (alive) setMfaEnabled(Boolean(r.enabled));
      })
      .catch(() => {
        if (alive) setMfaEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const score = passwordStrengthScore(newPassword);
  const checks = useMemo(
    () => buildPasswordChecks({ currentPassword, newPassword, confirmPassword }),
    [currentPassword, newPassword, confirmPassword],
  );
  // When MFA is on (or server asked for it), collect the code up front.
  const needsMfa = mfaEnabled || mfaRequired;
  const formReady =
    canSubmitPasswordChange({ currentPassword, newPassword, confirmPassword }) &&
    (!needsMfa || mfaCode.trim().length >= 6);

  function toggleReveal(key: FieldKey) {
    setReveal((r) => ({ ...r, [key]: !r[key] }));
  }

  function resetForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMfaCode("");
    setMfaRequired(false);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formReady) return;
    setBusy(true);
    setError("");
    setDone(null);
    try {
      const body: Record<string, string> = {
        currentPassword,
        newPassword,
        confirmPassword,
      };
      if (needsMfa && mfaCode.trim()) body.mfaCode = mfaCode.trim();
      const result = await api<{ ok: true; message: string; revokedSessions: number }>(
        "/auth/password/change",
        { method: "POST", body: JSON.stringify(body) },
      );
      setDone({
        message: result.message || "Password updated.",
        revoked: Number(result.revokedSessions) || 0,
      });
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update password";
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "MFA_REQUIRED" || /authenticator code required/i.test(msg)) {
        setMfaRequired(true);
        setError("Enter your authenticator code to confirm this change.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <CollapsibleSection
      className="profile-page-section pwd-panel"
      title="Security · Password"
      hint="Update your sign-in password"
      badge={done ? "Updated" : "Account"}
      badgeTone={done ? "accent" : "default"}
    >
      <div className="pwd-shell">
        <div className="pwd-shell-glow" aria-hidden />
        <div className="pwd-shell-inner">
          <header className="pwd-hero">
            <div className="pwd-hero-mark" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 11V8a5 5 0 0110 0v3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
                <rect
                  x="5"
                  y="11"
                  width="14"
                  height="10"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
                <circle cx="12" cy="16" r="1.4" fill="currentColor" />
              </svg>
            </div>
            <div>
              <p className="pwd-hero-kicker">Credential vault</p>
              <h3 className="pwd-hero-title">Change password</h3>
              <p className="pwd-hero-sub">
                Strengthen your account. Other devices will be signed out after a successful change.
              </p>
            </div>
          </header>

          {done ? (
            <div className="pwd-success" role="status">
              <div className="pwd-success-orb" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div>
                <strong>Password updated</strong>
                <p>{done.message}</p>
                {done.revoked > 0 ? (
                  <p className="pwd-success-meta">
                    {done.revoked} other session{done.revoked === 1 ? "" : "s"} signed out.
                  </p>
                ) : (
                  <p className="pwd-success-meta">This device stays signed in.</p>
                )}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDone(null)}>
                Change again
              </button>
            </div>
          ) : (
            <form className="pwd-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
              <div className="pwd-grid">
                <PasswordField
                  id="pwd-current"
                  label="Current password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                  revealed={reveal.current}
                  onToggleReveal={() => toggleReveal("current")}
                />
                <PasswordField
                  id="pwd-new"
                  label="New password"
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                  revealed={reveal.next}
                  onToggleReveal={() => toggleReveal("next")}
                  placeholder="At least 8 characters"
                />
                <PasswordField
                  id="pwd-confirm"
                  label="Confirm new password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  revealed={reveal.confirm}
                  onToggleReveal={() => toggleReveal("confirm")}
                />
              </div>

              <div className="pwd-meter" aria-live="polite">
                <div className="pwd-meter-head">
                  <span>Strength</span>
                  <strong data-score={score}>{passwordStrengthLabel(score)}</strong>
                </div>
                <div className="pwd-meter-bars" role="img" aria-label={`Password strength ${score} of 4`}>
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={score >= n ? "is-on" : undefined} data-n={n} />
                  ))}
                </div>
              </div>

              <ul className="pwd-checks" aria-label="Password requirements">
                {checks.map((c) => (
                  <li key={c.id} className={c.ok ? "is-ok" : undefined}>
                    <span className="pwd-check-dot" aria-hidden />
                    {c.label}
                  </li>
                ))}
              </ul>

              {needsMfa ? (
                <label className="pwd-field" htmlFor="pwd-mfa">
                  <span className="pwd-field-label">Authenticator code</span>
                  <input
                    id="pwd-mfa"
                    className="pwd-input pwd-input-solo"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-digit code"
                  />
                  <span className="pwd-field-hint">Required because MFA is on for this account.</span>
                </label>
              ) : null}

              {error ? (
                <p className="pwd-error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="pwd-actions">
                <button
                  type="submit"
                  className="btn btn-primary pwd-submit"
                  disabled={busy || !formReady}
                >
                  {busy ? "Updating…" : "Update password"}
                </button>
                <p className="pwd-footnote">
                  Tip: use a unique passphrase. We never store your password in plain text.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
