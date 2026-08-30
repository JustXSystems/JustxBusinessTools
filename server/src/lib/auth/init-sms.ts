import {
  ConsoleSmsProvider,
  HttpSmsProvider,
  TwilioSmsProvider,
} from "./sms-providers.js";
import { setSmsProvider } from "./phone-otp.js";

/** Select SMS provider from environment. Defaults to console logging in dev. */
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
