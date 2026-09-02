"use client";

import { useEffect, useState } from "react";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { ApiHealthBanner } from "@/components/layout/ApiHealthBanner";
import { SplashScreen } from "@/components/auth/SplashScreen";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import { apiUrl, withBasePath } from "@/lib/api-base";
import { requestPhoneOtp } from "@/lib/api";

type AuthMethods = { password: boolean; phoneOtp: boolean; google: boolean; mfa: boolean };

export default function LoginPage() {
  const { branding } = usePlatformBranding();
  const [mode, setMode] = useState<"password" | "phone">("password");
  const [methods, setMethods] = useState<AuthMethods>({
    password: true,
    phoneOtp: false,
    google: false,
    mfa: true,
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [fieldsUnlocked, setFieldsUnlocked] = useState(false);

  useEffect(() => {
    setMounted(true);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
    }
    fetch(apiUrl("/api/auth/methods"), { credentials: "include" })
      .then((r) => r.json())
      .then((data: AuthMethods) => setMethods(data))
      .catch(() => undefined);
  }, []);

  function unlockFields() {
    if (!fieldsUnlocked) setFieldsUnlocked(true);
  }

  function redirectAfterLogin(user?: { isPlatformAdmin?: boolean; role?: string }) {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const canAdmin = user?.isPlatformAdmin || user?.role === "admin";
    const dest =
      next &&
      next.startsWith("/") &&
      !next.startsWith("/login") &&
      !next.startsWith("/register")
        ? canAdmin || !next.startsWith("/admin")
          ? next
          : "/"
        : user?.isPlatformAdmin
          ? "/admin"
          : "/";
    window.location.assign(withBasePath(dest));
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mfaRequired?: boolean;
        mfaToken?: string;
        user?: { isPlatformAdmin?: boolean; role?: string };
      };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Invalid username or password");
        return;
      }
      if (data.mfaRequired && data.mfaToken) {
        setMfaToken(data.mfaToken);
        return;
      }
      redirectAfterLogin(data.user);
    } catch {
      setError(
        "Cannot reach the API server. Run npm run dev (web + API) and ensure the API is on port 4000.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/mfa/verify"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken, code: mfaCode.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: { isPlatformAdmin?: boolean; role?: string };
      };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Invalid authenticator code");
        return;
      }
      redirectAfterLogin(data.user);
    } catch {
      setError("Cannot reach the API server.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestPhoneOtp(phone.trim());
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send OTP");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/otp/verify"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code: otpCode.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: { isPlatformAdmin?: boolean; role?: string };
      };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Invalid code");
        return;
      }
      redirectAfterLogin(data.user);
    } catch {
      setError("Cannot reach the API server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SplashScreen>
      {!mounted ? (
        <div className="login-page" />
      ) : (
        <div className="login-page">
          <ApiHealthBanner />
          <div className="panel login-panel">
            <div className="login-brand">
              <PlatformBrandMark size="lg" showText={false} />
              <div>
                <h1>Sign in</h1>
                <p className="muted">{branding.appName}</p>
              </div>
            </div>

            {mfaToken ? (
              <form onSubmit={handleMfaSubmit} className="login-form" autoComplete="off">
                <p className="muted">Enter the 6-digit code from your authenticator app.</p>
                <label className="field" htmlFor="mfa-code">
                  <span className="label">Authenticator code</span>
                  <input
                    id="mfa-code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    required
                    autoComplete="one-time-code"
                  />
                </label>
                {error ? <p className="field-error">{error}</p> : null}
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? "Verifying…" : "Verify"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setMfaToken("");
                    setMfaCode("");
                  }}
                >
                  Back
                </button>
              </form>
            ) : (
              <>
                {methods.phoneOtp ? (
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                    <button
                      type="button"
                      className={`btn ${mode === "password" ? "btn-primary" : ""}`}
                      onClick={() => setMode("password")}
                    >
                      Password
                    </button>
                    <button
                      type="button"
                      className={`btn ${mode === "phone" ? "btn-primary" : ""}`}
                      onClick={() => setMode("phone")}
                    >
                      Phone OTP
                    </button>
                  </div>
                ) : null}

                {mode === "password" ? (
                  <form
                    onSubmit={handlePasswordSubmit}
                    className="login-form"
                    autoComplete="off"
                    method="post"
                  >
                    <label className="field" htmlFor="login-username">
                      <span className="label">Username</span>
                      <input
                        id="login-username"
                        name="jbt-sign-in-user"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onFocus={unlockFields}
                        required
                        readOnly={!fieldsUnlocked}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        inputMode="email"
                      />
                    </label>
                    <label className="field" htmlFor="login-password">
                      <span className="label">Password</span>
                      <input
                        id="login-password"
                        name="jbt-sign-in-pass"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={unlockFields}
                        required
                        readOnly={!fieldsUnlocked}
                        autoComplete="off"
                      />
                    </label>
                    {error ? <p className="field-error">{error}</p> : null}
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? "Signing in…" : "Sign in"}
                    </button>
                  </form>
                ) : (
                  <form
                    onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}
                    className="login-form"
                    autoComplete="off"
                  >
                    <label className="field" htmlFor="login-phone">
                      <span className="label">Phone</span>
                      <input
                        id="login-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        placeholder="10-digit mobile"
                      />
                    </label>
                    {otpSent ? (
                      <label className="field" htmlFor="login-otp">
                        <span className="label">OTP code</span>
                        <input
                          id="login-otp"
                          inputMode="numeric"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          required
                          autoComplete="one-time-code"
                        />
                      </label>
                    ) : null}
                    {error ? <p className="field-error">{error}</p> : null}
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? "Please wait…" : otpSent ? "Verify OTP" : "Send OTP"}
                    </button>
                  </form>
                )}
              </>
            )}

            <div className="login-signup">
              <p className="muted login-hint">No account yet?</p>
              <a href={withBasePath("/register")} className="btn btn-secondary btn-block login-signup-cta">
                Register with GSTIN
              </a>
            </div>
            <p className="muted login-hint login-status-link">
              <a href={withBasePath("/status")}>System status</a>
            </p>
          </div>
          <PoweredByFooter />
        </div>
      )}
    </SplashScreen>
  );
}
