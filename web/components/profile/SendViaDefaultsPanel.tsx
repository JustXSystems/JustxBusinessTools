"use client";

import Link from "next/link";
import {
  DEFAULT_SEND_SETTINGS,
  normalizeSendSettings,
  resolveCorporateEmailMessage,
  type BusinessProfile,
  type BusinessProfileSendSettings,
} from "@/lib/types/business-profile";
import { normalizeOutboundEmailFormatId } from "@/lib/outbound-email";
import { SendViaEmailTemplatePicker } from "@/components/profile/SendViaEmailTemplatePicker";

type Props = {
  profile: BusinessProfile;
  canEdit: boolean;
  send: BusinessProfileSendSettings;
  onPatchSend: (next: BusinessProfileSendSettings) => void;
  onEmailWebhookUrl: (url: string | null) => void;
};

export function SendViaDefaultsPanel({
  profile,
  canEdit,
  send,
  onPatchSend,
  onEmailWebhookUrl,
}: Props) {
  const normalized = normalizeSendSettings(send);

  return (
    <div className="profile-stack">
      <div className="profile-callout">
        <p>
          Defaults for <strong>Send Via</strong> in Quotation, Site Survey, and other tools. Share /
          download does not use these settings. Templates use {"{{placeholders}}"} — each tool fills
          the fields that apply to that document.
        </p>
      </div>

      <section className="profile-subsection">
        <h4 className="profile-subsection-title">WhatsApp</h4>
        <div className="profile-wa-list">
          {normalized.whatsappNumbers.map((n, idx) => (
            <div key={n.id} className="profile-wa-row">
              <input
                placeholder="Label"
                value={n.label}
                disabled={!canEdit}
                onChange={(e) => {
                  const next = [...normalized.whatsappNumbers];
                  next[idx] = { ...n, label: e.target.value };
                  onPatchSend({ ...normalized, whatsappNumbers: next });
                }}
              />
              <input
                placeholder="Phone"
                value={n.phone}
                disabled={!canEdit}
                onChange={(e) => {
                  const next = [...normalized.whatsappNumbers];
                  next[idx] = { ...n, phone: e.target.value };
                  onPatchSend({ ...normalized, whatsappNumbers: next });
                }}
              />
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn-destructive btn-sm"
                  onClick={() =>
                    onPatchSend({
                      ...normalized,
                      whatsappNumbers: normalized.whatsappNumbers.filter((_, i) => i !== idx),
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {canEdit ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 8 }}
            onClick={() =>
              onPatchSend({
                ...normalized,
                whatsappNumbers: [
                  ...normalized.whatsappNumbers,
                  { id: Math.random().toString(36).slice(2, 9), label: "", phone: "" },
                ],
              })
            }
          >
            Add WhatsApp number
          </button>
        ) : null}
        <label className="field" style={{ marginTop: 14 }}>
          <span className="label">WhatsApp message template</span>
          <textarea
            rows={6}
            className="mono"
            value={normalized.whatsappMessage || DEFAULT_SEND_SETTINGS.whatsappMessage}
            disabled={!canEdit}
            onChange={(e) => onPatchSend({ ...normalized, whatsappMessage: e.target.value })}
          />
        </label>
        <p className="section-note">
          PDF auto-attach needs Meta Cloud API or <code>WHATSAPP_WEBHOOK_URL</code> on the server.
        </p>
      </section>

      <section className="profile-subsection">
        <h4 className="profile-subsection-title">Email defaults</h4>
        <SendViaEmailTemplatePicker
          templateId={normalizeOutboundEmailFormatId(normalized.email.templateId)}
          plainMessage={normalized.email.message || DEFAULT_SEND_SETTINGS.email.message}
          corporateMessage={resolveCorporateEmailMessage(normalized.email)}
          accentColor={profile.documentAccentColor}
          companyName={profile.businessName}
          companyPhone={profile.phone}
          companyEmail={profile.email}
          companyGstin={profile.gstin}
          companyAddress={[profile.addressLine1, profile.addressLine2, profile.state]
            .filter(Boolean)
            .join(", ")}
          logoUrl={profile.logo}
          disabled={!canEdit}
          onChangeTemplateId={(templateId) =>
            onPatchSend({ ...normalized, email: { ...normalized.email, templateId } })
          }
          onChangePlainMessage={(message) =>
            onPatchSend({ ...normalized, email: { ...normalized.email, message } })
          }
          onChangeCorporateMessage={(corporateMessage) =>
            onPatchSend({ ...normalized, email: { ...normalized.email, corporateMessage } })
          }
        />
        <div className="field-row2" style={{ marginTop: 16 }}>
          <label className="field">
            <span className="label">Default To (blank = customer email in tool)</span>
            <input
              value={normalized.email.to}
              disabled={!canEdit}
              onChange={(e) =>
                onPatchSend({ ...normalized, email: { ...normalized.email, to: e.target.value } })
              }
            />
          </label>
          <label className="field">
            <span className="label">Default CC</span>
            <input
              value={normalized.email.cc}
              disabled={!canEdit}
              placeholder="comma-separated"
              onChange={(e) =>
                onPatchSend({ ...normalized, email: { ...normalized.email, cc: e.target.value } })
              }
            />
          </label>
        </div>
        <label className="field">
          <span className="label">Subject template</span>
          <input
            value={normalized.email.subject}
            disabled={!canEdit}
            onChange={(e) =>
              onPatchSend({ ...normalized, email: { ...normalized.email, subject: e.target.value } })
            }
          />
        </label>
        <label className="field">
          <span className="label">Reply-To (blank = company email)</span>
          <input
            type="email"
            value={normalized.email.replyTo}
            disabled={!canEdit}
            placeholder="sales@yourcompany.com"
            onChange={(e) =>
              onPatchSend({ ...normalized, email: { ...normalized.email, replyTo: e.target.value } })
            }
          />
        </label>
      </section>

      <section className="profile-subsection">
        <h4 className="profile-subsection-title">Email webhook (Path A — any device)</h4>
        <p className="section-note">
          Per-company HTTP POST URL for Power Automate / n8n. Not the artifact PDF webhook. See{" "}
          <code>docs/MICROSOFT_GRAPH_EMAIL.md</code>.
        </p>
        <label className="field">
          <span className="label">Email webhook URL</span>
          <input
            type="url"
            value={profile.emailWebhookUrl ?? ""}
            disabled={!canEdit}
            placeholder="https://prod-….logic.azure.com:443/workflows/…/invoke?…"
            autoComplete="off"
            onChange={(e) => onEmailWebhookUrl(e.target.value.trim() || null)}
          />
        </label>
        <p className="section-note">
          Fallback: Admin → Integrations or <code>EMAIL_WEBHOOK_URL</code>. Without a webhook, tools
          use <Link href="/email-outbox">Email Outbox</Link> (mailto / Outlook agent).
        </p>
      </section>
    </div>
  );
}
