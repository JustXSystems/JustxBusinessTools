"use client";

import { useCallback, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import Link from "next/link";

type IntegrationStatus = "not_configured" | "disabled" | "active" | "error";

type IntegrationPublic = {
  id: "google_oauth" | "email_webhook";
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  status: IntegrationStatus;
  statusDetail: string | null;
  source: "db" | "env" | null;
  lastCheckedAt: string | null;
  publicConfig: Record<string, unknown>;
};

type ListResponse = {
  integrations: IntegrationPublic[];
  hints: {
    redirectUriLogin: string;
    redirectUriDrive: string;
    migrateNote: string;
  };
};

function statusPill(status: IntegrationStatus) {
  if (status === "active") return "pill pill-success";
  if (status === "error") return "pill pill-danger";
  if (status === "disabled") return "pill pill-warning";
  return "pill";
}

function statusLabel(status: IntegrationStatus) {
  if (status === "not_configured") return "Not configured";
  if (status === "disabled") return "Disabled";
  if (status === "active") return "Active";
  return "Error";
}

function FieldGuide({ children }: { children: ReactNode }) {
  return <p className="muted small" style={{ margin: "0.35rem 0 0", lineHeight: 1.45 }}>{children}</p>;
}

function GuideBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="muted small"
      style={{
        marginTop: "0.85rem",
        padding: "0.85rem 1rem",
        border: "1px solid var(--border, rgba(0,0,0,0.08))",
        borderRadius: 8,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: "block", marginBottom: "0.4rem", color: "var(--text-mid, inherit)" }}>
        {title}
      </strong>
      {children}
    </div>
  );
}

export default function AdminIntegrationsPage() {
  const { user } = useAuth();
  const isPlatform = Boolean(user?.isPlatformAdmin);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const [googleForm, setGoogleForm] = useState({
    enabled: false,
    clientId: "",
    clientSecret: "",
    supportEmail: "",
  });
  const [emailForm, setEmailForm] = useState({ enabled: false, url: "" });

  const load = useCallback(async () => {
    if (!isPlatform) return;
    try {
      const next = await api<ListResponse>("/admin/integrations");
      setData(next);
      setError("");
      const g = next.integrations.find((i) => i.id === "google_oauth");
      const e = next.integrations.find((i) => i.id === "email_webhook");
      if (g) {
        setGoogleForm((prev) => ({
          enabled: g.enabled,
          clientId: String(g.publicConfig.clientId ?? "") || prev.clientId,
          clientSecret: g.publicConfig.clientSecretConfigured ? "••••keep" : "",
          supportEmail: String(g.publicConfig.supportEmail ?? "") || prev.supportEmail,
        }));
      }
      if (e) {
        setEmailForm({
          enabled: e.enabled,
          url: String(e.publicConfig.url ?? ""),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load integrations");
    }
  }, [isPlatform]);

  useLiveRefresh(load, { intervalMs: 60_000, enabled: isPlatform });

  async function saveGoogle() {
    setBusy("google-save");
    setMsg("");
    setError("");
    try {
      const res = await api<{ ok: boolean; warning?: string | null }>("/admin/integrations/google_oauth", {
        method: "PUT",
        body: JSON.stringify({
          enabled: googleForm.enabled,
          clientId: googleForm.clientId.trim(),
          clientSecret:
            googleForm.clientSecret.startsWith("••••") || !googleForm.clientSecret.trim()
              ? ""
              : googleForm.clientSecret.trim(),
          supportEmail: googleForm.supportEmail.trim() || null,
        }),
      });
      setMsg(res.warning || "Google OAuth saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function testGoogle() {
    setBusy("google-test");
    setMsg("");
    setError("");
    try {
      const res = await api<{ ok: boolean; message?: string; source?: string }>(
        "/admin/integrations/google_oauth/test",
        { method: "POST", body: "{}" },
      );
      setMsg(res.message ? `${res.message} (source: ${res.source ?? "—"})` : "Google test OK");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function saveEmail() {
    setBusy("email-save");
    setMsg("");
    setError("");
    try {
      await api("/admin/integrations/email_webhook", {
        method: "PUT",
        body: JSON.stringify({
          enabled: emailForm.enabled,
          url: emailForm.url.trim(),
        }),
      });
      setMsg("Email webhook saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function testEmail() {
    setBusy("email-test");
    setMsg("");
    setError("");
    try {
      const res = await api<{ ok: boolean; message?: string; source?: string }>(
        "/admin/integrations/email_webhook/test",
        { method: "POST", body: "{}" },
      );
      setMsg(res.message ? `${res.message} (source: ${res.source ?? "—"})` : "Webhook test OK");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMsg(`Copied ${label}.`);
    } catch {
      setError(`Could not copy ${label} — select the value manually.`);
    }
  }

  if (!isPlatform) {
    return (
      <div className="admin-page">
        <section className="panel admin-card">
          <h2>Integrations</h2>
          <p className="muted">
            Platform-wide Google OAuth and email webhook settings are managed by JustX platform admins
            only.
          </p>
        </section>
      </div>
    );
  }

  if (error && !data) return <p className="field-error">{error}</p>;
  if (!data) return <p className="muted">Loading integrations…</p>;

  const google = data.integrations.find((i) => i.id === "google_oauth");
  const email = data.integrations.find((i) => i.id === "email_webhook");

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div>
          <h2>Integrations</h2>
          <p className="muted">
            Optional platform services. Values saved here override <code>server/.env</code> without a
            PM2 reload. Bootstrap secrets (JWT, DB, CORS) stay in env only.
          </p>
        </div>
        <GuideBox title="When to use this screen">
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>
              <strong>Google OAuth</strong> — only if you want Sign in with Google and/or Company Google
              Drive delivery. The app boots fine without it (email/password, webhook/UNC delivery still
              work).
            </li>
            <li>
              <strong>Email webhook</strong> — only for automatic HTML + PDF email send (Path A). Staff
              can still use mailto or Outlook via Sync Center without this.
            </li>
            <li>
              After Save + Test succeed here, you may remove matching keys from{" "}
              <code>server/.env</code> on the VPS. Until then, env remains a fallback.
            </li>
          </ul>
          <p style={{ margin: "0.55rem 0 0" }}>{data.hints.migrateNote}</p>
        </GuideBox>
        {msg ? <p className="muted">{msg}</p> : null}
        {error ? <p className="field-error">{error}</p> : null}
      </section>

      <section className="panel admin-card">
        <div className="analytics-toolbar">
          <div>
            <h3>Status</h3>
            <p className="muted small">
              Live resolved config. Source <code>db</code> = this screen; <code>env</code> = still
              reading from <code>.env</code> because nothing enabled here yet (or incomplete save).
            </p>
          </div>
        </div>
        <div className="analytics-kpis">
          {[google, email].filter(Boolean).map((item) => (
            <article key={item!.id} className="result-card">
              <span>{item!.label}</span>
              <strong>
                <span className={statusPill(item!.status)}>{statusLabel(item!.status)}</span>
              </strong>
              <span className="analytics-delta">
                {item!.source ? `Source: ${item!.source}` : "No source"}
                {item!.statusDetail ? ` · ${item!.statusDetail}` : ""}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="panel admin-card">
        <h3>Google OAuth</h3>
        <p className="muted">
          One platform OAuth client for the whole SaaS: login + each Business Profile Owner connecting
          company Drive. Create the client once in{" "}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
            Google Cloud Console → Credentials
          </a>{" "}
          (OAuth 2.0 Client ID, type <strong>Web application</strong>). Typical owner account:{" "}
          <code>justxsystems@gmail.com</code> — any Google Cloud project works.
        </p>

        <GuideBox title="Setup checklist (Google)">
          <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>Enable Google APIs you need (at least Google Drive API for company folder upload).</li>
            <li>
              Create OAuth client → add <strong>both</strong> Authorized redirect URIs shown below
              (exact match, including <code>/jbt</code> in production).
            </li>
            <li>
              Copy Client ID + Client secret into the fields → check <strong>Enabled</strong> →{" "}
              <strong>Save Google</strong> → <strong>Test credentials</strong>.
            </li>
            <li>
              Confirm login page shows “Sign in with Google”, then have a Profile Owner use{" "}
              <Link href="/profile">Business Profile → Connect company Google Drive</Link>.
            </li>
          </ol>
          <p style={{ margin: "0.55rem 0 0" }}>
            Skip entirely if customers only use artifact webhook (SharePoint/OneDrive), UNC + Sync
            Center agent, or email Paths B/C.
          </p>
        </GuideBox>

        <div className="admin-form-grid" style={{ marginTop: "1rem", alignItems: "start" }}>
          <div>
            <label className="admin-form-row">
              <input
                type="checkbox"
                checked={googleForm.enabled}
                onChange={(e) => setGoogleForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              <span>Enabled</span>
            </label>
            <FieldGuide>
              When checked and credentials are complete, Sign in with Google and Drive connect become
              available. Uncheck to turn Google off platform-wide even if <code>GOOGLE_*</code> still
              exist in <code>.env</code>. Leave unchecked if you are not using Google.
            </FieldGuide>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label>
              Client ID
              <input
                value={googleForm.clientId}
                onChange={(e) => setGoogleForm((f) => ({ ...f, clientId: e.target.value }))}
                placeholder="123456789-xxxx.apps.googleusercontent.com"
                autoComplete="off"
              />
            </label>
            <FieldGuide>
              Public identifier from Google Cloud → Credentials → your OAuth 2.0 Client. Ends with{" "}
              <code>.apps.googleusercontent.com</code>. Same client is used for login and Drive —
              do not create a second client unless you intentionally rotate credentials. Changing this
              after companies connected Drive usually means Owners must reconnect on Business Profile.
            </FieldGuide>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label>
              Client secret
              <input
                type="password"
                value={googleForm.clientSecret}
                onChange={(e) => setGoogleForm((f) => ({ ...f, clientSecret: e.target.value }))}
                placeholder={
                  google?.publicConfig.clientSecretConfigured
                    ? "Leave blank to keep the stored secret"
                    : "GOCSPX-…"
                }
                autoComplete="new-password"
              />
            </label>
            <FieldGuide>
              Private value from the same OAuth client (“Client secret”). Stored encrypted in the
              database. Leave blank when editing other fields to keep the current secret. Paste a new
              value only when rotating. Never commit this to git or put it in the web frontend env.
            </FieldGuide>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label>
              Support / owner email (optional)
              <input
                value={googleForm.supportEmail}
                onChange={(e) => setGoogleForm((f) => ({ ...f, supportEmail: e.target.value }))}
                placeholder="justxsystems@gmail.com"
              />
            </label>
            <FieldGuide>
              Optional note of which Google account owns the Cloud project (for your ops team). Not
              used at runtime for OAuth. Does not grant Google access by itself.
            </FieldGuide>
          </div>
        </div>

        <GuideBox title="Authorized redirect URIs (paste into Google Cloud exactly)">
          <p style={{ margin: "0 0 0.5rem" }}>
            Google Cloud → your OAuth client → <strong>Authorized redirect URIs</strong>. Both URIs
            below are derived from <code>API_PUBLIC_URL</code> / override env on the server — they are
            not editable here.
          </p>
          <div style={{ display: "grid", gap: "0.55rem" }}>
            <div>
              <div>
                <strong>1. Sign-in callback</strong>
              </div>
              <code style={{ wordBreak: "break-all" }}>{data.hints.redirectUriLogin}</code>
              <div className="btn-row" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void copyText("login redirect URI", data.hints.redirectUriLogin)}
                >
                  Copy login URI
                </button>
              </div>
              <FieldGuide>
                Used by <code>/api/auth/google/callback</code> after “Sign in with Google”.
              </FieldGuide>
            </div>
            <div>
              <div>
                <strong>2. Drive connect callback</strong>
              </div>
              <code style={{ wordBreak: "break-all" }}>{data.hints.redirectUriDrive}</code>
              <div className="btn-row" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void copyText("Drive redirect URI", data.hints.redirectUriDrive)}
                >
                  Copy Drive URI
                </button>
              </div>
              <FieldGuide>
                Used when a Profile Owner connects company Drive (
                <code>/api/profile/drive/callback</code>). Missing this URI is the usual cause of
                “redirect_uri_mismatch” on Drive connect.
              </FieldGuide>
            </div>
          </div>
        </GuideBox>

        <div className="btn-row" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy)}
            onClick={() => void saveGoogle()}
          >
            {busy === "google-save" ? "Saving…" : "Save Google"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={Boolean(busy)}
            onClick={() => void testGoogle()}
          >
            {busy === "google-test" ? "Testing…" : "Test credentials"}
          </button>
        </div>
        <FieldGuide>
          <strong>Test credentials</strong> asks Google whether the Client ID + secret are accepted
          (no user login). Save first if you just pasted new values.
        </FieldGuide>
      </section>

      <section className="panel admin-card">
        <h3>Email webhook (Path A — automatic send)</h3>
        <p className="muted">
          JustX does <strong>not</strong> send SMTP mail itself. Path A posts JSON (including HTML
          body + PDF) to <strong>your</strong> automation, which then sends the real email via
          SendGrid, Gmail, Microsoft 365, etc.
        </p>

        <GuideBox title="What to put here vs what not to">
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>
              <strong>Put:</strong> the HTTPS inbound webhook URL from n8n, Make (Integromat), Zapier,
              Power Automate (“When an HTTP request is received”), or similar.
            </li>
            <li>
              <strong>Do not put:</strong> a SendGrid/API key, Gmail app password, SMTP host, or any
              JustX <code>/api/…</code> path — those belong inside your automation, not here.
            </li>
            <li>
              This is <strong>not</strong> the Business Profile “artifact / corporate webhook” used for
              PDF file delivery to SharePoint/OneDrive. That stays on{" "}
              <Link href="/profile">Business Profile</Link>.
            </li>
          </ul>
        </GuideBox>

        <GuideBox title="Setup checklist (email Path A)">
          <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>
              In your automation tool, create a flow triggered by an inbound webhook / Catch Hook /
              HTTP request.
            </li>
            <li>Copy the <strong>production</strong> HTTPS URL (not the test/listen URL if they differ).</li>
            <li>
              Paste below → check <strong>Enabled</strong> → <strong>Save email webhook</strong> →{" "}
              <strong>Send test POST</strong> (your flow should receive a sample payload).
            </li>
            <li>
              Map at least: <code>to</code>, <code>subject</code>, <code>html</code> (preferred) or{" "}
              <code>body</code>, plus <code>pdfBase64</code> + <code>filename</code> for the attachment.
            </li>
            <li>
              Live test: Quotation → Send Via → Email.{" "}
              <Link href="/email-outbox">Email Outbox</Link> should show <strong>sent</strong> when the
              webhook returns HTTP 2xx.
            </li>
          </ol>
        </GuideBox>

        <GuideBox title="If you skip Path A (still fully supported)">
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>
              <strong>Path B — mailto:</strong> leave this integration disabled / empty. Staff send
              opens the mail app; PDF downloads for manual attach; draft stays in Email Outbox.
            </li>
            <li>
              <strong>Path C — Outlook + PDF:</strong> install the Sync Center desktop agent on a
              Windows PC, then use Email Outbox → Open in Outlook. No webhook required.
            </li>
          </ul>
        </GuideBox>

        <div className="admin-form-grid" style={{ marginTop: "1rem", alignItems: "start" }}>
          <div>
            <label className="admin-form-row">
              <input
                type="checkbox"
                checked={emailForm.enabled}
                onChange={(e) => setEmailForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              <span>Enabled</span>
            </label>
            <FieldGuide>
              When checked with a valid URL, quotation / site survey / Email Outbox “send webhook”
              posts to this hook automatically. Uncheck to force Path B/C even if a URL is saved or{" "}
              <code>EMAIL_WEBHOOK_URL</code> remains in <code>.env</code>.
            </FieldGuide>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label>
              Webhook URL
              <input
                value={emailForm.url}
                onChange={(e) => setEmailForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://hook.eu1.make.com/xxxxxxxx  or  https://…/webhook/…"
                autoComplete="off"
              />
            </label>
            <FieldGuide>
              Must be <code>https://…</code> (or <code>http://</code> only for private lab testing).
              Example shapes: Make <code>hook.*.make.com/…</code>, n8n{" "}
              <code>…/webhook/…</code>, Zapier Catch Hook, Power Automate HTTP trigger URL. One URL
              serves all email Path A traffic (quotations, site surveys, outbox retries, UPI notify
              email). After this is saved and working, you can remove{" "}
              <code>EMAIL_WEBHOOK_URL</code> from the VPS <code>.env</code>.
            </FieldGuide>
          </div>
        </div>

        <div className="btn-row" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy)}
            onClick={() => void saveEmail()}
          >
            {busy === "email-save" ? "Saving…" : "Save email webhook"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={Boolean(busy)}
            onClick={() => void testEmail()}
          >
            {busy === "email-test" ? "Testing…" : "Send test POST"}
          </button>
        </div>
        <FieldGuide>
          <strong>Send test POST</strong> posts a small JSON payload (
          <code>kind: admin.integration.test</code>, <code>dryRun: true</code>) to the resolved URL.
          Your automation should accept it (HTTP 2xx). Save first if you just changed the URL.
        </FieldGuide>
      </section>
    </div>
  );
}
