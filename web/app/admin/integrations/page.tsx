"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  FormGrid,
  Grid,
  Switch,
  type BosBadgeTone,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
} from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import { useAuth } from "@/components/auth/AuthProvider";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { api } from "@/lib/api";
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

const PANE_OPTIONS = [
  { value: "overview", label: "Overview" },
  { value: "google_oauth", label: "Google" },
  { value: "email_webhook", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms_otp", label: "SMS / OTP" },
  { value: "error_webhook", label: "Errors" },
] as const;

function statusTone(status: string): BosBadgeTone {
  if (status === "active") return "emerald";
  if (status === "error") return "coral";
  if (status === "disabled" || status === "warning") return "amber";
  if (status === "info") return "blue";
  return "neutral";
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

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge auto tone={statusTone(status)}>
      {label ?? statusLabel(status)}
    </Badge>
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
  const id = useId();
  return (
    <div className="admin-cc-switch-card">
      <Switch id={id} checked={checked} onChange={onChange} aria-label={title} />
      <label htmlFor={id} className="admin-cc-switch-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </label>
    </div>
  );
}

/** One editable integration: header + status, switch/fields (children), action row. */
function IntegrationPanel({
  title,
  description,
  status,
  children,
  actions,
}: {
  title: ReactNode;
  description: ReactNode;
  status: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <AdminSection title={title} description={description} actions={<StatusBadge status={status} />}>
      <div className="admin-cc-form">{children}</div>
      <div className="admin-cc-actions admin-cc-actions-start">{actions}</div>
    </AdminSection>
  );
}

function HubStatic({ card }: { card: HubCard }) {
  return (
    <Card>
      <div className="admin-cc-hub">
        <div className="admin-cc-hub-top">
          <strong>{card.label}</strong>
          <StatusBadge status={card.status} label={card.statusLabel} />
        </div>
        <p className="admin-cc-hub-desc">{card.description}</p>
        {card.detail ? <span className="admin-cc-hub-meta">{card.detail}</span> : null}
        {card.manageHref ? (
          <div>
            <Link href={card.manageHref}>
              <Button variant="ghost" size="sm">
                Open
              </Button>
            </Link>
          </div>
        ) : null}
      </div>
    </Card>
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
  const [helpOpen, setHelpOpen] = useState(false);

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

  const seededFormsRef = useRef(false);

  const load = useCallback(async (forceSeed = false) => {
    if (!isPlatform) return;
    try {
      const next = await api<HubResponse>("/admin/integrations");
      setData(next);
      setError("");
      if (!forceSeed && seededFormsRef.current) return;
      seededFormsRef.current = true;
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
      await load(true);
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
      <AdminPage title="Integrations" section="Platform" sub="Platform configuration">
        <AdminEmpty title="Platform admins only" icon="lock">
          Platform configuration is available to Justxsystems platform admins only.
        </AdminEmpty>
      </AdminPage>
    );
  }

  if (error && !data) {
    return (
      <AdminPage title="Integrations" section="Platform" sub="Platform configuration">
        <AdminErrorState message={error} onRetry={load} />
      </AdminPage>
    );
  }
  if (!data) return <AdminPageSkeleton cards={4} />;

  const byId = Object.fromEntries(data.integrations.map((i) => [i.id, i]));
  const anyBusy = Boolean(busy);

  /** Save / Test button pair with in-flight labels. */
  function saveButton(path: string, onSave: () => void) {
    return (
      <Button variant="primary" disabled={anyBusy} onClick={onSave}>
        {busy === `save:${path}` ? "Saving…" : "Save"}
      </Button>
    );
  }
  function testButton(path: string, label: string) {
    return (
      <Button variant="secondary" disabled={anyBusy} onClick={() => void test(path)}>
        {busy === `test:${path}` ? "Testing…" : label}
      </Button>
    );
  }

  const statusOf = (id: Exclude<Pane, "overview">) => byId[id]?.status ?? "not_configured";

  return (
    <AdminPage
      title="Integrations"
      section="Platform"
      sub="One-stop view of platform configuration — status, tests, and editable optional services."
      toolbar={
        <>
          <Badge auto tone="blue">
            {data.integrations.filter((i) => i.status === "active").length}/{data.integrations.length} active
          </Badge>
          <Button variant="ghost" size="sm" icon="refresh" disabled={anyBusy} onClick={() => void load()}>
            Refresh
          </Button>
        </>
      }
    >
      <p className="admin-cc-note-text">{data.hints.migrateNote}</p>

      {error ? (
        <Alert tone="coral" title="Something went wrong">
          {error}
        </Alert>
      ) : msg ? (
        <Alert tone="emerald" title="Done">
          {msg}
        </Alert>
      ) : null}

      <AdminTabs aria-label="Integration sections" options={PANE_OPTIONS} value={pane} onChange={setPane} />

      {pane === "overview" ? (
        <>
          <AdminSection
            title="Editable integrations"
            description="Saved here override .env. Each has Save + Test."
          >
            <Grid cols={3} min={240} gap={12}>
              {data.integrations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="admin-cc-kpi-btn"
                  onClick={() => setPane(item.id)}
                >
                  <Card interactive className="admin-cc-hub-card">
                    <div className="admin-cc-hub">
                      <div className="admin-cc-hub-top">
                        <strong>{item.label}</strong>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="admin-cc-hub-desc">{item.description}</p>
                      <span className="admin-cc-hub-meta">
                        {item.source ? `Source · ${item.source}` : "Not set"}
                        {item.statusDetail ? ` · ${item.statusDetail}` : ""}
                      </span>
                    </div>
                  </Card>
                </button>
              ))}
            </Grid>
          </AdminSection>

          <AdminSection
            title="Managed elsewhere"
            description="Open the dedicated Admin screen — not duplicated here."
          >
            {data.linked.length === 0 ? (
              <AdminEmpty title="Nothing linked" />
            ) : (
              <Grid cols={3} min={240} gap={12}>
                {data.linked.map((card) => (
                  <HubStatic key={card.id} card={card} />
                ))}
              </Grid>
            )}
          </AdminSection>

          <AdminSection
            title="Bootstrap & runtime (read-only)"
            description={
              <>
                Stay in <code className="admin-cc-code">server/.env</code> — shown for ops visibility only.
              </>
            }
            actions={
              <Button variant="ghost" size="sm" onClick={() => setHelpOpen(true)}>
                What never moves into Admin
              </Button>
            }
          >
            {data.bootstrap.length === 0 ? (
              <AdminEmpty title="No bootstrap items" />
            ) : (
              <Grid cols={3} min={240} gap={12}>
                {data.bootstrap.map((card) => (
                  <HubStatic key={card.id} card={{ ...card, manageHref: null }} />
                ))}
              </Grid>
            )}
          </AdminSection>

          <Dialog
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
            title="What never moves into Admin"
            description="These stay in server/.env and are never editable from this console."
            actions={
              <Button variant="primary" onClick={() => setHelpOpen(false)}>
                Close
              </Button>
            }
          >
            <ul className="admin-cc-help-list">
              {data.hints.neverMove.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Dialog>
        </>
      ) : null}

      {pane === "google_oauth" ? (
        <IntegrationPanel
          title="Google OAuth"
          description="Sign in with Google + Company Drive. Optional — skip for webhook/UNC/email-only stacks."
          status={statusOf("google_oauth")}
          actions={
            <>
              {saveButton("google_oauth", () =>
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
                ),
              )}
              {testButton("google_oauth", "Test credentials")}
            </>
          }
        >
          <SwitchRow
            checked={googleForm.enabled}
            onChange={(enabled) => setGoogleForm((f) => ({ ...f, enabled }))}
            title="Enable Google OAuth"
            description="Platform-wide login + Drive connect client."
          />
          <FormGrid>
            <TextField
              label="Client ID"
              hint="OAuth Web client ID from Google Cloud Console."
              value={googleForm.clientId}
              onChange={(e) => setGoogleForm((f) => ({ ...f, clientId: e.target.value }))}
              placeholder="….apps.googleusercontent.com"
              autoComplete="off"
              full
            />
            <TextField
              label="Client secret"
              hint="Leave blank to keep the stored secret."
              type="password"
              value={googleForm.clientSecret}
              onChange={(e) => setGoogleForm((f) => ({ ...f, clientSecret: e.target.value }))}
              placeholder="GOCSPX-…"
              autoComplete="new-password"
            />
            <TextField
              label="Project owner email"
              hint="Ops note only — not used at runtime."
              value={googleForm.supportEmail}
              onChange={(e) => setGoogleForm((f) => ({ ...f, supportEmail: e.target.value }))}
              placeholder="justxsystems@gmail.com"
            />
          </FormGrid>
          <Card flat>
            <div className="admin-cc-detail-head">
              <div>
                <h4 className="admin-cc-detail-title">Authorized redirect URIs</h4>
                <p className="admin-cc-detail-sub">Paste both into Google Cloud exactly.</p>
              </div>
            </div>
            <ul className="admin-cc-verify-list">
              <li>
                <div>
                  <strong>Sign-in</strong>
                  <code className="admin-cc-code">{data.hints.redirectUriLogin}</code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copyText("sign-in URI", data.hints.redirectUriLogin)}
                >
                  Copy
                </Button>
              </li>
              <li>
                <div>
                  <strong>Drive</strong>
                  <code className="admin-cc-code">{data.hints.redirectUriDrive}</code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copyText("Drive URI", data.hints.redirectUriDrive)}
                >
                  Copy
                </Button>
              </li>
            </ul>
          </Card>
        </IntegrationPanel>
      ) : null}

      {pane === "email_webhook" ? (
        <IntegrationPanel
          title="Email webhook (Path A) — platform fallback"
          description={
            <>
              Optional platform-wide HTTPS inbound hook when a Business Profile has <strong>no</strong> per-company
              email webhook. Prefer <strong>Business Profile → Send Via → Email → Email webhook URL</strong> for each
              GSTIN / company mailbox (Power Automate). Not SMTP / SendGrid keys. Not the Profile artifact webhook
              (PDF files).
            </>
          }
          status={statusOf("email_webhook")}
          actions={
            <>
              {saveButton("email_webhook", () =>
                void save(
                  "email_webhook",
                  { enabled: emailForm.enabled, url: emailForm.url.trim() },
                  "Email webhook saved.",
                ),
              )}
              {testButton("email_webhook", "Send test POST")}
            </>
          }
        >
          <SwitchRow
            checked={emailForm.enabled}
            onChange={(enabled) => setEmailForm((f) => ({ ...f, enabled }))}
            title="Enable email webhook"
            description="Quotation / site survey / Email Outbox auto-send."
          />
          <FormGrid>
            <TextField
              label="Webhook URL"
              hint="Fallback only. Per-company URL lives on Business Profile. n8n / Make / Power Automate production HTTPS URL."
              value={emailForm.url}
              onChange={(e) => setEmailForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://hook….make.com/…"
              autoComplete="off"
              full
            />
          </FormGrid>
          <Grid cols={2} min={240} gap={12}>
            <Card flat>
              <h4 className="admin-cc-detail-title">Skip Path A</h4>
              <p className="admin-cc-note-text">
                Use mailto or Outlook via <Link href="/sync">Sync Center</Link> — no webhook needed.
              </p>
            </Card>
            <Card flat>
              <h4 className="admin-cc-detail-title">Staff queue</h4>
              <p className="admin-cc-note-text">
                Monitor sends in <Link href="/email-outbox">Email Outbox</Link>.
              </p>
            </Card>
          </Grid>
        </IntegrationPanel>
      ) : null}

      {pane === "whatsapp" ? (
        <IntegrationPanel
          title="WhatsApp"
          description="Cloud API and/or webhook for quotation / survey PDF delivery."
          status={statusOf("whatsapp")}
          actions={
            <>
              {saveButton("whatsapp", () =>
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
                ),
              )}
              {testButton("whatsapp", "Test")}
            </>
          }
        >
          <SwitchRow
            checked={waForm.enabled}
            onChange={(enabled) => setWaForm((f) => ({ ...f, enabled }))}
            title="Enable WhatsApp"
            description="Requires webhook URL and/or Cloud API phone number ID + token."
          />
          <FormGrid>
            <TextField
              label="Webhook URL (optional)"
              hint="Automation that sends WhatsApp with PDF payload."
              value={waForm.webhookUrl}
              onChange={(e) => setWaForm((f) => ({ ...f, webhookUrl: e.target.value }))}
              placeholder="https://…"
              autoComplete="off"
              full
            />
            <TextField
              label="Phone number ID (Cloud API)"
              hint="Meta WhatsApp Business phone number ID."
              value={waForm.phoneNumberId}
              onChange={(e) => setWaForm((f) => ({ ...f, phoneNumberId: e.target.value }))}
              autoComplete="off"
            />
            <TextField
              label="Access token (Cloud API)"
              hint="Leave blank to keep stored token."
              type="password"
              value={waForm.accessToken}
              onChange={(e) => setWaForm((f) => ({ ...f, accessToken: e.target.value }))}
              autoComplete="new-password"
            />
            <TextField
              label="API version"
              hint="Default v21.0."
              value={waForm.apiVersion}
              onChange={(e) => setWaForm((f) => ({ ...f, apiVersion: e.target.value }))}
            />
          </FormGrid>
        </IntegrationPanel>
      ) : null}

      {pane === "sms_otp" ? (
        <IntegrationPanel
          title="SMS / Phone OTP"
          description="Optional login method. Console logs OTP in API logs (dev only)."
          status={statusOf("sms_otp")}
          actions={
            <>
              {saveButton("sms_otp", () =>
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
                ),
              )}
              {testButton("sms_otp", "Test provider")}
            </>
          }
        >
          <SwitchRow
            checked={smsForm.enabled}
            onChange={(enabled) => setSmsForm((f) => ({ ...f, enabled }))}
            title="Enable SMS integration"
            description="When off, Phone OTP is hidden even if env still has SMS_* keys."
          />
          <SwitchRow
            checked={smsForm.phoneOtpEnabled}
            onChange={(phoneOtpEnabled) => setSmsForm((f) => ({ ...f, phoneOtpEnabled }))}
            title="Show Phone OTP on login"
            description="Requires a working provider when enabled in production."
          />
          <FormGrid>
            <SelectField
              label="Provider"
              value={smsForm.provider}
              onChange={(e) => setSmsForm((f) => ({ ...f, provider: e.target.value }))}
              full
            >
              <option value="console">console (dev)</option>
              <option value="twilio">twilio</option>
              <option value="msg91">msg91</option>
              <option value="http">http gateway</option>
            </SelectField>
            {smsForm.provider === "twilio" ? (
              <>
                <TextField
                  label="Twilio Account SID"
                  value={smsForm.twilioAccountSid}
                  onChange={(e) => setSmsForm((f) => ({ ...f, twilioAccountSid: e.target.value }))}
                />
                <TextField
                  label="Twilio Auth Token"
                  type="password"
                  value={smsForm.twilioAuthToken}
                  onChange={(e) => setSmsForm((f) => ({ ...f, twilioAuthToken: e.target.value }))}
                  autoComplete="new-password"
                />
                <TextField
                  label="Twilio From number"
                  value={smsForm.twilioFromNumber}
                  onChange={(e) => setSmsForm((f) => ({ ...f, twilioFromNumber: e.target.value }))}
                  placeholder="+91…"
                />
              </>
            ) : null}
            {smsForm.provider === "msg91" ? (
              <>
                <TextField
                  label="MSG91 Auth key"
                  type="password"
                  value={smsForm.msg91AuthKey}
                  onChange={(e) => setSmsForm((f) => ({ ...f, msg91AuthKey: e.target.value }))}
                  autoComplete="new-password"
                />
                <TextField
                  label="MSG91 Template ID"
                  value={smsForm.msg91TemplateId}
                  onChange={(e) => setSmsForm((f) => ({ ...f, msg91TemplateId: e.target.value }))}
                />
              </>
            ) : null}
            {smsForm.provider === "http" ? (
              <>
                <TextField
                  label="SMS API URL"
                  value={smsForm.smsApiUrl}
                  onChange={(e) => setSmsForm((f) => ({ ...f, smsApiUrl: e.target.value }))}
                  full
                />
                <TextField
                  label="SMS API key (optional)"
                  type="password"
                  value={smsForm.smsApiKey}
                  onChange={(e) => setSmsForm((f) => ({ ...f, smsApiKey: e.target.value }))}
                  autoComplete="new-password"
                />
              </>
            ) : null}
          </FormGrid>
        </IntegrationPanel>
      ) : null}

      {pane === "error_webhook" ? (
        <IntegrationPanel
          title="Error webhook"
          description="Optional Slack/Discord/ops POST for API failures. Sentry DSN stays in .env."
          status={statusOf("error_webhook")}
          actions={
            <>
              {saveButton("error_webhook", () =>
                void save(
                  "error_webhook",
                  { enabled: errorForm.enabled, url: errorForm.url.trim() },
                  "Error webhook saved.",
                ),
              )}
              {testButton("error_webhook", "Send test POST")}
              <Link href={adminDeepLink.ops()}>
                <Button variant="ghost">Operations</Button>
              </Link>
            </>
          }
        >
          <SwitchRow
            checked={errorForm.enabled}
            onChange={(enabled) => setErrorForm((f) => ({ ...f, enabled }))}
            title="Enable error webhook"
            description="Posts JSON when the API reports an error."
          />
          <FormGrid>
            <TextField
              label="Webhook URL"
              hint="Incoming webhook URL for your ops channel."
              value={errorForm.url}
              onChange={(e) => setErrorForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://hooks.slack.com/…"
              autoComplete="off"
              full
            />
          </FormGrid>
        </IntegrationPanel>
      ) : null}
    </AdminPage>
  );
}
