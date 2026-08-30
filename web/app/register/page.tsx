"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { HomeToolPicker } from "@/components/profile/HomeToolPicker";
import { api } from "@/lib/api";
import { INDIAN_STATES } from "@/lib/types/business-profile";
import { mergedHomeTools } from "@/lib/dynamic-tools";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;

type GstinProfile = {
  businessName: string;
  gstin: string;
  pan: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  logo: string | null;
};

function panFromGstin(gstin: string) {
  return gstin.length >= 12 ? gstin.slice(2, 12) : "";
}

function stateFromGstin(gstin: string): [string, string] | null {
  const code = gstin.slice(0, 2);
  const match = INDIAN_STATES.find(([, c]) => c === code);
  return match ?? null;
}

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [gstin, setGstin] = useState("");
  const [lookup, setLookup] = useState<"idle" | "loading" | "done">("idle");
  const [lookedGstin, setLookedGstin] = useState("");
  const [existing, setExisting] = useState<GstinProfile | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [pan, setPan] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [stateName, setStateName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [homeToolIds, setHomeToolIds] = useState<string[]>(() =>
    mergedHomeTools([]).map((t) => t.id),
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const gstinNorm = gstin.trim().toUpperCase();
  const gstinValid = GSTIN_RE.test(gstinNorm);
  const locked = Boolean(existing);

  async function lookupGstin(value = gstinNorm): Promise<{ ok: boolean; match: GstinProfile | null }> {
    if (!GSTIN_RE.test(value)) {
      setExisting(null);
      setLookup("idle");
      setLookedGstin("");
      return { ok: false, match: null };
    }
    if (lookedGstin === value && lookup === "done") {
      return { ok: true, match: existing };
    }
    setLookup("loading");
    try {
      const data = await api<{ exists: boolean; profile?: GstinProfile }>(
        `/auth/gstin?gstin=${encodeURIComponent(value)}`,
      );
      setLookedGstin(value);
      if (data.exists && data.profile) {
        setExisting(data.profile);
        setBusinessName(data.profile.businessName);
        setPan(data.profile.pan ?? panFromGstin(value));
        setAddressLine1(data.profile.addressLine1 ?? "");
        setAddressLine2(data.profile.addressLine2 ?? "");
        setStateName(data.profile.state ?? "");
        setStateCode(data.profile.stateCode ?? "");
        setBusinessPhone(data.profile.phone ?? "");
        setBusinessEmail(data.profile.email ?? "");
        setLogo(data.profile.logo);
        setLookup("done");
        return { ok: true, match: data.profile };
      }
      setExisting(null);
      setPan((prev) => prev || panFromGstin(value));
      const st = stateFromGstin(value);
      if (st) {
        setStateName((prev) => prev || st[0]);
        setStateCode((prev) => prev || st[1]);
      }
      setLookup("done");
      return { ok: true, match: null };
    } catch (err) {
      setExisting(null);
      setLookup("idle");
      setError(err instanceof Error ? err.message : "GSTIN lookup failed");
      return { ok: false, match: null };
    }
  }

  function onGstinChange(value: string) {
    const next = value.toUpperCase();
    setGstin(next);
    if (existing && next !== existing.gstin) {
      setExisting(null);
      setLookedGstin("");
      setLookup("idle");
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be 2 MB or smaller");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!gstinValid) {
      setError("Enter a valid 15-character GSTIN");
      return;
    }
    const looked = await lookupGstin(gstinNorm);
    if (!looked.ok) return;
    const joining = Boolean(looked.match);
    if (!joining && !businessName.trim()) {
      setError("Business name is required for a new GSTIN");
      return;
    }
    if (!joining && homeToolIds.length === 0) {
      setError("Select at least one tool to show on your home screen");
      return;
    }
    setLoading(true);
    try {
      await register({
        email,
        password,
        name: name || undefined,
        phone: phone || undefined,
        gstin: gstinNorm,
        businessName: businessName || undefined,
        pan: pan || undefined,
        addressLine1: addressLine1 || undefined,
        addressLine2: addressLine2 || undefined,
        state: stateName || undefined,
        stateCode: stateCode || undefined,
        businessPhone: businessPhone || undefined,
        businessEmail: businessEmail || undefined,
        logo: joining || !logo ? undefined : logo,
        homeToolIds: joining ? undefined : homeToolIds,
      });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="panel login-panel register-panel">
        <h1>Register</h1>
        <p className="muted">
          Enter GSTIN and tab out to load an existing business. If it is new, complete the business profile, then your
          user details.
        </p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="register-grid">
            <fieldset className="register-fieldset">
              <legend>Business profile</legend>
              <label className="field">
                <span>GSTIN</span>
                <input
                  value={gstin}
                  onChange={(e) => onGstinChange(e.target.value)}
                  onBlur={() => void lookupGstin()}
                  placeholder="29ABCDE1234F1Z5"
                  maxLength={15}
                  required
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </label>
              {lookup === "loading" ? <p className="muted">Looking up GSTIN…</p> : null}
              {locked ? (
                <p className="muted">
                  This GSTIN already has a business profile. Details below are read-only. Enter your user details to
                  join and share the subscription.
                </p>
              ) : lookup === "done" && gstinValid ? (
                <p className="muted">GSTIN not found. Enter the business profile details to create it.</p>
              ) : null}
              <label className="field">
                <span>Company logo</span>
                <div className="register-logo-row">
                  <div className="logo-preview-lg">
                    {logo ? <img src={logo} alt="Logo preview" /> : <span>🏢</span>}
                  </div>
                  {locked ? null : (
                    <label className="btn btn-secondary btn-sm">
                      Upload logo
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={handleLogoUpload} />
                    </label>
                  )}
                </div>
              </label>
              <label className="field">
                <span>Business name</span>
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  readOnly={locked}
                  required={!locked}
                  placeholder="Legal name as on GST certificate"
                />
              </label>
              <label className="field">
                <span>PAN</span>
                <input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} readOnly={locked} maxLength={10} />
              </label>
              <label className="field">
                <span>Address</span>
                <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} readOnly={locked} />
              </label>
              <label className="field">
                <span>Address line 2</span>
                <input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} readOnly={locked} />
              </label>
              <label className="field">
                <span>State</span>
                <select
                  value={stateCode}
                  disabled={locked}
                  onChange={(e) => {
                    const code = e.target.value;
                    const st = INDIAN_STATES.find(([, c]) => c === code);
                    setStateCode(code);
                    setStateName(st?.[0] ?? "");
                  }}
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map(([label, code]) => (
                    <option key={`${code}-${label}`} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Business phone</span>
                <input value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} readOnly={locked} />
              </label>
              <label className="field">
                <span>Business email</span>
                <input type="email" value={businessEmail} onChange={(e) => setBusinessEmail(e.target.value)} readOnly={locked} />
              </label>
              {!locked ? (
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <span>Tools on home</span>
                  <p className="muted" style={{ margin: "4px 0 10px" }}>
                    Only selected tools appear after login. Subscription billing still lists every tool.
                  </p>
                  <HomeToolPicker selectedIds={homeToolIds} onChange={setHomeToolIds} />
                </div>
              ) : null}
            </fieldset>

            <fieldset className="register-fieldset">
              <legend>Your user</legend>
              <label className="field">
                <span>Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </label>
              <label className="field">
                <span>Mobile</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label className="field">
                <span>Password (min 8 characters)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
            </fieldset>
          </div>
          {error ? <p className="field-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={loading || lookup === "loading"}>
            {loading ? "Saving…" : locked ? "Join business" : "Create account"}
          </button>
        </form>
        <p className="muted login-hint">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
      <PoweredByFooter />
    </div>
  );
}
