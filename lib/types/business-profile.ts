export type BusinessProfileSendSettings = {
  whatsappNumbers: Array<{ id: string; label: string; phone: string }>;
  /** WhatsApp chat text template (supports {{placeholders}}). */
  whatsappMessage: string;
  email: {
    to: string;
    cc: string;
    subject: string;
    message: string;
  };
  googleDrive: {
    folderId: string;
    folderLabel: string;
  };
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

export const DEFAULT_SEND_SETTINGS: BusinessProfileSendSettings = {
  whatsappNumbers: [],
  whatsappMessage: DEFAULT_WHATSAPP_MESSAGE,
  email: {
    to: "",
    cc: "",
    subject: "{{companyName}} — Quotation {{quoteNo}}",
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
  /** Tools shown on home. null = all tools (legacy profiles). */
  homeToolIds: string[] | null;
  /** Profile-level WhatsApp / Email / Google Drive defaults for all tools. */
  sendSettings: BusinessProfileSendSettings;
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
  homeToolIds: null,
  sendSettings: {
    ...DEFAULT_SEND_SETTINGS,
    whatsappMessage: DEFAULT_SEND_SETTINGS.whatsappMessage,
    email: { ...DEFAULT_SEND_SETTINGS.email },
    googleDrive: { ...DEFAULT_SEND_SETTINGS.googleDrive },
  },
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
      String(
        (src as { whatsappMessage?: string }).whatsappMessage ?? DEFAULT_SEND_SETTINGS.whatsappMessage,
      ).trim() || DEFAULT_WHATSAPP_MESSAGE,
    email: {
      to: String(emailRaw.to ?? DEFAULT_SEND_SETTINGS.email.to).trim(),
      cc: String(emailRaw.cc ?? DEFAULT_SEND_SETTINGS.email.cc).trim(),
      subject: String(emailRaw.subject ?? DEFAULT_SEND_SETTINGS.email.subject),
      message: String(emailRaw.message ?? DEFAULT_SEND_SETTINGS.email.message),
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
