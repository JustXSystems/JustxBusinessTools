import { Router } from "express";
import { isPlatformAdmin } from "../../lib/platform-admin.js";
import { logAudit } from "../../lib/audit.js";
import { getActiveUserId } from "../../lib/request-context.js";
import { buildIntegrationsHub } from "../../lib/integrations/overview.js";
import {
  describeIntegrationPublic,
  resolveEmailWebhook,
  resolveErrorWebhook,
  resolveGoogleOAuthConfig,
  resolveSmsOtp,
  resolveWhatsApp,
} from "../../lib/integrations/resolvers.js";
import {
  getIntegration,
  INTEGRATION_IDS,
  upsertIntegration,
  updateIntegrationStatus,
  type IntegrationId,
} from "../../lib/integrations/store.js";
import { refreshSmsProviderFromIntegrations } from "../../lib/auth/init-sms.js";

const router = Router();

function requirePlatformAdmin(res: import("express").Response): boolean {
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required to manage integrations" });
    return false;
  }
  return true;
}

function isIntegrationId(id: string): id is IntegrationId {
  return (INTEGRATION_IDS as string[]).includes(id);
}

router.get("/", async (_req, res) => {
  if (!requirePlatformAdmin(res)) return;
  res.json(await buildIntegrationsHub());
});

router.get("/:id", async (req, res) => {
  if (!requirePlatformAdmin(res)) return;
  const id = String(req.params.id);
  if (!isIntegrationId(id)) {
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
  const nextSecret =
    !clientSecretRaw || clientSecretRaw.startsWith("••••") ? undefined : clientSecretRaw;
  const hasSecret = Boolean(nextSecret || existing?.secrets.clientSecret);
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

  await upsertIntegration({
    id: "google_oauth",
    enabled,
    config: { clientId, supportEmail },
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
      ? "Google Client ID changed. Business Profiles may need to reconnect Drive."
      : null,
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
  await logAudit("integration.email_webhook.save", "platform_integration", "email_webhook", { enabled }, req.ip);
  res.json({ ok: true, integration: await describeIntegrationPublic("email_webhook") });
});

router.put("/whatsapp", async (req, res) => {
  if (!requirePlatformAdmin(res)) return;
  const enabled = Boolean(req.body?.enabled);
  const webhookUrl = String(req.body?.webhookUrl ?? "").trim();
  const phoneNumberId = String(req.body?.phoneNumberId ?? "").trim();
  const apiVersion = String(req.body?.apiVersion ?? "v21.0").trim() || "v21.0";
  const accessTokenRaw = String(req.body?.accessToken ?? "").trim();
  const existing = await getIntegration("whatsapp");
  const nextToken =
    !accessTokenRaw || accessTokenRaw.startsWith("••••") ? undefined : accessTokenRaw;
  const hasToken = Boolean(nextToken || existing?.secrets.accessToken);
  const cloudOk = Boolean(phoneNumberId && hasToken);
  const webhookOk = Boolean(webhookUrl);
  if (enabled && !cloudOk && !webhookOk) {
    res.status(400).json({
      error: "Enable requires a webhook URL and/or Cloud API phone number ID + access token",
    });
    return;
  }
  await upsertIntegration({
    id: "whatsapp",
    enabled,
    config: { webhookUrl, phoneNumberId, apiVersion },
    secretsPatch: nextToken ? { accessToken: nextToken } : undefined,
    status: enabled && (cloudOk || webhookOk) ? "active" : enabled ? "error" : "disabled",
    statusDetail: enabled ? "Saved from Admin" : "Disabled in Admin",
    updatedBy: getActiveUserId(),
  });
  await logAudit("integration.whatsapp.save", "platform_integration", "whatsapp", { enabled }, req.ip);
  res.json({ ok: true, integration: await describeIntegrationPublic("whatsapp") });
});

router.put("/sms_otp", async (req, res) => {
  if (!requirePlatformAdmin(res)) return;
  const enabled = Boolean(req.body?.enabled);
  const provider = String(req.body?.provider ?? "console").toLowerCase();
  const phoneOtpEnabled = req.body?.phoneOtpEnabled !== false;
  const existing = await getIntegration("sms_otp");

  const twilioAuthTokenRaw = String(req.body?.twilioAuthToken ?? "").trim();
  const msg91AuthKeyRaw = String(req.body?.msg91AuthKey ?? "").trim();
  const smsApiKeyRaw = String(req.body?.smsApiKey ?? "").trim();

  await upsertIntegration({
    id: "sms_otp",
    enabled,
    config: {
      provider,
      phoneOtpEnabled: enabled && phoneOtpEnabled,
      twilioAccountSid: String(req.body?.twilioAccountSid ?? "").trim(),
      twilioFromNumber: String(req.body?.twilioFromNumber ?? "").trim(),
      msg91TemplateId: String(req.body?.msg91TemplateId ?? "").trim(),
      smsApiUrl: String(req.body?.smsApiUrl ?? "").trim(),
      smsPhoneField: String(req.body?.smsPhoneField ?? "phone").trim() || "phone",
      smsMessageField: String(req.body?.smsMessageField ?? "message").trim() || "message",
    },
    secretsPatch: {
      twilioAuthToken:
        twilioAuthTokenRaw && !twilioAuthTokenRaw.startsWith("••••")
          ? twilioAuthTokenRaw
          : undefined,
      msg91AuthKey:
        msg91AuthKeyRaw && !msg91AuthKeyRaw.startsWith("••••") ? msg91AuthKeyRaw : undefined,
      smsApiKey: smsApiKeyRaw && !smsApiKeyRaw.startsWith("••••") ? smsApiKeyRaw : undefined,
    },
    status: enabled && phoneOtpEnabled ? "active" : "disabled",
    statusDetail: enabled ? `Provider ${provider}` : "Disabled in Admin",
    updatedBy: getActiveUserId(),
  });
  await refreshSmsProviderFromIntegrations();
  await logAudit(
    "integration.sms_otp.save",
    "platform_integration",
    "sms_otp",
    { enabled, provider, keptSecrets: Boolean(existing) },
    req.ip,
  );
  res.json({ ok: true, integration: await describeIntegrationPublic("sms_otp") });
});

router.put("/error_webhook", async (req, res) => {
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
    id: "error_webhook",
    enabled,
    config: { url },
    status: enabled && url ? "active" : enabled ? "error" : url ? "disabled" : "not_configured",
    statusDetail: enabled ? "Saved from Admin" : url ? "Disabled in Admin" : null,
    updatedBy: getActiveUserId(),
  });
  await logAudit("integration.error_webhook.save", "platform_integration", "error_webhook", { enabled }, req.ip);
  res.json({ ok: true, integration: await describeIntegrationPublic("error_webhook") });
});

router.post("/google_oauth/test", async (_req, res) => {
  if (!requirePlatformAdmin(res)) return;
  try {
    const cfg = await resolveGoogleOAuthConfig();
    if (!cfg) {
      await updateIntegrationStatus("google_oauth", "not_configured", "No Google OAuth credentials");
      res.status(400).json({ ok: false, error: "Google OAuth is not configured" });
      return;
    }
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
    const lower = text.toLowerCase();
    const badClient =
      probe.status === 401 ||
      lower.includes("invalid_client") ||
      lower.includes("unauthorized_client");
    if (badClient) {
      await updateIntegrationStatus("google_oauth", "error", "Google rejected client id or secret");
      res.status(400).json({ ok: false, error: "Google rejected the client ID or secret", source: cfg.source });
      return;
    }
    await updateIntegrationStatus("google_oauth", "active", `OK (${cfg.source})`);
    res.json({ ok: true, source: cfg.source, message: "Client credentials look valid" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Test failed";
    await updateIntegrationStatus("google_oauth", "error", msg);
    res.status(502).json({ ok: false, error: msg });
  }
});

router.post("/email_webhook/test", async (_req, res) => {
  if (!requirePlatformAdmin(res)) return;
  try {
    const resolved = await resolveEmailWebhook();
    if (!resolved) {
      await updateIntegrationStatus("email_webhook", "not_configured", "No email webhook");
      res.status(400).json({ ok: false, error: "Email webhook is not configured" });
      return;
    }
    const r = await fetch(resolved.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "email",
        to: "integrations-test@justx.local",
        subject: "[JustX] Email webhook test",
        body: "Platform Admin test. Safe to ignore.",
        kind: "admin.integration.test",
        dryRun: true,
      }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 180);
      await updateIntegrationStatus("email_webhook", "error", `HTTP ${r.status}`);
      res.status(400).json({ ok: false, error: `Webhook returned HTTP ${r.status}`, detail });
      return;
    }
    await updateIntegrationStatus("email_webhook", "active", `POST ok (${resolved.source})`);
    res.json({ ok: true, source: resolved.source, message: "Webhook accepted test POST" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Test failed";
    await updateIntegrationStatus("email_webhook", "error", msg);
    res.status(502).json({ ok: false, error: msg });
  }
});

router.post("/whatsapp/test", async (_req, res) => {
  if (!requirePlatformAdmin(res)) return;
  try {
    const resolved = await resolveWhatsApp();
    if (!resolved) {
      await updateIntegrationStatus("whatsapp", "not_configured", "WhatsApp not configured");
      res.status(400).json({ ok: false, error: "WhatsApp is not configured" });
      return;
    }
    if (resolved.webhookConfigured && resolved.webhookUrl) {
      const r = await fetch(resolved.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "whatsapp",
          to: "910000000000",
          message: "[JustX] WhatsApp webhook test",
          kind: "admin.integration.test",
          dryRun: true,
        }),
      });
      if (!r.ok) {
        await updateIntegrationStatus("whatsapp", "error", `Webhook HTTP ${r.status}`);
        res.status(400).json({ ok: false, error: `Webhook returned HTTP ${r.status}` });
        return;
      }
    }
    if (resolved.cloudConfigured && resolved.accessToken && resolved.phoneNumberId) {
      const r = await fetch(
        `https://graph.facebook.com/${resolved.apiVersion}/${resolved.phoneNumberId}?fields=id,display_phone_number`,
        { headers: { Authorization: `Bearer ${resolved.accessToken}` } },
      );
      if (!r.ok) {
        await updateIntegrationStatus("whatsapp", "error", `Cloud API HTTP ${r.status}`);
        res.status(400).json({ ok: false, error: `Cloud API rejected credentials (HTTP ${r.status})` });
        return;
      }
    }
    await updateIntegrationStatus("whatsapp", "active", `OK (${resolved.source})`);
    res.json({
      ok: true,
      source: resolved.source,
      message: "WhatsApp configuration looks valid",
      cloudConfigured: resolved.cloudConfigured,
      webhookConfigured: resolved.webhookConfigured,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Test failed";
    await updateIntegrationStatus("whatsapp", "error", msg);
    res.status(502).json({ ok: false, error: msg });
  }
});

router.post("/sms_otp/test", async (_req, res) => {
  if (!requirePlatformAdmin(res)) return;
  try {
    await refreshSmsProviderFromIntegrations();
    const cfg = await resolveSmsOtp();
    if (!cfg.phoneOtpEnabled) {
      await updateIntegrationStatus("sms_otp", "disabled", "Phone OTP disabled");
      res.status(400).json({ ok: false, error: "Phone OTP is disabled" });
      return;
    }
    if (cfg.provider === "console") {
      await updateIntegrationStatus("sms_otp", "active", "Console provider (dev)");
      res.json({
        ok: true,
        source: cfg.source,
        message: "Console SMS active — OTP codes are logged on the API server",
        provider: cfg.provider,
      });
      return;
    }
    if (cfg.provider === "twilio" && (!cfg.twilioAccountSid || !cfg.twilioAuthToken || !cfg.twilioFromNumber)) {
      res.status(400).json({ ok: false, error: "Twilio credentials incomplete" });
      return;
    }
    if (cfg.provider === "msg91" && !cfg.msg91AuthKey) {
      res.status(400).json({ ok: false, error: "MSG91 auth key missing" });
      return;
    }
    if (cfg.provider === "http" && !cfg.smsApiUrl) {
      res.status(400).json({ ok: false, error: "SMS API URL missing" });
      return;
    }
    if (cfg.provider === "twilio" && cfg.twilioAccountSid && cfg.twilioAuthToken) {
      const auth = Buffer.from(`${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`).toString("base64");
      const r = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioAccountSid}.json`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (!r.ok) {
        await updateIntegrationStatus("sms_otp", "error", `Twilio HTTP ${r.status}`);
        res.status(400).json({ ok: false, error: `Twilio rejected credentials (HTTP ${r.status})` });
        return;
      }
    }
    await updateIntegrationStatus("sms_otp", "active", `Provider ${cfg.provider} (${cfg.source})`);
    res.json({ ok: true, source: cfg.source, provider: cfg.provider, message: "SMS provider looks valid" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Test failed";
    await updateIntegrationStatus("sms_otp", "error", msg);
    res.status(502).json({ ok: false, error: msg });
  }
});

router.post("/error_webhook/test", async (_req, res) => {
  if (!requirePlatformAdmin(res)) return;
  try {
    const resolved = await resolveErrorWebhook();
    if (!resolved) {
      await updateIntegrationStatus("error_webhook", "not_configured", "No error webhook");
      res.status(400).json({ ok: false, error: "Error webhook is not configured" });
      return;
    }
    const r = await fetch(resolved.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "[JustX] Error webhook test — safe to ignore",
        service: "justx-jbt-api",
        kind: "admin.integration.test",
        dryRun: true,
        at: new Date().toISOString(),
      }),
    });
    if (!r.ok) {
      await updateIntegrationStatus("error_webhook", "error", `HTTP ${r.status}`);
      res.status(400).json({ ok: false, error: `Webhook returned HTTP ${r.status}` });
      return;
    }
    await updateIntegrationStatus("error_webhook", "active", `POST ok (${resolved.source})`);
    res.json({ ok: true, source: resolved.source, message: "Error webhook accepted test POST" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Test failed";
    await updateIntegrationStatus("error_webhook", "error", msg);
    res.status(502).json({ ok: false, error: msg });
  }
});

export default router;
