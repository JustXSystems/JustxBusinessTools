import type { SmsProvider } from "./phone-otp.js";

/** Dev provider — logs OTP to server console. */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    console.log(`[OTP] phone=${phone} code=${code}`);
  }
}

/** Twilio REST API (no SDK — uses fetch). */
export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const body = new URLSearchParams({
      To: phone,
      From: this.fromNumber,
      Body: `Your JustXSystems verification code is ${code}. Valid for 5 minutes.`,
    });
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio SMS failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
}

type HttpSmsTemplate = { phone: string; message: string };

/**
 * Generic HTTP SMS gateway — POST JSON to a configured URL.
 * Default body: `{ phone, message }`. Override keys via env.
 */
export class HttpSmsProvider implements SmsProvider {
  constructor(
    private url: string,
    private apiKey?: string,
    private phoneKey = "phone",
    private messageKey = "message",
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const payload: HttpSmsTemplate = {
      phone,
      message: `Your JustXSystems verification code is ${code}`,
    };
    const body: Record<string, string> = {
      [this.phoneKey]: payload.phone,
      [this.messageKey]: payload.message,
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP SMS failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
}
