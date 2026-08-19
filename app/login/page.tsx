"use client";

import { useEffect, useState } from "react";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { ApiHealthBanner } from "@/components/layout/ApiHealthBanner";

export default function LoginPage() {
  const [username, setUsername] = useState("admin@justx.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
    }
  }, []);

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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Invalid username or password");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      window.location.assign(next && next.startsWith("/") ? next : "/admin");
    } catch {
      setError(
        "Cannot reach the API server. Run npm run dev (web + API) and ensure the API is on port 4000.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) {
    return (
      <div className="login-page">
        <div className="panel login-panel">
          <h1>Sign in</h1>
          <p className="muted">JustX Business Tools</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <ApiHealthBanner />
      <div className="panel login-panel">
        <h1>Sign in</h1>
        <p className="muted">JustX Business Tools</p>
        <form onSubmit={handleSubmit} className="login-form">
          <label className="field" htmlFor="login-username">
            <span className="label">Username</span>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <label className="field" htmlFor="login-password">
            <span className="label">Password</span>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="field-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
      <PoweredByFooter />
    </div>
  );
}
