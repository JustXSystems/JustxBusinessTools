"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminOrgSelect } from "@/components/admin/AdminOrgSelect";
import { ProductPacksPanel } from "@/components/admin/ProductPacksPanel";
import {
  AdminEmpty,
  AdminErrorState,
  AdminGlossary,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
  useAdminConfirm,
} from "@/components/admin/ui";
import { SelectField, TextField, TextareaField } from "@/components/admin/ui/AdminFields";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  FormGrid,
  Grid,
  KpiCard,
  SearchInput,
  cx,
  type BosColumn,
} from "@/components/bos";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { api } from "@/lib/api";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
}

type AccessMode = "limited" | "unlimited";

type Plan = {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  priceInr: number;
  billingInterval: string;
  recordLimit: number | null;
  accessMode: AccessMode;
  features: string[];
  available?: boolean;
  trialDays?: number;
  tierLabel?: string | null;
};

type Active = {
  planId: string;
  planName: string;
  status: string;
  periodEnd: string | null;
  mrrInr: number;
  accessMode?: string;
  recordLimit?: number | null;
};

type TenantSub = {
  organizationId: number;
  organizationName: string;
  planId: string;
  planName: string;
  status: string;
  mrrInr: number;
  periodEnd?: string | null;
  daysLeft?: number | null;
  accessMode?: string;
  recordLimit?: number | null;
  provider?: string | null;
};

type TenantSummary = {
  total: number;
  unlimited: number;
  limited: number;
  renewingSoon: number;
  totalMrr: number;
};

type Notice = {
  id: number;
  kind: string;
  channel: string;
  title: string;
  body: string;
  dueAt: string | null;
  sentAt: string | null;
};

type RenewalCandidate = {
  organizationId: number;
  organizationName: string;
  planId: string;
  planName: string;
  periodEnd: string;
  daysLeft: number;
  mrrInr: number;
};

type Tab = "tenants" | "packs" | "modes" | "renewals" | "notices";

const TAB_VALUES: ReadonlyArray<Tab> = ["tenants", "packs", "modes", "renewals", "notices"];

/** Hash deep links: `#renewals` (dashboard KPI) plus the legacy `#plan-editor` anchor. */
function tabFromHash(hash: string): Tab | null {
  const h = hash.replace(/^#/, "");
  if (h === "plan-editor") return "modes";
  return (TAB_VALUES as ReadonlyArray<string>).includes(h) ? (h as Tab) : null;
}

function featureList(features: unknown): string[] {
  if (Array.isArray(features)) return features.map(String);
  return [];
}

export default function AdminSubscriptionsPage() {
  const [tab, setTab] = useState<Tab>("tenants");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [tenants, setTenants] = useState<TenantSub[]>([]);
  const [tenantSummary, setTenantSummary] = useState<TenantSummary>({
    total: 0,
    unlimited: 0,
    limited: 0,
    renewingSoon: 0,
    totalMrr: 0,
  });
  const [tenantQuery, setTenantQuery] = useState("");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [renewals, setRenewals] = useState<RenewalCandidate[]>([]);
  const [editingId, setEditingId] = useState<string | null>("free");
  const [form, setForm] = useState({
    name: "",
    tagline: "",
    description: "",
    priceInr: "0",
    billingInterval: "month",
    recordLimit: "28",
    features: "",
    available: true,
    trialDays: "0",
    tierLabel: "",
  });
  const [notice, setNotice] = useState({ title: "", body: "", kind: "renewal", dueAt: "" });
  const [noticeOrgId, setNoticeOrgId] = useState<number | null>(null);
  const [assignOrgId, setAssignOrgId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog: confirmDialog } = useAdminConfirm();

  const limited = plans.find((p) => p.accessMode === "limited" || p.id === "free");
  const paid = plans.find((p) => p.accessMode === "unlimited" || p.id === "pro");
  const editing = plans.find((p) => p.id === editingId) ?? limited ?? paid ?? null;

  const reload = useCallback(async () => {
    const [p, a, n, r] = await Promise.all([
      api<{ plans: Plan[] }>("/admin/subscriptions/plans"),
      api<{ subscription: Active | null; tenants?: TenantSub[]; summary?: TenantSummary }>(
        "/admin/subscriptions/active",
      ),
      api<{ notices: Notice[] }>("/admin/subscriptions/notices"),
      api<{ candidates: RenewalCandidate[]; withinDays: number }>(
        "/admin/subscriptions/renewals?withinDays=14",
      ),
    ]);
    setPlans(p.plans);
    setActive(a.subscription);
    setTenants(a.tenants ?? []);
    setTenantSummary(
      a.summary ?? {
        total: a.tenants?.length ?? 0,
        unlimited: 0,
        limited: 0,
        renewingSoon: 0,
        totalMrr: 0,
      },
    );
    setNotices(n.notices);
    setRenewals(r.candidates ?? []);
    return p.plans;
  }, []);

  const didInitEdit = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const list = await reload();
      setError("");
      setLoaded(true);
      if (!didInitEdit.current && list.length) {
        didInitEdit.current = true;
        const first = list.find((x) => x.id === "free") ?? list[0];
        if (first) startEdit(first);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load subscriptions");
    }
  }, [reload]);

  useLiveRefresh(refresh, { intervalMs: 45_000 });

  // Deep links (#renewals) select the matching pane on load and on hash changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const next = tabFromHash(window.location.hash);
      if (next) setTab(next);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    if (tabFromHash(window.location.hash) !== "renewals" || tab !== "renewals") return;
    const el = document.getElementById("renewals");
    if (!el) return;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [loaded, tab]);

  function selectTab(next: Tab) {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = `${window.location.pathname}${window.location.search}${next === "tenants" ? "" : `#${next}`}`;
      window.history.replaceState(null, "", url);
    }
  }

  function startEdit(plan: Plan) {
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      tagline: plan.tagline ?? "",
      description: plan.description ?? "",
      priceInr: String(plan.priceInr),
      billingInterval: plan.billingInterval || "month",
      recordLimit: plan.recordLimit == null ? "28" : String(plan.recordLimit),
      features: featureList(plan.features).join(", "),
      available: plan.available !== false,
      trialDays: String(plan.trialDays ?? 0),
      tierLabel: plan.tierLabel ?? "",
    });
    setMessage("");
    setError("");
  }

  async function savePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setMessage("");
    setError("");
    const isPaid = editingId === "pro";
    try {
      await api(`/admin/subscriptions/plans/${editingId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          tagline: form.tagline.trim() || null,
          description: form.description.trim() || null,
          priceInr: Number(form.priceInr),
          billingInterval: form.billingInterval,
          recordLimit: isPaid ? null : Number(form.recordLimit),
          features: form.features.split(",").map((s) => s.trim()).filter(Boolean),
          available: form.available,
          trialDays: Number(form.trialDays) || 0,
          tierLabel: form.tierLabel.trim() || null,
        }),
      });
      const keepId = editingId;
      const next = await reload();
      invalidateAdminData("admin-subscriptions");
      const keep = next.find((x) => x.id === keepId);
      if (keep) {
        setEditingId(keep.id);
        setForm({
          name: keep.name,
          tagline: keep.tagline ?? "",
          description: keep.description ?? "",
          priceInr: String(keep.priceInr),
          billingInterval: keep.billingInterval || "month",
          recordLimit: keep.recordLimit == null ? "28" : String(keep.recordLimit),
          features: featureList(keep.features).join(", "),
          available: keep.available !== false,
          trialDays: String(keep.trialDays ?? 0),
          tierLabel: keep.tierLabel ?? "",
        });
      }
      setMessage("Saved. Operator app picks this up on the next usage check (within seconds).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function assign(planId: string, organizationId?: number) {
    const orgId = organizationId ?? assignOrgId;
    if (orgId == null) {
      setError("Select an organization before assigning a plan");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api("/admin/subscriptions/assign", {
        method: "POST",
        body: JSON.stringify({ planId, organizationId: orgId }),
      });
      setMessage(`Organization ${orgId} switched to ${planId}.`);
      await reload();
      invalidateAdminData("admin-subscriptions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setSaving(false);
    }
  }

  /** Confirm before switching an org's plan — assigning changes its SKU licenses, not just a label. */
  function requestAssign(planId: string, organizationId?: number) {
    const orgId = organizationId ?? assignOrgId;
    if (orgId == null) {
      setError("Select an organization before assigning a plan");
      return;
    }
    const plan = plans.find((p) => p.id === planId);
    const unlimited = plan?.accessMode === "unlimited" || planId === "pro";
    const orgName = tenants.find((t) => t.organizationId === orgId)?.organizationName || `Organization ${orgId}`;
    const planLabel = unlimited ? "All Tools Pack" : "Freemium";
    confirm({
      title: `Switch ${orgName} to ${planLabel}?`,
      description: unlimited ? (
        <>
          <strong>All Tools Pack</strong> removes the record cap and grants a license for <strong>every paid tool</strong>{" "}
          to {orgName}
          {plan?.trialDays ? ` (starts with a ${plan.trialDays}-day trial)` : ""}. Review per-profile grants afterwards in
          Access Fabric.
        </>
      ) : (
        <>
          <strong>Freemium</strong> revokes the paid tool licenses {orgName} currently has and applies the record cap (
          {plan?.recordLimit ?? limited?.recordLimit ?? 28} records / tool, export locked). Existing data is kept.
        </>
      ),
      confirmLabel: `Switch to ${planLabel}`,
      tone: unlimited ? "primary" : "destructive",
      onConfirm: () => assign(planId, orgId),
    });
  }

  async function runRenewals() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const r = await api<{ scanned: number; created: number; skipped: number; autoSent: number }>(
        "/admin/subscriptions/renewals/run",
        { method: "POST", body: JSON.stringify({ withinDays: 14 }) },
      );
      setMessage(
        `Renewal job: scanned ${r.scanned}, created ${r.created}, skipped ${r.skipped}, auto-sent ${r.autoSent}.`,
      );
      await reload();
      invalidateAdminData("admin-subscriptions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renewal run failed");
    } finally {
      setSaving(false);
    }
  }

  async function scheduleNotice(e: React.FormEvent) {
    e.preventDefault();
    if (noticeOrgId == null) {
      setError("Select an organization for the notice");
      return;
    }
    setError("");
    try {
      await api("/admin/subscriptions/notices", {
        method: "POST",
        body: JSON.stringify({ ...notice, organizationId: noticeOrgId }),
      });
      setNotice({ title: "", body: "", kind: "renewal", dueAt: "" });
      await reload();
      setMessage("Notice scheduled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule notice");
    }
  }

  async function markSent(n: Notice) {
    setError("");
    try {
      await api(`/admin/subscriptions/notices/${n.id}/send`, { method: "POST" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark notice sent");
    }
  }

  if (!loaded) {
    if (error) {
      return (
        <AdminPage title="Plans" section="Revenue" sub="Platform modes · product packs · renewals">
          <AdminErrorState message={error} onRetry={() => void refresh()} />
        </AdminPage>
      );
    }
    return <AdminPageSkeleton cards={4} />;
  }

  const unlimitedEdit = editing?.accessMode === "unlimited" || editingId === "pro";
  const visibleTenants = tenants.filter((t) => {
    const q = tenantQuery.trim().toLowerCase();
    if (!q) return true;
    return `${t.organizationName} ${t.planName} ${t.status} ${t.organizationId}`.toLowerCase().includes(q);
  });
  const queuedNotices = notices.filter((n) => !n.sentAt).length;

  const tabOptions: ReadonlyArray<{ value: Tab; label: string }> = [
    { value: "tenants", label: `Tenants (${tenantSummary.total})` },
    { value: "packs", label: "Product packs" },
    { value: "modes", label: "Platform modes" },
    { value: "renewals", label: `Renewals (${renewals.length})` },
    { value: "notices", label: queuedNotices ? `Notices (${queuedNotices} queued)` : "Notices" },
  ];

  const tenantColumns: ReadonlyArray<BosColumn<TenantSub>> = [
    {
      key: "org",
      header: "Organization",
      cell: (t) => (
        <div>
          <div className="admin-cc-cell-title">{t.organizationName || `Org ${t.organizationId}`}</div>
          <div className="admin-cc-cell-sub">
            {t.planName} · {t.status}
            {t.periodEnd ? ` · ends ${t.periodEnd}` : ""}
            {t.daysLeft != null ? ` · ${t.daysLeft}d left` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "mode",
      header: "Mode",
      cell: (t) => (
        <Badge auto tone={t.accessMode === "unlimited" ? "emerald" : "amber"}>
          {t.accessMode === "unlimited" ? "All Tools Pack" : "Freemium"}
        </Badge>
      ),
    },
    { key: "mrr", header: "MRR", align: "right", mono: true, cell: (t) => inr(t.mrrInr) },
    {
      key: "actions",
      header: "Quick assign",
      align: "right",
      cell: (t) => (
        <div className="admin-cc-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || t.planId === "free"}
            onClick={() => requestAssign("free", t.organizationId)}
          >
            → Freemium
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saving || t.planId === "pro"}
            onClick={() => requestAssign("pro", t.organizationId)}
          >
            → All Tools Pack
          </Button>
        </div>
      ),
    },
  ];

  const renewalColumns: ReadonlyArray<BosColumn<RenewalCandidate>> = [
    {
      key: "org",
      header: "Organization",
      cell: (c) => (
        <div>
          <div className="admin-cc-cell-title">{c.organizationName || `Org ${c.organizationId}`}</div>
          <div className="admin-cc-cell-sub">
            {c.planName} · ends {c.periodEnd} · {c.daysLeft}d left
          </div>
        </div>
      ),
    },
    {
      key: "days",
      header: "Due",
      cell: (c) => (
        <Badge auto tone={c.daysLeft <= 3 ? "coral" : "amber"}>
          {c.daysLeft}d
        </Badge>
      ),
    },
    { key: "mrr", header: "MRR", align: "right", mono: true, cell: (c) => inr(c.mrrInr) },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (c) => (
        <div className="admin-cc-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setNoticeOrgId(c.organizationId);
              setNotice({
                title: `Renewal: ${c.planName}`,
                body: `${c.organizationName || `Org ${c.organizationId}`} renews on ${c.periodEnd}.`,
                kind: "renewal",
                dueAt: "",
              });
              setError("");
              setMessage(`Prefilled notice for ${c.organizationName || c.organizationId}.`);
              selectTab("notices");
            }}
          >
            Prefill notice
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saving || c.planId === "pro"}
            onClick={() => requestAssign("pro", c.organizationId)}
          >
            → All Tools Pack
          </Button>
        </div>
      ),
    },
  ];

  const noticeColumns: ReadonlyArray<BosColumn<Notice>> = [
    {
      key: "title",
      header: "Notice",
      cell: (n) => (
        <div>
          <div className="admin-cc-cell-title">{n.title}</div>
          <div className="admin-cc-cell-sub">
            {n.kind} · {n.channel}
            {n.dueAt ? ` · due ${n.dueAt.slice(0, 16).replace("T", " ")}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      cell: (n) => (
        <Badge auto tone={n.sentAt ? "emerald" : "amber"}>
          {n.sentAt ? "sent" : "queued"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (n) =>
        !n.sentAt ? (
          <div className="admin-cc-actions">
            <Button variant="ghost" size="sm" onClick={() => void markSent(n)}>
              Mark sent
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <AdminPage
      title="Plans"
      section="Revenue"
      sub="Platform freemium · product packs · renewals"
      toolbar={
        <>
          <Badge auto tone={tenantSummary.renewingSoon ? "amber" : "emerald"}>
            {tenantSummary.renewingSoon ? `${tenantSummary.renewingSoon} renewing ≤14d` : "No renewals due"}
          </Badge>
          <AdminTabs aria-label="Operator access section" options={tabOptions} value={tab} onChange={selectTab} />
          <Link href={adminDeepLink.toolsPricing()}>
            <Button variant="primary" size="sm">
              Tool products
            </Button>
          </Link>
          <Link href={adminDeepLink.profileAccess(undefined, "fabric")}>
            <Button variant="secondary" size="sm">
              Access Fabric
            </Button>
          </Link>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void refresh()}>
            Refresh
          </Button>
        </>
      }
    >
      <AdminGlossary />

      <Alert tone="blue" title="How operator access works">
        Platform freemium (record cap) plus product packs. Per-tool subscriptions live in{" "}
        <Link className="admin-cc-link" href={adminDeepLink.toolsPricing()}>
          Catalog &amp; products → Product
        </Link>
        . Assigning All Tools Pack grants every paid SKU license; Freemium revokes those licenses. Profile grants:{" "}
        <Link className="admin-cc-link" href={adminDeepLink.profileAccess(undefined, "fabric")}>
          Access Fabric
        </Link>
        . UPI verify:{" "}
        <Link className="admin-cc-link" href={adminDeepLink.upi()}>
          UPI
        </Link>
        .
      </Alert>

      <Grid cols={4} min={140} gap={12}>
        <KpiCard
          interactive={false}
          label="Current mode"
          value={active?.planName ?? "—"}
          chip={{ color: "blue", glyph: "◎" }}
          delta={active?.accessMode ?? active?.planId ?? "—"}
          deltaTone="muted"
        />
        <button type="button" className="admin-cc-kpi-btn" onClick={() => selectTab("tenants")}>
          <KpiCard
            label="Tenants"
            value={tenantSummary.total}
            chip={{ color: "lavender", glyph: "▣" }}
            delta={`${tenantSummary.unlimited} All Tools Pack · ${tenantSummary.limited} Freemium`}
            deltaTone="muted"
          />
        </button>
        <button type="button" className="admin-cc-kpi-btn" onClick={() => selectTab("renewals")}>
          <KpiCard
            label="Renewing ≤14d"
            value={tenantSummary.renewingSoon}
            chip={{ color: "amber", glyph: "◈" }}
            delta={tenantSummary.renewingSoon ? "Review renewals" : "Clear"}
            deltaTone={tenantSummary.renewingSoon ? "warn" : "muted"}
          />
        </button>
        <KpiCard
          interactive={false}
          label="Platform MRR"
          value={inr(tenantSummary.totalMrr || active?.mrrInr || 0)}
          chip={{ color: "mint", glyph: "₹" }}
          delta={`Renews ${active?.periodEnd?.slice(0, 10) ?? "—"}`}
          deltaTone="muted"
        />
      </Grid>

      {error ? <AdminErrorState title="Action or refresh failed" message={error} onRetry={() => void refresh()} /> : null}
      {message ? <Alert tone="emerald" title={message} /> : null}

      {tab === "tenants" ? (
        <AdminSection
          title="Tenant subscriptions"
          description="All orgs in scope with plan, period, and quick assign."
          actions={
            <SearchInput
              value={tenantQuery}
              onChange={(e) => setTenantQuery(e.target.value)}
              placeholder="Filter tenants…"
              aria-label="Filter tenants"
            />
          }
        >
          {visibleTenants.length === 0 ? (
            <AdminEmpty title="No subscriptions in scope" icon="search">
              {tenantQuery ? "No tenants match this filter." : "Tenants appear here once organizations subscribe."}
            </AdminEmpty>
          ) : (
            <div className="admin-cc-scroll" style={{ maxHeight: 640 }}>
              <DataTable
                caption="Tenant subscriptions"
                columns={tenantColumns}
                rows={visibleTenants}
                rowKey={(t) => String(t.organizationId)}
              />
            </div>
          )}
        </AdminSection>
      ) : null}

      {tab === "packs" ? (
        <ProductPacksPanel
          onMessage={(m) => {
            setError("");
            setMessage(m);
          }}
          onError={(m) => {
            setMessage("");
            setError(m);
          }}
        />
      ) : null}

      {tab === "modes" ? (
        <div className="admin-cc-split" id="plan-editor">
          <AdminSection title="Platform modes" description="Select a mode to edit it; assign it to an organization.">
            <div className="admin-cc-mode-list">
              {[limited, paid].filter(Boolean).map((p) => {
                const plan = p as Plan;
                const unlimited = plan.accessMode === "unlimited";
                const selected = editingId === plan.id;
                return (
                  <Card
                    key={plan.id}
                    flat
                    className={cx("admin-cc-mode-card", selected && "is-editing")}
                    onClick={() => startEdit(plan)}
                  >
                    <div className="admin-cc-mode-head">
                      <h4>{plan.name}</h4>
                      <Badge auto tone={unlimited ? "emerald" : "amber"}>
                        {unlimited ? "All tools pack" : "Freemium"}
                      </Badge>
                      {plan.available === false ? (
                        <Badge auto tone="coral">
                          Hidden
                        </Badge>
                      ) : null}
                    </div>
                    {plan.tagline ? <p className="admin-cc-note-text">{plan.tagline}</p> : null}
                    <p className="admin-cc-price">
                      {inr(plan.priceInr)}
                      <span>/{plan.billingInterval}</span>
                    </p>
                    <p className="admin-cc-note-text">
                      {unlimited
                        ? "No record cap · export enabled"
                        : `${plan.recordLimit ?? 28} records / tool · export locked`}
                      {plan.tierLabel ? ` · ${plan.tierLabel}` : ""}
                      {plan.trialDays && plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
                    </p>
                    <div className="admin-cc-inline" onClick={(e) => e.stopPropagation()}>
                      <AdminOrgSelect
                        value={assignOrgId}
                        onChange={setAssignOrgId}
                        label="Assign to organization"
                        emptyLabel="Select organization…"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={saving || assignOrgId == null}
                        onClick={() => requestAssign(plan.id)}
                      >
                        Assign mode
                      </Button>
                      <Button variant={selected ? "secondary" : "ghost"} size="sm" onClick={() => startEdit(plan)}>
                        {selected ? "Editing" : "Edit"}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </AdminSection>

          {editing ? (
            <AdminSection
              title={`Edit ${unlimitedEdit ? "unlimited" : "limited"} mode`}
              description={
                unlimitedEdit
                  ? "Price and copy for paid checkout. Records stay unlimited."
                  : "Record cap is enforced on the operator app as soon as you save."
              }
              actions={
                <>
                  <Badge auto tone={unlimitedEdit ? "emerald" : "amber"}>
                    {unlimitedEdit ? "Unlimited" : "Limited"}
                  </Badge>
                  <Button type="submit" form="subscription-plan-form" variant="primary" size="sm" disabled={saving}>
                    {saving ? "Saving…" : "Save mode"}
                  </Button>
                </>
              }
            >
              <form id="subscription-plan-form" className="admin-cc-form" onSubmit={savePlan}>
                <FormGrid>
                  <TextField
                    label="Display name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                  <TextField
                    label="Tagline"
                    value={form.tagline}
                    onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                  />
                  {!unlimitedEdit ? (
                    <TextField
                      label="Records per tool (enforced live)"
                      type="number"
                      min={1}
                      value={form.recordLimit}
                      onChange={(e) => setForm({ ...form, recordLimit: e.target.value })}
                      required
                    />
                  ) : null}
                  <TextField
                    label="Price (INR)"
                    type="number"
                    min={0}
                    step="1"
                    value={form.priceInr}
                    onChange={(e) => setForm({ ...form, priceInr: e.target.value })}
                    required={unlimitedEdit}
                  />
                  <SelectField
                    label="Billing interval"
                    value={form.billingInterval}
                    onChange={(e) => setForm({ ...form, billingInterval: e.target.value })}
                  >
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </SelectField>
                  <TextField
                    label="Tier label"
                    value={form.tierLabel}
                    onChange={(e) => setForm({ ...form, tierLabel: e.target.value })}
                    placeholder={unlimitedEdit ? "Growth" : "Starter"}
                  />
                  {unlimitedEdit ? (
                    <TextField
                      label="Trial days (on assign)"
                      type="number"
                      min={0}
                      max={365}
                      value={form.trialDays}
                      onChange={(e) => setForm({ ...form, trialDays: e.target.value })}
                    />
                  ) : null}
                  <TextareaField
                    full
                    label="Description"
                    rows={4}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                  <TextareaField
                    full
                    label="Marketing bullets (comma separated — display only)"
                    rows={3}
                    value={form.features}
                    onChange={(e) => setForm({ ...form, features: e.target.value })}
                  />
                  <SelectField
                    label="Available on operator checkout"
                    value={form.available ? "yes" : "no"}
                    onChange={(e) => setForm({ ...form, available: e.target.value === "yes" })}
                  >
                    <option value="yes">Yes — listed</option>
                    <option value="no">No — hidden</option>
                  </SelectField>
                </FormGrid>
              </form>
            </AdminSection>
          ) : (
            <AdminSection title="Editor">
              <AdminEmpty title="Select a mode" icon="settings">
                Select a mode on the left to configure it here.
              </AdminEmpty>
            </AdminSection>
          )}
        </div>
      ) : null}

      {tab === "renewals" ? (
        <div id="renewals">
          <AdminSection
            title="Renewals due ≤14d"
            description="Live candidates from org subscriptions approaching period end."
            actions={
              <Button variant="secondary" size="sm" disabled={saving} onClick={() => void runRenewals()}>
                Run renewal job
              </Button>
            }
          >
            {renewals.length === 0 ? (
              <AdminEmpty title="No renewals in the next 14 days" icon="check">
                Nothing is approaching its period end.
              </AdminEmpty>
            ) : (
              <div className="admin-cc-scroll" style={{ maxHeight: 640 }}>
                <DataTable
                  caption="Renewals due within 14 days"
                  columns={renewalColumns}
                  rows={renewals}
                  rowKey={(c) => String(c.organizationId)}
                />
              </div>
            )}
          </AdminSection>
        </div>
      ) : null}

      {tab === "notices" ? (
        <div className="admin-cc-two">
          <AdminSection
            title="Schedule notice"
            description="Queue notices for periods ending within 14 days, or create one manually."
          >
            <form className="admin-cc-form" onSubmit={(e) => void scheduleNotice(e)}>
              <FormGrid>
                <AdminOrgSelect full value={noticeOrgId} onChange={setNoticeOrgId} />
                <TextField
                  label="Title"
                  value={notice.title}
                  onChange={(e) => setNotice({ ...notice, title: e.target.value })}
                  required
                />
                <TextField
                  label="Due"
                  type="datetime-local"
                  value={notice.dueAt}
                  onChange={(e) => setNotice({ ...notice, dueAt: e.target.value })}
                />
                <TextareaField
                  full
                  label="Message"
                  rows={3}
                  value={notice.body}
                  onChange={(e) => setNotice({ ...notice, body: e.target.value })}
                  required
                />
              </FormGrid>
              <div className="admin-cc-form-actions">
                <Button type="submit" variant="primary">
                  Schedule notice
                </Button>
              </div>
            </form>
          </AdminSection>

          <AdminSection title="Renewal notifications" description={`${notices.length} notices · ${queuedNotices} queued`}>
            {notices.length === 0 ? (
              <AdminEmpty title="No notices yet" icon="bell">
                Scheduled notices appear here.
              </AdminEmpty>
            ) : (
              <div className="admin-cc-scroll" style={{ maxHeight: 520 }}>
                <DataTable
                  caption="Renewal notices"
                  columns={noticeColumns}
                  rows={notices}
                  rowKey={(n) => String(n.id)}
                />
              </div>
            )}
          </AdminSection>
        </div>
      ) : null}
      {confirmDialog}
    </AdminPage>
  );
}
