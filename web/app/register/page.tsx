"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { Alert, BosRoot, Button, Card, FormGrid, Input, Segmented } from "@/components/bos";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import { useAuth } from "@/components/auth/AuthProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { HomeToolPicker } from "@/components/profile/HomeToolPicker";
import { api } from "@/lib/api";
import { publicAssetUrl } from "@/lib/base-path";
import { type AccountType, validateRegisterForm } from "@/lib/register-form";
import { GSTIN_RE } from "@/lib/register-gstin";
import { INDIAN_STATES } from "@/lib/types/business-profile";
import { filterHomeToolsByPersonalAccount, mergedHomeTools } from "@/lib/dynamic-tools";
import "@/components/admin/admin-console.css";

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

const ACCOUNT_OPTIONS = [
  { value: "individual" as const, label: "Individual" },
  { value: "business" as const, label: "Business" },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const { branding } = usePlatformBranding();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const [accountType, setAccountType] = useState<AccountType>("individual");
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
    filterHomeToolsByPersonalAccount(mergedHomeTools([]), true).map((t) => t.id),
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingResult, setPendingResult] = useState<{
    joinedExisting: boolean;
    email: string;
    title: string;
    message: string;
    detail: string;
  } | null>(null);

  const gstinNorm = gstin.trim().toUpperCase();
  const gstinValid = GSTIN_RE.test(gstinNorm);
  const locked = Boolean(existing);
  const isIndividual = accountType === "individual";

  function switchAccountType(next: AccountType) {
    setAccountType(next);
    setError("");
    if (next === "individual") {
      setLookup("idle");
      setHomeToolIds(filterHomeToolsByPersonalAccount(mergedHomeTools([]), true).map((t) => t.id));
    } else {
      setHomeToolIds(mergedHomeTools([]).map((t) => t.id));
    }
  }

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
    processLogoFile(file);
  }

  function processLogoFile(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be 2 MB or smaller");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file");
      return;
    }
    processLogoFile(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (isIndividual) {
      const gate = validateRegisterForm({
        accountType: "individual",
        name,
        phone,
        email,
        password,
        gstin: "",
        businessName: "",
        joiningExisting: false,
        homeToolIds: [],
      });
      if (!gate.ok) {
        setError(gate.error);
        return;
      }
      setLoading(true);
      try {
        const result = await register({
          accountType: "individual",
          email: email.trim(),
          password: password.trim(),
          name: name.trim(),
          phone: phone.trim() || undefined,
        });
        if (!result.pending) {
          router.replace("/");
          return;
        }
        setPendingResult({
          joinedExisting: result.joinedExisting,
          email: result.email,
          title: result.title,
          message: result.message,
          detail: result.detail,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Registration failed");
      } finally {
        setLoading(false);
      }
      return;
    }

    const looked = await lookupGstin(gstinNorm);
    if (!looked.ok && !gstinValid) {
      setError("Enter a valid 15-character GSTIN");
      return;
    }
    if (!looked.ok) return;
    const joining = Boolean(looked.match);
    const gate = validateRegisterForm({
      accountType: "business",
      name,
      phone,
      email,
      password,
      gstin: gstinNorm,
      businessName,
      joiningExisting: joining,
      homeToolIds,
    });
    if (!gate.ok) {
      setError(gate.error);
      return;
    }

    setLoading(true);
    try {
      const result = await register({
        accountType: "business",
        email: email.trim(),
        password: password.trim(),
        name: name.trim(),
        phone: phone.trim() || undefined,
        gstin: gstinNorm,
        businessName: businessName.trim() || undefined,
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
      if (!result.pending) {
        router.replace("/");
        return;
      }
      setPendingResult({
        joinedExisting: result.joinedExisting,
        email: result.email,
        title: result.title,
        message: result.message,
        detail: result.detail,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) return <div className="login-page" />;

  if (pendingResult) {
    return (
      <BosRoot canvas className="admin-bos" defaultTheme="dark" skin="bos">
        <div className="admin-cc-login">
          <Card className="admin-cc-login-card">
            <div className="admin-cc-login-brand">
              <PlatformBrandMark size="lg" showText={false} />
              <div>
                <h1>{pendingResult.title}</h1>
                <p>{branding.appName}</p>
              </div>
            </div>
            <Alert tone={pendingResult.joinedExisting ? "blue" : "emerald"} title={pendingResult.message}>
              {pendingResult.detail}
            </Alert>
            <div className="admin-cc-login-foot">
              <Link href="/login">
                <Button variant="primary" block>
                  Back to sign in
                </Button>
              </Link>
            </div>
          </Card>
          <PoweredByFooter />
        </div>
      </BosRoot>
    );
  }

  return (
    <BosRoot canvas className="admin-bos" defaultTheme="dark" skin="bos">
      <div className={`admin-cc-login admin-cc-register ${isIndividual ? "is-individual" : "is-business"}`}>
        <Card
          className={`admin-cc-login-card admin-cc-register-card ${isIndividual ? "admin-cc-register-card--individual" : ""}`}
        >
          <div className="admin-cc-login-brand">
            <PlatformBrandMark size="lg" showText={false} />
            <div>
              <h1>Create account</h1>
              <p>{branding.appName}</p>
            </div>
          </div>

          <div className="admin-cc-register-type" role="group" aria-label="Account type">
            <button
              type="button"
              className={`admin-cc-register-type-card ${isIndividual ? "is-active" : ""}`}
              onClick={() => switchAccountType("individual")}
              aria-pressed={isIndividual}
            >
              <span className="admin-cc-register-type-icon" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M5 19.5c1.8-3.2 4.2-4.8 7-4.8s5.2 1.6 7 4.8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="admin-cc-register-type-copy">
                <strong>Individual</strong>
                <span>Personal tools — no GSTIN needed</span>
              </span>
            </button>
            <button
              type="button"
              className={`admin-cc-register-type-card ${!isIndividual ? "is-active" : ""}`}
              onClick={() => switchAccountType("business")}
              aria-pressed={!isIndividual}
            >
              <span className="admin-cc-register-type-icon" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 20V9.5L12 4l8 5.5V20"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <path d="M9 20v-5h6v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="admin-cc-register-type-copy">
                <strong>Business</strong>
                <span>GSTIN profile for your company</span>
              </span>
            </button>
          </div>

          <div className="admin-cc-register-segment">
            <Segmented
              block
              role="radio"
              aria-label="Account type"
              options={ACCOUNT_OPTIONS}
              value={accountType}
              onChange={switchAccountType}
            />
          </div>

          <p className="admin-cc-note-text admin-cc-register-lead" key={accountType}>
            {isIndividual
              ? "Register with your name, email and password. Start using tools right away — add a business profile later if you need GSTIN billing."
              : "Enter GSTIN and tab out to load an existing business. New GSTIN creates an Owner account you can use immediately. Joining an existing GSTIN sends a request for the Business Owner to approve."}
          </p>

          <form onSubmit={handleSubmit} className="admin-cc-login-form">
            <div
              className={`admin-cc-register-panels ${isIndividual ? "show-individual" : "show-business"}`}
              key={accountType}
            >
              {isIndividual ? (
                <fieldset className="admin-cc-register-fieldset admin-cc-register-fieldset--solo">
                  <legend>Your details</legend>
                  <TextField
                    label="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                    autoFocus
                  />
                  <TextField
                    label="Mobile"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                  <TextField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                  <TextField
                    label="Password (min 8 characters)"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </fieldset>
              ) : (
                <div className="admin-cc-register-grid">
                  <fieldset className="admin-cc-register-fieldset">
                    <legend>Business profile</legend>
                    <TextField
                      label="GSTIN"
                      value={gstin}
                      onChange={(e) => onGstinChange(e.target.value)}
                      onBlur={() => void lookupGstin()}
                      placeholder="29ABCDE1234F1Z5"
                      maxLength={15}
                      required
                      autoCapitalize="characters"
                      spellCheck={false}
                    />
                    {lookup === "loading" ? <p className="admin-cc-note-text">Looking up GSTIN…</p> : null}
                    {locked ? (
                      <Alert tone="blue" title="Existing business profile">
                        This GSTIN already has a business profile. Details below are read-only. Enter your user details to
                        request access — the Business Profile Owner will approve you as Staff or Viewer.
                      </Alert>
                    ) : lookup === "done" && gstinValid ? (
                      <Alert tone="emerald" title="New GSTIN">
                        GSTIN not found. Enter the business profile details to create it. You will be signed in as Owner
                        right away; Justxsystems can review the Business Profile later.
                      </Alert>
                    ) : null}

                    <div className="bos-field">
                      <span className="bos-field-label">Company logo</span>
                      <div className="admin-cc-register-logo-row">
                        <div className="admin-cc-register-logo" onDragOver={handleDragOver} onDrop={handleDrop}>
                          {logo ? (
                            // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied data URL / asset
                            <img src={publicAssetUrl(logo)} alt="Logo preview" />
                          ) : (
                            <span aria-hidden className="admin-cc-register-logo-fallback">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                                <path
                                  d="M4 20V9.5L12 4l8 5.5V20"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M9 20v-5h6v5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          )}
                        </div>
                        {locked ? null : (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => logoInputRef.current?.click()}>
                              Upload logo
                            </Button>
                            <Input
                              ref={logoInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              style={{ display: "none" }}
                              aria-label="Upload logo file"
                              onChange={handleLogoUpload}
                            />
                          </>
                        )}
                      </div>
                    </div>

                    <TextField
                      label="Business name"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      readOnly={locked}
                      required={!locked}
                      placeholder="Legal name as on GST certificate"
                    />
                    <TextField
                      label="PAN"
                      value={pan}
                      onChange={(e) => setPan(e.target.value.toUpperCase())}
                      readOnly={locked}
                      maxLength={10}
                    />
                    <TextField
                      label="Address"
                      value={addressLine1}
                      onChange={(e) => setAddressLine1(e.target.value)}
                      readOnly={locked}
                    />
                    <TextField
                      label="Address line 2"
                      value={addressLine2}
                      onChange={(e) => setAddressLine2(e.target.value)}
                      readOnly={locked}
                    />
                    <SelectField
                      label="State"
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
                    </SelectField>
                    <FormGrid>
                      <TextField
                        label="Business phone"
                        value={businessPhone}
                        onChange={(e) => setBusinessPhone(e.target.value)}
                        readOnly={locked}
                      />
                      <TextField
                        label="Business email"
                        type="email"
                        value={businessEmail}
                        onChange={(e) => setBusinessEmail(e.target.value)}
                        readOnly={locked}
                      />
                    </FormGrid>
                    {!locked ? (
                      <div className="bos-field">
                        <span className="bos-field-label">Tools on home</span>
                        <p className="admin-cc-note-text">
                          Only selected tools appear after login. Subscription billing still lists every tool.
                        </p>
                        <HomeToolPicker
                          selectedIds={homeToolIds}
                          onChange={setHomeToolIds}
                          personalOnly={false}
                        />
                      </div>
                    ) : null}
                  </fieldset>

                  <fieldset className="admin-cc-register-fieldset">
                    <legend>Your user</legend>
                    <TextField
                      label="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                    <TextField
                      label="Mobile"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                    />
                    <TextField
                      label="Email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                    <TextField
                      label="Password (min 8 characters)"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </fieldset>
                </div>
              )}
            </div>

            {error ? (
              <Alert tone="coral" title="Registration problem">
                {error}
              </Alert>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              block
              disabled={loading || (!isIndividual && lookup === "loading")}
              className="admin-cc-register-submit"
            >
              {loading
                ? "Saving…"
                : isIndividual
                  ? "Create account"
                  : locked
                    ? "Request to join"
                    : "Create business account"}
            </Button>
          </form>
          <div className="admin-cc-login-foot">
            <p className="bos-text-muted" style={{ margin: 0, fontSize: 13 }}>
              Already have an account?
            </p>
            <Link href="/login">
              <Button variant="secondary" block>
                Sign in
              </Button>
            </Link>
          </div>
        </Card>
        <PoweredByFooter />
      </div>
    </BosRoot>
  );
}
