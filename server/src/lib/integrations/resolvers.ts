import {
  loadIntegrationCache,
  type IntegrationRow,
  type IntegrationStatus,
} from "./store.js";

export type ResolvedGoogleOAuth = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  driveRedirectUri: string;
  enabled: boolean;
  source: "db" | "env";
  supportEmail: string | null;
};

export type ResolvedEmailWebhook = {
  url: string;
  enabled: boolean;
  source: "db" | "env";
};

function apiPublicBase(): string {
  return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

export function defaultGoogleRedirectUris(): { login: string; drive: string } {
  const base = apiPublicBase();
  return {
    login:
      process.env.GOOGLE_REDIRECT_URI?.trim() || `${base}/api/auth/google/callback`,
    drive:
      process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim() || `${base}/api/profile/drive/callback`,
  };
}

function googleFromEnv(): ResolvedGoogleOAuth | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const uris = defaultGoogleRedirectUris();
  return {
    clientId,
    clientSecret,
    redirectUri: uris.login,
    driveRedirectUri: uris.drive,
    enabled: true,
    source: "env",
    supportEmail: null,
  };
}

function googleFromRow(row: IntegrationRow): ResolvedGoogleOAuth | null {
  if (!row.enabled) return null;
  const clientId = String(row.config.clientId ?? "").trim();
  const clientSecret = String(row.secrets.clientSecret ?? "").trim();
  if (!clientId || !clientSecret) return null;
  const uris = defaultGoogleRedirectUris();
  return {
    clientId,
    clientSecret,
    redirectUri: uris.login,
    driveRedirectUri: uris.drive,
    enabled: true,
    source: "db",
    supportEmail: row.config.supportEmail != null ? String(row.config.supportEmail) : null,
  };
}

function dbExplicitlyDisables(row: IntegrationRow | null): boolean {
  // A saved row with enabled=false overrides env (Admin turned it off).
  return Boolean(row && row.enabled === false && (row.updatedAt || Object.keys(row.config).length));
}

export async function resolveGoogleOAuthConfig(): Promise<ResolvedGoogleOAuth | null> {
  const bundle = await loadIntegrationCache();
  if (dbExplicitlyDisables(bundle.google)) return null;
  const fromDb = bundle.google ? googleFromRow(bundle.google) : null;
  if (fromDb) return fromDb;
  return googleFromEnv();
}

/** Sync helper for rare cold paths: env only (prefer resolveGoogleOAuthConfig). */
export function resolveGoogleOAuthConfigFromEnvOnly(): ResolvedGoogleOAuth | null {
  return googleFromEnv();
}

function emailFromEnv(): ResolvedEmailWebhook | null {
  const url = (process.env.EMAIL_WEBHOOK_URL ?? process.env.NOTIFY_EMAIL_WEBHOOK_URL ?? "").trim();
  if (!url) return null;
  return { url, enabled: true, source: "env" };
}

function emailFromRow(row: IntegrationRow): ResolvedEmailWebhook | null {
  if (!row.enabled) return null;
  const url = String(row.config.url ?? row.secrets.url ?? "").trim();
  if (!url) return null;
  return { url, enabled: true, source: "db" };
}

export async function resolveEmailWebhook(): Promise<ResolvedEmailWebhook | null> {
  const bundle = await loadIntegrationCache();
  if (dbExplicitlyDisables(bundle.email)) return null;
  const fromDb = bundle.email ? emailFromRow(bundle.email) : null;
  if (fromDb) return fromDb;
  return emailFromEnv();
}

export function computeStatusFromConfig(input: {
  enabled: boolean;
  configured: boolean;
  lastStatus?: IntegrationStatus | null;
  lastDetail?: string | null;
}): { status: IntegrationStatus; statusDetail: string | null } {
  if (!input.configured) {
    return { status: "not_configured", statusDetail: null };
  }
  if (!input.enabled) {
    return { status: "disabled", statusDetail: "Saved but disabled" };
  }
  if (input.lastStatus === "error") {
    return { status: "error", statusDetail: input.lastDetail ?? "Last check failed" };
  }
  return { status: "active", statusDetail: input.lastDetail ?? null };
}

export async function describeIntegrationPublic(id: "google_oauth" | "email_webhook") {
  const bundle = await loadIntegrationCache();
  const uris = defaultGoogleRedirectUris();

  if (id === "google_oauth") {
    const row = bundle.google;
    const resolved = await resolveGoogleOAuthConfig();
    const configured = Boolean(
      (row && String(row.config.clientId ?? "").trim() && String(row.secrets.clientSecret ?? "").trim()) ||
        (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    );
    const enabled = row ? row.enabled : Boolean(resolved);
    const { status, statusDetail } = computeStatusFromConfig({
      enabled,
      configured,
      lastStatus: row?.status,
      lastDetail: row?.statusDetail,
    });
    return {
      id,
      label: "Google OAuth",
      description: "Sign in with Google + Company Google Drive (platform client)",
      enabled,
      configured,
      status: resolved ? (enabled ? status : "disabled") : configured ? status : "not_configured",
      statusDetail: resolved ? statusDetail : configured && !enabled ? "Disabled" : statusDetail,
      source: resolved?.source ?? (row ? "db" : configured ? "env" : null),
      lastCheckedAt: row?.lastCheckedAt ?? null,
      publicConfig: {
        clientId: row?.config.clientId
          ? String(row.config.clientId)
          : process.env.GOOGLE_CLIENT_ID
            ? String(process.env.GOOGLE_CLIENT_ID)
            : null,
        clientSecretConfigured: Boolean(
          row?.secrets.clientSecret || process.env.GOOGLE_CLIENT_SECRET,
        ),
        supportEmail: row?.config.supportEmail != null ? String(row.config.supportEmail) : null,
        redirectUriLogin: uris.login,
        redirectUriDrive: uris.drive,
        loginReady: Boolean(resolved),
        driveConnectReady: Boolean(resolved),
      },
    };
  }

  const row = bundle.email;
  const resolved = await resolveEmailWebhook();
  const configured = Boolean(
    (row && String(row.config.url ?? "").trim()) ||
      process.env.EMAIL_WEBHOOK_URL ||
      process.env.NOTIFY_EMAIL_WEBHOOK_URL,
  );
  const enabled = row ? row.enabled : Boolean(resolved);
  const { status, statusDetail } = computeStatusFromConfig({
    enabled,
    configured,
    lastStatus: row?.status,
    lastDetail: row?.statusDetail,
  });
  const url =
    (row?.config.url != null ? String(row.config.url) : null) ||
    process.env.EMAIL_WEBHOOK_URL ||
    process.env.NOTIFY_EMAIL_WEBHOOK_URL ||
    null;
  return {
    id,
    label: "Email webhook",
    description: "Quotation / Email Outbox automatic send (EMAIL_WEBHOOK_URL)",
    enabled,
    configured,
    status: resolved ? status : configured && !enabled ? "disabled" : "not_configured",
    statusDetail: resolved ? statusDetail : configured && !enabled ? "Disabled" : statusDetail,
    source: resolved?.source ?? (row ? "db" : configured ? "env" : null),
    lastCheckedAt: row?.lastCheckedAt ?? null,
    publicConfig: {
      url,
      urlHost: url ? safeHost(url) : null,
    },
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
