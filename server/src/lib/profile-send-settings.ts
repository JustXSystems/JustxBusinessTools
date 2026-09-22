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
  corporateMessage: string;
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

/** Legacy closing lines right after Regards — upgraded while keeping any following extras. */
const LEGACY_SIG_NAME = /^\{\{\s*companyName\s*\}\}$/;
const LEGACY_SIG_PHONE = /^\{\{\s*companyPhone\s*\}\}$/;
const NEW_SIG_USER = /^\{\{\s*LoggedinUserName\s*\}\}$/;
const NEW_SIG_COMPANY = /^\{\{\s*companyName\s*\}\}$/;
const NEW_SIG_USER_PHONE = /^\{\{\s*LogginUserPhonenumber\s*\}\}$/;
/** Accidental one-line merge from an earlier upgrade. */
const CORRUPT_USER_PHONE = /^\{\{\s*LogginUserPhonenumber\s*\}\}\s*,\s*\{\{\s*companyPhone\s*\}\}$/;

export const DEFAULT_SEND_SIGNATURE = `Regards,
{{LoggedinUserName}}
{{companyName}}
{{LogginUserPhonenumber}}`;

const DEFAULT_SIGNATURE_LINES = [
  "{{LoggedinUserName}}",
  "{{companyName}}",
  "{{LogginUserPhonenumber}}",
];

/**
 * Upgrade only the first three signature lines after Regards / Warm regards.
 * Any extra lines below the phone line are left unchanged.
 */
export function upgradeSendTemplateSignature(template: string): string {
  const eol = template.includes("\r\n") ? "\r\n" : "\n";
  const lines = template.split(/\r?\n/);
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    if (!/^(Warm\s+)?Regards,\s*$/i.test(lines[i].trim())) continue;

    const a = (lines[i + 1] ?? "").trim();
    const b = (lines[i + 2] ?? "").trim();
    const c = (lines[i + 3] ?? "").trim();

    // Already on the new 3-line shape.
    if (NEW_SIG_USER.test(a) && NEW_SIG_COMPANY.test(b) && NEW_SIG_USER_PHONE.test(c)) {
      continue;
    }

    // Fix corrupt "{{LogginUserPhonenumber}}, {{companyPhone}}" on one line.
    if (NEW_SIG_USER.test(a) && NEW_SIG_COMPANY.test(b) && CORRUPT_USER_PHONE.test(c)) {
      lines[i + 3] = "{{LogginUserPhonenumber}}";
      changed = true;
      continue;
    }

    // Legacy: Regards + companyName + companyPhone (+ optional extras after).
    if (LEGACY_SIG_NAME.test(a) && LEGACY_SIG_PHONE.test(b)) {
      lines.splice(i + 1, 2, ...DEFAULT_SIGNATURE_LINES);
      changed = true;
      i += 3;
      continue;
    }
  }

  return changed ? lines.join(eol) : template;
}

export const DEFAULT_WHATSAPP_MESSAGE = `Hi {{customerName}},

Please find our quotation details:

• Quotation No.: {{quoteNo}}
• Type: {{typeLabel}}
• Date: {{date}}
• Valid Till: {{validTill}}
• Grand Total: ₹{{grandTotal}} ({{grandTotalWords}})

I am attaching the PDF quotation. Please review and confirm.

${DEFAULT_SEND_SIGNATURE}`;

export const DEFAULT_PROFILE_SEND_SETTINGS: ProfileSendSettings = {
  whatsappNumbers: [],
  whatsappMessage: DEFAULT_WHATSAPP_MESSAGE,
  email: {
    to: "",
    cc: "",
    subject: "{{companyName}} — Quotation {{quoteNo}}",
    templateId: DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    corporateMessage: "",
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

${DEFAULT_SEND_SIGNATURE}`,
  },
  googleDrive: {
    folderId: "",
    folderLabel: "",
  },
};

let ready: Promise<void> | null = null;
let signatureMigration: Promise<void> | null = null;

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

function rawTemplateMessages(raw: unknown): { whatsappMessage: string; emailMessage: string } {
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
  return {
    whatsappMessage: String(src.whatsappMessage ?? ""),
    emailMessage: String(email.message ?? ""),
  };
}

/**
 * Persist signature upgrades (WhatsApp + email message) for every business profile.
 * Only rewrites rows whose Regards block still uses the legacy companyName/companyPhone pair.
 */
export async function migrateAllProfileSendSignatures(): Promise<void> {
  if (!signatureMigration) {
    signatureMigration = (async () => {
      await ensureSendSettingsColumn();
      const [rows] = await pool.query(`SELECT id, send_settings FROM business_profiles`);
      const list = Array.isArray(rows) ? (rows as Array<{ id: number; send_settings: unknown }>) : [];
      for (const row of list) {
        if (row.send_settings == null || String(row.send_settings).trim() === "") continue;
        const before = rawTemplateMessages(row.send_settings);
        if (!before.whatsappMessage && !before.emailMessage) continue;
        const afterWa = upgradeSendTemplateSignature(before.whatsappMessage);
        const afterEmail = upgradeSendTemplateSignature(before.emailMessage);
        if (afterWa === before.whatsappMessage && afterEmail === before.emailMessage) continue;
        const normalized = serializeProfileSendSettings(row.send_settings);
        await pool.query(`UPDATE business_profiles SET send_settings = :send WHERE id = :id`, {
          id: row.id,
          send: JSON.stringify(normalized),
        });
      }
    })().catch((err) => {
      signatureMigration = null;
      throw err;
    });
  }
  await signatureMigration;
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
    whatsappMessage: upgradeSendTemplateSignature(
      String(src.whatsappMessage ?? DEFAULT_PROFILE_SEND_SETTINGS.whatsappMessage).trim() ||
        DEFAULT_WHATSAPP_MESSAGE,
    ),
    email: {
      to: String(email.to ?? DEFAULT_PROFILE_SEND_SETTINGS.email.to).trim(),
      cc: String(email.cc ?? DEFAULT_PROFILE_SEND_SETTINGS.email.cc).trim(),
      subject: String(email.subject ?? DEFAULT_PROFILE_SEND_SETTINGS.email.subject),
      message: upgradeSendTemplateSignature(
        String(email.message ?? DEFAULT_PROFILE_SEND_SETTINGS.email.message),
      ),
      templateId: normalizeQuotationEmailTemplateId(
        email.templateId ?? DEFAULT_PROFILE_SEND_SETTINGS.email.templateId,
      ),
      corporateMessage: String(email.corporateMessage ?? "").trim(),
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
