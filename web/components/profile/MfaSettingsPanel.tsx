"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";

/** TOTP MFA setup for signed-in users (Owner/Admin recommended). */
export function MfaSettingsPanel() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ enabled: boolean }>("/auth/mfa/status");
      setEnabled(Boolean(data.enabled));
    } catch {
      /* MFA optional */
    }
  }, []);

  useEffect(() => {
    if (user) void refresh();
  }, [user, refresh]);

  if (!user) return null;

  async function startSetup() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const data = await api<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup", {
        method: "POST",
        body: "{}",
      });
      setSecret(data.secret);
      setOtpauthUrl(data.otpauthUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    setError("");
    setBusy(true);
    try {
      await api("/auth/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setSecret("");
      setOtpauthUrl("");
      setCode("");
      setMessage("Authenticator enabled.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setError("");
    setBusy(true);
    try {
      await api("/auth/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setCode("");
      setMessage("Authenticator disabled.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginBottom: "1.25rem" }}>
      <h3 className="panel-title">Security · Authenticator (MFA)</h3>
      <p className="section-note">
        {enabled
          ? "Two-factor authentication is on for this account."
          : "Add an authenticator app (Google Authenticator, 1Password, etc.) for Owner/Admin sign-in."}
      </p>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
      {!enabled && !secret ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startSetup()}>
          Set up authenticator
        </button>
      ) : null}
      {secret ? (
        <div className="stack" style={{ gap: "0.75rem" }}>
          <p className="muted">
            Secret: <code>{secret}</code>
          </p>
          <p className="muted" style={{ wordBreak: "break-all" }}>
            {otpauthUrl}
          </p>
          <label className="field">
            <span className="label">Confirm with 6-digit code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmSetup()}>
            Enable MFA
          </button>
        </div>
      ) : null}
      {enabled ? (
        <div className="stack" style={{ gap: "0.75rem", marginTop: "0.75rem" }}>
          <label className="field">
            <span className="label">Code to disable</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
          </label>
          <button type="button" className="btn" disabled={busy} onClick={() => void disable()}>
            Disable MFA
          </button>
        </div>
      ) : null}
    </section>
  );
}
