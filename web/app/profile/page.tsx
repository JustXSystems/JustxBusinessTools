"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { HomeToolPicker } from "@/components/profile/HomeToolPicker";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { canEditBusinessProfile } from "@/lib/auth-access";
import {
  DEFAULT_SEND_SETTINGS,
  EMPTY_PROFILE,
  INDIAN_STATES,
  normalizeSendSettings,
  type BusinessProfile,
  type BusinessProfileSendSettings,
} from "@/lib/types/business-profile";
import { normalizeDocumentAccentColor } from "@/lib/document-accent";
import {
  findThemePresetTokens,
  normalizeThemePreset,
  savedThemePresetKey,
  THEME_PRESETS,
} from "@/lib/theme-presets";
import { applyThemeTokens, type ThemeTokens } from "@/lib/theme";
import { invalidateLiveData } from "@/hooks/useLiveRefresh";
import { fetchProfile, saveProfile } from "@/lib/api";
import { publicAssetUrl } from "@/lib/base-path";
import { mergedHomeTools } from "@/lib/dynamic-tools";
import { DownloadFolderPanel } from "@/components/profile/DownloadFolderPanel";
import { MfaSettingsPanel } from "@/components/profile/MfaSettingsPanel";
import { QuotationEmailTemplatePicker } from "@/components/profile/QuotationEmailTemplatePicker";
import { TeamRequestsPanel } from "@/components/profile/TeamRequestsPanel";
import { normalizeQuotationEmailTemplateId } from "@/lib/quotation-email-templates";

export default function ProfilePage() {
  const { user } = useAuth();
  const canEdit = canEditBusinessProfile(user);
  const { config, refresh: refreshConfig } = usePlatformConfig();
  const platformTools = config?.tools ?? [];
  const catalogIds = useMemo(
    () => mergedHomeTools(platformTools).map((t) => t.id),
    [platformTools],
  );
  const [profile, setProfile] = useState<BusinessProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [webhookSecretDraft, setWebhookSecretDraft] = useState("");

  const send = normalizeSendSettings(profile.sendSettings);
  const themePresets = profile.themePresets?.length
    ? profile.themePresets
    : THEME_PRESETS.map((p) => ({ name: p.name, tokens: p.tokens as Record<string, string> }));
  const orgThemes = profile.orgThemes ?? [];
  const selectedThemeKey = normalizeThemePreset(profile.themePreset) ?? "";

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setProfile({
          ...EMPTY_PROFILE,
          ...p,
          documentAccentColor: normalizeDocumentAccentColor(p.documentAccentColor),
          themePreset: normalizeThemePreset(p.themePreset),
          themePresets: p.themePresets ?? [],
          orgThemes: p.orgThemes ?? [],
          organizationTheme: p.organizationTheme ?? null,
          sendSettings: normalizeSendSettings(p.sendSettings),
          homeToolIds: p.homeToolIds ?? catalogIds,
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchSend(next: BusinessProfileSendSettings) {
    if (!canEdit) return;
    setProfile((p) => ({ ...p, sendSettings: next }));
  }

  function previewTheme(presetKey: string | null) {
    const key = normalizeThemePreset(presetKey);
    if (!key) {
      const orgTokens = profile.organizationTheme || config?.theme;
      if (orgTokens) applyThemeTokens(orgTokens as ThemeTokens);
      return;
    }
    const fromPreset = findThemePresetTokens(key);
    if (fromPreset) {
      applyThemeTokens(fromPreset);
      return;
    }
    const org = orgThemes.find((t) => t.key === key || savedThemePresetKey(t.id) === key);
    if (org?.tokens) applyThemeTokens(org.tokens as ThemeTokens);
  }

  function setThemePreset(next: string | null) {
    if (!canEdit) return;
    const normalized = normalizeThemePreset(next);
    setProfile((p) => ({ ...p, themePreset: normalized }));
    previewTheme(normalized);
  }

  async function handleSave() {
    if (!canEdit) {
      setError("Only the Business Owner or Admin can edit Business Profile details.");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const normalized = normalizeSendSettings(profile.sendSettings);
      const payload: BusinessProfile & { artifactWebhookSecret?: string } = {
        ...profile,
        documentAccentColor: normalizeDocumentAccentColor(profile.documentAccentColor),
        themePreset: normalizeThemePreset(profile.themePreset),
        sendSettings: {
          ...normalized,
          whatsappNumbers: normalized.whatsappNumbers.filter((n) => n.phone.trim()),
        },
      };
      if (webhookSecretDraft.trim()) {
        payload.artifactWebhookSecret = webhookSecretDraft.trim();
      }
      const saved = await saveProfile(payload);
      setProfile({
        ...EMPTY_PROFILE,
        ...saved,
        documentAccentColor: normalizeDocumentAccentColor(saved.documentAccentColor),
        themePreset: normalizeThemePreset(saved.themePreset),
        themePresets: saved.themePresets ?? [],
        orgThemes: saved.orgThemes ?? [],
        organizationTheme: saved.organizationTheme ?? null,
        sendSettings: normalizeSendSettings(saved.sendSettings),
        homeToolIds: saved.homeToolIds ?? catalogIds,
      });
      setWebhookSecretDraft("");
      invalidateLiveData("config");
      await refreshConfig();
      setMessage("Business profile saved. Theme and tools apply to this Business Profile.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!canEdit) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setProfile((p) => ({ ...p, logo: String(reader.result) }));
    };
    reader.readAsDataURL(file);
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="es-icon">⏳</div>
        <div className="es-title">Loading profile…</div>
      </div>
    );
  }

  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">Business Profile</div>
          <div className="tool-header-sub">
            Fill this once — it auto-fills every quotation, order, invoice, and PO you create.
          </div>
        </div>
        {canEdit ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        ) : null}
      </div>

      {!canEdit ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <p className="section-note" style={{ margin: 0 }}>
            {user?.role === "staff"
              ? "Staff can view Business Profile details but cannot edit them. Only the Business Owner or Admin can make changes."
              : "Viewing as a team user — Business Profile details are read-only. Only the Business Owner or Admin can edit these settings."}
          </p>
        </div>
      ) : null}

      <MfaSettingsPanel />

      {canEdit ? <TeamRequestsPanel /> : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {message ? <div className="panel profile-success">{message}</div> : null}

      <div className="panel profile-hero">
        <div className="flex-row-wrap">
          <div className="logo-preview-lg">
            {profile.logo ? <img src={publicAssetUrl(profile.logo)} alt="Logo" /> : <span>🏢</span>}
          </div>
          <div className="min-w-240">
            <label className="label" htmlFor="businessName">
              Business Name
            </label>
            <input
              id="businessName"
              className="business-name-input"
              value={profile.businessName}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
              placeholder="Your Business Name"
            />
            <p className="section-note">This name and logo appear at the top of every document you create.</p>
            {canEdit ? (
              <div className="btn-row">
                <label className="btn btn-secondary btn-sm">
                  🖼 Upload Logo
                  <input type="file" accept="image/*" hidden onChange={handleLogoUpload} />
                </label>
                {profile.logo ? (
                  <button
                    type="button"
                    className="btn btn-destructive btn-sm"
                    onClick={() => setProfile({ ...profile, logo: null })}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="profile-accent-field" style={{ marginTop: 16 }}>
              <label className="label" htmlFor="documentAccentColor">
                Document accent color
              </label>
              <div className="flex-row-wrap" style={{ alignItems: "center", gap: 10 }}>
                <input
                  id="documentAccentColor"
                  type="color"
                  value={normalizeDocumentAccentColor(profile.documentAccentColor)}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      documentAccentColor: normalizeDocumentAccentColor(e.target.value),
                    })
                  }
                  aria-label="Document accent color"
                  style={{
                    width: 48,
                    height: 36,
                    padding: 2,
                    borderRadius: 8,
                    border: "1px solid var(--border-hair)",
                    background: "transparent",
                    cursor: canEdit ? "pointer" : "default",
                  }}
                />
                <input
                  className="mono"
                  value={normalizeDocumentAccentColor(profile.documentAccentColor)}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      documentAccentColor: e.target.value,
                    })
                  }
                  onBlur={() =>
                    setProfile((p) => ({
                      ...p,
                      documentAccentColor: normalizeDocumentAccentColor(p.documentAccentColor),
                    }))
                  }
                  placeholder="#0f3d3e"
                  style={{ maxWidth: 120 }}
                  aria-label="Document accent color hex"
                />
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 72,
                    height: 8,
                    borderRadius: 4,
                    background: normalizeDocumentAccentColor(profile.documentAccentColor),
                  }}
                />
              </div>
              <p className="section-note">
                Used for quotation sheets, invoices/orders/POs, site-survey PDF letterhead
                (headings, borders, table headers), and the corporate quotation email template.
                Owner and Admin can change this.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Theme preset</h3>
        <p className="section-note">
          Default follows the organization theme set in Admin. A selection here overrides that theme
          for this Business Profile only (takes precedence for every user on this branch).
        </p>
        <label className="field">
          <span className="label">Active theme for this profile</span>
          <select
            value={selectedThemeKey}
            disabled={!canEdit}
            onChange={(e) => setThemePreset(e.target.value || null)}
          >
            <option value="">Organization default (Admin)</option>
            <optgroup label="Built-in presets">
              {themePresets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {orgThemes.length ? (
              <optgroup label="Saved organization themes">
                {orgThemes.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                    {t.isActive ? " (Admin active)" : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <div className="admin-theme-presets" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="admin-theme-swatch"
            disabled={!canEdit}
            style={{
              background: "linear-gradient(135deg, var(--bg-1) 0%, var(--bg-2) 55%, var(--accent) 100%)",
              borderColor: selectedThemeKey === "" ? "var(--accent)" : "var(--border-hair)",
              outline: selectedThemeKey === "" ? "2px solid var(--accent)" : undefined,
            }}
            onClick={() => setThemePreset(null)}
          >
            <span style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
              Org default
            </span>
          </button>
          {themePresets.map((p) => {
            const tokens = p.tokens as ThemeTokens;
            const active = selectedThemeKey === p.name;
            return (
              <button
                key={p.name}
                type="button"
                className="admin-theme-swatch"
                disabled={!canEdit}
                style={{
                  background: `linear-gradient(135deg, ${tokens.bg1} 0%, ${tokens.bg2} 55%, ${tokens.accent} 100%)`,
                  borderColor: tokens.accent,
                  outline: active ? `2px solid ${tokens.accent}` : undefined,
                }}
                onClick={() => setThemePreset(p.name)}
              >
                <span style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>{p.name}</span>
              </button>
            );
          })}
        </div>
        <p className="section-note" style={{ marginTop: 10 }}>
          {selectedThemeKey
            ? `Override active — this profile uses “${
                orgThemes.find((t) => t.key === selectedThemeKey)?.name || selectedThemeKey
              }”.`
            : "Using Admin organization theme (no profile override)."}{" "}
          Save to apply for all staff on this Business Profile.
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">Tools on home</h3>
        <p className="section-note">
          Only selected tools appear on Home after login. Subscription / billing always shows the full
          catalog.
        </p>
        <HomeToolPicker
          selectedIds={profile.homeToolIds ?? []}
          platformTools={platformTools}
          onChange={(ids) => {
            if (!canEdit) return;
            setProfile({ ...profile, homeToolIds: ids });
          }}
          disabled={!canEdit}
        />
      </div>

      <div className="panel">
        <h3 className="panel-title">Business details</h3>
        <div className="field-row2">
          <label className="field">
            <span className="label">Address line 1</span>
            <input
              value={profile.addressLine1 ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, addressLine1: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">Address line 2</span>
            <input
              value={profile.addressLine2 ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, addressLine2: e.target.value })}
            />
          </label>
        </div>
        <div className="field-row2">
          <label className="field">
            <span className="label">GSTIN</span>
            <input
              value={profile.gstin ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, gstin: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">PAN</span>
            <input
              value={profile.pan ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, pan: e.target.value })}
            />
          </label>
        </div>
        <div className="field-row2">
          <label className="field">
            <span className="label">State</span>
            <select
              value={profile.state ?? ""}
              disabled={!canEdit}
              onChange={(e) => {
                const state = e.target.value;
                const code = INDIAN_STATES.find(([n]) => n === state)?.[1] ?? "";
                setProfile({ ...profile, state, stateCode: code });
              }}
            >
              <option value="">Select state</option>
              {INDIAN_STATES.map(([name, code]) => (
                <option key={code} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">State code</span>
            <input value={profile.stateCode ?? ""} readOnly />
          </label>
        </div>
        <div className="field-row2">
          <label className="field">
            <span className="label">Phone</span>
            <input
              value={profile.phone ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">Email</span>
            <input
              type="email"
              value={profile.email ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Send Via defaults</h3>
        <p className="section-note">
          WhatsApp numbers / message and email To/CC/message templates — used by Quotation → Send Via.
          Share / download needs no profile setup.
        </p>
        <p className="section-note">
          Templates support {"{{customerName}}"}, {"{{quoteNo}}"}, {"{{typeLabel}}"}, {"{{date}}"},{" "}
          {"{{validTill}}"}, {"{{grandTotal}}"}, {"{{grandTotalWords}}"}, {"{{companyName}}"},{" "}
          {"{{companyPhone}}"}.
        </p>

        <h4 className="panel-subtitle">WhatsApp numbers</h4>
        <div className="profile-wa-list">
          {send.whatsappNumbers.map((n, idx) => (
            <div key={n.id} className="profile-wa-row">
              <input
                placeholder="Label"
                value={n.label}
                disabled={!canEdit}
                onChange={(e) => {
                  const next = [...send.whatsappNumbers];
                  next[idx] = { ...n, label: e.target.value };
                  patchSend({ ...send, whatsappNumbers: next });
                }}
              />
              <input
                placeholder="Phone"
                value={n.phone}
                disabled={!canEdit}
                onChange={(e) => {
                  const next = [...send.whatsappNumbers];
                  next[idx] = { ...n, phone: e.target.value };
                  patchSend({ ...send, whatsappNumbers: next });
                }}
              />
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn-destructive btn-sm"
                  onClick={() =>
                    patchSend({
                      ...send,
                      whatsappNumbers: send.whatsappNumbers.filter((_, i) => i !== idx),
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
              patchSend({
                ...send,
                whatsappNumbers: [
                  ...send.whatsappNumbers,
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
            rows={9}
            value={send.whatsappMessage || DEFAULT_SEND_SETTINGS.whatsappMessage}
            disabled={!canEdit}
            onChange={(e) => patchSend({ ...send, whatsappMessage: e.target.value })}
          />
        </label>
        <p className="section-note">
          Prefilled when you use Send Via → WhatsApp (editable before opening). Automatic PDF attachment
          requires <code>WHATSAPP_ACCESS_TOKEN</code> + <code>WHATSAPP_PHONE_NUMBER_ID</code> (Meta Cloud
          API) or <code>WHATSAPP_WEBHOOK_URL</code> on the API server — browser WhatsApp links cannot attach
          files.
        </p>

        <h4 className="panel-subtitle">Email</h4>
        <QuotationEmailTemplatePicker
          templateId={normalizeQuotationEmailTemplateId(send.email.templateId)}
          accentColor={profile.documentAccentColor}
          companyName={profile.businessName}
          companyPhone={profile.phone}
          companyEmail={profile.email}
          companyGstin={profile.gstin}
          companyAddress={[profile.addressLine1, profile.addressLine2, profile.state]
            .filter(Boolean)
            .join(", ")}
          logoUrl={profile.logo}
          intro={send.email.intro}
          closing={send.email.closing}
          disabled={!canEdit}
          onChange={(templateId) =>
            patchSend({ ...send, email: { ...send.email, templateId } })
          }
        />
        <div className="field-row2">
          <label className="field">
            <span className="label">Default To (blank = customer email)</span>
            <input
              value={send.email.to}
              disabled={!canEdit}
              onChange={(e) =>
                patchSend({ ...send, email: { ...send.email, to: e.target.value } })
              }
            />
          </label>
          <label className="field">
            <span className="label">Default CC</span>
            <input
              value={send.email.cc}
              disabled={!canEdit}
              onChange={(e) =>
                patchSend({ ...send, email: { ...send.email, cc: e.target.value } })
              }
              placeholder="comma-separated"
            />
          </label>
        </div>
        <label className="field">
          <span className="label">Subject template</span>
          <input
            value={send.email.subject}
            disabled={!canEdit}
            onChange={(e) =>
              patchSend({ ...send, email: { ...send.email, subject: e.target.value } })
            }
          />
        </label>
        <label className="field">
          <span className="label">Reply-To (blank = company / sales email)</span>
          <input
            type="email"
            value={send.email.replyTo}
            disabled={!canEdit}
            onChange={(e) =>
              patchSend({ ...send, email: { ...send.email, replyTo: e.target.value } })
            }
            placeholder="sales@yourcompany.com"
          />
        </label>
        {normalizeQuotationEmailTemplateId(send.email.templateId) === "plain" ? (
          <label className="field">
            <span className="label">Message template</span>
            <textarea
              rows={8}
              value={send.email.message || DEFAULT_SEND_SETTINGS.email.message}
              disabled={!canEdit}
              onChange={(e) =>
                patchSend({ ...send, email: { ...send.email, message: e.target.value } })
              }
            />
          </label>
        ) : (
          <>
            <label className="field">
              <span className="label">Corporate intro</span>
              <textarea
                rows={3}
                value={send.email.intro || DEFAULT_SEND_SETTINGS.email.intro}
                disabled={!canEdit}
                onChange={(e) =>
                  patchSend({ ...send, email: { ...send.email, intro: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span className="label">Corporate closing</span>
              <textarea
                rows={3}
                value={send.email.closing || DEFAULT_SEND_SETTINGS.email.closing}
                disabled={!canEdit}
                onChange={(e) =>
                  patchSend({ ...send, email: { ...send.email, closing: e.target.value } })
                }
              />
            </label>
            <p className="section-note">
              Summary card, line items, accent colors, logo, GSTIN, and CTA stay fixed. Intro/closing
              support the same {"{{placeholders}}"} as subject.
            </p>
          </>
        )}

        <p className="section-note">
          Without <code>EMAIL_WEBHOOK_URL</code> on the API server, Send Via → Email opens the user’s mail
          app with plain text and downloads the PDF to attach. With a webhook, the server posts
          To/CC/subject/body/<strong>html</strong>/replyTo/from/PDF — map <code>html</code> in your
          provider (see <code>docs/EMAIL_WEBHOOK.md</code>).
        </p>
      </div>

      <Suspense fallback={<div className="panel"><p className="section-note">Loading delivery settings…</p></div>}>
        <DownloadFolderPanel
          canEdit={canEdit}
          downloadFolder={profile.downloadFolder}
          conflictPolicy={profile.downloadFolderConflictPolicy ?? "overwrite"}
          artifactDestination={profile.artifactDestination ?? "auto"}
          artifactWebhookUrl={profile.artifactWebhookUrl}
          artifactWebhookSecretConfigured={profile.artifactWebhookSecretConfigured}
          onFolderChange={(path) => setProfile((p) => ({ ...p, downloadFolder: path || null }))}
          onPolicyChange={(policy) =>
            setProfile((p) => ({ ...p, downloadFolderConflictPolicy: policy }))
          }
          onDestinationChange={(d) => setProfile((p) => ({ ...p, artifactDestination: d }))}
          onWebhookUrlChange={(url) =>
            setProfile((p) => ({ ...p, artifactWebhookUrl: url || null }))
          }
          onWebhookSecretChange={(secret) => setWebhookSecretDraft(secret)}
        />
      </Suspense>

      <div className="panel">
        <h3 className="panel-title">Bank details</h3>
        <div className="field-row2">
          <label className="field">
            <span className="label">Bank name</span>
            <input
              value={profile.bankName ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, bankName: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">Branch</span>
            <input
              value={profile.bankBranch ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, bankBranch: e.target.value })}
            />
          </label>
        </div>
        <div className="field-row2">
          <label className="field">
            <span className="label">Account number</span>
            <input
              value={profile.bankAccount ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, bankAccount: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">IFSC</span>
            <input
              value={profile.bankIfsc ?? ""}
              disabled={!canEdit}
              onChange={(e) => setProfile({ ...profile, bankIfsc: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span className="label">UPI ID</span>
          <input
            value={profile.bankUpi ?? ""}
            disabled={!canEdit}
            onChange={(e) => setProfile({ ...profile, bankUpi: e.target.value })}
          />
        </label>
      </div>

      <div className="panel">
        <h3 className="panel-title">Default terms & conditions</h3>
        <label className="field">
          <span className="label">Terms (shown on documents)</span>
          <textarea
            rows={5}
            value={profile.terms ?? ""}
            disabled={!canEdit}
            onChange={(e) => setProfile({ ...profile, terms: e.target.value })}
          />
        </label>
      </div>

      {canEdit ? (
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Business Profile"}
        </button>
      ) : null}
    </div>
  );
}
