import {
  dbExplicitlyDisables,
  loadIntegrationCache,
  type IntegrationId,
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

export type ResolvedWhatsApp = {
  webhookUrl: string | null;
  accessToken: string | null;
  phoneNumberId: string | null;
  apiVersion: string;
  cloudConfigured: boolean;
  webhookConfigured: boolean;
  canAutoAttach: boolean;
  source: "db" | "env";
};

export type SmsProviderKind = "console" | "twilio" | "msg91" | "http";

export type ResolvedSmsOtp = {
  provider: SmsProviderKind;
  phoneOtpEnabled: boolean;
  twilioAccountSid: string | null;
  twilioAuthToken: string | null;
  twilioFromNumber: string | null;
  msg91AuthKey: string | null;
  msg91TemplateId: string | null;
  smsApiUrl: string | null;
  smsApiKey: string | null;
  smsPhoneField: string;
  smsMessageField: string;
  source: "db" | "env";
};

export type ResolvedErrorWebhook = {
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

function rowOf(id: IntegrationId, bundle: Awaited<ReturnType<typeof loadIntegrationCache>>) {
  return bundle.byId[id] ?? null;
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

export async function resolveGoogleOAuthConfig(): Promise<ResolvedGoogleOAuth | null> {
  const bundle = await loadIntegrationCache();
  const row = rowOf("google_oauth", bundle);
  if (dbExplicitlyDisables(row)) return null;
  const fromDb = row ? googleFromRow(row) : null;
  if (fromDb) return fromDb;
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
  const row = rowOf("email_webhook", bundle);
  if (dbExplicitlyDisables(row)) return null;
  const fromDb = row ? emailFromRow(row) : null;
  if (fromDb) return fromDb;
  return emailFromEnv();
}

function whatsappFromEnv(): ResolvedWhatsApp | null {
  const webhookUrl =
    (process.env.WHATSAPP_WEBHOOK_URL ?? process.env.NOTIFY_WHATSAPP_WEBHOOK_URL ?? "").trim() || null;
  const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim() || null;
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim() || null;
  const apiVersion = (process.env.WHATSAPP_API_VERSION ?? "v21.0").trim() || "v21.0";
  const cloudConfigured = Boolean(accessToken && phoneNumberId);
  const webhookConfigured = Boolean(webhookUrl);
  if (!cloudConfigured && !webhookConfigured) return null;
  return {
    webhookUrl,
    accessToken,
    phoneNumberId,
    apiVersion,
    cloudConfigured,
    webhookConfigured,
    canAutoAttach: cloudConfigured || webhookConfigured,
    source: "env",
  };
}

function whatsappFromRow(row: IntegrationRow): ResolvedWhatsApp | null {
  if (!row.enabled) return null;
  const webhookUrl = String(row.config.webhookUrl ?? "").trim() || null;
  const accessToken = String(row.secrets.accessToken ?? "").trim() || null;
  const phoneNumberId = String(row.config.phoneNumberId ?? "").trim() || null;
  const apiVersion = String(row.config.apiVersion ?? "v21.0").trim() || "v21.0";
  const cloudConfigured = Boolean(accessToken && phoneNumberId);
  const webhookConfigured = Boolean(webhookUrl);
  if (!cloudConfigured && !webhookConfigured) return null;
  return {
    webhookUrl,
    accessToken,
    phoneNumberId,
    apiVersion,
    cloudConfigured,
    webhookConfigured,
    canAutoAttach: cloudConfigured || webhookConfigured,
    source: "db",
  };
}

export async function resolveWhatsApp(): Promise<ResolvedWhatsApp | null> {
  const bundle = await loadIntegrationCache();
  const row = rowOf("whatsapp", bundle);
  if (dbExplicitlyDisables(row)) return null;
  const fromDb = row ? whatsappFromRow(row) : null;
  if (fromDb) return fromDb;
  return whatsappFromEnv();
}

function smsFromEnv(): ResolvedSmsOtp {
  const provider = ((process.env.SMS_PROVIDER ?? "console").toLowerCase() ||
    "console") as SmsProviderKind;
  const phoneOtpEnabled =
    process.env.ENABLE_PHONE_OTP === "true" ||
    (provider !== "console" && process.env.ENABLE_PHONE_OTP !== "false");
  return {
    provider: ["twilio", "msg91", "http", "console"].includes(provider) ? provider : "console",
    phoneOtpEnabled,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || null,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN?.trim() || null,
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER?.trim() || null,
    msg91AuthKey: process.env.MSG91_AUTH_KEY?.trim() || null,
    msg91TemplateId: process.env.MSG91_TEMPLATE_ID?.trim() || null,
    smsApiUrl: process.env.SMS_API_URL?.trim() || null,
    smsApiKey: process.env.SMS_API_KEY?.trim() || null,
    smsPhoneField: process.env.SMS_PHONE_FIELD?.trim() || "phone",
    smsMessageField: process.env.SMS_MESSAGE_FIELD?.trim() || "message",
    source: "env",
  };
}

function smsFromRow(row: IntegrationRow): ResolvedSmsOtp | null {
  if (!row.enabled) return null;
  const providerRaw = String(row.config.provider ?? "console").toLowerCase();
  const provider = (
    ["twilio", "msg91", "http", "console"].includes(providerRaw) ? providerRaw : "console"
  ) as SmsProviderKind;
  return {
    provider,
    phoneOtpEnabled: row.config.phoneOtpEnabled !== false,
    twilioAccountSid: String(row.config.twilioAccountSid ?? "").trim() || null,
    twilioAuthToken: String(row.secrets.twilioAuthToken ?? "").trim() || null,
    twilioFromNumber: String(row.config.twilioFromNumber ?? "").trim() || null,
    msg91AuthKey: String(row.secrets.msg91AuthKey ?? "").trim() || null,
    msg91TemplateId: String(row.config.msg91TemplateId ?? "").trim() || null,
    smsApiUrl: String(row.config.smsApiUrl ?? "").trim() || null,
    smsApiKey: String(row.secrets.smsApiKey ?? "").trim() || null,
    smsPhoneField: String(row.config.smsPhoneField ?? "phone").trim() || "phone",
    smsMessageField: String(row.config.smsMessageField ?? "message").trim() || "message",
    source: "db",
  };
}

export async function resolveSmsOtp(): Promise<ResolvedSmsOtp> {
  const bundle = await loadIntegrationCache();
  const row = rowOf("sms_otp", bundle);
  if (dbExplicitlyDisables(row)) {
    return {
      ...smsFromEnv(),
      provider: "console",
      phoneOtpEnabled: false,
      source: row?.updatedAt ? "db" : "env",
    };
  }
  const fromDb = row ? smsFromRow(row) : null;
  if (fromDb) return fromDb;
  return smsFromEnv();
}

function errorFromEnv(): ResolvedErrorWebhook | null {
  const url = (process.env.ERROR_WEBHOOK_URL ?? "").trim();
  if (!url) return null;
  return { url, enabled: true, source: "env" };
}

function errorFromRow(row: IntegrationRow): ResolvedErrorWebhook | null {
  if (!row.enabled) return null;
  const url = String(row.config.url ?? "").trim();
  if (!url) return null;
  return { url, enabled: true, source: "db" };
}

export async function resolveErrorWebhook(): Promise<ResolvedErrorWebhook | null> {
  const bundle = await loadIntegrationCache();
  const row = rowOf("error_webhook", bundle);
  if (dbExplicitlyDisables(row)) return null;
  const fromDb = row ? errorFromRow(row) : null;
  if (fromDb) return fromDb;
  return errorFromEnv();
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

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function describeIntegrationPublic(id: IntegrationId) {
  const bundle = await loadIntegrationCache();
  const uris = defaultGoogleRedirectUris();

  if (id === "google_oauth") {
    const row = rowOf(id, bundle);
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
      description: "Sign in with Google + Company Google Drive",
      category: "editable" as const,
      enabled,
      configured,
      status: resolved ? (enabled ? status : "disabled") : configured ? status : "not_configured",
      statusDetail: resolved ? statusDetail : configured && !enabled ? "Disabled" : statusDetail,
      source: resolved?.source ?? (row ? "db" : configured ? "env" : null),
      lastCheckedAt: row?.lastCheckedAt ?? null,
      testable: true,
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

  if (id === "email_webhook") {
    const row = rowOf(id, bundle);
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
      description: "Path A automatic quotation / outbox email",
      category: "editable" as const,
      enabled,
      configured,
      status: resolved ? status : configured && !enabled ? "disabled" : "not_configured",
      statusDetail: resolved ? statusDetail : configured && !enabled ? "Disabled" : statusDetail,
      source: resolved?.source ?? (row ? "db" : configured ? "env" : null),
      lastCheckedAt: row?.lastCheckedAt ?? null,
      testable: true,
      publicConfig: { url, urlHost: url ? safeHost(url) : null },
    };
  }

  if (id === "whatsapp") {
    const row = rowOf(id, bundle);
    const resolved = await resolveWhatsApp();
    const configured = Boolean(
      resolved ||
        process.env.WHATSAPP_WEBHOOK_URL ||
        process.env.NOTIFY_WHATSAPP_WEBHOOK_URL ||
        (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) ||
        (row &&
          (String(row.config.webhookUrl ?? "").trim() ||
            (String(row.secrets.accessToken ?? "").trim() &&
              String(row.config.phoneNumberId ?? "").trim()))),
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
      label: "WhatsApp",
      description: "Quotation / survey WhatsApp delivery (Cloud API or webhook)",
      category: "editable" as const,
      enabled,
      configured,
      status: resolved ? status : configured && !enabled ? "disabled" : "not_configured",
      statusDetail: resolved ? statusDetail : configured && !enabled ? "Disabled" : statusDetail,
      source: resolved?.source ?? (row ? "db" : configured ? "env" : null),
      lastCheckedAt: row?.lastCheckedAt ?? null,
      testable: true,
      publicConfig: {
        webhookUrl:
          row?.config.webhookUrl != null
            ? String(row.config.webhookUrl)
            : process.env.WHATSAPP_WEBHOOK_URL || process.env.NOTIFY_WHATSAPP_WEBHOOK_URL || null,
        phoneNumberId:
          row?.config.phoneNumberId != null
            ? String(row.config.phoneNumberId)
            : process.env.WHATSAPP_PHONE_NUMBER_ID || null,
        apiVersion:
          row?.config.apiVersion != null
            ? String(row.config.apiVersion)
            : process.env.WHATSAPP_API_VERSION || "v21.0",
        accessTokenConfigured: Boolean(
          row?.secrets.accessToken || process.env.WHATSAPP_ACCESS_TOKEN,
        ),
        cloudConfigured: Boolean(resolved?.cloudConfigured),
        webhookConfigured: Boolean(resolved?.webhookConfigured),
        canAutoAttach: Boolean(resolved?.canAutoAttach),
      },
    };
  }

  if (id === "sms_otp") {
    const row = rowOf(id, bundle);
    const resolved = await resolveSmsOtp();
    const configured =
      resolved.provider !== "console" ||
      Boolean(row && String(row.config.provider ?? "").trim()) ||
      Boolean(process.env.SMS_PROVIDER && process.env.SMS_PROVIDER !== "console");
    const enabled = row ? row.enabled : resolved.phoneOtpEnabled && resolved.provider !== "console";
    const { status, statusDetail } = computeStatusFromConfig({
      enabled: enabled && resolved.phoneOtpEnabled,
      configured: configured || resolved.phoneOtpEnabled,
      lastStatus: row?.status,
      lastDetail: row?.statusDetail,
    });
    return {
      id,
      label: "SMS / Phone OTP",
      description: "Login with phone OTP (Twilio, MSG91, or HTTP SMS gateway)",
      category: "editable" as const,
      enabled: enabled && resolved.phoneOtpEnabled,
      configured: configured || resolved.provider !== "console",
      status:
        resolved.phoneOtpEnabled && resolved.provider !== "console"
          ? status
          : configured
            ? "disabled"
            : "not_configured",
      statusDetail:
        resolved.provider === "console"
          ? "Console provider (OTP logged to API logs — not for production)"
          : statusDetail,
      source: resolved.source,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      testable: true,
      publicConfig: {
        provider: resolved.provider,
        phoneOtpEnabled: resolved.phoneOtpEnabled,
        twilioAccountSid: resolved.twilioAccountSid,
        twilioFromNumber: resolved.twilioFromNumber,
        twilioAuthTokenConfigured: Boolean(resolved.twilioAuthToken),
        msg91TemplateId: resolved.msg91TemplateId,
        msg91AuthKeyConfigured: Boolean(resolved.msg91AuthKey),
        smsApiUrl: resolved.smsApiUrl,
        smsApiKeyConfigured: Boolean(resolved.smsApiKey),
        smsPhoneField: resolved.smsPhoneField,
        smsMessageField: resolved.smsMessageField,
      },
    };
  }

  // error_webhook
  const row = rowOf("error_webhook", bundle);
  const resolved = await resolveErrorWebhook();
  const configured = Boolean(
    (row && String(row.config.url ?? "").trim()) || process.env.ERROR_WEBHOOK_URL,
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
    process.env.ERROR_WEBHOOK_URL ||
    null;
  return {
    id: "error_webhook" as const,
    label: "Error webhook",
    description: "Slack/Discord/ops POST for API 500s and uncaught errors",
    category: "editable" as const,
    enabled,
    configured,
    status: resolved ? status : configured && !enabled ? "disabled" : "not_configured",
    statusDetail: resolved ? statusDetail : configured && !enabled ? "Disabled" : statusDetail,
    source: resolved?.source ?? (row ? "db" : configured ? "env" : null),
    lastCheckedAt: row?.lastCheckedAt ?? null,
    testable: true,
    publicConfig: { url, urlHost: url ? safeHost(url) : null },
  };
}
