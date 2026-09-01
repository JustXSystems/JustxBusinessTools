"use client";

import { useEffect, useState } from "react";
import { apiUrl, withBasePath } from "@/lib/api-base";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";

type StatusPayload = {
  ok: boolean;
  db?: string;
  checkedAt?: string;
  components?: Record<string, string>;
};

export default function StatusPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(apiUrl("/api/public/status"), { cache: "no-store" });
        const data = (await res.json()) as StatusPayload;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setError("Unable to reach status API");
      }
    }
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const ok = status?.ok === true && status.db === "ok";

  return (
    <main className="login-page" style={{ padding: "2rem 1rem" }}>
      <div className="panel login-panel" style={{ maxWidth: 480 }}>
        <div className="login-brand">
          <PlatformBrandMark size="md" showText={false} />
          <div>
            <h1>System status</h1>
            <p className="muted">JustX Business Tools</p>
          </div>
        </div>
        {error ? <p className="field-error">{error}</p> : null}
        {!status && !error ? <p className="muted">Checking…</p> : null}
        {status ? (
          <>
            <p style={{ fontSize: "1.25rem", fontWeight: 600, color: ok ? "#0a7a3e" : "#b42318" }}>
              {ok ? "All systems operational" : "Degraded or unavailable"}
            </p>
            <ul className="muted" style={{ listStyle: "none", padding: 0, lineHeight: 1.8 }}>
              <li>API: {status.components?.api ?? (status.ok ? "ok" : "error")}</li>
              <li>Database: {status.db ?? "unknown"}</li>
              {status.checkedAt ? <li>Checked: {new Date(status.checkedAt).toLocaleString()}</li> : null}
            </ul>
          </>
        ) : null}
        <p className="muted" style={{ marginTop: "1.5rem" }}>
          <a href={withBasePath("/")}>Back to app</a>
          {" · "}
          <a href={withBasePath("/login")}>Sign in</a>
        </p>
      </div>
    </main>
  );
}
