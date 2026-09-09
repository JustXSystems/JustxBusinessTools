import {
  ConsoleSmsProvider,
  HttpSmsProvider,
  Msg91SmsProvider,
  TwilioSmsProvider,
} from "./sms-providers.js";
import { setSmsProvider } from "./phone-otp.js";
import type { ResolvedSmsOtp } from "../integrations/resolvers.js";

/** Apply a resolved SMS config (Admin Integrations or env). */
export function applySmsProvider(cfg: ResolvedSmsOtp): void {
  if (!cfg.phoneOtpEnabled || cfg.provider === "console") {
    setSmsProvider(new ConsoleSmsProvider());
    return;
  }

  if (cfg.provider === "twilio") {
    if (!cfg.twilioAccountSid || !cfg.twilioAuthToken || !cfg.twilioFromNumber) {
      console.warn("[SMS] Twilio credentials incomplete — using console");
      setSmsProvider(new ConsoleSmsProvider());
      return;
    }
    setSmsProvider(
      new TwilioSmsProvider(cfg.twilioAccountSid, cfg.twilioAuthToken, cfg.twilioFromNumber),
    );
    return;
  }

  if (cfg.provider === "msg91") {
    if (!cfg.msg91AuthKey) {
      console.warn("[SMS] MSG91 auth key missing — using console");
      setSmsProvider(new ConsoleSmsProvider());
      return;
    }
    setSmsProvider(new Msg91SmsProvider(cfg.msg91AuthKey, cfg.msg91TemplateId ?? undefined));
    return;
  }

  if (cfg.provider === "http") {
    if (!cfg.smsApiUrl) {
      console.warn("[SMS] HTTP SMS_API_URL missing — using console");
      setSmsProvider(new ConsoleSmsProvider());
      return;
    }
    setSmsProvider(
      new HttpSmsProvider(
        cfg.smsApiUrl,
        cfg.smsApiKey ?? undefined,
        cfg.smsPhoneField,
        cfg.smsMessageField,
      ),
    );
    return;
  }

  setSmsProvider(new ConsoleSmsProvider());
}

/** Select SMS provider from environment (startup). Admin DB overrides applied on demand. */
export function initSmsProvider(): void {
  const provider = (process.env.SMS_PROVIDER ?? "console").toLowerCase();

  if (provider === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) {
      console.warn("[SMS] SMS_PROVIDER=twilio but credentials missing — using console");
      setSmsProvider(new ConsoleSmsProvider());
      return;
    }
    setSmsProvider(new TwilioSmsProvider(sid, token, from));
    console.log("[SMS] Twilio provider active");
    return;
  }

  if (provider === "msg91") {
    const authKey = process.env.MSG91_AUTH_KEY?.trim();
    const templateId = process.env.MSG91_TEMPLATE_ID?.trim();
    if (!authKey) {
      console.warn("[SMS] SMS_PROVIDER=msg91 but MSG91_AUTH_KEY missing — using console");
      setSmsProvider(new ConsoleSmsProvider());
      return;
    }
    setSmsProvider(new Msg91SmsProvider(authKey, templateId));
    console.log("[SMS] MSG91 provider active");
    return;
  }

  if (provider === "http") {
    const url = process.env.SMS_API_URL;
    if (!url) {
      console.warn("[SMS] SMS_PROVIDER=http but SMS_API_URL missing — using console");
      setSmsProvider(new ConsoleSmsProvider());
      return;
    }
    setSmsProvider(
      new HttpSmsProvider(
        url,
        process.env.SMS_API_KEY,
        process.env.SMS_PHONE_FIELD ?? "phone",
        process.env.SMS_MESSAGE_FIELD ?? "message",
      ),
    );
    console.log("[SMS] HTTP gateway provider active");
    return;
  }

  setSmsProvider(new ConsoleSmsProvider());
}

/** Refresh SMS provider from Admin Integrations (DB) with env fallback. */
export async function refreshSmsProviderFromIntegrations(): Promise<void> {
  const { resolveSmsOtp } = await import("../integrations/resolvers.js");
  const cfg = await resolveSmsOtp();
  applySmsProvider(cfg);
}
