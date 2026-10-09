"use client";

import type { CSSProperties } from "react";
import { QuoteSheetFooter } from "@/components/quotation-v1/QuoteSheetFooter";
import "@/components/quotation-v1/quotation-v1.css";
import { documentAccentCssVars } from "@/lib/document-accent";
import {
  DOCUMENT_FOOTER_TEMPLATE_OPTIONS,
  footerShowsSender,
  normalizeDocumentFooter,
  type DocumentFooterSettings,
} from "@/lib/document-footer";
import { DEFAULT_COMPANY, todayISO, type CompanyProfileV1 } from "@/lib/quotation-v1";

type Props = {
  value: DocumentFooterSettings;
  disabled?: boolean;
  onChange: (next: DocumentFooterSettings) => void;
  company: {
    name: string;
    phone: string;
    email: string;
    accentColor: string;
    textTone: "standard" | "dark";
  };
  /** Logged-in user, used as the sample sender in the preview. */
  sender: { name: string; phone: string; email: string };
};

export function DocumentFooterPanel({ value, disabled, onChange, company, sender }: Props) {
  const settings = normalizeDocumentFooter(value);
  const showsSender = footerShowsSender(settings);

  function patch(partial: Partial<DocumentFooterSettings>) {
    if (disabled) return;
    onChange({ ...value, ...partial });
  }

  const previewCompany: CompanyProfileV1 = {
    ...DEFAULT_COMPANY,
    name: company.name.trim() || DEFAULT_COMPANY.name,
    phone: company.phone,
    email: company.email,
    documentAccentColor: company.accentColor,
    documentTextTone: company.textTone,
    documentFooter: settings,
  };

  const previewSender = {
    name: sender.name || "Priya Sharma",
    phone: sender.phone || "+91 98765 43210",
    email: sender.email || "priya@yourcompany.com",
  };

  return (
    <div className="doc-footer-panel">
      <p className="section-note" style={{ margin: 0 }}>
        Choose how the sign-off at the bottom of every quotation looks. Templates other than
        Classic print the details of the employee in <b>Prepared by</b>, taken from their login
        (name, mobile, email), so customers know whose lead it is. Staff can adjust their mobile and
        email on each quotation.
      </p>

      <div className="doc-footer-templates" role="radiogroup" aria-label="Footer template">
        {DOCUMENT_FOOTER_TEMPLATE_OPTIONS.map((opt) => {
          const selected = settings.template === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={`doc-footer-template${selected ? " is-selected" : ""}`}
              onClick={() => patch({ template: opt.id })}
            >
              <span className={`doc-footer-thumb is-${opt.id}`} aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="doc-footer-template-copy">
                <strong>{opt.label}</strong>
                <span>{opt.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {showsSender ? (
        <>
          <div className="field-row2">
            <label className="field">
              <span className="label">Contact heading</span>
              <input
                value={value.contactHeading ?? ""}
                maxLength={60}
                disabled={disabled || settings.template === "sender-signs"}
                onChange={(e) => onChange({ ...value, contactHeading: e.target.value })}
                placeholder="Your point of contact"
              />
            </label>
            <label className="field">
              <span className="label">Signatory label</span>
              <input
                value={value.signatoryLabel ?? ""}
                maxLength={60}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, signatoryLabel: e.target.value })}
                placeholder="Authorized Signatory"
              />
            </label>
          </div>
          <div className="doc-footer-toggles">
            <label className="field toggle-row toggle-inline">
              <input
                type="checkbox"
                checked={settings.showPhone}
                disabled={disabled}
                onChange={(e) => patch({ showPhone: e.target.checked })}
              />
              <span className="toggle-hint">Show the sender&apos;s mobile</span>
            </label>
            <label className="field toggle-row toggle-inline">
              <input
                type="checkbox"
                checked={settings.showEmail}
                disabled={disabled}
                onChange={(e) => patch({ showEmail: e.target.checked })}
              />
              <span className="toggle-hint">Show the sender&apos;s email</span>
            </label>
            <label className="field toggle-row toggle-inline">
              <input
                type="checkbox"
                checked={settings.queriesToSender}
                disabled={disabled}
                onChange={(e) => patch({ queriesToSender: e.target.checked })}
              />
              <span className="toggle-hint">
                Send &ldquo;For any queries&rdquo; to the sender instead of the company phone and email
              </span>
            </label>
          </div>
        </>
      ) : (
        <label className="field" style={{ maxWidth: 320 }}>
          <span className="label">Signatory label</span>
          <input
            value={value.signatoryLabel ?? ""}
            maxLength={60}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, signatoryLabel: e.target.value })}
            placeholder="Authorized Signatory"
          />
        </label>
      )}

      <div className="doc-footer-preview-wrap">
        <span className="label">Preview{sender.name ? " (your login as the sender)" : " (sample sender)"}</span>
        <div
          className="qgv1-sheet doc-footer-preview"
          data-text-tone={company.textTone === "dark" ? "dark" : "standard"}
          style={documentAccentCssVars(company.accentColor) as CSSProperties}
        >
          <QuoteSheetFooter company={previewCompany} date={todayISO()} sender={previewSender} />
        </div>
      </div>
    </div>
  );
}
