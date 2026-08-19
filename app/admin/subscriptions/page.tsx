"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

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
  });
  const [notice, setNotice] = useState({ title: "", body: "", kind: "renewal", dueAt: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const limited = plans.find((p) => p.accessMode === "limited" || p.id === "free");
  const paid = plans.find((p) => p.accessMode === "unlimited" || p.id === "pro");
  const editing = plans.find((p) => p.id === editingId) ?? limited ?? paid ?? null;

  async function reload() {
    const [p, a, n] = await Promise.all([
      api<{ plans: Plan[] }>("/admin/subscriptions/plans"),
      api<{ subscription: Active | null }>("/admin/subscriptions/active"),
      api<{ notices: Notice[] }>("/admin/subscriptions/notices"),
    ]);
    setPlans(p.plans);
    setActive(a.subscription);
    setNotices(n.notices);
    return p.plans;
  }

  useEffect(() => {
    reload()
      .then((list) => {
        const first = list.find((x) => x.id === "free") ?? list[0];
        if (first) startEdit(first);
      })
      .catch((e: Error) => setMessage(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        }),
      });
      const keepId = editingId;
      const next = await reload();
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
        });
      }
      setMessage("Saved. Operator app picks this up on the next usage check (within seconds).");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function assign(planId: string) {
    setSaving(true);
    setMessage("");
    try {
      await api("/admin/subscriptions/assign", {
        method: "POST",
        body: JSON.stringify({ planId }),
      });
      setMessage("Operator org switched to this mode. Limits apply on the next create.");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setSaving(false);
    }
  }

  const unlimitedEdit = editing?.accessMode === "unlimited" || editingId === "pro";

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Operator access</h2>
            <p className="muted">
              Record cap for unlicensed tools. Per-tool prices and cart checkout live in{" "}
              <Link href="/admin/skus">SKU pricing</Link>. Paid upgrades collect UPI — verify in{" "}
              <Link href="/admin/upi">UPI verify</Link>. Assigning Unlimited licenses every paid SKU;
              Limited revokes those licenses.
            </p>
          </div>
          <Link href="/admin/skus" className="btn btn-primary btn-sm">
            SKU pricing
          </Link>
        </div>
        <div className="analytics-kpis">
          <div className="result-card">
            <span>Current mode</span>
            <strong>{active?.planName ?? "—"}</strong>
            <span className="analytics-delta">{active?.accessMode ?? active?.planId ?? ""}</span>
          </div>
          <div className="result-card">
            <span>Status</span>
            <strong>{active?.status ?? "—"}</strong>
          </div>
          <div className="result-card">
            <span>Record limit</span>
            <strong>{active?.recordLimit == null ? "Unlimited" : `${active.recordLimit} / tool`}</strong>
          </div>
          <div className="result-card">
            <span>MRR</span>
            <strong>{inr(active?.mrrInr ?? 0)}</strong>
            <span className="analytics-delta">Renews {active?.periodEnd?.slice(0, 10) ?? "—"}</span>
          </div>
        </div>
        {message ? <p className="muted">{message}</p> : null}
      </section>

      <div className="admin-split sub-workspace">
        <div className="admin-pane-stack">
          <section className="panel admin-card admin-pane">
            <h2>Modes</h2>
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
                        {unlimited ? "Unlimited" : "Limited"}
                      </span>
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
            <h2>Renewal notifications</h2>
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
