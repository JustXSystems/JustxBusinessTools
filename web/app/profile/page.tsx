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
import { fetchProfile, saveProfile } from "@/lib/api";
import { publicAssetUrl } from "@/lib/base-path";
import { mergedHomeTools } from "@/lib/dynamic-tools";
import { DownloadFolderPanel } from "@/components/profile/DownloadFolderPanel";

export default function ProfilePage() {
  const { user } = useAuth();
  const canEdit = canEditBusinessProfile(user);
  const { config } = usePlatformConfig();
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

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setProfile({
          ...EMPTY_PROFILE,
          ...p,
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

  async function handleSave() {
    if (!canEdit) {
      setError("Only the Business Owner can edit Business Profile details.");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const normalized = normalizeSendSettings(profile.sendSettings);
      const payload: BusinessProfile & { artifactWebhookSecret?: string } = {
        ...profile,
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
        sendSettings: normalizeSendSettings(saved.sendSettings),
        homeToolIds: saved.homeToolIds ?? catalogIds,
      });
      setWebhookSecretDraft("");
      setMessage("Business profile saved. Return to Home to see your tool list.");
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
              ? "Staff can view Business Profile details but cannot edit them. Only the Business Owner can make changes."
              : "Viewing as a team user — Business Profile details are read-only. Only the Business Owner can edit these settings."}
          </p>
        </div>
      ) : null}

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
                    className="btn btn-secondary btn-sm"
                    onClick={() => setProfile({ ...profile, logo: null })}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
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
                  className="btn btn-danger btn-sm"
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

        <p className="section-note">
          Without <code>EMAIL_WEBHOOK_URL</code> on the API server, Send Via → Email opens the user’s mail
          app and downloads the PDF to attach. With a webhook, the server posts To/CC/subject/body/PDF to
          that URL for real delivery (SendGrid, n8n, etc.).
        </p>
      </div>

      <Suspense fallback={<div className="panel"><p className="section-note">Loading delivery settings…</p></div>}>
        <DownloadFolderPanel
          canEdit={canEdit}
          downloadFolder={profile.downloadFolder}
          conflictPolicy={profile.downloadFolderConflictPolicy ?? "rename"}
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
