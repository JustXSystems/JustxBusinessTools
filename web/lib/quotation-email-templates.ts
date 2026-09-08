/**
 * Quotation outbound email layouts — Business Profile chooses a template;
 * corporate layout follows the profile Document accent color.
 */

import {
  hexToRgbTuple,
  normalizeDocumentAccentColor,
} from "@/lib/document-accent";

export type QuotationEmailTemplateId = "plain" | "corporate";

export type QuotationEmailTemplateMeta = {
  id: QuotationEmailTemplateId;
  label: string;
  description: string;
};

export const QUOTATION_EMAIL_TEMPLATES: QuotationEmailTemplateMeta[] = [
  {
    id: "plain",
    label: "Plain text",
    description: "Classic text-only message (best for mailto / mail apps).",
  },
  {
    id: "corporate",
    label: "Corporate HTML",
    description: "Branded card layout using your Document accent color (webhook delivery).",
  },
];

export const DEFAULT_QUOTATION_EMAIL_TEMPLATE: QuotationEmailTemplateId = "corporate";

export const DEFAULT_CORPORATE_EMAIL_INTRO =
  "Greetings from {{companyName}}. Thank you for your interest in our products and services. We appreciate the opportunity and are pleased to share your quotation summary below.";

export const DEFAULT_CORPORATE_EMAIL_CLOSING =
  "Should you have any questions or require modifications, please feel free to reach out — we would be happy to assist. We look forward to your confirmation and to the opportunity of working together.";

/** Max line items shown in the corporate email mini-table. */
export const QUOTATION_EMAIL_LINE_ITEM_LIMIT = 5;

export function normalizeQuotationEmailTemplateId(raw: unknown): QuotationEmailTemplateId {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "plain") return "plain";
  if (v === "corporate") return "corporate";
  return DEFAULT_QUOTATION_EMAIL_TEMPLATE;
}

export type QuotationEmailLineItem = {
  desc: string;
  qty: string;
  amount: string;
};

export type QuotationEmailVars = {
  customerName: string;
  quoteNo: string;
  typeLabel: string;
  date: string;
  validTill: string;
  grandTotal: string;
  grandTotalWords: string;
  companyName: string;
  companyPhone: string;
  companyEmail?: string;
  companyAddress?: string;
  companyGstin?: string;
  quoteLink?: string;
  /** Absolute https logo URL only — data URLs are skipped (blocked by many clients). */
  logoUrl?: string;
  accentColor?: string;
  /** Filled intro (placeholders already applied). */
  intro?: string;
  /** Filled closing (placeholders already applied). */
  closing?: string;
  lineItems?: QuotationEmailLineItem[];
  /** Count of items not shown in the mini-table. */
  moreItemsCount?: number;
};

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function mixToward(
  rgb: [number, number, number],
  target: [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    clampByte(rgb[0] + (target[0] - rgb[0]) * amount),
    clampByte(rgb[1] + (target[1] - rgb[1]) * amount),
    clampByte(rgb[2] + (target[2] - rgb[2]) * amount),
  ];
}

function rgbToHex(rgb: [number, number, number]) {
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance 0–1 (WCAG). */
function luminance(rgb: [number, number, number]) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function emailAccentPalette(raw: unknown) {
  const accent = normalizeDocumentAccentColor(raw);
  const deep = hexToRgbTuple(accent) ?? [15, 61, 62];
  // Darken pale brand colors so header/CTA keep readable contrast in light + dark clients.
  let usableDeep = deep;
  if (luminance(usableDeep) > 0.55) {
    usableDeep = mixToward(usableDeep, [0, 0, 0], 0.55);
  }
  if (luminance(usableDeep) > 0.55) {
    usableDeep = mixToward(usableDeep, [0, 0, 0], 0.4);
  }
  const usableAccent = rgbToHex(usableDeep);
  const soft = mixToward(usableDeep, [255, 255, 255], 0.92);
  const muted = mixToward(usableDeep, [255, 255, 255], 0.55);
  const border = mixToward(usableDeep, [255, 255, 255], 0.82);
  const onAccent = luminance(usableDeep) > 0.55 ? "#1a1a1a" : "#ffffff";
  return {
    accent: usableAccent,
    soft: rgbToHex(soft),
    muted: rgbToHex(muted),
    border: rgbToHex(border),
    onAccent,
    validTill: "#b42318",
  };
}

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape plain text and turn newlines into `<br />` for email HTML. */
export function formatEmailParagraphs(text: string): string {
  return escapeHtml(String(text ?? "").trim()).replace(/\r\n|\r|\n/g, "<br />");
}

/** Only absolute http(s) logos — skip data: and relative paths. */
export function safeEmailLogoUrl(raw: string | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return "";
}

export function summarizeQuoteLineItems(
  items: Array<{ desc?: string; qty?: number | string; rate?: number | string; discount?: number | string }>,
  limit = QUOTATION_EMAIL_LINE_ITEM_LIMIT,
): { lineItems: QuotationEmailLineItem[]; moreItemsCount: number } {
  const cleaned = (Array.isArray(items) ? items : [])
    .map((it) => {
      const qty = Number(it.qty) || 0;
      const rate = Number(it.rate) || 0;
      const discPct = Number(it.discount) || 0;
      const gross = qty * rate;
      const net = gross - (gross * discPct) / 100;
      const desc = String(it.desc ?? "").trim() || "Item";
      return {
        desc,
        qty: String(qty || "—"),
        amount: net.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      };
    })
    .filter((it) => it.desc);
  return {
    lineItems: cleaned.slice(0, Math.max(0, limit)),
    moreItemsCount: Math.max(0, cleaned.length - Math.max(0, limit)),
  };
}

function defaultIntro(vars: QuotationEmailVars) {
  return (
    vars.intro?.trim() ||
    `Greetings from ${vars.companyName || "us"}. Thank you for your interest in our products and services. We appreciate the opportunity and are pleased to share your quotation summary below.`
  );
}

function defaultClosing(vars: QuotationEmailVars) {
  return (
    vars.closing?.trim() ||
    "Should you have any questions or require modifications, please feel free to reach out — we would be happy to assist. We look forward to your confirmation and to the opportunity of working together."
  );
}

/** Plain-text body matching the corporate summary (mailto / multipart text part). */
export function renderPlainQuotationEmail(vars: QuotationEmailVars): string {
  const lines = [
    `Dear ${vars.customerName || "Customer"},`,
    "",
    defaultIntro(vars),
    "",
    `Quotation No.: ${vars.quoteNo}`,
    `Type: ${vars.typeLabel}`,
    `Date: ${vars.date}`,
    `Valid Till: ${vars.validTill}`,
    `Grand Total: ₹${vars.grandTotal} (${vars.grandTotalWords})`,
    "",
  ];
  const items = vars.lineItems ?? [];
  if (items.length) {
    lines.push("Items:");
    for (const it of items) {
      lines.push(`• ${it.desc} — qty ${it.qty} — ₹${it.amount}`);
    }
    if (vars.moreItemsCount && vars.moreItemsCount > 0) {
      lines.push(`• …and ${vars.moreItemsCount} more`);
    }
    lines.push("");
  }
  if (vars.quoteLink) {
    lines.push(`View full quotation: ${vars.quoteLink}`, "");
  }
  lines.push(defaultClosing(vars), "", "Warm regards,", vars.companyName || "");
  if (vars.companyPhone) lines.push(`Phone: ${vars.companyPhone}`);
  if (vars.companyEmail) lines.push(`Email: ${vars.companyEmail}`);
  if (vars.companyGstin) lines.push(`GSTIN: ${vars.companyGstin}`);
  if (vars.companyAddress) lines.push(vars.companyAddress);
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

/**
 * Corporate HTML email — table-based, inline CSS, themed from Document accent.
 * Suitable for SendGrid / n8n / Power Automate webhooks that accept `html`.
 */
export function renderCorporateQuotationEmailHtml(vars: QuotationEmailVars): string {
  const p = emailAccentPalette(vars.accentColor);
  const companyName = escapeHtml(vars.companyName || "Company");
  const customerName = escapeHtml(vars.customerName || "Customer");
  const quoteNo = escapeHtml(vars.quoteNo || "—");
  const typeLabel = escapeHtml(vars.typeLabel || "—");
  const date = escapeHtml(vars.date || "—");
  const validTill = escapeHtml(vars.validTill || "—");
  const grandTotal = escapeHtml(vars.grandTotal || "0.00");
  const grandTotalWords = escapeHtml(vars.grandTotalWords || "");
  const phone = escapeHtml(vars.companyPhone || "");
  const email = escapeHtml(vars.companyEmail || "");
  const address = escapeHtml(vars.companyAddress || "");
  const gstin = escapeHtml(vars.companyGstin || "");
  const quoteLink = String(vars.quoteLink ?? "").trim();
  const logoUrl = safeEmailLogoUrl(vars.logoUrl);
  const introHtml = formatEmailParagraphs(defaultIntro(vars));
  const closingHtml = formatEmailParagraphs(defaultClosing(vars));

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${companyName}" width="140" style="display:block; max-width:140px; max-height:48px; height:auto; border:0;" />`
    : `<span style="color:${p.onAccent}; font-size:20px; font-weight:700; letter-spacing:0.3px; font-family:Arial, Helvetica, sans-serif;">${companyName}</span>`;

  const lineItems = vars.lineItems ?? [];
  const more = Math.max(0, Number(vars.moreItemsCount) || 0);
  let lineItemsBlock = "";
  if (lineItems.length) {
    const rows = lineItems
      .map(
        (it, idx) => `<tr>
                  <td style="padding:10px 12px; border-bottom:1px solid #eef0f3; font-size:13px; color:#111827; font-family:Arial, Helvetica, sans-serif;">${escapeHtml(it.desc)}</td>
                  <td style="padding:10px 12px; border-bottom:1px solid #eef0f3; font-size:13px; color:#6b7280; text-align:center; font-family:Arial, Helvetica, sans-serif; white-space:nowrap;">${escapeHtml(it.qty)}</td>
                  <td style="padding:10px 12px; border-bottom:1px solid #eef0f3; font-size:13px; color:#111827; text-align:right; font-family:Arial, Helvetica, sans-serif; white-space:nowrap;">&#8377;${escapeHtml(it.amount)}</td>
                </tr>${idx === lineItems.length - 1 && more > 0 ? "" : ""}`,
      )
      .join("");
    const moreRow =
      more > 0
        ? `<tr>
                  <td colspan="3" style="padding:10px 12px; font-size:12px; color:#6b7280; font-family:Arial, Helvetica, sans-serif; font-style:italic;">
                    …and ${more} more item${more === 1 ? "" : "s"} on the full quotation
                  </td>
                </tr>`
        : "";
    lineItemsBlock = `<tr>
            <td style="padding:8px 40px 4px 40px;">
              <p style="font-size:12px; color:#6b7280; margin:0 0 8px 0; font-family:Arial, Helvetica, sans-serif; text-transform:uppercase; letter-spacing:0.4px; font-weight:700;">Line items</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${p.border};">
                <tr>
                  <td style="padding:8px 12px; background-color:${p.soft}; font-size:11px; color:${p.accent}; font-weight:700; font-family:Arial, Helvetica, sans-serif;">Description</td>
                  <td style="padding:8px 12px; background-color:${p.soft}; font-size:11px; color:${p.accent}; font-weight:700; text-align:center; font-family:Arial, Helvetica, sans-serif;">Qty</td>
                  <td style="padding:8px 12px; background-color:${p.soft}; font-size:11px; color:${p.accent}; font-weight:700; text-align:right; font-family:Arial, Helvetica, sans-serif;">Amount</td>
                </tr>
                ${rows}
                ${moreRow}
              </table>
            </td>
          </tr>`;
  }

  const ctaBlock = quoteLink
    ? `<tr>
              <td style="padding:12px 40px 28px 40px;" align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="${p.accent}" style="border-radius:4px;">
                      <a href="${escapeHtml(quoteLink)}" target="_blank" style="display:inline-block; background-color:${p.accent}; color:${p.onAccent}; text-decoration:none; font-size:14px; font-weight:700; font-family:Arial, Helvetica, sans-serif; padding:14px 36px; border-radius:4px; mso-padding-alt:0;">
                        <!--[if mso]><i style="letter-spacing:36px; mso-font-width:-100%; mso-text-raise:21pt;">&nbsp;</i><![endif]-->
                        <span style="mso-text-raise:10pt;">View Full Quotation</span>
                        <!--[if mso]><i style="letter-spacing:36px; mso-font-width:-100%;">&nbsp;</i><![endif]-->
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="font-size:12px; color:#8a8f98; margin:12px 0 0 0; font-family:Arial, Helvetica, sans-serif;">
                  Or open: <a href="${escapeHtml(quoteLink)}" style="color:${p.accent}; word-break:break-all;">${escapeHtml(quoteLink)}</a>
                </p>
              </td>
            </tr>`
    : `<tr>
              <td style="padding:0 40px 28px 40px;">
                <p style="font-size:13px; color:#6b7280; margin:0; font-family:Arial, Helvetica, sans-serif; line-height:1.5;">
                  The full quotation PDF is attached to this email for your review.
                </p>
              </td>
            </tr>`;

  const contactLines: string[] = [];
  if (phone) contactLines.push(`Tel: ${phone}`);
  if (email) contactLines.push(`Email: ${email}`);

  const footerBits: string[] = [];
  if (gstin) footerBits.push(`GSTIN: ${gstin}`);
  if (address) footerBits.push(address);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>Quotation — ${companyName}</title>
<!--[if mso]>
<noscript>
<xml>
  <o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#f0f2f5; font-family:Arial, Helvetica, sans-serif; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
    Your quotation ${quoteNo} from ${companyName} is ready for review.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f2f5;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border:1px solid #e5e7eb;">

          <tr>
            <td style="height:4px; line-height:4px; font-size:0; background-color:${p.accent};">&nbsp;</td>
          </tr>

          <tr>
            <td style="background-color:${p.accent}; padding:24px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" style="padding:0;">
                    ${logoBlock}
                  </td>
                  <td valign="middle" align="right" style="padding:0 0 0 16px;">
                    <span style="display:inline-block; color:${p.muted}; font-size:11px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; font-family:Arial, Helvetica, sans-serif;">
                      Quotation
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <p style="font-size:15px; color:#1f2937; margin:0 0 16px 0; font-family:Arial, Helvetica, sans-serif; line-height:1.5;">
                Dear <strong style="color:#111827;">${customerName}</strong>,
              </p>
              <p style="font-size:15px; color:#374151; line-height:1.65; margin:0; font-family:Arial, Helvetica, sans-serif;">
                ${introHtml}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${p.border};">
                <tr>
                  <td style="padding:14px 20px; border-bottom:1px solid #eef0f3; font-size:12px; color:#6b7280; font-family:Arial, Helvetica, sans-serif; text-transform:uppercase; letter-spacing:0.4px;">Quotation No.</td>
                  <td style="padding:14px 20px; border-bottom:1px solid #eef0f3; font-size:14px; color:#111827; font-weight:700; text-align:right; font-family:Arial, Helvetica, sans-serif;">${quoteNo}</td>
                </tr>
                <tr>
                  <td style="padding:14px 20px; border-bottom:1px solid #eef0f3; font-size:12px; color:#6b7280; font-family:Arial, Helvetica, sans-serif; text-transform:uppercase; letter-spacing:0.4px;">Type</td>
                  <td style="padding:14px 20px; border-bottom:1px solid #eef0f3; font-size:14px; color:#111827; text-align:right; font-family:Arial, Helvetica, sans-serif;">${typeLabel}</td>
                </tr>
                <tr>
                  <td style="padding:14px 20px; border-bottom:1px solid #eef0f3; font-size:12px; color:#6b7280; font-family:Arial, Helvetica, sans-serif; text-transform:uppercase; letter-spacing:0.4px;">Date</td>
                  <td style="padding:14px 20px; border-bottom:1px solid #eef0f3; font-size:14px; color:#111827; text-align:right; font-family:Arial, Helvetica, sans-serif;">${date}</td>
                </tr>
                <tr>
                  <td style="padding:14px 20px; border-bottom:1px solid #eef0f3; font-size:12px; color:#6b7280; font-family:Arial, Helvetica, sans-serif; text-transform:uppercase; letter-spacing:0.4px;">Valid Till</td>
                  <td style="padding:14px 20px; border-bottom:1px solid #eef0f3; font-size:14px; color:${p.validTill}; font-weight:700; text-align:right; font-family:Arial, Helvetica, sans-serif;">${validTill}</td>
                </tr>
                <tr>
                  <td style="padding:16px 20px; background-color:${p.soft}; font-size:12px; color:${p.accent}; font-weight:700; font-family:Arial, Helvetica, sans-serif; text-transform:uppercase; letter-spacing:0.4px;">Grand Total</td>
                  <td style="padding:16px 20px; background-color:${p.soft}; font-size:17px; color:${p.accent}; font-weight:700; text-align:right; font-family:Arial, Helvetica, sans-serif;">
                    &#8377;${grandTotal}
                    ${grandTotalWords ? `<div style="font-size:11px; color:#6b7280; font-weight:400; margin-top:4px;">(${grandTotalWords})</div>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${lineItemsBlock}

          ${ctaBlock}

          <tr>
            <td style="padding:0 40px 28px 40px;">
              <p style="font-size:14px; color:#4b5563; line-height:1.65; margin:0; font-family:Arial, Helvetica, sans-serif;">
                ${closingHtml}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 32px 40px; border-top:1px solid #eef0f3;">
              <p style="font-size:14px; color:#374151; margin:0 0 6px 0; font-family:Arial, Helvetica, sans-serif;">Warm regards,</p>
              <p style="font-size:14px; color:${p.accent}; font-weight:700; margin:0 0 8px 0; font-family:Arial, Helvetica, sans-serif;">${companyName}</p>
              ${
                contactLines.length
                  ? `<p style="font-size:13px; color:#6b7280; margin:0; line-height:1.55; font-family:Arial, Helvetica, sans-serif;">${contactLines.join("<br />")}</p>`
                  : ""
              }
            </td>
          </tr>

          <tr>
            <td style="background-color:${p.soft}; padding:18px 40px; text-align:center; border-top:1px solid ${p.border};">
              ${
                footerBits.length
                  ? `<p style="font-size:11px; color:#6b7280; margin:0 0 8px 0; line-height:1.5; font-family:Arial, Helvetica, sans-serif;">${footerBits.join(" · ")}</p>`
                  : ""
              }
              <p style="font-size:11px; color:#9ca3af; margin:0; line-height:1.5; font-family:Arial, Helvetica, sans-serif;">
                This message was sent by ${companyName}. The quotation PDF is attached when delivered via your email service.
                Replies go to the Reply-To address configured for this branch when your email webhook supports it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildQuotationEmailBodies(opts: {
  templateId: QuotationEmailTemplateId;
  /** Custom plain message from profile (used when template is plain, or as webhook text fallback). */
  customPlainMessage?: string;
  vars: QuotationEmailVars;
}): { text: string; html?: string } {
  const templateId = normalizeQuotationEmailTemplateId(opts.templateId);
  if (templateId === "corporate") {
    return {
      text: renderPlainQuotationEmail(opts.vars),
      html: renderCorporateQuotationEmailHtml(opts.vars),
    };
  }
  const custom = String(opts.customPlainMessage ?? "").trim();
  return {
    text: custom || renderPlainQuotationEmail(opts.vars),
  };
}
