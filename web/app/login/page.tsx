"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert,
  BosRoot,
  Button,
  Card,
  Field,
  Input,
  Segmented,
} from "@/components/bos";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { ApiHealthBanner } from "@/components/layout/ApiHealthBanner";
import { SplashScreen } from "@/components/auth/SplashScreen";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import { apiUrl, withBasePath } from "@/lib/api-base";
import { requestPhoneOtp } from "@/lib/api";
import { flashAppError } from "@/lib/app-flash";
import "@/components/admin/admin-console.css";

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
  const [error, setErrorState] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [fieldsUnlocked, setFieldsUnlocked] = useState(false);

  function setError(msg: string) {
    setErrorState(msg);
    if (msg.trim()) flashAppError(msg);
  }

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
          : "/admin"
        : canAdmin
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
        <BosRoot canvas className="admin-bos" defaultTheme="dark" skin="bos">
          <div className="admin-cc-login">
            <ApiHealthBanner />
            <Card className="admin-cc-login-card">
              <div className="admin-cc-login-brand">
                <PlatformBrandMark size="lg" showText={false} />
                <div>
                  <h1>Sign in</h1>
                  <p>{branding.appName}</p>
                </div>
              </div>

              {mfaToken ? (
                <form onSubmit={handleMfaSubmit} className="admin-cc-login-form" autoComplete="off">
                  <p className="bos-text-muted" style={{ margin: 0, fontSize: 13 }}>
                    Enter the 6-digit code from your authenticator app.
                  </p>
                  <Field label="Authenticator code">
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        aria-invalid={invalid || undefined}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                        required
                        autoComplete="one-time-code"
                        autoFocus
                      />
                    )}
                  </Field>
                  {error ? <Alert tone="coral" title="Verification failed">{error}</Alert> : null}
                  <Button type="submit" variant="primary" block disabled={loading}>
                    {loading ? "Verifying…" : "Verify"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    block
                    onClick={() => {
                      setMfaToken("");
                      setMfaCode("");
                    }}
                  >
                    Back
                  </Button>
                </form>
              ) : (
                <>
                  {methods.phoneOtp ? (
                    <Segmented
                      block
                      role="tabs"
                      aria-label="Sign-in method"
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: "password", label: "Password" },
                        { value: "phone", label: "Phone OTP" },
                      ]}
                    />
                  ) : null}

                  {mode === "password" ? (
                    <form
                      onSubmit={handlePasswordSubmit}
                      className="admin-cc-login-form"
                      autoComplete="off"
                      method="post"
                    >
                      <Field label="Username">
                        {({ id, describedBy, invalid }) => (
                          <Input
                            id={id}
                            aria-describedby={describedBy}
                            aria-invalid={invalid || undefined}
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
                            autoFocus
                          />
                        )}
                      </Field>
                      <Field label="Password">
                        {({ id, describedBy, invalid }) => (
                          <Input
                            id={id}
                            aria-describedby={describedBy}
                            aria-invalid={invalid || undefined}
                            name="jbt-sign-in-pass"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onFocus={unlockFields}
                            required
                            readOnly={!fieldsUnlocked}
                            autoComplete="off"
                          />
                        )}
                      </Field>
                      {error ? <Alert tone="coral" title="Sign-in failed">{error}</Alert> : null}
                      <Button type="submit" variant="primary" block disabled={loading}>
                        {loading ? "Signing in…" : "Sign in"}
                      </Button>
                    </form>
                  ) : (
                    <form
                      onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}
                      className="admin-cc-login-form"
                      autoComplete="off"
                    >
                      <Field label="Phone">
                        {({ id, describedBy, invalid }) => (
                          <Input
                            id={id}
                            aria-describedby={describedBy}
                            aria-invalid={invalid || undefined}
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            required
                            placeholder="10-digit mobile"
                            autoFocus={!otpSent}
                          />
                        )}
                      </Field>
                      {otpSent ? (
                        <Field label="OTP code">
                          {({ id, describedBy, invalid }) => (
                            <Input
                              id={id}
                              aria-describedby={describedBy}
                              aria-invalid={invalid || undefined}
                              inputMode="numeric"
                              value={otpCode}
                              onChange={(e) => setOtpCode(e.target.value)}
                              required
                              autoComplete="one-time-code"
                              autoFocus
                            />
                          )}
                        </Field>
                      ) : null}
                      {error ? <Alert tone="coral" title="OTP failed">{error}</Alert> : null}
                      <Button type="submit" variant="primary" block disabled={loading}>
                        {loading ? "Please wait…" : otpSent ? "Verify OTP" : "Send OTP"}
                      </Button>
                    </form>
                  )}
                </>
              )}

              <div className="admin-cc-login-foot">
                <p className="bos-text-muted" style={{ margin: 0, fontSize: 13 }}>
                  No account yet?
                </p>
                <Link href="/register" className="bos-btn bos-btn-secondary bos-btn-block">
                  Register with GSTIN
                </Link>
              </div>
            </Card>
            <PoweredByFooter />
          </div>
        </BosRoot>
      )}
    </SplashScreen>
  );
}
