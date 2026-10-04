"use client";

import "./bos-app.css";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BosIcon, BosRoot, Button, Field, Footnote, Input, Segmented } from "@/components/bos";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { api, requestPhoneOtp } from "@/lib/api";
import { publicAssetUrl, withBasePath } from "@/lib/base-path";
import { isBosLive } from "@/lib/bos-app/handoff";
import { clearSubscriptionSnapshot } from "@/lib/subscription-cache";
import { clearToolCart } from "@/lib/tool-cart";
import { BOS_LOGO, BosApp } from "./BosApp";

type AuthMethods = { password: boolean; phoneOtp: boolean; google: boolean; mfa: boolean };
type LoginResponse = { user?: unknown; mfaRequired?: boolean; mfaToken?: string } | undefined;

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function LoginCard({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const { verifyOtp } = useAuth();
  const [methods, setMethods] = useState<AuthMethods>({ password: true, phoneOtp: false, google: false, mfa: true });
  const [method, setMethod] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AuthMethods>("/auth/methods")
      .then((m) => setMethods(m))
      .catch(() => undefined);
  }, []);

  const attempt = async (fn: () => Promise<void>, fallback: string) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(message(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      const data = await api<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email: email.trim(), password }) });
      if (data?.mfaRequired && data.mfaToken) {
        setMfaToken(data.mfaToken);
        return;
      }
      await onSignedIn();
    }, "Invalid email or password");
  };

  const submitMfa = (e: FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      await api("/auth/mfa/verify", { method: "POST", body: JSON.stringify({ mfaToken, code: mfaCode.trim() }) });
      await onSignedIn();
    }, "Invalid authenticator code");
  };

  const submitOtp = (e: FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      if (!otpSent) {
        await requestPhoneOtp(phone.trim());
        setOtpSent(true);
        return;
      }
      await verifyOtp(phone.trim(), otp.trim());
      await onSignedIn();
    }, otpSent ? "Invalid code" : "Could not send the code");
  };

  const note = (
    <div className="bos-login-note">
      <BosIcon name="lock" />
      Protected by enterprise-grade encryption
    </div>
  );

  if (mfaToken) {
    return (
      <form className="bos-login-card" onSubmit={submitMfa}>
        <h2 className="bos-login-title">Two-step verification</h2>
        <p className="bos-login-sub">Enter the 6-digit code from your authenticator app.</p>
        <Field label="Authenticator code">{({ id }) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required autoFocus value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />}</Field>
        {error ? <p className="bos-app-error" role="alert">{error}</p> : null}
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? "Verifying…" : "Verify & sign in"}
        </Button>
        <div className="bos-login-between" style={{ justifyContent: "center", marginTop: 12 }}>
          <button
            type="button"
            className="bos-link"
            onClick={() => {
              setMfaToken("");
              setMfaCode("");
            }}
          >
            ← Back
          </button>
        </div>
        {note}
      </form>
    );
  }

  return (
    <form className="bos-login-card" onSubmit={method === "password" ? submitPassword : submitOtp}>
      <h2 className="bos-login-title">Welcome to Justx BOS</h2>
      <p className="bos-login-sub">Sign in with your Justx Business Tools account.</p>
      {methods.phoneOtp ? (
        <Segmented
          block
          role="tabs"
          aria-label="Sign-in method"
          options={[
            { value: "password", label: "Password" },
            { value: "otp", label: "Mobile OTP" },
          ]}
          value={method}
          onChange={(m) => {
            setMethod(m);
            setError("");
          }}
        />
      ) : null}
      {method === "password" ? (
        <>
          <Field label="Work email">{({ id }) => <Input id={id} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Password">{({ id }) => <Input id={id} type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          {error ? <p className="bos-app-error" role="alert">{error}</p> : null}
          <div className="bos-login-between">
            <span className="bos-text-faint" style={{ fontSize: 12 }}>
              Google or other sign-in?
            </span>
            <a className="bos-link" href={withBasePath("/login?next=/bos")}>
              Use JBT sign-in
            </a>
          </div>
          <Button type="submit" variant="primary" block disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </>
      ) : (
        <>
          <Field label="Registered mobile number">
            {({ id }) => <Input id={id} type="tel" inputMode="tel" required autoComplete="tel" disabled={otpSent} value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
          {otpSent ? (
            <>
              <p className="bos-otp-hint">Enter the 6-digit code sent to your phone.</p>
              <Field label="One-time code">{({ id }) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required autoFocus value={otp} onChange={(e) => setOtp(e.target.value)} />}</Field>
            </>
          ) : null}
          {error ? <p className="bos-app-error" role="alert">{error}</p> : null}
          <Button type="submit" variant="primary" block disabled={busy}>
            {busy ? "Please wait…" : otpSent ? "Verify & sign in" : "Send code"}
          </Button>
          {otpSent ? (
            <div className="bos-login-between" style={{ justifyContent: "center", marginTop: 12 }}>
              <button
                type="button"
                className="bos-link"
                onClick={() => {
                  setOtpSent(false);
                  setOtp("");
                }}
              >
                Change number
              </button>
            </div>
          ) : null}
        </>
      )}
      {note}
    </form>
  );
}

function Gate({ children }: { children: ReactNode }) {
  return (
    <BosRoot canvas className="bos-app-standalone">
      <main className="bos-app-gate">
        {children}
        <div className="bos-app-gate-foot">
          <Footnote>Justx BOS™ (Business Operating System) · © 2026 Justx Systems. All Rights Reserved.</Footnote>
        </div>
      </main>
    </BosRoot>
  );
}

function Splash({ logoSrc, sub, onLogin }: { logoSrc: string; sub: string; onLogin?: () => void }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset under the app base path */}
      <img className="bos-splash-logo" src={logoSrc} alt="Justx" />
      <div className="bos-splash-welcome">Welcome to Justx</div>
      <div className="bos-splash-sub">{sub}</div>
      {onLogin ? (
        <Button variant="primary" className="bos-splash-cta" onClick={onLogin}>
          Login
        </Button>
      ) : null}
    </>
  );
}

/** `/bos` — Justx BOS as a full-screen application, signed in with JBT accounts. */
export function BosStandalone() {
  const { user, loading, refresh } = useAuth();
  const { config, refresh: refreshConfig } = usePlatformConfig();
  const [stage, setStage] = useState<"splash" | "login">("splash");
  const [configFor, setConfigFor] = useState<string | null>(null);
  const logoSrc = publicAssetUrl(BOS_LOGO);
  const userKey = user ? `${user.id}:${user.businessProfileId}` : null;

  /* The org catalog decides whether BOS is enabled; re-read it for the signed-in tenant. */
  useEffect(() => {
    if (!userKey) return;
    let alive = true;
    refreshConfig()
      .catch(() => undefined)
      .finally(() => alive && setConfigFor(userKey));
    return () => {
      alive = false;
    };
  }, [userKey, refreshConfig]);

  const signOut = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      clearSubscriptionSnapshot();
      clearToolCart();
      setStage("login");
      await refresh();
    }
  };

  if (loading || (user && configFor !== userKey)) {
    return (
      <Gate>
        <Splash logoSrc={logoSrc} sub="Setting up your workspace…" />
      </Gate>
    );
  }

  if (!user) {
    return <Gate>{stage === "splash" ? <Splash logoSrc={logoSrc} sub="Your Business Operating System" onLogin={() => setStage("login")} /> : <LoginCard onSignedIn={refresh} />}</Gate>;
  }

  const enabled = Boolean(user.isPlatformAdmin) || isBosLive(config?.catalog);
  if (!enabled) {
    return (
      <Gate>
        <div className="bos-login-card">
          <h2 className="bos-login-title">Justx BOS isn&apos;t enabled yet</h2>
          <p className="bos-login-sub">
            An administrator can turn it on in Admin → Tools (Justx BOS → Visible on home → Live, then Save placement). It then opens here and inside Justx Business Tools.
          </p>
          <div className="bos-row" style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <a className="bos-btn bos-btn-primary" href={withBasePath("/")}>
              Open Justx Business Tools
            </a>
            <Button onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>
      </Gate>
    );
  }

  return <BosApp mode="standalone" onSignOut={() => void signOut()} />;
}
