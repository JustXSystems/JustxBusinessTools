"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ProgressBar,
  SearchInput,
  cx,
  type BosBadgeTone,
  type BosColumn,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
} from "@/components/admin/ui";
import { SelectField, TextareaField, TextField } from "@/components/admin/ui/AdminFields";
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

const FILTER_OPTIONS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
  { value: "incomplete", label: "Incomplete" },
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

function statusTone(status: string): BosBadgeTone {
  if (status === "approved") return "emerald";
  if (status === "pending") return "amber";
  if (status === "rejected" || status === "archived") return "coral";
  return "neutral";
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
    <Suspense fallback={<AdminPageSkeleton cards={4} />}>
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
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState({ total: 0, pending: 0, approved: 0, archived: 0, incomplete: 0 });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { ref: detailRef, reveal: revealDetail } = useRevealWhenStacked<HTMLElement>();
  const [creating, setCreating] = useState(false);
  const [createOrgId, setCreateOrgId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab ?? "fabric");
  const [fabricFocusTool, setFabricFocusTool] = useState<string | null>(focusCapabilityTool);
  const [form, setForm] = useState(emptyForm);
  const [homeToolIds, setHomeToolIds] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [rejectNote, setRejectNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
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
      setLoaded(true);
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
    syncProfileUrl(creating ? null : selectedId, tab, filter, fabricFocusTool);
  }, [selectedId, tab, filter, creating, fabricFocusTool]);

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
      setFabricFocusTool(focusCapabilityTool);
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
    [catalogIds, initialTab, focusCapabilityTool],
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

  function startCreate() {
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
  }

  function cancelCreate() {
    setCreating(false);
    setCreateOrgId(null);
    setForm(emptyForm);
    const restoreId = previousSelectedId.current;
    if (restoreId) {
      appliedFocus.current = restoreId;
      void openProfile(restoreId, "fabric");
    }
  }

  if (!loaded) {
    if (error) {
      return (
        <AdminPage title="Organizations" sub="Access Fabric">
          <AdminErrorState message={error} onRetry={reload} />
        </AdminPage>
      );
    }
    return <AdminPageSkeleton cards={4} />;
  }

  const showSaveTab =
    tab === "identity" || tab === "address" || tab === "bank" || tab === "branding" || tab === "home";

  const tabOptions = PROFILE_TABS.filter(
    (t) => !(creating && (t.id === "fabric" || t.id === "people" || t.id === "lifecycle")),
  ).map((t) => ({ value: t.id, label: t.label }));

  const peopleColumns: ReadonlyArray<BosColumn<Person>> = selected
    ? [
        {
          key: "person",
          header: "Person",
          cell: (person) => (
            <div>
              <div className="admin-cc-cell-title">{person.name || person.email}</div>
              <div className="admin-cc-cell-sub">{person.email}</div>
            </div>
          ),
        },
        {
          key: "role",
          header: "Role",
          cell: (person) => (
            <Badge auto tone="neutral">
              {person.role}
            </Badge>
          ),
        },
        {
          key: "reach",
          header: "Reach",
          cell: (person) =>
            person.implicit ? (
              <Badge auto tone="emerald">
                all profiles
              </Badge>
            ) : person.access ? (
              <Badge auto tone="blue">
                granted
              </Badge>
            ) : (
              <Badge auto tone="neutral">
                no access
              </Badge>
            ),
        },
        {
          key: "actions",
          header: "Actions",
          align: "right",
          cell: (person) =>
            person.implicit ? null : (
              <div className="admin-cc-actions">
                <Button
                  variant={person.access ? "ghost" : "secondary"}
                  size="sm"
                  onClick={() =>
                    void run(person.access ? "Access revoked." : "Access granted.", async () => {
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
                </Button>
              </div>
            ),
        },
      ]
    : [];

  const kpi = (
    key: Filter,
    label: string,
    value: number,
    chip: { color: "blue" | "amber" | "mint" | "lavender" | "rose" | "sage"; glyph: string },
    warn?: boolean,
  ) => (
    <button
      type="button"
      className={cx("admin-cc-kpi-btn", filter === key && "is-selected")}
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
    >
      <KpiCard
        label={label}
        value={value}
        chip={chip}
        delta={warn && value ? "Needs review" : "Filter directory"}
        deltaTone={warn && value ? "warn" : "muted"}
      />
    </button>
  );

  return (
    <AdminPage
      title="Organizations"
      sub="Access Fabric · profiles · tools · reach"
      toolbar={
        <>
          <Badge auto tone={summary.pending ? "amber" : "emerald"}>
            {summary.pending ? `${summary.pending} pending` : "No pending"}
          </Badge>
          <Link href={adminDeepLink.tools()}>
            <Button variant="secondary" size="sm">
              Catalog &amp; products
            </Button>
          </Link>
          <Link href={adminDeepLink.subscriptions()}>
            <Button variant="secondary" size="sm">
              Packs &amp; plans
            </Button>
          </Link>
          <Button variant="primary" size="sm" icon="plus" onClick={startCreate}>
            Add profile
          </Button>
        </>
      }
    >
      <Alert tone="blue" title="Profile-first command center">
        Select a Business Profile, assign tools, then tune each product&apos;s capabilities (module ceilings). Pack
        provisioning, tool lattice, home surface, and people reach live here. Catalog Live/Hidden and SKU pricing stay
        under <Link className="admin-cc-link" href={adminDeepLink.tools()}>Catalog &amp; products</Link>; packs under{" "}
        <Link className="admin-cc-link" href={adminDeepLink.subscriptions()}>Plans &amp; entitlements</Link>. Org Owners
        and org Admins manage day-to-day team access in operator Business Profile → Team.
      </Alert>

      <Grid cols={4} min={140} gap={12}>
        {kpi("all", "Total", summary.total, { color: "blue", glyph: "◎" })}
        {kpi("pending", "Pending", summary.pending, { color: "amber", glyph: "◈" }, true)}
        {kpi("approved", "Approved", summary.approved, { color: "mint", glyph: "✓" })}
        {kpi("incomplete", "Incomplete", summary.incomplete, { color: "rose", glyph: "▣" }, true)}
      </Grid>

      {error ? <AdminErrorState title="Action or refresh failed" message={error} onRetry={reload} /> : null}
      {message ? <Alert tone="emerald" title={message} /> : null}

      <div className="admin-cc-split">
        <AdminSection
          title="Profiles"
          description={`${visible.length} of ${profiles.length} shown`}
        >
          <div className="admin-cc-stack">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search business, GSTIN, org, state"
              aria-label="Search profiles"
            />
            <AdminTabs
              aria-label="Profile filter"
              options={FILTER_OPTIONS}
              value={filter}
              onChange={setFilter}
            />
          </div>
          <div className="admin-cc-dir-list">
            {visible.map((p) => {
              const active = selectedId === p.id && !creating;
              return (
                <button
                  type="button"
                  key={p.id}
                  className={cx("admin-cc-row", active && "is-selected")}
                  aria-pressed={active}
                  onClick={() => {
                    appliedFocus.current = p.id;
                    void openProfile(p.id, "fabric");
                    revealDetail();
                  }}
                >
                  <div className="admin-cc-row-main">
                    <div className="admin-cc-cell-title">{p.businessName}</div>
                    <div className="admin-cc-cell-sub">
                      {p.organizationName ? `${p.organizationName} · ` : ""}
                      {p.gstin || "No GSTIN"} · {p.state || "No state"}
                    </div>
                    <div className="admin-cc-cell-bar">
                      <ProgressBar
                        value={p.completeness}
                        tone={p.completeness >= 75 ? "emerald" : "amber"}
                        label={`Completeness ${p.completeness}%`}
                      />
                    </div>
                  </div>
                  <div className="admin-cc-row-badges">
                    {p.isDefault ? (
                      <Badge auto tone="emerald">
                        Default
                      </Badge>
                    ) : null}
                    <Badge auto tone={statusTone(p.approvalStatus)}>
                      {p.approvalStatus}
                    </Badge>
                    <Badge auto tone="neutral">
                      {p.completeness}%
                    </Badge>
                  </div>
                </button>
              );
            })}
            {visible.length === 0 ? (
              <AdminEmpty title="No profiles match" icon="search">
                No profiles match this filter.
              </AdminEmpty>
            ) : null}
          </div>
        </AdminSection>

        <section ref={detailRef} className="bos-widget admin-cc-section" style={{ minWidth: 0 }}>
          {creating || selected ? (
            <>
              <div className="admin-cc-detail-head">
                <div>
                  <h3 className="admin-cc-detail-title">
                    {creating ? "New Business Profile" : selected?.businessName}
                  </h3>
                  {!creating && selected ? (
                    <p className="admin-cc-detail-sub">
                      {selected.organizationName ? `${selected.organizationName} · ` : ""}
                      {selected.planId} plan · {selected.recordCount} records · {selected.documentCount} documents ·{" "}
                      {selected.staffCount} people grants
                    </p>
                  ) : (
                    <p className="admin-cc-detail-sub">New profiles stay pending until approved.</p>
                  )}
                </div>
                {!creating && selected ? (
                  <div className="admin-cc-actions">
                    <Badge auto tone={statusTone(selected.approvalStatus)}>
                      {selected.approvalStatus}
                    </Badge>
                    <Link href={adminDeepLink.enterAs(selected.id, "owner")}>
                      <Button variant="secondary" size="sm">
                        Enter as…
                      </Button>
                    </Link>
                  </div>
                ) : null}
              </div>

              <div className="admin-cc-tabs-bar">
                <AdminTabs aria-label="Profile section" options={tabOptions} value={tab} onChange={setTab} />
                <div className="admin-cc-actions">
                  {showSaveTab ? (
                    <Button type="submit" form="profile-save-form" variant="primary">
                      {creating || !selectedId ? "Create (pending approval)" : "Save profile"}
                    </Button>
                  ) : null}
                  {creating ? (
                    <Button variant="ghost" onClick={cancelCreate}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>

              <form id="profile-save-form" onSubmit={save} className="admin-cc-form">
                {tab === "identity" ? (
                  <FormGrid>
                    {creating ? (
                      <SelectField
                        full
                        label="Organization"
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
                      </SelectField>
                    ) : null}
                    <TextField
                      label="Legal name"
                      value={form.businessName}
                      onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                      required
                    />
                    <TextField
                      label="GSTIN"
                      value={form.gstin}
                      onChange={(e) => applyGstin(e.target.value)}
                      placeholder="29ABCDE1234F1Z5"
                      maxLength={15}
                    />
                    <TextField
                      label="PAN"
                      value={form.pan}
                      onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                      placeholder="ABCDE1234F"
                      maxLength={10}
                    />
                    <TextField
                      label="Phone"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                    <TextField
                      label="Email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </FormGrid>
                ) : null}

                {tab === "address" ? (
                  <FormGrid>
                    <TextField
                      full
                      label="Address line 1"
                      value={form.addressLine1}
                      onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
                    />
                    <TextField
                      full
                      label="Address line 2"
                      value={form.addressLine2}
                      onChange={(e) => setForm({ ...form, addressLine2: e.target.value })}
                    />
                    <SelectField label="State" value={form.state} onChange={(e) => setStateName(e.target.value)}>
                      <option value="">Select state</option>
                      {INDIAN_STATES.map(([name, code]) => (
                        <option key={`${name}-${code}`} value={name}>
                          {name} ({code})
                        </option>
                      ))}
                    </SelectField>
                    <TextField label="GST state code" value={form.stateCode} readOnly />
                  </FormGrid>
                ) : null}

                {tab === "bank" ? (
                  <FormGrid>
                    <TextField
                      label="Bank name"
                      value={form.bankName}
                      onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                    />
                    <TextField
                      label="Branch"
                      value={form.bankBranch}
                      onChange={(e) => setForm({ ...form, bankBranch: e.target.value })}
                    />
                    <TextField
                      label="Account number"
                      value={form.bankAccount}
                      onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
                    />
                    <TextField
                      label="IFSC"
                      value={form.bankIfsc}
                      onChange={(e) => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })}
                      placeholder="HDFC0001234"
                    />
                    <TextField
                      label="UPI"
                      value={form.bankUpi}
                      onChange={(e) => setForm({ ...form, bankUpi: e.target.value })}
                      placeholder="name@upi"
                    />
                    <TextareaField
                      full
                      label="Invoice terms"
                      value={form.terms}
                      onChange={(e) => setForm({ ...form, terms: e.target.value })}
                      rows={4}
                    />
                  </FormGrid>
                ) : null}

                {tab === "branding" ? (
                  <>
                    <p className="admin-cc-note-text">
                      Document accent colors quotation sheets / PDFs. Quotation email template controls the branded
                      HTML layout used when staff send quotations.
                    </p>
                    <Field label="Document accent color">
                      {({ id }) => (
                        <div className="admin-cc-color-row">
                          <input
                            id={id}
                            type="color"
                            value={normalizeDocumentAccentColor(form.documentAccentColor)}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                documentAccentColor: normalizeDocumentAccentColor(e.target.value),
                              })
                            }
                            aria-label="Document accent color"
                          />
                          <Input
                            value={normalizeDocumentAccentColor(form.documentAccentColor)}
                            onChange={(e) => setForm({ ...form, documentAccentColor: e.target.value })}
                            onBlur={() =>
                              setForm((f) => ({
                                ...f,
                                documentAccentColor: normalizeDocumentAccentColor(f.documentAccentColor),
                              }))
                            }
                            placeholder="#0f3d3e"
                            aria-label="Document accent color hex"
                          />
                        </div>
                      )}
                    </Field>
                    <QuotationEmailTemplatePicker
                      templateId={normalizeQuotationEmailTemplateId(form.emailTemplateId)}
                      plainMessage={DEFAULT_SEND_SETTINGS.email.message}
                      corporateMessage={DEFAULT_SEND_SETTINGS.email.corporateMessage}
                      accentColor={form.documentAccentColor}
                      companyName={form.businessName}
                      companyPhone={form.phone}
                      companyEmail={form.email}
                      messageDisabled
                      onChangeTemplateId={(emailTemplateId) => setForm({ ...form, emailTemplateId })}
                      onChangePlainMessage={() => {}}
                      onChangeCorporateMessage={() => {}}
                    />
                    <p className="admin-cc-note-text">
                      Plain / Corporate message templates and Reply-To are edited on Business Profile → Send Via for
                      this branch. See <code className="admin-cc-code">docs/EMAIL_WEBHOOK.md</code> for HTML delivery.
                    </p>
                  </>
                ) : null}

                {tab === "home" ? (
                  <>
                    <p className="admin-cc-note-text">
                      Which tools appear on this profile&apos;s operator home. Commercial entitlements and pack
                      provisioning live on Access Fabric; org Live/Hidden and SKU pricing stay under{" "}
                      <Link href={adminDeepLink.tools()}>Catalog &amp; products</Link>.
                    </p>
                    <HomeToolPicker
                      selectedIds={homeToolIds}
                      onChange={setHomeToolIds}
                      platformTools={platformTools}
                    />
                  </>
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
                  focusToolId={fabricFocusTool ?? focusCapabilityTool}
                  onNavigate={(target) => setTab(target)}
                  onHomeToolsChange={setHomeToolIds}
                  onSelectedToolIdChange={(toolId) => {
                    setFabricFocusTool(toolId);
                  }}
                  onMutated={async () => {
                    invalidateAdminData("admin-profiles");
                    await reload();
                    if (selectedId) await openProfile(selectedId, "fabric");
                  }}
                />
              ) : null}

              {tab === "people" && selected ? (
                <div className="admin-cc-form">
                  <p className="admin-cc-note-text">
                    Who may switch into this Business Profile. Owners and org Admins always have access. For
                    day-to-day role changes, Owner/org Admin use operator Business Profile → Team.
                  </p>
                  <DataTable
                    caption="People reach"
                    columns={peopleColumns}
                    rows={people}
                    rowKey={(person) => String(person.userId)}
                    empty="No people on this organization yet."
                  />
                </div>
              ) : null}

              {tab === "lifecycle" && selected ? (
                <div className="admin-cc-form">
                  {selected.reviewNote ? (
                    <Alert tone="amber" title="Review note">
                      {selected.reviewNote}
                    </Alert>
                  ) : null}
                  <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
                    {selected.approvalStatus === "pending" || selected.approvalStatus === "rejected" ? (
                      <Button
                        variant="primary"
                        onClick={() =>
                          void run("Branch approved.", () =>
                            api(`/admin/profiles/${selected.id}/approve`, { method: "POST" }).then(() => undefined),
                          )
                        }
                      >
                        Approve
                      </Button>
                    ) : null}
                    {!selected.isDefault && selected.approvalStatus === "approved" ? (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void run("Default branch updated.", () =>
                            api(`/admin/profiles/${selected.id}/default`, { method: "POST" }).then(() => undefined),
                          )
                        }
                      >
                        Make default
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void run("Copy created as pending.", async () => {
                          const copy = await api<{ id: number }>(`/admin/profiles/${selected.id}/duplicate`, {
                            method: "POST",
                          });
                          return copy.id;
                        })
                      }
                    >
                      Duplicate
                    </Button>
                    {selected.approvalStatus === "archived" ? (
                      <Button
                        variant="primary"
                        onClick={() =>
                          void run("Branch restored.", () =>
                            api(`/admin/profiles/${selected.id}/unarchive`, { method: "POST" }).then(() => undefined),
                          )
                        }
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
                        Archive
                      </Button>
                    )}
                  </div>
                  <p className="admin-cc-note-text">
                    Archive hides the branch from normal use. Use the <strong>archived</strong> filter to find it
                    later, then Restore.
                  </p>

                  {selected.approvalStatus === "pending" ? (
                    <Card className="admin-cc-pad">
                      <div className="admin-cc-form">
                        <div className="admin-cc-inline">
                          <TextField
                            label="Rejection note"
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            placeholder="Rejection note"
                          />
                          <Button
                            variant="destructive"
                            onClick={() =>
                              void run(
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
                          </Button>
                        </div>
                        <p className="admin-cc-note-text">
                          Justxsystems admin reject suspends every user on this business and ends all their sessions
                          immediately.
                        </p>
                      </div>
                    </Card>
                  ) : null}

                  <Dialog
                    open={archiveOpen}
                    onClose={() => setArchiveOpen(false)}
                    title={selected.isDefault ? "Archive default branch?" : "Archive profile?"}
                    description={
                      selected.isDefault
                        ? `Archive default branch “${selected.businessName}”? It will leave the active directory. Another branch becomes default if one exists.`
                        : `Archive ${selected.businessName}?`
                    }
                    icon={{ tone: "coral" }}
                    actions={
                      <>
                        <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => {
                            setArchiveOpen(false);
                            void run("Branch archived.", () =>
                              api(`/admin/profiles/${selected.id}`, { method: "DELETE" }).then(() => undefined),
                            );
                          }}
                        >
                          Archive
                        </Button>
                      </>
                    }
                  />
                </div>
              ) : null}
            </>
          ) : (
            <AdminEmpty title="Select a Business Profile" icon="sparkle">
              Choose a profile to open its Access Fabric — readiness, packs, lattice, and reach.
            </AdminEmpty>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
