"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HomeToolPicker } from "@/components/profile/HomeToolPicker";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { INDIAN_STATES, EMPTY_PROFILE, type BusinessProfile } from "@/lib/types/business-profile";
import { fetchProfile, saveProfile } from "@/lib/api";
import { mergedHomeTools } from "@/lib/dynamic-tools";

export default function ProfilePage() {
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

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setProfile({
          ...p,
          homeToolIds: p.homeToolIds ?? catalogIds,
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await saveProfile(profile);
      setProfile({
        ...saved,
        homeToolIds: saved.homeToolIds ?? catalogIds,
      });
      setMessage("Business profile saved. Return to Home to see your tool list.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
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
        <Link href="/" className="back-btn" aria-label="Back">←</Link>
        <div className="tool-header-text">
          <div className="tool-header-title">Business Profile</div>
          <div className="tool-header-sub">
            Fill this once — it auto-fills every quotation, order, invoice, and PO you create.
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {message ? (
        <div className="panel profile-success">{message}</div>
      ) : null}

      <div className="panel profile-hero">
        <div className="flex-row-wrap">
          <div className="logo-preview-lg">
            {profile.logo ? <img src={profile.logo} alt="Logo" /> : <span>🏢</span>}
          </div>
          <div className="min-w-240">
            <label className="label" htmlFor="businessName">Business Name</label>
            <input
              id="businessName"
              className="business-name-input"
              value={profile.businessName}
              onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
              placeholder="Your Business Name"
            />
            <p className="section-note">This name and logo appear at the top of every document you create.</p>
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
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Tools on home</h3>
        <p className="section-note">
          Only selected tools appear on Home after login. Subscription / billing always shows the full catalog.
        </p>
        <HomeToolPicker
          selectedIds={profile.homeToolIds ?? []}
          platformTools={platformTools}
          onChange={(ids) => setProfile({ ...profile, homeToolIds: ids })}
        />
      </div>

      <div className="panel">
        <h3 className="panel-title">Business details</h3>
        <div className="field-row2">
          <label className="field">
            <span className="label">Address line 1</span>
            <input
              value={profile.addressLine1 ?? ""}
              onChange={(e) => setProfile({ ...profile, addressLine1: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">Address line 2</span>
            <input
              value={profile.addressLine2 ?? ""}
              onChange={(e) => setProfile({ ...profile, addressLine2: e.target.value })}
            />
          </label>
        </div>
        <div className="field-row2">
          <label className="field">
            <span className="label">GSTIN</span>
            <input value={profile.gstin ?? ""} onChange={(e) => setProfile({ ...profile, gstin: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">PAN</span>
            <input value={profile.pan ?? ""} onChange={(e) => setProfile({ ...profile, pan: e.target.value })} />
          </label>
        </div>
        <div className="field-row2">
          <label className="field">
            <span className="label">State</span>
            <select
              value={profile.state ?? ""}
              onChange={(e) => {
                const state = e.target.value;
                const code = INDIAN_STATES.find(([n]) => n === state)?.[1] ?? "";
                setProfile({ ...profile, state, stateCode: code });
              }}
            >
              <option value="">Select state</option>
              {INDIAN_STATES.map(([name, code]) => (
                <option key={code} value={name}>{name}</option>
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
            <input value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Email</span>
            <input
              type="email"
              value={profile.email ?? ""}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Bank details</h3>
        <div className="field-row2">
          <label className="field">
            <span className="label">Bank name</span>
            <input value={profile.bankName ?? ""} onChange={(e) => setProfile({ ...profile, bankName: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Branch</span>
            <input value={profile.bankBranch ?? ""} onChange={(e) => setProfile({ ...profile, bankBranch: e.target.value })} />
          </label>
        </div>
        <div className="field-row2">
          <label className="field">
            <span className="label">Account number</span>
            <input value={profile.bankAccount ?? ""} onChange={(e) => setProfile({ ...profile, bankAccount: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">IFSC</span>
            <input value={profile.bankIfsc ?? ""} onChange={(e) => setProfile({ ...profile, bankIfsc: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span className="label">UPI ID</span>
          <input value={profile.bankUpi ?? ""} onChange={(e) => setProfile({ ...profile, bankUpi: e.target.value })} />
        </label>
      </div>

      <div className="panel">
        <h3 className="panel-title">Default terms & conditions</h3>
        <label className="field">
          <span className="label">Terms (shown on documents)</span>
          <textarea
            rows={5}
            value={profile.terms ?? ""}
            onChange={(e) => setProfile({ ...profile, terms: e.target.value })}
          />
        </label>
      </div>

      <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save Business Profile"}
      </button>
    </div>
  );
}
