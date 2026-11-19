"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccessFabricPane } from "@/components/admin/AccessFabricPane";
import { HomeToolPicker } from "@/components/profile/HomeToolPicker";
import { QuotationEmailTemplatePicker } from "@/components/profile/QuotationEmailTemplatePicker";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { DEFAULT_SEND_SETTINGS, INDIAN_STATES } from "@/lib/types/business-profile";
import { normalizeDocumentAccentColor } from "@/lib/document-accent";
import {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  normalizeQuotationEmailTemplateId,
  type QuotationEmailTemplateId,
} from "@/lib/quotation-email-templates";
import { api } from "@/lib/api";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { withBasePath } from "@/lib/base-path";
import { mergedHomeTools } from "@/lib/dynamic-tools";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useRevealWhenStacked } from "@/hooks/useRevealWhenStacked";
import Link from "next/link";

type Profile = {
  id: number;
  businessName: string;
  gstin: string | null;
  pan: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankUpi: string | null;
  terms: string | null;
  documentAccentColor?: string;
  emailTemplateId?: QuotationEmailTemplateId;
  isDefault: boolean;
  approvalStatus: string;
  reviewNote: string | null;
  archivedAt: string | null;
  planId: string;
  subscriptionStatus: string;
  staffCount: number;
  recordCount: number;
  documentCount: number;
  completeness: number;
  organizationId?: number | null;
  organizationName?: string | null;
  homeToolIds?: string[] | null;
};

type Person = {
  userId: number;
  email: string;
  name: string | null;
  role: string;
  access: boolean;
  implicit: boolean;
};

type Tab =
  | "fabric"
  | "home"
  | "people"
  | "identity"
  | "address"
  | "bank"
  | "branding"
  | "lifecycle";
type Filter = "all" | "pending" | "approved" | "archived" | "incomplete";

const PROFILE_TABS: Array<{ id: Tab; label: string }> = [
  { id: "fabric", label: "Access Fabric" },
  { id: "home", label: "Home surface" },
  { id: "people", label: "People reach" },
  { id: "identity", label: "Identity" },
  { id: "address", label: "Address" },
  { id: "bank", label: "Bank" },
  { id: "branding", label: "Branding" },
  { id: "lifecycle", label: "Lifecycle" },
];

function normalizeTab(raw: string | null): Tab | null {
  if (!raw) return null;
  if (raw === "licenses") return "fabric";
  if (raw === "access") return "people";
  if (PROFILE_TABS.some((t) => t.id === raw)) return raw as Tab;
  return null;
}

function syncProfileUrl(
  id: number | null,
  tab: Tab,
  filter: Filter,
  focusTool?: string | null,
) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (id != null) params.set("id", String(id));
  if (tab !== "fabric") params.set("tab", tab);
  if (tab === "fabric" && focusTool) {
    params.set("focus", focusTool === "imsdealer" ? "ims" : focusTool);
  }
  const qs = params.toString();
  window.history.replaceState(null, "", withBasePath(`/admin/profiles${qs ? `?${qs}` : ""}`));
}

const emptyForm = {
  businessName: "",
  gstin: "",
  pan: "",
  addressLine1: "",
  addressLine2: "",
  state: "",
  stateCode: "",
  phone: "",
  email: "",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankIfsc: "",
  bankUpi: "",
  terms: "",
  documentAccentColor: normalizeDocumentAccentColor(null),
  emailTemplateId: DEFAULT_QUOTATION_EMAIL_TEMPLATE as QuotationEmailTemplateId,
};

function statusClass(status: string) {
  if (status === "approved") return "pill pill-success";
  if (status === "pending") return "pill pill-warning";
  if (status === "rejected" || status === "archived") return "pill pill-danger";
  return "pill";
}

function fromProfile(p: Profile) {
  return {
    businessName: p.businessName,
    gstin: p.gstin ?? "",
    pan: p.pan ?? "",
    addressLine1: p.addressLine1 ?? "",
    addressLine2: p.addressLine2 ?? "",
    state: p.state ?? "",
    stateCode: p.stateCode ?? "",
    phone: p.phone ?? "",
    email: p.email ?? "",
    bankName: p.bankName ?? "",
    bankBranch: p.bankBranch ?? "",
    bankAccount: p.bankAccount ?? "",
    bankIfsc: p.bankIfsc ?? "",
    bankUpi: p.bankUpi ?? "",
    terms: p.terms ?? "",
    documentAccentColor: normalizeDocumentAccentColor(p.documentAccentColor),
    emailTemplateId: normalizeQuotationEmailTemplateId(p.emailTemplateId),
  };
}

export default function AdminProfilesPage() {
  return (
    <Suspense
      fallback={
        <div className="admin-page">
          <p className="muted">Loading profiles…</p>
        </div>
      }
    >
      <AdminProfilesInner />
    </Suspense>
  );
}

function AdminProfilesInner() {
  const search = useSearchParams();
  const initialFilter = useMemo((): Filter => {
    const f = search.get("filter");
    if (f === "pending" || f === "approved" || f === "archived" || f === "incomplete") return f;
    return "all";
  }, [search]);
  const focusId = useMemo(() => {
    const n = Number(search.get("id"));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [search]);
  const initialTab = useMemo((): Tab | null => normalizeTab(search.get("tab")), [search]);
  const focusCapabilityTool = useMemo(() => {
    const raw = (search.get("focus") || search.get("tool") || "").trim().toLowerCase();
    if (!raw || raw === "fabric" || raw === "capabilities") return null;
    if (raw === "ims" || raw === "ims-modules" || raw === "modules") return "imsdealer";
    return raw;
  }, [search]);

  const { config } = usePlatformConfig();
  const platformTools = config?.tools ?? [];
  const catalogIds = useMemo(
    () => mergedHomeTools(platformTools).map((t) => t.id),
    [platformTools],
  );
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, approved: 0, archived: 0, incomplete: 0 });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { ref: detailRef, reveal: revealDetail } = useRevealWhenStacked<HTMLElement>();
  const [creating, setCreating] = useState(false);
  const [createOrgId, setCreateOrgId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab ?? "fabric");
  const [form, setForm] = useState(emptyForm);
  const [homeToolIds, setHomeToolIds] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [rejectNote, setRejectNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const openSeq = useRef(0);
  const appliedFocus = useRef<number | null>(null);
  const previousSelectedId = useRef<number | null>(null);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const orgOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of profiles) {
      if (p.organizationId == null) continue;
      if (!map.has(p.organizationId)) {
        map.set(p.organizationId, p.organizationName || `Org ${p.organizationId}`);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles]);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ profiles: Profile[]; summary: typeof summary }>("/admin/profiles");
      setProfiles(data.profiles);
      setSummary(data.summary);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profiles");
    }
  }, []);

  useLiveRefresh(reload, { intervalMs: 45_000 });

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    if (selectedId == null && !creating) return;
    syncProfileUrl(creating ? null : selectedId, tab, filter, focusCapabilityTool);
  }, [selectedId, tab, filter, creating, focusCapabilityTool]);

  useEffect(() => {
    if (initialTab && selectedId != null && !creating) {
      setTab(initialTab);
    }
  }, [initialTab, selectedId, creating]);

  const openProfile = useCallback(
    async (id: number, preferredTab?: Tab | null) => {
      const seq = ++openSeq.current;
      setCreating(false);
      setSelectedId(id);
      const nextTab = preferredTab ?? initialTab ?? "fabric";
      setTab(nextTab);
      setError("");
      try {
        const data = await api<{ profile: Profile; people: Person[] }>(`/admin/profiles/${id}`);
        if (seq !== openSeq.current) return;
        setForm(fromProfile(data.profile));
        setHomeToolIds(data.profile.homeToolIds ?? catalogIds);
        setPeople(data.people);
        setRejectNote(data.profile.reviewNote ?? "");
      } catch (err) {
        if (seq !== openSeq.current) return;
        setError(err instanceof Error ? err.message : "Failed to open profile");
      }
    },
    [catalogIds, initialTab],
  );

  useEffect(() => {
    if (!focusId || profiles.length === 0) return;
    if (!profiles.some((p) => p.id === focusId)) return;
    if (appliedFocus.current === focusId) return;
    appliedFocus.current = focusId;
    void openProfile(focusId, initialTab);
  }, [focusId, profiles, openProfile, initialTab]);

  const visible = profiles.filter((p) => {
    const q = query.trim().toLowerCase();
    if (q && !`${p.businessName} ${p.gstin ?? ""} ${p.state ?? ""} ${p.email ?? ""} ${p.organizationName ?? ""}`.toLowerCase().includes(q)) {
      return false;
    }
    if (filter === "pending") return p.approvalStatus === "pending";
    if (filter === "approved") return p.approvalStatus === "approved";
    if (filter === "archived") return p.approvalStatus === "archived";
    if (filter === "incomplete") return p.completeness < 75 && p.approvalStatus !== "archived";
    return true;
  });

  async function run(label: string, fn: () => Promise<number | void>) {
    setError("");
    setMessage("");
    try {
      const focus = await fn();
      setMessage(label);
      invalidateAdminData("admin-profiles");
      await reload();
      if (typeof focus === "number") await openProfile(focus);
      else if (selectedId && !creating) await openProfile(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  function setStateName(name: string) {
    const code = INDIAN_STATES.find(([n]) => n === name)?.[1] ?? "";
    setForm((f) => ({ ...f, state: name, stateCode: code }));
  }

  function applyGstin(gstin: string) {
    const next = gstin.toUpperCase();
    const code = next.slice(0, 2);
    const match = INDIAN_STATES.find(([, c]) => c === code);
    setForm((f) => ({
      ...f,
      gstin: next,
      state: match && !f.state ? match[0] : f.state,
      stateCode: match && !f.stateCode ? match[1] : f.stateCode,
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await run(creating || !selectedId ? "Profile created — pending approval." : "Profile saved.", async () => {
      if (creating || !selectedId) {
        if (createOrgId == null) {
          throw new Error("Select an organization for the new Business Profile");
        }
        const created = await api<{ id: number }>("/admin/profiles", {
          method: "POST",
          body: JSON.stringify({ ...form, homeToolIds, organizationId: createOrgId }),
        });
        setCreating(false);
        setCreateOrgId(null);
        return created.id;
      }
      await api(`/admin/profiles/${selectedId}`, {
        method: "PUT",
        // Home tab: only send allowlist — incomplete GSTIN/PAN/IFSC must not block this save.
        body: JSON.stringify(tab === "home" ? { homeToolIds } : { ...form, homeToolIds }),
      });
    });
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Access Fabric</h2>
            <p className="muted">
              Profile-first command center: select a Business Profile, assign tools, then tune each
              product&apos;s capabilities (module ceilings). Pack provisioning, tool lattice, home
              surface, and people reach live here. Catalog Live/Hidden stays under Catalog &amp;
              products. Org Owners and org Admins manage day-to-day team access in operator Business
              Profile → Team.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              previousSelectedId.current = selectedId;
              setCreating(true);
              setSelectedId(null);
              setForm(emptyForm);
              setHomeToolIds(catalogIds);
              setPeople([]);
              setCreateOrgId(orgOptions[0]?.id ?? null);
              setTab("identity");
              setMessage("");
              appliedFocus.current = null;
            }}
          >
            Add profile
          </button>
        </div>
        <div className="result-grid">
          {([
            ["all", "Total", summary.total],
            ["pending", "Pending", summary.pending],
            ["approved", "Approved", summary.approved],
            ["incomplete", "Incomplete", summary.incomplete],
          ] as Array<[Filter, string, number]>).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              className={`result-card ${filter === key ? "is-selected" : ""}`}
              onClick={() => setFilter(key)}
            >
              <span>{label}</span><strong>{n}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="admin-page-scroll">
      <div className="team-workspace">
        <section className="panel admin-card admin-dir-panel">
          <h2>Profiles</h2>
          <div className="admin-form-row admin-dir-filters">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search business, GSTIN, org, state" aria-label="Search profiles" />
            <div className="admin-tabs admin-tabs-scroll" role="tablist" aria-label="Profile filter">
              {(["all", "pending", "approved", "archived", "incomplete"] as Filter[]).map((f) => (
                <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
          </div>
          <div className="tracker-list admin-dir-list">
            {visible.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`tracker-row admin-member-row ${selectedId === p.id && !creating ? "is-selected" : ""}`}
                onClick={() => {
                  appliedFocus.current = p.id;
                  void openProfile(p.id, "fabric");
                  revealDetail();
                }}
              >
                <div className="tracker-row-main">
                  <span className="tracker-row-title">{p.businessName}</span>
                  <span className="tracker-row-sub">
                    {p.organizationName ? `${p.organizationName} · ` : ""}
                    {p.gstin || "No GSTIN"} · {p.state || "No state"}
                  </span>
                  <div className="usage-bar" aria-hidden>
                    <span style={{ width: `${p.completeness}%` }} />
                  </div>
                </div>
                <div className="admin-form-row">
                  {p.isDefault ? <span className="pill pill-success">Default</span> : null}
                  <span className={statusClass(p.approvalStatus)}>{p.approvalStatus}</span>
                  <span className="pill">{p.completeness}%</span>
                </div>
              </button>
            ))}
            {visible.length === 0 ? <p className="muted">No profiles match this filter.</p> : null}
          </div>
        </section>

        <section ref={detailRef} className="panel admin-card admin-detail-panel">
          {creating || selected ? (
            <>
              <h2>{creating ? "New Business Profile" : selected?.businessName}</h2>
              {!creating && selected ? (
                <>
                  <p className="muted">
                    {selected.organizationName ? `${selected.organizationName} · ` : ""}
                    {selected.planId} plan · {selected.recordCount} records · {selected.documentCount}{" "}
                    documents · {selected.staffCount} people grants
                  </p>
                  <div className="admin-form-row">
                    <Link
                      href={adminDeepLink.enterAs(selected.id)}
                      className="btn btn-secondary btn-sm"
                    >
                      Enter as…
                    </Link>
                  </div>
                </>
              ) : (
                <p className="muted">New profiles stay pending until approved.</p>
              )}
              <div className="admin-tabs-bar">
                <div className="admin-tabs admin-tabs-scroll" role="tablist">
                  {PROFILE_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      className={tab === t.id ? "active" : ""}
                      onClick={() => setTab(t.id)}
                      disabled={
                        creating &&
                        (t.id === "fabric" || t.id === "people" || t.id === "lifecycle")
                      }
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="admin-tabs-actions">
                  {tab === "identity" ||
                  tab === "address" ||
                  tab === "bank" ||
                  tab === "branding" ||
                  tab === "home" ? (
                    <button type="submit" form="profile-save-form" className="btn btn-primary">
                      {creating || !selectedId ? "Create (pending approval)" : "Save profile"}
                    </button>
                  ) : null}
                  {creating ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setCreating(false);
                        setCreateOrgId(null);
                        setForm(emptyForm);
                        const restoreId = previousSelectedId.current;
                        if (restoreId) {
                          appliedFocus.current = restoreId;
                          void openProfile(restoreId, "fabric");
                        }
                      }}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="admin-detail-scroll">
              <form id="profile-save-form" onSubmit={save} className="admin-stack">
                {tab === "identity" ? (
                  <div className="admin-form-grid">
                    {creating ? (
                      <label className="field" style={{ gridColumn: "1 / -1" }}>
                        <span>Organization</span>
                        <select
                          value={createOrgId ?? ""}
                          required
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setCreateOrgId(Number.isInteger(v) && v > 0 ? v : null);
                          }}
                        >
                          <option value="">
                            {orgOptions.length === 0 ? "No organizations yet" : "Select organization…"}
                          </option>
                          {orgOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label className="field"><span>Legal name</span>
                      <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} required />
                    </label>
                    <label className="field"><span>GSTIN</span>
                      <input value={form.gstin} onChange={(e) => applyGstin(e.target.value)} placeholder="29ABCDE1234F1Z5" maxLength={15} />
                    </label>
                    <label className="field"><span>PAN</span>
                      <input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} />
                    </label>
                    <label className="field"><span>Phone</span>
                      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </label>
                    <label className="field"><span>Email</span>
                      <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </label>
                  </div>
                ) : null}

                {tab === "address" ? (
                  <div className="admin-form-grid">
                    <label className="field" style={{ gridColumn: "1 / -1" }}><span>Address line 1</span>
                      <input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
                    </label>
                    <label className="field" style={{ gridColumn: "1 / -1" }}><span>Address line 2</span>
                      <input value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
                    </label>
                    <label className="field"><span>State</span>
                      <select value={form.state} onChange={(e) => setStateName(e.target.value)}>
                        <option value="">Select state</option>
                        {INDIAN_STATES.map(([name, code]) => (
                          <option key={`${name}-${code}`} value={name}>{name} ({code})</option>
                        ))}
                      </select>
                    </label>
                    <label className="field"><span>GST state code</span>
                      <input value={form.stateCode} readOnly />
                    </label>
                  </div>
                ) : null}

                {tab === "bank" ? (
                  <div className="admin-form-grid">
                    <label className="field"><span>Bank name</span>
                      <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
                    </label>
                    <label className="field"><span>Branch</span>
                      <input value={form.bankBranch} onChange={(e) => setForm({ ...form, bankBranch: e.target.value })} />
                    </label>
                    <label className="field"><span>Account number</span>
                      <input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
                    </label>
                    <label className="field"><span>IFSC</span>
                      <input value={form.bankIfsc} onChange={(e) => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" />
                    </label>
                    <label className="field"><span>UPI</span>
                      <input value={form.bankUpi} onChange={(e) => setForm({ ...form, bankUpi: e.target.value })} placeholder="name@upi" />
                    </label>
                    <label className="field" style={{ gridColumn: "1 / -1" }}><span>Invoice terms</span>
                      <textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} rows={4} />
                    </label>
                  </div>
                ) : null}

                {tab === "branding" ? (
                  <div className="admin-stack">
                    <p className="section-note">
                      Document accent colors quotation sheets / PDFs. Quotation email template controls the
                      branded HTML layout used when staff send quotations.
                    </p>
                    <div className="profile-accent-field">
                      <label className="label" htmlFor="adminDocumentAccentColor">
                        Document accent color
                      </label>
                      <div className="flex-row-wrap" style={{ alignItems: "center", gap: 10 }}>
                        <input
                          id="adminDocumentAccentColor"
                          type="color"
                          value={normalizeDocumentAccentColor(form.documentAccentColor)}
                          onChange={(e) =>
                            setForm({
                              ...form,
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
                            cursor: "pointer",
                          }}
                        />
                        <input
                          className="mono"
                          value={normalizeDocumentAccentColor(form.documentAccentColor)}
                          onChange={(e) =>
                            setForm({ ...form, documentAccentColor: e.target.value })
                          }
                          onBlur={() =>
                            setForm((f) => ({
                              ...f,
                              documentAccentColor: normalizeDocumentAccentColor(f.documentAccentColor),
                            }))
                          }
                          placeholder="#0f3d3e"
                          style={{ maxWidth: 120 }}
                          aria-label="Document accent color hex"
                        />
                      </div>
                    </div>
                    <QuotationEmailTemplatePicker
                      templateId={normalizeQuotationEmailTemplateId(form.emailTemplateId)}
                      plainMessage={DEFAULT_SEND_SETTINGS.email.message}
                      corporateMessage={DEFAULT_SEND_SETTINGS.email.corporateMessage}
                      accentColor={form.documentAccentColor}
                      companyName={form.businessName}
                      companyPhone={form.phone}
                      companyEmail={form.email}
                      messageDisabled
                      onChangeTemplateId={(emailTemplateId) =>
                        setForm({ ...form, emailTemplateId })
                      }
                      onChangePlainMessage={() => {}}
                      onChangeCorporateMessage={() => {}}
                    />
                    <p className="section-note">
                      Plain / Corporate message templates and Reply-To are edited on Business Profile →
                      Send Via for this branch. See <code>docs/EMAIL_WEBHOOK.md</code> for HTML delivery.
                    </p>
                  </div>
                ) : null}

                {tab === "home" ? (
                  <div className="admin-stack">
                    <p className="section-note">
                      Which tools appear on this profile&apos;s operator home. Commercial
                      entitlements and pack provisioning live on Access Fabric; org Live/Hidden
                      stays under Catalog &amp; products.
                    </p>
                    <HomeToolPicker
                      selectedIds={homeToolIds}
                      onChange={setHomeToolIds}
                      platformTools={platformTools}
                    />
                  </div>
                ) : null}
              </form>

              {tab === "fabric" && selected ? (
                <AccessFabricPane
                  businessProfileId={selected.id}
                  profileName={selected.businessName}
                  identityCompleteness={selected.completeness}
                  approvalStatus={selected.approvalStatus}
                  peopleGranted={people.filter((p) => p.access || p.implicit).length}
                  peopleTotal={people.length}
                  homeToolIds={homeToolIds}
                  focusToolId={focusCapabilityTool}
                  onNavigate={(target) => setTab(target)}
                  onHomeToolsChange={setHomeToolIds}
                  onMutated={async () => {
                    invalidateAdminData("admin-profiles");
                    await reload();
                    if (selectedId) await openProfile(selectedId, "fabric");
                  }}
                />
              ) : null}

              {tab === "people" && selected ? (
                <div className="admin-stack">
                  <p className="section-note">
                    Who may switch into this Business Profile. Owners and org Admins always have
                    access. For day-to-day role changes, Owner/org Admin use operator Business
                    Profile → Team.
                  </p>
                  <ul className="admin-list">
                    {people.map((person) => (
                      <li key={person.userId}>
                        <span>
                          {person.name || person.email}
                          <span className="muted"> · {person.role}</span>
                        </span>
                        {person.implicit ? (
                          <span className="pill pill-success">all profiles</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              run(person.access ? "Access revoked." : "Access granted.", async () => {
                                if (person.access) {
                                  await api(`/admin/profiles/${selected.id}/access/${person.userId}`, {
                                    method: "DELETE",
                                  });
                                } else {
                                  await api(`/admin/profiles/${selected.id}/access`, {
                                    method: "POST",
                                    body: JSON.stringify({ userId: person.userId }),
                                  });
                                }
                              })
                            }
                          >
                            {person.access ? "Revoke" : "Grant"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {tab === "lifecycle" && selected ? (
                <div className="admin-stack">
                  {selected.reviewNote ? <p className="muted">Review note: {selected.reviewNote}</p> : null}
                  <div className="admin-form-row">
                    {selected.approvalStatus === "pending" || selected.approvalStatus === "rejected" ? (
                      <button type="button" className="btn btn-primary" onClick={() => run("Branch approved.", () => api(`/admin/profiles/${selected.id}/approve`, { method: "POST" }).then(() => undefined))}>
                        Approve
                      </button>
                    ) : null}
                    {selected.approvalStatus === "pending" ? (
                      <>
                        <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Rejection note" />
                        <button
                          type="button"
                          className="btn btn-destructive"
                          onClick={() =>
                            run(
                              "Business rejected. If you are a Justxsystems admin, all org users were suspended and logged out.",
                              () =>
                                api(`/admin/profiles/${selected.id}/reject`, {
                                  method: "POST",
                                  body: JSON.stringify({ note: rejectNote || "Rejected" }),
                                }).then(() => undefined),
                            )
                          }
                        >
                          Reject
                        </button>
                        <p className="muted">
                          Justxsystems admin reject suspends every user on this business and ends all their sessions immediately.
                        </p>
                      </>
                    ) : null}
                    {!selected.isDefault && selected.approvalStatus === "approved" ? (
                      <button type="button" className="btn btn-secondary" onClick={() => run("Default branch updated.", () => api(`/admin/profiles/${selected.id}/default`, { method: "POST" }).then(() => undefined))}>
                        Make default
                      </button>
                    ) : null}
                    <button type="button" className="btn btn-ghost" onClick={() => run("Copy created as pending.", async () => {
                      const copy = await api<{ id: number }>(`/admin/profiles/${selected.id}/duplicate`, { method: "POST" });
                      return copy.id;
                    })}>Duplicate</button>
                    {selected.approvalStatus === "archived" ? (
                      <button type="button" className="btn btn-primary" onClick={() => run("Branch restored.", () => api(`/admin/profiles/${selected.id}/unarchive`, { method: "POST" }).then(() => undefined))}>
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-destructive"
                        onClick={() => {
                          const warn = selected.isDefault
                            ? `Archive default branch “${selected.businessName}”? It will leave the active directory. Another branch becomes default if one exists.`
                            : `Archive ${selected.businessName}?`;
                          if (!window.confirm(warn)) return;
                          void run("Branch archived.", () =>
                            api(`/admin/profiles/${selected.id}`, { method: "DELETE" }).then(() => undefined),
                          );
                        }}
                      >
                        Archive
                      </button>
                    )}
                    <p className="muted">
                      Archive hides the branch from normal use. Use the <strong>archived</strong> filter to find it later, then Restore.
                    </p>
                  </div>
                </div>
              ) : null}
              </div>

              {message ? <p className="muted">{message}</p> : null}
              {error ? <p className="field-error">{error}</p> : null}
            </>
          ) : (
            <>
              <h2>Select a Business Profile</h2>
              <p className="muted">
                Choose a profile to open its Access Fabric — readiness, packs, lattice, and reach.
              </p>
            </>
          )}
        </section>
      </div>
      </div>
    </div>
  );
}
