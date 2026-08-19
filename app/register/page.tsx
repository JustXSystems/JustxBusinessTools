"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register({
        email,
        password,
        name: name || undefined,
        organizationName: organizationName || name || undefined,
      });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="panel login-panel">
        <h1>Create account</h1>
        <p className="muted">Start a new organization with your first GST branch.</p>
        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>Organization / business name</span>
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="e.g. Shiv Solar Pvt Ltd"
            />
          </label>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password (min 8 characters)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="field-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="muted login-hint">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
      <PoweredByFooter />
    </div>
  );
}
