"use client";

import { useMemo } from "react";
import {
  buildQuotationEmailBodies,
  DEFAULT_CORPORATE_EMAIL_CLOSING,
  DEFAULT_CORPORATE_EMAIL_INTRO,
  QUOTATION_EMAIL_TEMPLATES,
  summarizeQuoteLineItems,
  type QuotationEmailTemplateId,
  type QuotationEmailVars,
} from "@/lib/quotation-email-templates";
import { normalizeDocumentAccentColor } from "@/lib/document-accent";
import { fillSendTemplate } from "@/lib/types/business-profile";
import { absolutePublicAssetUrl } from "@/lib/base-path";

type Props = {
  templateId: QuotationEmailTemplateId;
  accentColor: string;
  companyName?: string;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyGstin?: string | null;
  companyAddress?: string | null;
  logoUrl?: string | null;
  intro?: string;
  closing?: string;
  disabled?: boolean;
  onChange: (id: QuotationEmailTemplateId) => void;
};

export function QuotationEmailTemplatePicker({
  templateId,
  accentColor,
  companyName,
  companyPhone,
  companyEmail,
  companyGstin,
  companyAddress,
  logoUrl,
  intro,
  closing,
  disabled,
  onChange,
}: Props) {
  const vars = useMemo<QuotationEmailVars>(() => {
    const name = companyName?.trim() || "Your Company";
    const phone = companyPhone?.trim() || "+91 98765 43210";
    const email = companyEmail?.trim() || "sales@example.com";
    const gstin = companyGstin?.trim() || "29ABCDE1234F1Z5";
    const address = companyAddress?.trim() || "123 Business Park, City";
    const placeholders: Record<string, string> = {
      customerName: "Acme Industries",
      quoteNo: "Q-2026-0042",
      typeLabel: "Solar EPC",
      date: "08 Sep 2026",
      validTill: "22 Sep 2026",
      grandTotal: "2,45,800.00",
      grandTotalWords: "Two Lakh Forty Five Thousand Eight Hundred Only",
      companyName: name,
      companyPhone: phone,
      companyEmail: email,
      companyAddress: address,
      companyGstin: gstin,
      quoteLink: "https://example.com/q/preview",
    };
    const sampleItems = summarizeQuoteLineItems([
      { desc: "Solar PV modules 540W", qty: 20, rate: 8500 },
      { desc: "String inverter 10 kW", qty: 2, rate: 42000 },
      { desc: "Mounting structure", qty: 1, rate: 28000 },
      { desc: "ACDB / DCDB", qty: 1, rate: 12500 },
      { desc: "Installation & commissioning", qty: 1, rate: 35000 },
      { desc: "AMC Year 1", qty: 1, rate: 15000 },
    ]);
    const resolved: QuotationEmailVars = {
      customerName: placeholders.customerName,
      quoteNo: placeholders.quoteNo,
      typeLabel: placeholders.typeLabel,
      date: placeholders.date,
      validTill: placeholders.validTill,
      grandTotal: placeholders.grandTotal,
      grandTotalWords: placeholders.grandTotalWords,
      companyName: name,
      companyPhone: phone,
      companyEmail: email,
      companyAddress: address,
      companyGstin: gstin,
      quoteLink: placeholders.quoteLink,
      logoUrl: logoUrl
        ? absolutePublicAssetUrl(
            logoUrl,
            typeof window !== "undefined" ? window.location.origin : "",
          ) || undefined
        : undefined,
      accentColor: normalizeDocumentAccentColor(accentColor),
      lineItems: sampleItems.lineItems,
      moreItemsCount: sampleItems.moreItemsCount,
      intro: fillSendTemplate(intro?.trim() || DEFAULT_CORPORATE_EMAIL_INTRO, placeholders),
      closing: fillSendTemplate(
        closing?.trim() || DEFAULT_CORPORATE_EMAIL_CLOSING,
        placeholders,
      ),
    };
    return resolved;
  }, [
    accentColor,
    closing,
    companyAddress,
    companyEmail,
    companyGstin,
    companyName,
    companyPhone,
    intro,
    logoUrl,
  ]);

  const preview = useMemo(
    () =>
      buildQuotationEmailBodies({
        templateId,
        vars,
        customPlainMessage: undefined,
      }),
    [templateId, vars],
  );

  return (
    <div className="q-email-tpl">
      <span className="label">Quotation email template</span>
      <div className="q-email-tpl-options" role="radiogroup" aria-label="Quotation email template">
        {QUOTATION_EMAIL_TEMPLATES.map((tpl) => {
          const selected = templateId === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={`q-email-tpl-card ${selected ? "is-selected" : ""}`}
              onClick={() => onChange(tpl.id)}
            >
              <span className="q-email-tpl-card-title">{tpl.label}</span>
              <span className="q-email-tpl-card-desc">{tpl.description}</span>
            </button>
          );
        })}
      </div>

      <div className="q-email-tpl-preview-wrap">
        <span className="label">Preview</span>
        {preview.html ? (
          <iframe
            title="Quotation email preview"
            className="q-email-tpl-preview"
            sandbox=""
            srcDoc={preview.html}
          />
        ) : (
          <pre className="q-email-tpl-preview-text">{preview.text}</pre>
        )}
        <p className="section-note">
          Corporate HTML uses your Document accent color
          ({normalizeDocumentAccentColor(accentColor)}). Webhook delivery must map the{" "}
          <code>html</code> field (see <code>docs/EMAIL_OUTBOX.md</code>). Without a webhook, mailto uses plain text; drafts stay in Email Outbox.
        </p>
      </div>
    </div>
  );
}
