/** Quotation sheet sign-off footer — Business Profile setting. */

export const DOCUMENT_FOOTER_TEMPLATES = [
  "classic",
  "contact-card",
  "sender-signs",
  "contact-strip",
] as const;

export type DocumentFooterTemplate = (typeof DOCUMENT_FOOTER_TEMPLATES)[number];

export type DocumentFooterSettings = {
  template: DocumentFooterTemplate;
  /** Heading over the sender's details (contact card and strip). */
  contactHeading: string;
  showPhone: boolean;
  showEmail: boolean;
  /** "For any queries, please contact" names the sender instead of the company phone and email. */
  queriesToSender: boolean;
  signatoryLabel: string;
};

export const DOCUMENT_FOOTER_TEMPLATE_OPTIONS: Array<{
  id: DocumentFooterTemplate;
  label: string;
  hint: string;
}> = [
  {
    id: "classic",
    label: "Classic",
    hint: "Date, place and company signatory. No employee details.",
  },
  {
    id: "contact-card",
    label: "Contact card",
    hint: "A card between date and signatory with the employee's name, mobile and email.",
  },
  {
    id: "sender-signs",
    label: "Sender signs",
    hint: "The employee signs for the company, with their mobile and email under the name.",
  },
  {
    id: "contact-strip",
    label: "Contact strip",
    hint: "A slim accent band above the classic sign-off with the employee's details.",
  },
];

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
  const src = obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
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

/** Every template except Classic prints the sender's (Prepared by) details. */
export function footerShowsSender(settings: DocumentFooterSettings): boolean {
  return settings.template !== "classic";
}
