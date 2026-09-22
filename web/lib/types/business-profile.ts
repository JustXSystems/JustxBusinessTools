import type { QuotationEmailTemplateId } from "@/lib/quotation-email-templates";
import {
  corporateMessageFromLegacyParts,
  DEFAULT_CORPORATE_EMAIL_CLOSING,
  DEFAULT_CORPORATE_EMAIL_INTRO,
  DEFAULT_CORPORATE_EMAIL_MESSAGE,
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  normalizeQuotationEmailTemplateId,
} from "@/lib/quotation-email-templates";
import {
  DEFAULT_CLOCK_DISPLAY_FORMAT,
  DEFAULT_CLOCK_DISPLAY_VISIBLE,
  normalizeClockDisplaySettings,
  type ClockDisplaySettings,
} from "@/lib/clock-display";
import {
  DEFAULT_FLASH_ERROR_SECONDS,
  DEFAULT_FLASH_OK_SECONDS,
  normalizeFlashDisplaySettings,
  type FlashDisplaySettings,
} from "@/lib/flash-display";

export type BusinessProfileSendSettings = {
  whatsappNumbers: Array<{ id: string; label: string; phone: string }>;
  /** WhatsApp chat text template (supports {{placeholders}}). */
  whatsappMessage: string;
  email: {
    to: string;
    cc: string;
    subject: string;
    message: string;
    /**
     * Outbound email format for all tools (Send Via → Email).
     * `corporate` = HTML + text; `plain` = text-only.
     */
    templateId: QuotationEmailTemplateId;
    /**
     * Corporate HTML message template ({{placeholders}} + optional
     * {{quoteSummaryBlock}}, {{lineItemsBlock}}, {{quoteLinkBlock}}).
     */
    corporateMessage: string;
    /** @deprecated Migrated into corporateMessage — kept for stored JSON compat. */
    intro: string;
    /** @deprecated Migrated into corporateMessage — kept for stored JSON compat. */
    closing: string;
    /**
     * Reply-To for webhook delivery. Blank = company sales/email.
     * Plain addresses only (comma-separated ok).
     */
    replyTo: string;
  };
  googleDrive: {
    folderId: string;
    folderLabel: string;
  };
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

export const DEFAULT_SEND_SETTINGS: BusinessProfileSendSettings = {
  whatsappNumbers: [],
  whatsappMessage: DEFAULT_WHATSAPP_MESSAGE,
  email: {
    to: "",
    cc: "",
    subject: "{{companyName}} — Quotation {{quoteNo}}",
    templateId: DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    corporateMessage: DEFAULT_CORPORATE_EMAIL_MESSAGE,
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

export type BusinessProfile = {
  id: number;
  logo: string | null;
  businessName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankUpi: string | null;
  terms: string | null;
  /**
   * Accent used on tool document previews and generated PDFs
   * (quote-sheet headings, borders, table headers, site-survey report, etc.).
   * `#rrggbb`; defaults to quotation teal `#0f3d3e`.
   */
  documentAccentColor: string;
  /**
   * UI theme override for this Business Profile.
   * `null` = inherit Admin (organization) active theme.
   * Otherwise a built-in preset name, or `saved:{orgThemeId}` for a saved org theme.
   */
  themePreset: string | null;
  /** Built-in presets (from GET /profile). */
  themePresets?: Array<{ name: string; tokens: Record<string, string> }>;
  /** Saved organization themes available as overrides. */
  orgThemes?: Array<{
    id: number;
    name: string;
    isActive: boolean;
    key: string;
    tokens?: Record<string, string>;
  }>;
  /** Admin-active organization theme tokens (for “Org default” preview). */
  organizationTheme?: Record<string, string> | null;
  /**
   * Footer chrome: live date/time next to Powered by.
   * Owner/Admin toggles visibility and picks a format (IST).
   */
  clockDisplay: ClockDisplaySettings;
  /**
   * How long top-right error/success banners stay visible (seconds).
   * Staff can always Close early.
   */
  flashDisplay: FlashDisplaySettings;
  /** Tools shown on home. null = all tools (legacy profiles). */
  homeToolIds: string[] | null;
  /** Profile-level WhatsApp / Email / Google Drive defaults for all tools. */
  sendSettings: BusinessProfileSendSettings;
  /**
   * Target folder for tool artifacts (UNC or absolute path).
   * Written by desktop sync agent / File System Access — not by the SaaS server.
   */
  downloadFolder: string | null;
  /** How company delivery handles an existing file with the same name (Drive revisions / UNC / FSA). */
  downloadFolderConflictPolicy: "rename" | "skip" | "overwrite";
  /**
   * Automatic delivery mode (cloud-first).
   * `auto` picks Google Drive → webhook → UNC agent based on what is configured.
   */
  artifactDestination: "auto" | "google_drive" | "webhook" | "unc_agent" | "none";
  /** Corporate webhook (Power Automate / n8n / SharePoint flow) for **PDF file** delivery. */
  artifactWebhookUrl: string | null;
  artifactWebhookSecretConfigured?: boolean;
  /**
   * Quotation **email** webhook (Path A) for this Business Profile / company.
   * Per-GSTIN Power Automate / n8n URL — not the same as artifactWebhookUrl.
   * Falls back to Admin → Integrations / EMAIL_WEBHOOK_URL when empty.
   */
  emailWebhookUrl: string | null;
  delivery?: {
    artifactDestination: string;
    effectiveDestination: string;
    automationReady: boolean;
    googleDrive: {
      folderId: string;
      folderLabel: string;
      serverConfigured: boolean;
      serviceAccountEmail: string | null;
    };
    webhook: { url: string | null; secretConfigured: boolean };
  } | null;
};

export const EMPTY_PROFILE: BusinessProfile = {
  id: 1,
  logo: null,
  businessName: "",
  addressLine1: null,
  addressLine2: null,
  gstin: null,
  pan: null,
  state: null,
  stateCode: null,
  phone: null,
  email: null,
  bankName: null,
  bankBranch: null,
  bankAccount: null,
  bankIfsc: null,
  bankUpi: null,
  terms: null,
  documentAccentColor: "#0f3d3e",
  themePreset: null,
  themePresets: [],
  orgThemes: [],
  organizationTheme: null,
  clockDisplay: {
    visible: DEFAULT_CLOCK_DISPLAY_VISIBLE,
    format: DEFAULT_CLOCK_DISPLAY_FORMAT,
  },
  flashDisplay: {
    errorSeconds: DEFAULT_FLASH_ERROR_SECONDS,
    okSeconds: DEFAULT_FLASH_OK_SECONDS,
  },
  homeToolIds: null,
  sendSettings: {
    ...DEFAULT_SEND_SETTINGS,
    whatsappMessage: DEFAULT_SEND_SETTINGS.whatsappMessage,
    email: { ...DEFAULT_SEND_SETTINGS.email },
    googleDrive: { ...DEFAULT_SEND_SETTINGS.googleDrive },
  },
  downloadFolder: null,
  downloadFolderConflictPolicy: "overwrite",
  artifactDestination: "auto",
  artifactWebhookUrl: null,
  artifactWebhookSecretConfigured: false,
  emailWebhookUrl: null,
  delivery: null,
};

export function normalizeSendSettings(
  send: Partial<BusinessProfileSendSettings> | null | undefined,
): BusinessProfileSendSettings {
  const src = send && typeof send === "object" ? send : {};
  const emailRaw =
    src.email && typeof src.email === "object"
      ? (src.email as Partial<BusinessProfileSendSettings["email"]>)
      : {};
  const driveRaw =
    src.googleDrive && typeof src.googleDrive === "object"
      ? (src.googleDrive as Partial<BusinessProfileSendSettings["googleDrive"]>)
      : {};
  const numbers = Array.isArray(src.whatsappNumbers) ? src.whatsappNumbers : [];
  return {
    whatsappNumbers: numbers.map((n) => ({
      id: String((n as { id?: string }).id ?? Math.random().toString(36).slice(2, 9)),
      label: String((n as { label?: string }).label ?? "").trim(),
      phone: String((n as { phone?: string }).phone ?? "").trim(),
    })),
    whatsappMessage:
      upgradeSendTemplateSignature(
        String(
          (src as { whatsappMessage?: string }).whatsappMessage ??
            DEFAULT_SEND_SETTINGS.whatsappMessage,
        ).trim() || DEFAULT_WHATSAPP_MESSAGE,
      ),
    email: {
      to: String(emailRaw.to ?? DEFAULT_SEND_SETTINGS.email.to).trim(),
      cc: String(emailRaw.cc ?? DEFAULT_SEND_SETTINGS.email.cc).trim(),
      subject: String(emailRaw.subject ?? DEFAULT_SEND_SETTINGS.email.subject),
      message: upgradeSendTemplateSignature(
        String(emailRaw.message ?? DEFAULT_SEND_SETTINGS.email.message),
      ),
      templateId: normalizeQuotationEmailTemplateId(
        emailRaw.templateId ?? DEFAULT_SEND_SETTINGS.email.templateId,
      ),
      corporateMessage: resolveCorporateEmailMessage({
        corporateMessage: String(emailRaw.corporateMessage ?? "").trim(),
        intro: String(emailRaw.intro ?? DEFAULT_SEND_SETTINGS.email.intro),
        closing: String(emailRaw.closing ?? DEFAULT_SEND_SETTINGS.email.closing),
      }),
      intro:
        String(emailRaw.intro ?? DEFAULT_SEND_SETTINGS.email.intro).trim() ||
        DEFAULT_CORPORATE_EMAIL_INTRO,
      closing:
        String(emailRaw.closing ?? DEFAULT_SEND_SETTINGS.email.closing).trim() ||
        DEFAULT_CORPORATE_EMAIL_CLOSING,
      replyTo: String(emailRaw.replyTo ?? DEFAULT_SEND_SETTINGS.email.replyTo).trim(),
    },
    googleDrive: {
      folderId: String(driveRaw.folderId ?? "").trim(),
      folderLabel: String(driveRaw.folderLabel ?? "").trim(),
    },
  };
}

export function fillSendTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

/** Effective corporate message template (new field or legacy intro/closing). */
export function resolveCorporateEmailMessage(parts: {
  corporateMessage?: string;
  intro?: string;
  closing?: string;
}): string {
  const direct = String(parts.corporateMessage ?? "").trim();
  if (direct) return direct;
  return corporateMessageFromLegacyParts(
    String(parts.intro ?? DEFAULT_CORPORATE_EMAIL_INTRO),
    String(parts.closing ?? DEFAULT_CORPORATE_EMAIL_CLOSING),
  );
}

export function extractDriveFolderId(raw: string) {
  const v = raw.trim();
  const m = v.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return v.replace(/\?.*$/, "").trim();
}

export const INDIAN_STATES: Array<[string, string]> = [
  ["Jammu and Kashmir", "01"], ["Himachal Pradesh", "02"], ["Punjab", "03"], ["Chandigarh", "04"],
  ["Uttarakhand", "05"], ["Haryana", "06"], ["Delhi", "07"], ["Rajasthan", "08"], ["Uttar Pradesh", "09"],
  ["Bihar", "10"], ["Sikkim", "11"], ["Arunachal Pradesh", "12"], ["Nagaland", "13"], ["Manipur", "14"],
  ["Mizoram", "15"], ["Tripura", "16"], ["Meghalaya", "17"], ["Assam", "18"], ["West Bengal", "19"],
  ["Jharkhand", "20"], ["Odisha", "21"], ["Chhattisgarh", "22"], ["Madhya Pradesh", "23"], ["Gujarat", "24"],
  ["Daman and Diu", "25"], ["Dadra and Nagar Haveli", "26"], ["Maharashtra", "27"], ["Andhra Pradesh", "28"],
  ["Karnataka", "29"], ["Goa", "30"], ["Lakshadweep", "31"], ["Kerala", "32"], ["Tamil Nadu", "33"],
  ["Puducherry", "34"], ["Andaman and Nicobar Islands", "35"], ["Telangana", "36"], ["Andhra Pradesh (New)", "37"],
  ["Ladakh", "38"],
];
