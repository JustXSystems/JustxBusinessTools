"use client";

import { useMemo, useState } from "react";
import {
  buildOutboundEmailBodies,
  DEFAULT_CORPORATE_EMAIL_MESSAGE,
  DEFAULT_OUTBOUND_EMAIL_FORMAT,
  normalizeOutboundEmailFormatId,
  OUTBOUND_EMAIL_BLOCK_TOKENS,
  OUTBOUND_EMAIL_FORMATS,
  summarizeOutboundLineItems,
  type OutboundEmailFormatId,
  type OutboundEmailVars,
} from "@/lib/outbound-email";
import { normalizeDocumentAccentColor } from "@/lib/document-accent";
import { SEND_TEMPLATE_PLACEHOLDER_GROUPS } from "@/lib/send-template-placeholders";
import {
  DEFAULT_SEND_SETTINGS,
  resolveCorporateEmailMessage,
} from "@/lib/types/business-profile";
import { absolutePublicAssetUrl } from "@/lib/base-path";

type Props = {
  templateId: OutboundEmailFormatId;
  plainMessage: string;
  corporateMessage: string;
  accentColor: string;
  companyName?: string;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyGstin?: string | null;
  companyAddress?: string | null;
  logoUrl?: string | null;
  disabled?: boolean;
  messageDisabled?: boolean;
  /** Override sample data for preview (defaults to quotation-style sample). */
  previewVars?: Partial<OutboundEmailVars>;
  onChangeTemplateId: (id: OutboundEmailFormatId) => void;
  onChangePlainMessage: (value: string) => void;
  onChangeCorporateMessage: (value: string) => void;
};

function defaultPreviewVars(
  accentColor: string,
  logoUrl: string | null | undefined,
  company: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    gstin?: string | null;
    address?: string | null;
  },
): OutboundEmailVars {
  const name = company.name?.trim() || "Your Company";
  const sampleItems = summarizeOutboundLineItems([
    { desc: "Sample line item A", qty: 2, rate: 8500 },
    { desc: "Sample line item B", qty: 1, rate: 42000 },
  ]);
  return {
    customerName: "Sample Customer",
    quoteNo: "DOC-2026-0042",
    typeLabel: "Sample type",
    date: "08 Sep 2026",
    validTill: "22 Sep 2026",
    grandTotal: "50,500.00",
    grandTotalWords: "Fifty Thousand Five Hundred Only",
    companyName: name,
    companyPhone: company.phone?.trim() || "+91 98765 43210",
    companyEmail: company.email?.trim() || "sales@example.com",
    companyAddress: company.address?.trim() || "123 Business Park, City",
    companyGstin: company.gstin?.trim() || "29ABCDE1234F1Z5",
    quoteLink: "https://example.com/document/preview",
    LoggedinUserName: "Alex Sender",
    LogginUserPhonenumber: "+91 98765 00000",
    emailHeaderLabel: "Document",
    referenceNoLabel: "Reference No.",
    logoUrl: logoUrl
      ? absolutePublicAssetUrl(
          logoUrl,
          typeof window !== "undefined" ? window.location.origin : "",
        ) || undefined
      : undefined,
    accentColor: normalizeDocumentAccentColor(accentColor),
    lineItems: sampleItems.lineItems,
    moreItemsCount: sampleItems.moreItemsCount,
  };
}

export function SendViaEmailTemplatePicker({
  templateId,
  plainMessage,
  corporateMessage,
  accentColor,
  companyName,
  companyPhone,
  companyEmail,
  companyGstin,
  companyAddress,
  logoUrl,
  disabled,
  messageDisabled,
  previewVars,
  onChangeTemplateId,
  onChangePlainMessage,
  onChangeCorporateMessage,
}: Props) {
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const formatId = normalizeOutboundEmailFormatId(templateId);

  const vars = useMemo<OutboundEmailVars>(() => {
    const base = defaultPreviewVars(accentColor, logoUrl, {
      name: companyName,
      phone: companyPhone,
      email: companyEmail,
      gstin: companyGstin,
      address: companyAddress,
    });
    return { ...base, ...previewVars };
  }, [
    accentColor,
    companyAddress,
    companyEmail,
    companyGstin,
    companyName,
    companyPhone,
    logoUrl,
    previewVars,
  ]);

  const activeMessageTemplate =
    formatId === "corporate"
      ? resolveCorporateEmailMessage({ corporateMessage }) || DEFAULT_CORPORATE_EMAIL_MESSAGE
      : plainMessage || DEFAULT_SEND_SETTINGS.email.message;

  const preview = useMemo(
    () =>
      buildOutboundEmailBodies({
        templateId: formatId,
        vars,
        customPlainMessage: plainMessage || DEFAULT_SEND_SETTINGS.email.message,
        customCorporateMessage: resolveCorporateEmailMessage({ corporateMessage }),
      }),
    [formatId, vars, plainMessage, corporateMessage],
  );

  return (
    <div className="q-email-tpl">
      <span className="label">Email format</span>
      <div className="q-email-tpl-options" role="radiogroup" aria-label="Outbound email format">
        {OUTBOUND_EMAIL_FORMATS.map((tpl) => {
          const selected = formatId === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={`q-email-tpl-card ${selected ? "is-selected" : ""}`}
              onClick={() => onChangeTemplateId(tpl.id)}
            >
              <span className="q-email-tpl-card-title">{tpl.label}</span>
              <span className="q-email-tpl-card-desc">{tpl.description}</span>
            </button>
          );
        })}
      </div>

      <label className="field" style={{ marginTop: 14 }}>
        <span className="label">
          Message template — {formatId === "corporate" ? "Corporate HTML" : "Plain text"}
        </span>
        <textarea
          rows={formatId === "corporate" ? 12 : 8}
          className="q-email-tpl-message mono"
          value={activeMessageTemplate}
          disabled={messageDisabled ?? disabled}
          onChange={(e) =>
            formatId === "corporate"
              ? onChangeCorporateMessage(e.target.value)
              : onChangePlainMessage(e.target.value)
          }
        />
      </label>

      <div className="profile-placeholder-toggle">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={showPlaceholders}
          onClick={() => setShowPlaceholders((v) => !v)}
        >
          {showPlaceholders ? "Hide" : "Show"} placeholder reference
        </button>
      </div>
      {showPlaceholders ? (
        <div className="profile-placeholder-grid">
          {SEND_TEMPLATE_PLACEHOLDER_GROUPS.map((group) => (
            <div key={group.title} className="profile-placeholder-group">
              <div className="profile-placeholder-group-title">{group.title}</div>
              <ul className="profile-placeholder-list">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <code>{`{{${item.key}}}`}</code>
                    <span>{item.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="section-note" style={{ gridColumn: "1 / -1", margin: 0 }}>
            Dynamic blocks for Corporate HTML / Plain:{" "}
            {OUTBOUND_EMAIL_BLOCK_TOKENS.map((t, i) => (
              <span key={t}>
                {i > 0 ? ", " : null}
                <code>{`{{${t}}}`}</code>
              </span>
            ))}
            . Each tool supplies values for the fields it uses (e.g.{" "}
            <code>{`{{quoteNo}}`}</code> vs <code>{`{{reportNo}}`}</code>).
          </p>
        </div>
      ) : null}

      <div className="q-email-tpl-preview-wrap">
        <span className="label">Preview (same renderer as Send Via → Email)</span>
        {preview.html ? (
          <iframe
            title="Outbound email preview"
            className="q-email-tpl-preview"
            sandbox=""
            srcDoc={preview.html}
          />
        ) : (
          <pre className="q-email-tpl-preview-text">{preview.text}</pre>
        )}
        <p className="section-note">
          Default format:{" "}
          <strong>
            {OUTBOUND_EMAIL_FORMATS.find((f) => f.id === DEFAULT_OUTBOUND_EMAIL_FORMAT)?.label}
          </strong>
          . Accent {normalizeDocumentAccentColor(accentColor)} — map webhook field{" "}
          <code>html</code> for Corporate (
          <code>docs/EMAIL_OUTBOX.md</code>).
        </p>
      </div>
    </div>
  );
}
