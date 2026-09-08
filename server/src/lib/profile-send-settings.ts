import { pool } from "../db.js";

export type ProfileWhatsAppNumber = {
  id: string;
  label: string;
  phone: string;
};

export type QuotationEmailTemplateId = "plain" | "corporate";

export type ProfileEmailDefaults = {
  to: string;
  cc: string;
  subject: string;
  message: string;
  /** Quotation HTML vs plain layout — see web/lib/quotation-email-templates.ts */
  templateId: QuotationEmailTemplateId;
  intro: string;
  closing: string;
  replyTo: string;
};

export const DEFAULT_QUOTATION_EMAIL_TEMPLATE: QuotationEmailTemplateId = "corporate";

export const DEFAULT_CORPORATE_EMAIL_INTRO =
  "Greetings from {{companyName}}. Thank you for your interest in our products and services. We appreciate the opportunity and are pleased to share your quotation summary below.";

export const DEFAULT_CORPORATE_EMAIL_CLOSING =
  "Should you have any questions or require modifications, please feel free to reach out — we would be happy to assist. We look forward to your confirmation and to the opportunity of working together.";

export function normalizeQuotationEmailTemplateId(raw: unknown): QuotationEmailTemplateId {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "plain") return "plain";
  if (v === "corporate") return "corporate";
  return DEFAULT_QUOTATION_EMAIL_TEMPLATE;
}

/** Legacy fields kept for stored JSON compat — Drive send is client-side PDF download. */
export type ProfileGoogleDriveSettings = {
  folderId: string;
  folderLabel: string;
};

export type ProfileSendSettings = {
  whatsappNumbers: ProfileWhatsAppNumber[];
  /** WhatsApp chat text template ({{placeholders}}). */
  whatsappMessage: string;
  email: ProfileEmailDefaults;
  googleDrive: ProfileGoogleDriveSettings;
};

export const DEFAULT_WHATSAPP_MESSAGE = `Hi {{customerName}},

Please find our quotation details:

• Quotation No.: {{quoteNo}}
• Type: {{typeLabel}}
• Date: {{date}}
• Valid Till: {{validTill}}
• Grand Total: ₹{{grandTotal}} ({{grandTotalWords}})

I am attaching the PDF quotation. Please review and confirm.

Regards,
{{companyName}}
{{companyPhone}}`;

export const DEFAULT_PROFILE_SEND_SETTINGS: ProfileSendSettings = {
  whatsappNumbers: [],
  whatsappMessage: DEFAULT_WHATSAPP_MESSAGE,
  email: {
    to: "",
    cc: "",
    subject: "{{companyName}} — Quotation {{quoteNo}}",
    templateId: DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    intro: DEFAULT_CORPORATE_EMAIL_INTRO,
    closing: DEFAULT_CORPORATE_EMAIL_CLOSING,
    replyTo: "",
    message: `Dear {{customerName}},

Please find our quotation details below:

* Quotation No.: {{quoteNo}}
* Type: {{typeLabel}}
* Date: {{date}}
* Valid Till: {{validTill}}
* Grand Total: ₹{{grandTotal}} ({{grandTotalWords}})

We look forward to your confirmation.

Regards,
{{companyName}}
{{companyPhone}}`,
  },
  googleDrive: {
    folderId: "",
    folderLabel: "",
  },
};

let ready: Promise<void> | null = null;

export async function ensureSendSettingsColumn(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      try {
        await pool.query(`ALTER TABLE business_profiles ADD COLUMN send_settings JSON NULL`);
      } catch (err) {
        const e = err as { code?: string; errno?: number };
        if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  await ready;
}

export function normalizeProfileSendSettings(raw: unknown): ProfileSendSettings {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const email =
    src.email && typeof src.email === "object" ? (src.email as Record<string, unknown>) : {};
  const drive =
    src.googleDrive && typeof src.googleDrive === "object"
      ? (src.googleDrive as Record<string, unknown>)
      : {};
  const numbers = Array.isArray(src.whatsappNumbers) ? src.whatsappNumbers : [];

  return {
    whatsappNumbers: numbers.map((n) => {
      const row = n && typeof n === "object" ? (n as Record<string, unknown>) : {};
      return {
        id: String(row.id ?? Math.random().toString(36).slice(2, 9)),
        label: String(row.label ?? "").trim(),
        phone: String(row.phone ?? "").trim(),
      };
    }),
    whatsappMessage:
      String(src.whatsappMessage ?? DEFAULT_PROFILE_SEND_SETTINGS.whatsappMessage).trim() ||
      DEFAULT_WHATSAPP_MESSAGE,
    email: {
      to: String(email.to ?? DEFAULT_PROFILE_SEND_SETTINGS.email.to).trim(),
      cc: String(email.cc ?? DEFAULT_PROFILE_SEND_SETTINGS.email.cc).trim(),
      subject: String(email.subject ?? DEFAULT_PROFILE_SEND_SETTINGS.email.subject),
      message: String(email.message ?? DEFAULT_PROFILE_SEND_SETTINGS.email.message),
      templateId: normalizeQuotationEmailTemplateId(
        email.templateId ?? DEFAULT_PROFILE_SEND_SETTINGS.email.templateId,
      ),
      intro:
        String(email.intro ?? DEFAULT_PROFILE_SEND_SETTINGS.email.intro).trim() ||
        DEFAULT_CORPORATE_EMAIL_INTRO,
      closing:
        String(email.closing ?? DEFAULT_PROFILE_SEND_SETTINGS.email.closing).trim() ||
        DEFAULT_CORPORATE_EMAIL_CLOSING,
      replyTo: String(email.replyTo ?? DEFAULT_PROFILE_SEND_SETTINGS.email.replyTo).trim(),
    },
    googleDrive: {
      folderId: String(drive.folderId ?? "").trim(),
      folderLabel: String(drive.folderLabel ?? "").trim(),
    },
  };
}

/** Persist-ready payload — drops empty WhatsApp rows. Strips any legacy OAuth secrets. */
export function serializeProfileSendSettings(input: unknown): ProfileSendSettings {
  const normalized = normalizeProfileSendSettings(input);
  return {
    ...normalized,
    whatsappNumbers: normalized.whatsappNumbers.filter((n) => n.phone),
  };
}

/** Alias used by profile GET — same as normalize (no secrets stored anymore). */
export function publicSendSettings(raw: unknown): ProfileSendSettings {
  return normalizeProfileSendSettings(raw);
}

/**
 * When the client saves profile UI fields, keep only folderId/label from Drive
 * (ignore legacy refreshToken if present in DB).
 */
export function mergeSendSettingsPreservingDriveSecrets(
  incoming: unknown,
  _existingRaw: unknown,
): ProfileSendSettings {
  return serializeProfileSendSettings(incoming);
}
