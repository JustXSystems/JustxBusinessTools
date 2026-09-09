"use client";

import { useCallback, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import Link from "next/link";

type IntegrationStatus = "not_configured" | "disabled" | "active" | "error";
type Pane = "google_oauth" | "email_webhook";

type IntegrationPublic = {
  id: Pane;
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="integ-field">
      <label className="integ-label">{label}</label>
      {children}
      {hint ? <p className="integ-hint">{hint}</p> : null}
    </div>
  );
}

function SwitchRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="integ-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="integ-switch-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </label>
  );
}

function HelpDetails({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="integ-help">
      <summary>{summary}</summary>
      <div className="integ-help-body">{children}</div>
    </details>
  );
}

export default function AdminIntegrationsPage() {
  const { user } = useAuth();
  const isPlatform = Boolean(user?.isPlatformAdmin);
  const [pane, setPane] = useState<Pane>("google_oauth");
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
      setMsg(res.message ? `${res.message} (${res.source ?? "—"})` : "Google credentials OK");
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
      setMsg(res.message ? `${res.message} (${res.source ?? "—"})` : "Webhook test OK");
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
      setError(`Could not copy ${label}.`);
    }
  }

  if (!isPlatform) {
    return (
      <div className="admin-page">
        <section className="panel admin-card">
          <h2>Integrations</h2>
          <p className="muted">Platform integrations are available to JustX platform admins only.</p>
        </section>
      </div>
    );
  }

  if (error && !data) return <p className="field-error">{error}</p>;
  if (!data) return <p className="muted">Loading integrations…</p>;

  const google = data.integrations.find((i) => i.id === "google_oauth");
  const email = data.integrations.find((i) => i.id === "email_webhook");

  return (
    <div className="admin-page integ-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Integrations</h2>
            <p className="muted">
              Optional platform services. Changes take effect immediately and override matching{" "}
              <code>.env</code> values.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={Boolean(busy)}
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>

        <div className="analytics-kpis">
          <button
            type="button"
            className={`result-card${pane === "google_oauth" ? " is-selected" : ""}`}
            onClick={() => setPane("google_oauth")}
          >
            <span>Google OAuth</span>
            <strong>
              <span className={statusPill(google?.status ?? "not_configured")}>
                {statusLabel(google?.status ?? "not_configured")}
              </span>
            </strong>
            <span className="analytics-delta">
              {google?.source ? `Source · ${google.source}` : "Optional · login & Drive"}
            </span>
          </button>
          <button
            type="button"
            className={`result-card${pane === "email_webhook" ? " is-selected" : ""}`}
            onClick={() => setPane("email_webhook")}
          >
            <span>Email webhook</span>
            <strong>
              <span className={statusPill(email?.status ?? "not_configured")}>
                {statusLabel(email?.status ?? "not_configured")}
              </span>
            </strong>
            <span className="analytics-delta">
              {email?.source ? `Source · ${email.source}` : "Optional · Path A auto-send"}
            </span>
          </button>
        </div>
      </section>

      {(msg || error) && (
        <div className={`integ-banner${error ? " is-error" : ""}`}>
          {error || msg}
        </div>
      )}

      <div className="admin-tabs-bar">
        <div className="admin-tabs">
          <button
            type="button"
            className={pane === "google_oauth" ? "active" : ""}
            onClick={() => setPane("google_oauth")}
          >
            Google OAuth
          </button>
          <button
            type="button"
            className={pane === "email_webhook" ? "active" : ""}
            onClick={() => setPane("email_webhook")}
          >
            Email webhook
          </button>
        </div>
      </div>

      <div className="admin-page-scroll">
        {pane === "google_oauth" ? (
          <section className="panel admin-card integ-panel">
            <header className="integ-panel-head">
              <div>
                <h3>Google OAuth</h3>
                <p>
                  One platform client for Sign in with Google and Company Drive connect. Skip if
                  customers use webhook, UNC, or email-only delivery.
                </p>
              </div>
              {google?.statusDetail ? (
                <span className="integ-meta">{google.statusDetail}</span>
              ) : null}
            </header>

            <SwitchRow
              checked={googleForm.enabled}
              onChange={(enabled) => setGoogleForm((f) => ({ ...f, enabled }))}
              title="Enable Google OAuth"
              description="Turns Sign in with Google and Drive connect on or off for the whole platform."
            />

            <div className="integ-form">
              <Field
                label="Client ID"
                hint={
                  <>
                    From Google Cloud → Credentials → OAuth 2.0 Client (Web). Ends with{" "}
                    <code>.apps.googleusercontent.com</code>. Changing this may require Owners to
                    reconnect Drive.
                  </>
                }
              >
                <input
                  value={googleForm.clientId}
                  onChange={(e) => setGoogleForm((f) => ({ ...f, clientId: e.target.value }))}
                  placeholder="….apps.googleusercontent.com"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>

              <Field
                label="Client secret"
                hint="Stored encrypted. Leave blank when editing other fields to keep the current secret."
              >
                <input
                  type="password"
                  value={googleForm.clientSecret}
                  onChange={(e) => setGoogleForm((f) => ({ ...f, clientSecret: e.target.value }))}
                  placeholder={
                    google?.publicConfig.clientSecretConfigured
                      ? "••••••••  (unchanged)"
                      : "GOCSPX-…"
                  }
                  autoComplete="new-password"
                />
              </Field>

              <Field
                label="Project owner email"
                hint="Optional ops note (e.g. justxsystems@gmail.com). Not used at runtime."
              >
                <input
                  value={googleForm.supportEmail}
                  onChange={(e) => setGoogleForm((f) => ({ ...f, supportEmail: e.target.value }))}
                  placeholder="justxsystems@gmail.com"
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="integ-uri-block">
              <div className="integ-uri-head">
                <h4>Authorized redirect URIs</h4>
                <p>Paste both into Google Cloud Console exactly. Derived from server API public URL.</p>
              </div>
              <div className="integ-uri-list">
                <div className="integ-uri-row">
                  <div>
                    <span className="integ-uri-label">Sign-in callback</span>
                    <code>{data.hints.redirectUriLogin}</code>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void copyText("sign-in URI", data.hints.redirectUriLogin)}
                  >
                    Copy
                  </button>
                </div>
                <div className="integ-uri-row">
                  <div>
                    <span className="integ-uri-label">Drive connect callback</span>
                    <code>{data.hints.redirectUriDrive}</code>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void copyText("Drive URI", data.hints.redirectUriDrive)}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="integ-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() => void saveGoogle()}
              >
                {busy === "google-save" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => void testGoogle()}
              >
                {busy === "google-test" ? "Testing…" : "Test credentials"}
              </button>
              <a
                className="btn btn-ghost"
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
              >
                Open Google Cloud
              </a>
            </div>

            <HelpDetails summary="Setup guide — Google OAuth">
              <ol>
                <li>
                  In{" "}
                  <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
                    Google Cloud Console
                  </a>
                  , create or select a project and enable the <strong>Google Drive API</strong>.
                </li>
                <li>
                  Configure the OAuth consent screen (app name JustX Business Tools; support email e.g.{" "}
                  <code>justxsystems@gmail.com</code>).
                </li>
                <li>
                  Create an OAuth client ID → type <strong>Web application</strong>.
                </li>
                <li>
                  Authorized JavaScript origins: <code>https://justxsystems.com</code> (and{" "}
                  <code>http://localhost:3000</code> for local).
                </li>
                <li>Authorized redirect URIs: copy both URIs from the block above.</li>
                <li>Paste Client ID + secret here → Enable → Save → Test credentials.</li>
                <li>
                  Verify login shows Sign in with Google, then have a Profile Owner connect Drive on{" "}
                  <Link href="/profile">Business Profile</Link>.
                </li>
              </ol>
              <p>
                Not required for SharePoint/OneDrive artifact webhooks, UNC + Sync Center, or email Paths
                B/C.
              </p>
            </HelpDetails>
          </section>
        ) : (
          <section className="panel admin-card integ-panel">
            <header className="integ-panel-head">
              <div>
                <h3>Email webhook</h3>
                <p>
                  Path A automatic send. JustX POSTs email JSON to your automation; it is not SMTP and
                  not a SendGrid key.
                </p>
              </div>
              {email?.statusDetail ? (
                <span className="integ-meta">{email.statusDetail}</span>
              ) : null}
            </header>

            <SwitchRow
              checked={emailForm.enabled}
              onChange={(enabled) => setEmailForm((f) => ({ ...f, enabled }))}
              title="Enable email webhook"
              description="When on, Quotation / Site Survey / Email Outbox can auto-send via this URL."
            />

            <div className="integ-form">
              <Field
                label="Webhook URL"
                hint={
                  <>
                    HTTPS inbound hook from n8n, Make, Zapier, or Power Automate. Not a JustX{" "}
                    <code>/api/…</code> path, and not the Profile artifact webhook used for SharePoint
                    files.
                  </>
                }
              >
                <input
                  value={emailForm.url}
                  onChange={(e) => setEmailForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://hook.eu1.make.com/…  or  https://…/webhook/…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </div>

            <div className="integ-note-grid">
              <article>
                <h4>Use this for</h4>
                <p>Automatic HTML + PDF email (Path A) for quotations, site surveys, and outbox retries.</p>
              </article>
              <article>
                <h4>Skip this for</h4>
                <p>
                  Path B mailto, or Path C Outlook via{" "}
                  <Link href="/sync">Sync Center</Link> desktop agent — no webhook needed.
                </p>
              </article>
            </div>

            <div className="integ-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() => void saveEmail()}
              >
                {busy === "email-save" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => void testEmail()}
              >
                {busy === "email-test" ? "Testing…" : "Send test POST"}
              </button>
              <Link href="/email-outbox" className="btn btn-ghost">
                Open Email Outbox
              </Link>
            </div>

            <HelpDetails summary="Setup guide — Email Path A">
              <ol>
                <li>
                  In n8n / Make / Zapier / Power Automate, create a flow triggered by an inbound webhook.
                </li>
                <li>Copy the production HTTPS URL and paste it above.</li>
                <li>Enable → Save → Send test POST (expect HTTP 2xx in your automation).</li>
                <li>
                  Map at least <code>to</code>, <code>subject</code>, <code>html</code>,{" "}
                  <code>pdfBase64</code>, and <code>filename</code>.
                </li>
                <li>
                  Live check: Quotation → Send Via → Email → confirm{" "}
                  <Link href="/email-outbox">Email Outbox</Link> shows sent.
                </li>
              </ol>
              <p>
                After this works, you may remove <code>EMAIL_WEBHOOK_URL</code> from{" "}
                <code>server/.env</code>. Until then, env remains a fallback when nothing is enabled
                here.
              </p>
            </HelpDetails>
          </section>
        )}
      </div>
    </div>
  );
}
