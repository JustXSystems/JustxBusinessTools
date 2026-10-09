import { pool } from "../db.js";

/** Quotation sheet sign-off footer; mirrors web/lib/document-footer.ts. */
export const DOCUMENT_FOOTER_TEMPLATES = [
  "classic",
  "contact-card",
  "sender-signs",
  "contact-strip",
] as const;

export type DocumentFooterTemplate = (typeof DOCUMENT_FOOTER_TEMPLATES)[number];

export type DocumentFooterSettings = {
  template: DocumentFooterTemplate;
  contactHeading: string;
  showPhone: boolean;
  showEmail: boolean;
  queriesToSender: boolean;
  signatoryLabel: string;
};

export const DEFAULT_DOCUMENT_FOOTER: DocumentFooterSettings = {
  template: "classic",
  contactHeading: "Your point of contact",
  showPhone: true,
  showEmail: true,
  queriesToSender: true,
  signatoryLabel: "Authorized Signatory",
};

const MAX_LABEL_CHARS = 60;

function label(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.trim().slice(0, MAX_LABEL_CHARS) : "";
  return s || fallback;
}

export function normalizeDocumentFooter(raw: unknown): DocumentFooterSettings {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  const src =
    obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
  const template = DOCUMENT_FOOTER_TEMPLATES.includes(src.template as DocumentFooterTemplate)
    ? (src.template as DocumentFooterTemplate)
    : DEFAULT_DOCUMENT_FOOTER.template;
  return {
    template,
    contactHeading: label(src.contactHeading, DEFAULT_DOCUMENT_FOOTER.contactHeading),
    showPhone: src.showPhone !== false,
    showEmail: src.showEmail !== false,
    queriesToSender: src.queriesToSender !== false,
    signatoryLabel: label(src.signatoryLabel, DEFAULT_DOCUMENT_FOOTER.signatoryLabel),
  };
}

let ready: Promise<void> | null = null;

/** Ensures `business_profiles.document_footer` (JSON). */
export function ensureDocumentFooterColumn(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      try {
        await pool.query(`ALTER TABLE business_profiles ADD COLUMN document_footer JSON NULL`);
      } catch (err) {
        const e = err as { code?: string; errno?: number };
        if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
