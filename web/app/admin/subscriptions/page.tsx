"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ProductPacksPanel } from "@/components/admin/ProductPacksPanel";
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

function featureList(features: unknown): string[] {
  if (Array.isArray(features)) return features.map(String);
  return [];
}

export default function AdminSubscriptionsPage() {
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
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const limited = plans.find((p) => p.accessMode === "limited" || p.id === "free");
  const paid = plans.find((p) => p.accessMode === "unlimited" || p.id === "pro");
  const editing = plans.find((p) => p.id === editingId) ?? limited ?? paid ?? null;

  const reload = useCallback(async () => {
    const [p, a, n] = await Promise.all([
      api<{ plans: Plan[] }>("/admin/subscriptions/plans"),
      api<{ subscription: Active | null; tenants?: TenantSub[]; summary?: TenantSummary }>(
        "/admin/subscriptions/active",
      ),
      api<{ notices: Notice[] }>("/admin/subscriptions/notices"),
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
    return p.plans;
  }, []);

  const didInitEdit = useRef(false);
  useLiveRefresh(async () => {
    try {
      const list = await reload();
      if (!didInitEdit.current && list.length) {
        didInitEdit.current = true;
        const first = list.find((x) => x.id === "free") ?? list[0];
        if (first) startEdit(first);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to load subscriptions");
    }
  }, { intervalMs: 45_000 });

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
  }

  async function savePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setMessage("");
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
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function assign(planId: string, organizationId?: number) {
    setSaving(true);
    setMessage("");
    try {
      await api("/admin/subscriptions/assign", {
        method: "POST",
        body: JSON.stringify({ planId, organizationId }),
      });
      setMessage(
        organizationId
          ? `Org ${organizationId} switched to ${planId}.`
          : "Operator org switched to this mode. Limits apply on the next create.",
      );
      await reload();
      invalidateAdminData("admin-subscriptions");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setSaving(false);
    }
  }

  async function runRenewals() {
    setSaving(true);
    setMessage("");
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
      setMessage(err instanceof Error ? err.message : "Renewal run failed");
    } finally {
      setSaving(false);
    }
  }

  const unlimitedEdit = editing?.accessMode === "unlimited" || editingId === "pro";
  const visibleTenants = tenants.filter((t) => {
    const q = tenantQuery.trim().toLowerCase();
    if (!q) return true;
    return `${t.organizationName} ${t.planName} ${t.status} ${t.organizationId}`.toLowerCase().includes(q);
  });

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Operator access</h2>
            <p className="muted">
              Platform freemium (record cap) plus product packs. Per-tool subscriptions live in{" "}
              <Link href="/admin/tools?tab=pricing">Tool management → Product</Link>. Assigning All Tools Pack
              grants every paid SKU license; Freemium revokes those licenses. UPI verify:{" "}
              <Link href="/admin/upi">UPI</Link>.
            </p>
          </div>
          <Link href="/admin/tools?tab=pricing" className="btn btn-primary btn-sm">
            Tool products
          </Link>
        </div>
        <div className="analytics-kpis">
          <div className="result-card">
            <span>Current mode</span>
            <strong>{active?.planName ?? "—"}</strong>
            <span className="analytics-delta">{active?.accessMode ?? active?.planId ?? ""}</span>
          </div>
          <div className="result-card">
            <span>Tenants</span>
            <strong>{tenantSummary.total}</strong>
            <span className="analytics-delta">
              {tenantSummary.unlimited} All Tools Pack · {tenantSummary.limited} Freemium
            </span>
          </div>
          <div className="result-card">
            <span>Renewing ≤14d</span>
            <strong>{tenantSummary.renewingSoon}</strong>
          </div>
          <div className="result-card">
            <span>Platform MRR</span>
            <strong>{inr(tenantSummary.totalMrr || active?.mrrInr || 0)}</strong>
            <span className="analytics-delta">Renews {active?.periodEnd?.slice(0, 10) ?? "—"}</span>
          </div>
        </div>
        {message ? <p className="muted">{message}</p> : null}
      </section>

      <section className="panel admin-card">
        <div className="analytics-toolbar">
          <div>
            <h2>Tenant subscriptions</h2>
            <p className="muted">All orgs in scope with plan, period, and quick assign.</p>
          </div>
          <input
            value={tenantQuery}
            onChange={(e) => setTenantQuery(e.target.value)}
            placeholder="Filter tenants…"
            aria-label="Filter tenants"
          />
        </div>
        <div className="tracker-list">
          {visibleTenants.length === 0 ? (
            <p className="muted">No subscriptions in scope.</p>
          ) : (
            visibleTenants.map((t) => (
              <div key={t.organizationId} className="tracker-row">
                <div className="tracker-row-main">
                  <span className="tracker-row-title">
                    {t.organizationName || `Org ${t.organizationId}`}
                  </span>
                  <span className="tracker-row-sub">
                    {t.planName} · {t.status}
                    {t.periodEnd ? ` · ends ${t.periodEnd}` : ""}
                    {t.daysLeft != null ? ` · ${t.daysLeft}d left` : ""}
                  </span>
                </div>
                <div className="tracker-row-meta">
                  <span>
                    <span className="m-lbl">MRR</span>
                    <span className="m-val">{inr(t.mrrInr)}</span>
                  </span>
                  <span className={t.accessMode === "unlimited" ? "pill pill-success" : "pill pill-warning"}>
                    {t.accessMode === "unlimited" ? "All Tools Pack" : "Freemium"}
                  </span>
                </div>
                <div className="tracker-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={saving || t.planId === "free"}
                    onClick={() => void assign("free", t.organizationId)}
                  >
                    → Freemium
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={saving || t.planId === "pro"}
                    onClick={() => void assign("pro", t.organizationId)}
                  >
                    → All Tools Pack
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <ProductPacksPanel onMessage={setMessage} />

      <div className="admin-split sub-workspace">
        <div className="admin-pane-stack">
          <section className="panel admin-card admin-pane">
            <h2>Platform modes</h2>
            <div className="sub-mode-list">
              {[limited, paid].filter(Boolean).map((p) => {
                const plan = p as Plan;
                const unlimited = plan.accessMode === "unlimited";
                const selected = editingId === plan.id;
                return (
                  <article
                    key={plan.id}
                    className={`admin-plan-card sub-mode-card ${unlimited ? "is-highlight" : ""} ${selected ? "is-editing" : ""}`}
                    onClick={() => startEdit(plan)}
                  >
                    <header>
                      <h3>{plan.name}</h3>
                      <span className={unlimited ? "pill pill-success" : "pill pill-warning"}>
                        {unlimited ? "All tools pack" : "Freemium"}
                      </span>
                      {plan.available === false ? <span className="pill pill-danger">Hidden</span> : null}
                    </header>
                    <p className="muted">{plan.tagline}</p>
                    <p className="admin-plan-price">
                      {inr(plan.priceInr)}
                      <span>/{plan.billingInterval}</span>
                    </p>
                    <p className="muted">
                      {unlimited
                        ? "No record cap · export enabled"
                        : `${plan.recordLimit ?? 28} records / tool · export locked`}
                      {plan.tierLabel ? ` · ${plan.tierLabel}` : ""}
                      {plan.trialDays && plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
                    </p>
                    <div className="admin-form-row">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={saving || active?.planId === plan.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void assign(plan.id);
                        }}
                      >
                        {active?.planId === plan.id ? "Assigned" : "Assign to operator"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel admin-card">
            <div className="analytics-toolbar">
              <div>
                <h2>Renewal notifications</h2>
                <p className="muted">Queue notices for periods ending within 14 days, or create one manually.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void runRenewals()}>
                Run renewal job
              </button>
            </div>
            <form
              className="admin-form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                await api("/admin/subscriptions/notices", { method: "POST", body: JSON.stringify(notice) });
                setNotice({ title: "", body: "", kind: "renewal", dueAt: "" });
                await reload();
              }}
            >
              <label className="field">
                <span>Title</span>
                <input value={notice.title} onChange={(e) => setNotice({ ...notice, title: e.target.value })} required />
              </label>
              <label className="field">
                <span>Due</span>
                <input type="datetime-local" value={notice.dueAt} onChange={(e) => setNotice({ ...notice, dueAt: e.target.value })} />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>Message</span>
                <textarea rows={2} value={notice.body} onChange={(e) => setNotice({ ...notice, body: e.target.value })} required />
              </label>
              <button type="submit" className="btn btn-primary">Schedule notice</button>
            </form>
            <div className="tracker-list">
              {notices.map((n) => (
                <div key={n.id} className="tracker-row">
                  <div>
                    <strong>{n.title}</strong>
                    <span className="muted">{n.kind} · {n.sentAt ? "sent" : "queued"}</span>
                  </div>
                  {!n.sentAt ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        await api(`/admin/subscriptions/notices/${n.id}/send`, { method: "POST" });
                        await reload();
                      }}
                    >
                      Mark sent
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel admin-card admin-pane" id="plan-editor">
          {editing ? (
            <>
              <div className="analytics-toolbar">
                <div>
                  <h2>Edit {unlimitedEdit ? "unlimited" : "limited"} mode</h2>
                  <p className="muted">
                    {unlimitedEdit
                      ? "Price and copy for paid checkout. Records stay unlimited."
                      : "Record cap is enforced on the operator app as soon as you save."}
                  </p>
                </div>
                <span className={unlimitedEdit ? "pill pill-success" : "pill pill-warning"}>
                  {unlimitedEdit ? "Unlimited" : "Limited"}
                </span>
              </div>
              <form className="admin-form-grid sub-editor-form" onSubmit={savePlan}>
                <label className="field">
                  <span>Display name</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </label>
                <label className="field">
                  <span>Tagline</span>
                  <input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
                </label>
                {!unlimitedEdit ? (
                  <label className="field">
                    <span>Records per tool (enforced live)</span>
                    <input
                      type="number"
                      min={1}
                      value={form.recordLimit}
                      onChange={(e) => setForm({ ...form, recordLimit: e.target.value })}
                      required
                    />
                  </label>
                ) : null}
                <label className="field">
                  <span>Price (INR)</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={form.priceInr}
                    onChange={(e) => setForm({ ...form, priceInr: e.target.value })}
                    required={unlimitedEdit}
                  />
                </label>
                <label className="field">
                  <span>Billing interval</span>
                  <select value={form.billingInterval} onChange={(e) => setForm({ ...form, billingInterval: e.target.value })}>
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </label>
                <label className="field">
                  <span>Tier label</span>
                  <input
                    value={form.tierLabel}
                    onChange={(e) => setForm({ ...form, tierLabel: e.target.value })}
                    placeholder={unlimitedEdit ? "Growth" : "Starter"}
                  />
                </label>
                {unlimitedEdit ? (
                  <label className="field">
                    <span>Trial days (on assign)</span>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={form.trialDays}
                      onChange={(e) => setForm({ ...form, trialDays: e.target.value })}
                    />
                  </label>
                ) : null}
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  <span>Description</span>
                  <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  <span>Marketing bullets (comma separated — display only)</span>
                  <textarea
                    rows={3}
                    value={form.features}
                    onChange={(e) => setForm({ ...form, features: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Available on operator checkout</span>
                  <select
                    value={form.available ? "yes" : "no"}
                    onChange={(e) => setForm({ ...form, available: e.target.value === "yes" })}
                  >
                    <option value="yes">Yes — listed</option>
                    <option value="no">No — hidden</option>
                  </select>
                </label>
                <div className="admin-form-row">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? "Saving…" : "Save mode"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <h2>Editor</h2>
              <p className="muted">Select a mode on the left to configure it here.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
