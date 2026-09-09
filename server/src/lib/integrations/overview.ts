import { pool } from "../../db.js";
import { INTEGRATION_IDS, type IntegrationId } from "./store.js";
import {
  defaultGoogleRedirectUris,
  describeIntegrationPublic,
  resolveGoogleOAuthConfig,
  resolveSmsOtp,
} from "./resolvers.js";
import { getWhatsAppDeliveryConfig } from "../whatsapp-cloud.js";
import { isProductionRuntime } from "../env.js";

export type HubCard = {
  id: string;
  label: string;
  description: string;
  status: "active" | "disabled" | "not_configured" | "error" | "warning" | "info";
  statusLabel: string;
  detail: string | null;
  manageHref: string | null;
  editable: boolean;
  testable: boolean;
  integrationId?: IntegrationId;
};

export async function buildIntegrationsHub() {
  const integrations = await Promise.all(INTEGRATION_IDS.map((id) => describeIntegrationPublic(id)));

  const [googleCfg, sms, wa] = await Promise.all([
    resolveGoogleOAuthConfig(),
    resolveSmsOtp(),
    getWhatsAppDeliveryConfig(),
  ]);

  const mfaEnabled = process.env.ENABLE_MFA !== "false";
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  const paymentAutoComplete = process.env.PAYMENT_AUTO_COMPLETE === "true";
  const paymentProvider = process.env.PAYMENT_PROVIDER ?? "mock";

  let gateways = { total: 0, enabled: 0, unhealthy: 0 };
  try {
    const [rows] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled,
         SUM(CASE WHEN enabled = 1 AND (last_health IS NULL OR last_health <> 'ok') THEN 1 ELSE 0 END) AS unhealthy
       FROM payment_gateways`,
    );
    const r = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
    gateways = {
      total: Number(r?.total) || 0,
      enabled: Number(r?.enabled) || 0,
      unhealthy: Number(r?.unhealthy) || 0,
    };
  } catch {
    /* optional */
  }

  const uris = defaultGoogleRedirectUris();
  const apiPublic = (process.env.API_PUBLIC_URL ?? "").replace(/\/$/, "") || null;
  const cors = process.env.CORS_ORIGIN?.trim() || null;
  const webOrigin = process.env.WEB_PUBLIC_ORIGIN?.trim() || cors;
  const webBase = process.env.WEB_BASE_PATH || process.env.NEXT_PUBLIC_BASE_PATH || "";

  const linked: HubCard[] = [
    {
      id: "payment_gateways",
      label: "Payment gateways",
      description: "Razorpay / Stripe / Cashfree — org credentials live under Gateways",
      status: gateways.unhealthy ? "warning" : gateways.enabled ? "active" : "not_configured",
      statusLabel: gateways.unhealthy
        ? "Needs check"
        : gateways.enabled
          ? `${gateways.enabled} enabled`
          : "None enabled",
      detail: `${gateways.total} configured · env provider fallback: ${paymentProvider}`,
      manageHref: "/admin/gateways",
      editable: false,
      testable: false,
    },
    {
      id: "ops_observability",
      label: "Observability",
      description: "Sentry/GlitchTip, Grafana, OpenTelemetry — runtime probes on Operations",
      status:
        process.env.SENTRY_DSN || process.env.GRAFANA_PUBLIC_URL || process.env.OTEL_ENABLED === "true"
          ? "info"
          : "not_configured",
      statusLabel: [
        process.env.SENTRY_DSN ? "Sentry" : null,
        process.env.GRAFANA_PUBLIC_URL ? "Grafana" : null,
        process.env.OTEL_ENABLED === "true" ? "OTel" : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Not linked",
      detail: "DSN / Grafana URL stay in .env (infra). Error webhook is editable on this page.",
      manageHref: "/admin/ops",
      editable: false,
      testable: false,
    },
    {
      id: "experience",
      label: "Experience & branding",
      description: "Platform logo, theme, registration copy, tool catalog",
      status: "info",
      statusLabel: "Managed in Admin",
      detail: null,
      manageHref: "/admin/experience",
      editable: false,
      testable: false,
    },
    {
      id: "auth_surface",
      label: "Auth methods (live)",
      description: "What the login page currently offers",
      status: "active",
      statusLabel: "Live",
      detail: [
        "Password",
        googleCfg ? "Google" : null,
        sms.phoneOtpEnabled && sms.provider !== "console" ? "Phone OTP" : null,
        mfaEnabled ? "MFA available" : "MFA off",
      ]
        .filter(Boolean)
        .join(" · "),
      manageHref: null,
      editable: false,
      testable: false,
    },
  ];

  const bootstrap: HubCard[] = [
    {
      id: "require_auth",
      label: "REQUIRE_AUTH",
      description: "API must reject anonymous requests",
      status: requireAuth ? "active" : isProductionRuntime() ? "error" : "warning",
      statusLabel: requireAuth ? "true" : "false",
      detail: "Bootstrap — edit server/.env only",
      manageHref: null,
      editable: false,
      testable: false,
    },
    {
      id: "payment_auto_complete",
      label: "PAYMENT_AUTO_COMPLETE",
      description: "Must be false on public production",
      status: paymentAutoComplete && isProductionRuntime() ? "error" : paymentAutoComplete ? "warning" : "active",
      statusLabel: String(paymentAutoComplete),
      detail: "Bootstrap — edit server/.env only",
      manageHref: null,
      editable: false,
      testable: false,
    },
    {
      id: "public_urls",
      label: "Public URLs",
      description: "API / CORS / web base path (nginx + build)",
      status: apiPublic && cors ? "active" : "warning",
      statusLabel: apiPublic ? "Set" : "Incomplete",
      detail: [
        apiPublic ? `API ${apiPublic}` : "API_PUBLIC_URL missing",
        cors ? `CORS ${cors}` : "CORS_ORIGIN missing",
        webBase ? `base ${webBase}` : "no WEB_BASE_PATH",
        `login callback ${uris.login}`,
      ].join(" · "),
      manageHref: null,
      editable: false,
      testable: false,
    },
    {
      id: "jwt_db",
      label: "JWT & database",
      description: "Session encryption and MySQL — never editable in Admin",
      status: process.env.JWT_SECRET && process.env.DB_HOST ? "active" : "error",
      statusLabel: process.env.JWT_SECRET ? "Configured" : "Missing JWT",
      detail: `DB ${process.env.DB_HOST ?? "?"} / ${process.env.DB_NAME ?? "?"} · secrets stay in .env`,
      manageHref: null,
      editable: false,
      testable: false,
    },
    {
      id: "mfa_flag",
      label: "ENABLE_MFA",
      description: "TOTP MFA APIs/UI (env flag; per-user enroll on account)",
      status: mfaEnabled ? "active" : "disabled",
      statusLabel: mfaEnabled ? "On" : "Off",
      detail: "Stays in .env for this release (user enroll is not platform config)",
      manageHref: null,
      editable: false,
      testable: false,
    },
    {
      id: "whatsapp_live",
      label: "WhatsApp capability",
      description: "Resolved delivery readiness for tools",
      status: wa.canAutoAttach ? "active" : "not_configured",
      statusLabel: wa.canAutoAttach ? "Ready" : "Not ready",
      detail: [
        wa.cloudConfigured ? "Cloud API" : null,
        wa.webhookConfigured ? "Webhook" : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Configure WhatsApp integration",
      manageHref: null,
      editable: false,
      testable: false,
      integrationId: "whatsapp",
    },
  ];

  return {
    integrations,
    linked,
    bootstrap,
    hints: {
      redirectUriLogin: uris.login,
      redirectUriDrive: uris.drive,
      webOrigin,
      apiPublic,
      migrateNote:
        "Editable integrations override .env when saved. Bootstrap secrets (JWT, DB, CORS, paths) never move here.",
      neverMove: [
        "JWT_SECRET",
        "DB_*",
        "CORS_ORIGIN / WEB_* / API_PUBLIC_URL",
        "REQUIRE_AUTH",
        "PLATFORM_ADMIN_EMAIL",
        "S3_* / UPLOAD_* infra",
        "Payment gateway credentials (use Admin → Gateways)",
        "Per-company Drive / artifact webhook / UNC (Business Profile)",
      ],
    },
  };
}
