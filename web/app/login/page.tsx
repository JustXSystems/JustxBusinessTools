"use client";

import { useEffect, useState } from "react";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { ApiHealthBanner } from "@/components/layout/ApiHealthBanner";
import { SplashScreen } from "@/components/auth/SplashScreen";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";

export default function LoginPage() {
  const { branding } = usePlatformBranding();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  /** Block browser autofill until the user focuses a field. */
  const [fieldsUnlocked, setFieldsUnlocked] = useState(false);

  useEffect(() => {
    setMounted(true);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
    }
  }, []);

  function unlockFields() {
    if (!fieldsUnlocked) setFieldsUnlocked(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: { isPlatformAdmin?: boolean; role?: string };
      };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Invalid username or password");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      const canAdmin =
        data.user?.isPlatformAdmin || data.user?.role === "admin";
      const dest =
        next &&
        next.startsWith("/") &&
        !next.startsWith("/login") &&
        !next.startsWith("/register")
          ? canAdmin || !next.startsWith("/admin")
            ? next
            : "/"
          : data.user?.isPlatformAdmin
            ? "/admin"
            : "/";
      window.location.assign(dest);
    } catch {
      setError(
        "Cannot reach the API server. Run npm run dev (web + API) and ensure the API is on port 4000.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Keep a single SplashScreen mount — swapping trees on `mounted` remounted splash and caused flicker.
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
          <form onSubmit={handleSubmit} className="login-form" autoComplete="off" method="post">
            {/* Honeypot-style decoys reduce aggressive password-manager autofill on load. */}
            <input
              type="text"
              name="fake-username"
              autoComplete="username"
              tabIndex={-1}
              aria-hidden
              value=""
              readOnly
              style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
            />
            <input
              type="password"
              name="fake-password"
              autoComplete="current-password"
              tabIndex={-1}
              aria-hidden
              value=""
              readOnly
              style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
            />
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
          <p className="muted login-hint">
            No account? <a href="/register">Register with GSTIN</a>
          </p>
        </div>
        <PoweredByFooter />
      </div>
      )}
    </SplashScreen>
  );
}
