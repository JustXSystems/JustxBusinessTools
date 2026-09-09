import { Router } from "express";
import { isPlatformAdmin } from "../../lib/platform-admin.js";
import { logAudit } from "../../lib/audit.js";
import { getActiveUserId } from "../../lib/request-context.js";
import {
  describeIntegrationPublic,
  defaultGoogleRedirectUris,
  resolveEmailWebhook,
  resolveGoogleOAuthConfig,
} from "../../lib/integrations/resolvers.js";
import {
  getIntegration,
  maskSecret,
  updateIntegrationStatus,
  upsertIntegration,
  type IntegrationId,
} from "../../lib/integrations/store.js";

const router = Router();

function requirePlatformAdmin(res: import("express").Response): boolean {
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required to manage integrations" });
    return false;
  }
  return true;
}

router.get("/", async (_req, res) => {
  if (!requirePlatformAdmin(res)) return;
  const [google, email] = await Promise.all([
    describeIntegrationPublic("google_oauth"),
    describeIntegrationPublic("email_webhook"),
  ]);
  const uris = defaultGoogleRedirectUris();
  res.json({
    integrations: [google, email],
    hints: {
      redirectUriLogin: uris.login,
      redirectUriDrive: uris.drive,
      migrateNote:
        "Values saved here override .env. After verifying in Admin, you can remove GOOGLE_* and EMAIL_WEBHOOK_URL from server/.env.",
    },
  });
});

router.get("/:id", async (req, res) => {
  if (!requirePlatformAdmin(res)) return;
  const id = String(req.params.id) as IntegrationId;
  if (id !== "google_oauth" && id !== "email_webhook") {
    res.status(404).json({ error: "Unknown integration" });
    return;
  }
  res.json({ integration: await describeIntegrationPublic(id) });
});

router.put("/google_oauth", async (req, res) => {
  if (!requirePlatformAdmin(res)) return;
  const enabled = Boolean(req.body?.enabled);
  const clientId = String(req.body?.clientId ?? "").trim();
  const clientSecretRaw = String(req.body?.clientSecret ?? "").trim();
  const supportEmail = String(req.body?.supportEmail ?? "").trim() || null;

  const existing = await getIntegration("google_oauth");
  const keepSecret = !clientSecretRaw || clientSecretRaw.startsWith("••••");
  const nextSecret = keepSecret ? undefined : clientSecretRaw;
  const hasSecret = Boolean(
    nextSecret || existing?.secrets.clientSecret,
  );

  if (enabled && !clientId) {
    res.status(400).json({ error: "Client ID is required when enabling Google OAuth" });
    return;
  }
  if (enabled && !hasSecret) {
    res.status(400).json({ error: "Client secret is required when enabling Google OAuth" });
    return;
  }

  const clientIdChanged =
    existing &&
    String(existing.config.clientId ?? "").trim() &&
    clientId &&
    String(existing.config.clientId).trim() !== clientId;

  const row = await upsertIntegration({
    id: "google_oauth",
    enabled,
    config: {
      clientId,
      supportEmail,
    },
    secretsPatch: nextSecret ? { clientSecret: nextSecret } : undefined,
    status: enabled && clientId && hasSecret ? "active" : enabled ? "error" : "disabled",
    statusDetail: enabled
      ? clientIdChanged
        ? "Saved — companies may need to reconnect Google Drive"
        : "Saved from Admin"
      : "Disabled in Admin",
    updatedBy: getActiveUserId(),
  });

  await logAudit(
    "integration.google_oauth.save",
    "platform_integration",
    "google_oauth",
    { enabled, clientIdChanged: Boolean(clientIdChanged) },
    req.ip,
  );

  res.json({
    ok: true,
    integration: await describeIntegrationPublic("google_oauth"),
    warning: clientIdChanged
      ? "Google Client ID changed. Business Profiles that connected Drive with the previous client may need to reconnect."
      : null,
    secretMasked: maskSecret(row.secrets.clientSecret),
  });
});

router.put("/email_webhook", async (req, res) => {
  if (!requirePlatformAdmin(res)) return;
  const enabled = Boolean(req.body?.enabled);
  const url = String(req.body?.url ?? "").trim();

  if (enabled && !url) {
    res.status(400).json({ error: "Webhook URL is required when enabling" });
    return;
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/i.test(parsed.protocol)) {
        res.status(400).json({ error: "Webhook URL must be http(s)" });
        return;
      }
    } catch {
      res.status(400).json({ error: "Invalid webhook URL" });
      return;
    }
  }

  await upsertIntegration({
    id: "email_webhook",
    enabled,
    config: { url },
    status: enabled && url ? "active" : enabled ? "error" : url ? "disabled" : "not_configured",
    statusDetail: enabled ? "Saved from Admin" : url ? "Disabled in Admin" : null,
    updatedBy: getActiveUserId(),
  });

  await logAudit(
    "integration.email_webhook.save",
    "platform_integration",
    "email_webhook",
    { enabled, host: url ? new URL(url).host : null },
    req.ip,
  );

  res.json({ ok: true, integration: await describeIntegrationPublic("email_webhook") });
});

router.post("/google_oauth/test", async (req, res) => {
  if (!requirePlatformAdmin(res)) return;
  try {
    const cfg = await resolveGoogleOAuthConfig();
    if (!cfg) {
      await updateIntegrationStatus("google_oauth", "not_configured", "No Google OAuth credentials resolved");
      res.status(400).json({ ok: false, error: "Google OAuth is not configured" });
      return;
    }
    // Lightweight check: Google's tokeninfo / discovery — POST with invalid code should 400, not 401 client
    const probe = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code: "jbt_admin_probe_invalid",
        redirect_uri: cfg.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const text = await probe.text();
    // invalid_grant / invalid_request with our fake code means client id+secret were accepted shape-wise;
    // unauthorized_client / invalid_client means bad credentials
    const lower = text.toLowerCase();
    const badClient =
      probe.status === 401 ||
      lower.includes("invalid_client") ||
      lower.includes("unauthorized_client");
    if (badClient) {
      await updateIntegrationStatus("google_oauth", "error", "Google rejected client id or secret");
      res.status(400).json({
        ok: false,
        error: "Google rejected the client ID or secret",
        detail: text.slice(0, 200),
        source: cfg.source,
      });
      return;
    }
    await updateIntegrationStatus(
      "google_oauth",
      "active",
      `Credentials accepted by Google (source: ${cfg.source})`,
    );
    res.json({
      ok: true,
      source: cfg.source,
      redirectUri: cfg.redirectUri,
      driveRedirectUri: cfg.driveRedirectUri,
      message: "Client credentials look valid",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Test failed";
    await updateIntegrationStatus("google_oauth", "error", msg);
    res.status(502).json({ ok: false, error: msg });
  }
});

router.post("/email_webhook/test", async (req, res) => {
  if (!requirePlatformAdmin(res)) return;
  try {
    const resolved = await resolveEmailWebhook();
    if (!resolved) {
      await updateIntegrationStatus("email_webhook", "not_configured", "No email webhook URL resolved");
      res.status(400).json({ ok: false, error: "Email webhook is not configured" });
      return;
    }
    const probePayload = {
      channel: "email",
      to: "integrations-test@justx.local",
      subject: "[JustX] Email webhook test",
      body: "Platform Admin test from JustX Business Tools. Safe to ignore.",
      kind: "admin.integration.test",
      dryRun: true,
    };
    const r = await fetch(resolved.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(probePayload),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 180);
      await updateIntegrationStatus("email_webhook", "error", `HTTP ${r.status}: ${detail}`);
      res.status(400).json({
        ok: false,
        error: `Webhook returned HTTP ${r.status}`,
        detail,
        source: resolved.source,
      });
      return;
    }
    await updateIntegrationStatus(
      "email_webhook",
      "active",
      `POST ok (source: ${resolved.source})`,
    );
    res.json({ ok: true, source: resolved.source, status: r.status, message: "Webhook accepted test POST" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Test failed";
    await updateIntegrationStatus("email_webhook", "error", msg);
    res.status(502).json({ ok: false, error: msg });
  }
});

export default router;
