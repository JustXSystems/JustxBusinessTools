"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type IntegrationStatus = "not_configured" | "disabled" | "active" | "error";
type Pane =
  | "overview"
  | "google_oauth"
  | "email_webhook"
  | "whatsapp"
  | "sms_otp"
  | "error_webhook";

type IntegrationPublic = {
  id: Exclude<Pane, "overview">;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  status: IntegrationStatus;
  statusDetail: string | null;
  source: "db" | "env" | null;
  lastCheckedAt: string | null;
  testable?: boolean;
  publicConfig: Record<string, unknown>;
};

type HubCard = {
  id: string;
  label: string;
  description: string;
  status: string;
  statusLabel: string;
  detail: string | null;
  manageHref: string | null;
  editable: boolean;
  testable: boolean;
  integrationId?: string;
};

type HubResponse = {
  integrations: IntegrationPublic[];
  linked: HubCard[];
  bootstrap: HubCard[];
  hints: {
    redirectUriLogin: string;
    redirectUriDrive: string;
    migrateNote: string;
    neverMove: string[];
  };
};

function statusPill(status: string) {
  if (status === "active") return "pill pill-success";
  if (status === "error") return "pill pill-danger";
  if (status === "disabled" || status === "warning") return "pill pill-warning";
  if (status === "info") return "pill";
  return "pill";
}

function statusLabel(status: string) {
  if (status === "not_configured") return "Not configured";
  if (status === "disabled") return "Disabled";
  if (status === "active") return "Active";
  if (status === "warning") return "Warning";
  if (status === "info") return "Info";
  if (status === "error") return "Error";
  return status;
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
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
  const [pane, setPane] = useState<Pane>("overview");
  const [data, setData] = useState<HubResponse | null>(null);
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
  const [waForm, setWaForm] = useState({
    enabled: false,
    webhookUrl: "",
    phoneNumberId: "",
    accessToken: "",
    apiVersion: "v21.0",
  });
  const [smsForm, setSmsForm] = useState({
    enabled: false,
    phoneOtpEnabled: true,
    provider: "console",
    twilioAccountSid: "",
    twilioAuthToken: "",
    twilioFromNumber: "",
    msg91AuthKey: "",
    msg91TemplateId: "",
    smsApiUrl: "",
    smsApiKey: "",
  });
  const [errorForm, setErrorForm] = useState({ enabled: false, url: "" });

  const load = useCallback(async () => {
    if (!isPlatform) return;
    try {
      const next = await api<HubResponse>("/admin/integrations");
      setData(next);
      setError("");
      const byId = Object.fromEntries(next.integrations.map((i) => [i.id, i]));

      const g = byId.google_oauth;
      if (g) {
        setGoogleForm((prev) => ({
          enabled: g.enabled,
          clientId: String(g.publicConfig.clientId ?? "") || prev.clientId,
          clientSecret: g.publicConfig.clientSecretConfigured ? "••••keep" : "",
          supportEmail: String(g.publicConfig.supportEmail ?? "") || prev.supportEmail,
        }));
      }
      const e = byId.email_webhook;
      if (e) {
        setEmailForm({ enabled: e.enabled, url: String(e.publicConfig.url ?? "") });
      }
      const w = byId.whatsapp;
      if (w) {
        setWaForm((prev) => ({
          enabled: w.enabled,
          webhookUrl: String(w.publicConfig.webhookUrl ?? ""),
          phoneNumberId: String(w.publicConfig.phoneNumberId ?? ""),
          accessToken: w.publicConfig.accessTokenConfigured ? "••••keep" : "",
          apiVersion: String(w.publicConfig.apiVersion ?? "v21.0"),
        }));
      }
      const s = byId.sms_otp;
      if (s) {
        setSmsForm({
          enabled: s.enabled,
          phoneOtpEnabled: Boolean(s.publicConfig.phoneOtpEnabled),
          provider: String(s.publicConfig.provider ?? "console"),
          twilioAccountSid: String(s.publicConfig.twilioAccountSid ?? ""),
          twilioAuthToken: s.publicConfig.twilioAuthTokenConfigured ? "••••keep" : "",
          twilioFromNumber: String(s.publicConfig.twilioFromNumber ?? ""),
          msg91AuthKey: s.publicConfig.msg91AuthKeyConfigured ? "••••keep" : "",
          msg91TemplateId: String(s.publicConfig.msg91TemplateId ?? ""),
          smsApiUrl: String(s.publicConfig.smsApiUrl ?? ""),
          smsApiKey: s.publicConfig.smsApiKeyConfigured ? "••••keep" : "",
        });
      }
      const er = byId.error_webhook;
      if (er) {
        setErrorForm({ enabled: er.enabled, url: String(er.publicConfig.url ?? "") });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load integrations");
    }
  }, [isPlatform]);

  useLiveRefresh(load, { intervalMs: 60_000, enabled: isPlatform });

  async function save(path: string, body: unknown, okMsg: string) {
    setBusy(`save:${path}`);
    setMsg("");
    setError("");
    try {
      const res = await api<{ warning?: string | null }>(`/admin/integrations/${path}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setMsg(res.warning || okMsg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function test(path: string) {
    setBusy(`test:${path}`);
    setMsg("");
    setError("");
    try {
      const res = await api<{ message?: string; source?: string }>(`/admin/integrations/${path}/test`, {
        method: "POST",
        body: "{}",
      });
      setMsg(res.message ? `${res.message}${res.source ? ` · ${res.source}` : ""}` : "Test OK");
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
          <p className="muted">Platform configuration is available to JustX platform admins only.</p>
        </section>
      </div>
    );
  }

  if (error && !data) return <p className="field-error">{error}</p>;
  if (!data) return <p className="muted">Loading system configuration…</p>;

  const byId = Object.fromEntries(data.integrations.map((i) => [i.id, i]));

  return (
    <div className="admin-page integ-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Integrations</h2>
            <p className="muted">
              One-stop view of platform configuration — status, tests, and editable optional services.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          {data.hints.migrateNote}
        </p>
      </section>

      {(msg || error) && <div className={`integ-banner${error ? " is-error" : ""}`}>{error || msg}</div>}

      <div className="admin-tabs-bar">
        <div className="admin-tabs">
          {(
            [
              ["overview", "Overview"],
              ["google_oauth", "Google"],
              ["email_webhook", "Email"],
              ["whatsapp", "WhatsApp"],
              ["sms_otp", "SMS / OTP"],
              ["error_webhook", "Errors"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={pane === id ? "active" : ""} onClick={() => setPane(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-page-scroll">
        {pane === "overview" ? (
          <div className="integ-overview">
            <section className="panel admin-card">
              <h3>Editable integrations</h3>
              <p className="muted small">Saved here override .env. Each has Save + Test.</p>
              <div className="integ-card-grid">
                {data.integrations.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="integ-hub-card"
                    onClick={() => setPane(item.id)}
                  >
                    <div className="integ-hub-card-top">
                      <strong>{item.label}</strong>
                      <span className={statusPill(item.status)}>{statusLabel(item.status)}</span>
                    </div>
                    <p>{item.description}</p>
                    <span className="integ-hub-meta">
                      {item.source ? `Source · ${item.source}` : "Not set"}
                      {item.statusDetail ? ` · ${item.statusDetail}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel admin-card">
              <h3>Managed elsewhere</h3>
              <p className="muted small">Open the dedicated Admin screen — not duplicated here.</p>
              <div className="integ-card-grid">
                {data.linked.map((card) => (
                  <div key={card.id} className="integ-hub-card is-static">
                    <div className="integ-hub-card-top">
                      <strong>{card.label}</strong>
                      <span className={statusPill(card.status)}>{card.statusLabel}</span>
                    </div>
                    <p>{card.description}</p>
                    {card.detail ? <span className="integ-hub-meta">{card.detail}</span> : null}
                    {card.manageHref ? (
                      <Link href={card.manageHref} className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}>
                        Open
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel admin-card">
              <h3>Bootstrap & runtime (read-only)</h3>
              <p className="muted small">Stay in <code>server/.env</code> — shown for ops visibility only.</p>
              <div className="integ-card-grid">
                {data.bootstrap.map((card) => (
                  <div key={card.id} className="integ-hub-card is-static">
                    <div className="integ-hub-card-top">
                      <strong>{card.label}</strong>
                      <span className={statusPill(card.status)}>{card.statusLabel}</span>
                    </div>
                    <p>{card.description}</p>
                    {card.detail ? <span className="integ-hub-meta">{card.detail}</span> : null}
                  </div>
                ))}
              </div>
              <HelpDetails summary="What never moves into Admin">
                <ul>
                  {data.hints.neverMove.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </HelpDetails>
            </section>
          </div>
        ) : null}

        {pane === "google_oauth" ? (
          <section className="panel admin-card integ-panel">
            <header className="integ-panel-head">
              <div>
                <h3>Google OAuth</h3>
                <p>Sign in with Google + Company Drive. Optional — skip for webhook/UNC/email-only stacks.</p>
              </div>
              <span className={statusPill(byId.google_oauth?.status ?? "not_configured")}>
                {statusLabel(byId.google_oauth?.status ?? "not_configured")}
              </span>
            </header>
            <SwitchRow
              checked={googleForm.enabled}
              onChange={(enabled) => setGoogleForm((f) => ({ ...f, enabled }))}
              title="Enable Google OAuth"
              description="Platform-wide login + Drive connect client."
            />
            <div className="integ-form">
              <Field label="Client ID" hint="OAuth Web client ID from Google Cloud Console.">
                <input
                  value={googleForm.clientId}
                  onChange={(e) => setGoogleForm((f) => ({ ...f, clientId: e.target.value }))}
                  placeholder="….apps.googleusercontent.com"
                  autoComplete="off"
                />
              </Field>
              <Field label="Client secret" hint="Leave blank to keep the stored secret.">
                <input
                  type="password"
                  value={googleForm.clientSecret}
                  onChange={(e) => setGoogleForm((f) => ({ ...f, clientSecret: e.target.value }))}
                  placeholder="GOCSPX-…"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Project owner email" hint="Ops note only — not used at runtime.">
                <input
                  value={googleForm.supportEmail}
                  onChange={(e) => setGoogleForm((f) => ({ ...f, supportEmail: e.target.value }))}
                  placeholder="justxsystems@gmail.com"
                />
              </Field>
            </div>
            <div className="integ-uri-block">
              <div className="integ-uri-head">
                <h4>Authorized redirect URIs</h4>
                <p>Paste both into Google Cloud exactly.</p>
              </div>
              <div className="integ-uri-list">
                <div className="integ-uri-row">
                  <div>
                    <span className="integ-uri-label">Sign-in</span>
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
                    <span className="integ-uri-label">Drive</span>
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
                onClick={() =>
                  void save(
                    "google_oauth",
                    {
                      enabled: googleForm.enabled,
                      clientId: googleForm.clientId.trim(),
                      clientSecret: googleForm.clientSecret.startsWith("••••")
                        ? ""
                        : googleForm.clientSecret.trim(),
                      supportEmail: googleForm.supportEmail.trim() || null,
                    },
                    "Google OAuth saved.",
                  )
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => void test("google_oauth")}
              >
                Test credentials
              </button>
            </div>
          </section>
        ) : null}

        {pane === "email_webhook" ? (
          <section className="panel admin-card integ-panel">
            <header className="integ-panel-head">
              <div>
                <h3>Email webhook (Path A)</h3>
                <p>HTTPS inbound hook for automatic HTML + PDF email. Not SMTP / SendGrid keys.</p>
              </div>
              <span className={statusPill(byId.email_webhook?.status ?? "not_configured")}>
                {statusLabel(byId.email_webhook?.status ?? "not_configured")}
              </span>
            </header>
            <SwitchRow
              checked={emailForm.enabled}
              onChange={(enabled) => setEmailForm((f) => ({ ...f, enabled }))}
              title="Enable email webhook"
              description="Quotation / site survey / Email Outbox auto-send."
            />
            <div className="integ-form">
              <Field
                label="Webhook URL"
                hint="n8n / Make / Zapier / Power Automate production HTTPS URL. Not the Profile artifact webhook."
              >
                <input
                  value={emailForm.url}
                  onChange={(e) => setEmailForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://hook….make.com/…"
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="integ-note-grid">
              <article>
                <h4>Skip Path A</h4>
                <p>
                  Use mailto or Outlook via <Link href="/sync">Sync Center</Link> — no webhook needed.
                </p>
              </article>
              <article>
                <h4>Staff queue</h4>
                <p>
                  Monitor sends in <Link href="/email-outbox">Email Outbox</Link>.
                </p>
              </article>
            </div>
            <div className="integ-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void save(
                    "email_webhook",
                    { enabled: emailForm.enabled, url: emailForm.url.trim() },
                    "Email webhook saved.",
                  )
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => void test("email_webhook")}
              >
                Send test POST
              </button>
            </div>
          </section>
        ) : null}

        {pane === "whatsapp" ? (
          <section className="panel admin-card integ-panel">
            <header className="integ-panel-head">
              <div>
                <h3>WhatsApp</h3>
                <p>Cloud API and/or webhook for quotation / survey PDF delivery.</p>
              </div>
              <span className={statusPill(byId.whatsapp?.status ?? "not_configured")}>
                {statusLabel(byId.whatsapp?.status ?? "not_configured")}
              </span>
            </header>
            <SwitchRow
              checked={waForm.enabled}
              onChange={(enabled) => setWaForm((f) => ({ ...f, enabled }))}
              title="Enable WhatsApp"
              description="Requires webhook URL and/or Cloud API phone number ID + token."
            />
            <div className="integ-form">
              <Field label="Webhook URL (optional)" hint="Automation that sends WhatsApp with PDF payload.">
                <input
                  value={waForm.webhookUrl}
                  onChange={(e) => setWaForm((f) => ({ ...f, webhookUrl: e.target.value }))}
                  placeholder="https://…"
                  autoComplete="off"
                />
              </Field>
              <Field label="Phone number ID (Cloud API)" hint="Meta WhatsApp Business phone number ID.">
                <input
                  value={waForm.phoneNumberId}
                  onChange={(e) => setWaForm((f) => ({ ...f, phoneNumberId: e.target.value }))}
                  autoComplete="off"
                />
              </Field>
              <Field label="Access token (Cloud API)" hint="Leave blank to keep stored token.">
                <input
                  type="password"
                  value={waForm.accessToken}
                  onChange={(e) => setWaForm((f) => ({ ...f, accessToken: e.target.value }))}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="API version" hint="Default v21.0.">
                <input
                  value={waForm.apiVersion}
                  onChange={(e) => setWaForm((f) => ({ ...f, apiVersion: e.target.value }))}
                />
              </Field>
            </div>
            <div className="integ-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void save(
                    "whatsapp",
                    {
                      enabled: waForm.enabled,
                      webhookUrl: waForm.webhookUrl.trim(),
                      phoneNumberId: waForm.phoneNumberId.trim(),
                      apiVersion: waForm.apiVersion.trim() || "v21.0",
                      accessToken: waForm.accessToken.startsWith("••••") ? "" : waForm.accessToken.trim(),
                    },
                    "WhatsApp saved.",
                  )
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => void test("whatsapp")}
              >
                Test
              </button>
            </div>
          </section>
        ) : null}

        {pane === "sms_otp" ? (
          <section className="panel admin-card integ-panel">
            <header className="integ-panel-head">
              <div>
                <h3>SMS / Phone OTP</h3>
                <p>Optional login method. Console logs OTP in API logs (dev only).</p>
              </div>
              <span className={statusPill(byId.sms_otp?.status ?? "not_configured")}>
                {statusLabel(byId.sms_otp?.status ?? "not_configured")}
              </span>
            </header>
            <SwitchRow
              checked={smsForm.enabled}
              onChange={(enabled) => setSmsForm((f) => ({ ...f, enabled }))}
              title="Enable SMS integration"
              description="When off, Phone OTP is hidden even if env still has SMS_* keys."
            />
            <div className="integ-form">
              <Field label="Provider">
                <select
                  value={smsForm.provider}
                  onChange={(e) => setSmsForm((f) => ({ ...f, provider: e.target.value }))}
                >
                  <option value="console">console (dev)</option>
                  <option value="twilio">twilio</option>
                  <option value="msg91">msg91</option>
                  <option value="http">http gateway</option>
                </select>
              </Field>
              <label className="integ-switch" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={smsForm.phoneOtpEnabled}
                  onChange={(e) => setSmsForm((f) => ({ ...f, phoneOtpEnabled: e.target.checked }))}
                />
                <span className="integ-switch-copy">
                  <strong>Show Phone OTP on login</strong>
                  <span>Requires a working provider when enabled in production.</span>
                </span>
              </label>
              {smsForm.provider === "twilio" ? (
                <>
                  <Field label="Twilio Account SID">
                    <input
                      value={smsForm.twilioAccountSid}
                      onChange={(e) => setSmsForm((f) => ({ ...f, twilioAccountSid: e.target.value }))}
                    />
                  </Field>
                  <Field label="Twilio Auth Token">
                    <input
                      type="password"
                      value={smsForm.twilioAuthToken}
                      onChange={(e) => setSmsForm((f) => ({ ...f, twilioAuthToken: e.target.value }))}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Twilio From number">
                    <input
                      value={smsForm.twilioFromNumber}
                      onChange={(e) => setSmsForm((f) => ({ ...f, twilioFromNumber: e.target.value }))}
                      placeholder="+91…"
                    />
                  </Field>
                </>
              ) : null}
              {smsForm.provider === "msg91" ? (
                <>
                  <Field label="MSG91 Auth key">
                    <input
                      type="password"
                      value={smsForm.msg91AuthKey}
                      onChange={(e) => setSmsForm((f) => ({ ...f, msg91AuthKey: e.target.value }))}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="MSG91 Template ID">
                    <input
                      value={smsForm.msg91TemplateId}
                      onChange={(e) => setSmsForm((f) => ({ ...f, msg91TemplateId: e.target.value }))}
                    />
                  </Field>
                </>
              ) : null}
              {smsForm.provider === "http" ? (
                <>
                  <Field label="SMS API URL">
                    <input
                      value={smsForm.smsApiUrl}
                      onChange={(e) => setSmsForm((f) => ({ ...f, smsApiUrl: e.target.value }))}
                    />
                  </Field>
                  <Field label="SMS API key (optional)">
                    <input
                      type="password"
                      value={smsForm.smsApiKey}
                      onChange={(e) => setSmsForm((f) => ({ ...f, smsApiKey: e.target.value }))}
                      autoComplete="new-password"
                    />
                  </Field>
                </>
              ) : null}
            </div>
            <div className="integ-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void save(
                    "sms_otp",
                    {
                      enabled: smsForm.enabled,
                      phoneOtpEnabled: smsForm.phoneOtpEnabled,
                      provider: smsForm.provider,
                      twilioAccountSid: smsForm.twilioAccountSid.trim(),
                      twilioFromNumber: smsForm.twilioFromNumber.trim(),
                      twilioAuthToken: smsForm.twilioAuthToken.startsWith("••••")
                        ? ""
                        : smsForm.twilioAuthToken.trim(),
                      msg91TemplateId: smsForm.msg91TemplateId.trim(),
                      msg91AuthKey: smsForm.msg91AuthKey.startsWith("••••")
                        ? ""
                        : smsForm.msg91AuthKey.trim(),
                      smsApiUrl: smsForm.smsApiUrl.trim(),
                      smsApiKey: smsForm.smsApiKey.startsWith("••••") ? "" : smsForm.smsApiKey.trim(),
                    },
                    "SMS / OTP saved.",
                  )
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => void test("sms_otp")}
              >
                Test provider
              </button>
            </div>
          </section>
        ) : null}

        {pane === "error_webhook" ? (
          <section className="panel admin-card integ-panel">
            <header className="integ-panel-head">
              <div>
                <h3>Error webhook</h3>
                <p>Optional Slack/Discord/ops POST for API failures. Sentry DSN stays in .env.</p>
              </div>
              <span className={statusPill(byId.error_webhook?.status ?? "not_configured")}>
                {statusLabel(byId.error_webhook?.status ?? "not_configured")}
              </span>
            </header>
            <SwitchRow
              checked={errorForm.enabled}
              onChange={(enabled) => setErrorForm((f) => ({ ...f, enabled }))}
              title="Enable error webhook"
              description="Posts JSON when the API reports an error."
            />
            <div className="integ-form">
              <Field label="Webhook URL" hint="Incoming webhook URL for your ops channel.">
                <input
                  value={errorForm.url}
                  onChange={(e) => setErrorForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://hooks.slack.com/…"
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="integ-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void save(
                    "error_webhook",
                    { enabled: errorForm.enabled, url: errorForm.url.trim() },
                    "Error webhook saved.",
                  )
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => void test("error_webhook")}
              >
                Send test POST
              </button>
              <Link href="/admin/ops" className="btn btn-ghost">
                Operations
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
