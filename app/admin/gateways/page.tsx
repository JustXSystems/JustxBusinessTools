"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Gateway = {
  id: number;
  provider: string;
  displayName: string;
  mode: string;
  enabled: boolean;
  mappedPlanIds: string[];
  config?: Record<string, unknown>;
  lastHealth: string | null;
  lastHealthAt: string | null;
};

type GwEvent = { id: number; eventType: string; message: string | null; createdAt: string };
type Plan = { id: string; name: string; available: boolean };
type Filter = "all" | "live" | "test" | "enabled" | "off" | "unhealthy";
type Pane = "health" | "config" | "plans" | "trace";

const PROVIDERS = [
  { id: "razorpay", label: "Razorpay", hint: "UPI, cards, netbanking (India)" },
  { id: "stripe", label: "Stripe", hint: "Cards and international" },
  { id: "cashfree", label: "Cashfree", hint: "UPI and payouts" },
  { id: "mock", label: "Mock (dev)", hint: "Sandbox — no live charges" },
] as const;

const emptyForm = {
  provider: "razorpay",
  displayName: "Razorpay",
  mode: "test",
  keyId: "",
  keySecret: "",
  webhookSecret: "",
  mappedPlanIds: [] as string[],
};

function healthClass(health: string | null, enabled: boolean) {
  if (!enabled) return "pill";
  if (health === "ok" || health === "healthy") return "pill pill-success";
  if (health === "fail" || health === "error" || health === "down") return "pill pill-danger";
  return "pill pill-warning";
}

function healthLabel(g: Gateway) {
  if (!g.enabled) return "offline";
  return g.lastHealth ?? "untested";
}

function fmtWhen(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

function relativeAgo(value: string | null) {
  if (!value) return "Never checked";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return fmtWhen(value);
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function eventClass(type: string) {
  if (type === "health_check" || type === "created") return "pill-success";
  if (type === "updated") return "pill-warning";
  if (type.includes("fail") || type.includes("error")) return "pill-danger";
  return "";
}

function secretPlaceholder(config: Record<string, unknown> | undefined, key: string) {
  const v = config?.[key];
  return typeof v === "string" && v ? v : "";
}

function credentialLabels(provider: string) {
  if (provider === "stripe") return { keyId: "Publishable key", secret: "Secret key" };
  if (provider === "cashfree") return { keyId: "App ID", secret: "Secret key" };
  if (provider === "mock") return { keyId: "Sandbox token (optional)", secret: "Sandbox secret (optional)" };
  return { keyId: "Key / client id", secret: "Secret" };
}

export default function AdminGatewaysPage() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [events, setEvents] = useState<GwEvent[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [pane, setPane] = useState<Pane>("health");
  const [form, setForm] = useState(emptyForm);
  const [edit, setEdit] = useState({
    displayName: "",
    mode: "test",
    keyId: "",
    keySecret: "",
    webhookSecret: "",
    mappedPlanIds: [] as string[],
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async (keepId?: number | null) => {
    setError("");
    const [g, p] = await Promise.all([
      api<{ gateways: Gateway[] }>("/admin/gateways"),
      api<{ plans: Plan[] }>("/admin/subscriptions/plans").catch(() => ({ plans: [] as Plan[] })),
    ]);
    setGateways(g.gateways);
    setPlans(p.plans);
    const prefer = keepId ?? selectedId;
    const nextId = prefer && g.gateways.some((x) => x.id === prefer) ? prefer : (g.gateways[0]?.id ?? null);
    setSelectedId(nextId);
    return { gateways: g.gateways, nextId };
  }, [selectedId]);

  const loadEvents = useCallback(async (id: number) => {
    const data = await api<{ events: GwEvent[] }>(`/admin/gateways/${id}/events`);
    setEvents(data.events);
  }, []);

  useEffect(() => {
    setLoading(true);
    load()
      .then(({ nextId }) => {
        if (nextId != null) return loadEvents(nextId);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = gateways.find((g) => g.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setEdit({
      displayName: selected.displayName,
      mode: selected.mode,
      keyId: "",
      keySecret: "",
      webhookSecret: "",
      mappedPlanIds: [...(selected.mappedPlanIds ?? [])],
    });
  }, [selected]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return gateways.filter((g) => {
      if (filter === "live" && g.mode !== "live") return false;
      if (filter === "test" && g.mode !== "test") return false;
      if (filter === "enabled" && !g.enabled) return false;
      if (filter === "off" && g.enabled) return false;
      if (filter === "unhealthy" && (g.lastHealth === "ok" || !g.enabled)) return false;
      if (!q) return true;
      return `${g.displayName} ${g.provider} ${g.mode} ${(g.mappedPlanIds ?? []).join(" ")}`.toLowerCase().includes(q);
    });
  }, [gateways, filter, query]);

  const summary = useMemo(() => {
    const live = gateways.filter((g) => g.mode === "live").length;
    const enabled = gateways.filter((g) => g.enabled).length;
    const unhealthy = gateways.filter((g) => g.enabled && g.lastHealth !== "ok").length;
    return { total: gateways.length, live, enabled, unhealthy };
  }, [gateways]);

  async function selectGateway(id: number) {
    setSelectedId(id);
    setPane("health");
    setShowAdd(false);
    try {
      await loadEvents(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load trace");
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setMessage("");
    setError("");
    try {
      await fn();
      setMessage(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(g: Gateway) {
    await run(g.enabled ? "Gateway disabled." : "Gateway enabled.", async () => {
      await api(`/admin/gateways/${g.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !g.enabled }),
      });
      await load(g.id);
      await loadEvents(g.id);
    });
  }

  async function testGateway(g: Gateway) {
    await run("Health check passed (sandbox).", async () => {
      await api(`/admin/gateways/${g.id}/test`, { method: "POST" });
      await load(g.id);
      await loadEvents(g.id);
      setPane("trace");
    });
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const config: Record<string, string> = {};
    if (edit.keyId.trim()) config.keyId = edit.keyId.trim();
    if (edit.keySecret.trim()) config.keySecret = edit.keySecret.trim();
    if (edit.webhookSecret.trim()) config.webhookSecret = edit.webhookSecret.trim();
    await run("Configuration saved. Secrets stay masked.", async () => {
      await api(`/admin/gateways/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName: edit.displayName.trim(),
          mode: edit.mode,
          mappedPlanIds: edit.mappedPlanIds,
          config,
        }),
      });
      await load(selected.id);
      await loadEvents(selected.id);
    });
  }

  async function savePlans() {
    if (!selected) return;
    await run("Plan mapping updated.", async () => {
      await api(`/admin/gateways/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({ mappedPlanIds: edit.mappedPlanIds }),
      });
      await load(selected.id);
      await loadEvents(selected.id);
    });
  }

  async function createGateway(e: React.FormEvent) {
    e.preventDefault();
    await run("Gateway created (starts disabled).", async () => {
      const created = await api<{ id: number }>("/admin/gateways", {
        method: "POST",
        body: JSON.stringify({
          provider: form.provider,
          displayName: form.displayName.trim(),
          mode: form.mode,
          mappedPlanIds: form.mappedPlanIds,
          config: {
            keyId: form.keyId,
            keySecret: form.keySecret,
            webhookSecret: form.webhookSecret,
          },
          enabled: false,
        }),
      });
      setForm(emptyForm);
      setShowAdd(false);
      const { nextId } = await load(created.id);
      if (nextId != null) await loadEvents(nextId);
    });
  }

  const labels = credentialLabels(selected?.provider ?? form.provider);

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Gateways</h2>
            <p className="muted">
              Connect Razorpay, Stripe, or Cashfree, map them to plans, and keep a health trace before going live.
            </p>
          </div>
          <div className="admin-form-row">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={loading || Boolean(busy)}
              onClick={() =>
                run("Refreshed.", async () => {
                  const { nextId } = await load(selectedId);
                  if (nextId != null) await loadEvents(nextId);
                })
              }
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <Link href="/admin/upi" className="btn btn-ghost btn-sm">
              UPI QR (default)
            </Link>
            <Link href="/admin/payments" className="btn btn-ghost btn-sm">
              Payments
            </Link>
            <Link href="/admin/subscriptions" className="btn btn-ghost btn-sm">
              Plans
            </Link>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
              Add gateway
            </button>
          </div>
        </div>
        <div className="analytics-kpis">
          <button type="button" className={`result-card ${filter === "all" ? "is-selected" : ""}`} onClick={() => setFilter("all")}>
            <span>Providers</span>
            <strong>{summary.total}</strong>
          </button>
          <button type="button" className={`result-card ${filter === "enabled" ? "is-selected" : ""}`} onClick={() => setFilter("enabled")}>
            <span>Enabled</span>
            <strong>{summary.enabled}</strong>
          </button>
          <button type="button" className={`result-card ${filter === "live" ? "is-selected" : ""}`} onClick={() => setFilter("live")}>
            <span>Live mode</span>
            <strong>{summary.live}</strong>
            <span className={`analytics-delta ${summary.live ? "is-down" : ""}`}>Real charges</span>
          </button>
          <button
            type="button"
            className={`result-card ${filter === "unhealthy" ? "is-selected" : ""}`}
            onClick={() => setFilter("unhealthy")}
          >
            <span>Needs check</span>
            <strong>{summary.unhealthy}</strong>
            <span className={`analytics-delta ${summary.unhealthy ? "is-down" : "is-up"}`}>
              Untested or failed
            </span>
          </button>
        </div>
      </section>

      {error ? <p className="field-error">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <div className="admin-split payments-split">
        <section className="panel admin-card admin-pane">
          <h2>Directory</h2>
          <div className="admin-form-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, provider, plan"
              aria-label="Search gateways"
            />
            <div className="admin-tabs">
              {(["all", "enabled", "off", "live", "test", "unhealthy"] as Filter[]).map((f) => (
                <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="tracker-list">
            {visible.map((g) => (
              <button
                type="button"
                key={g.id}
                className={`tracker-row admin-member-row ${selectedId === g.id ? "is-selected" : ""}`}
                onClick={() => void selectGateway(g.id)}
              >
                <div>
                  <strong>{g.displayName}</strong>
                  <span className="muted">
                    {g.provider} · {g.mode} · {(g.mappedPlanIds ?? []).join(", ") || "no plans"}
                  </span>
                </div>
                <div className="admin-form-row">
                  <span className={g.enabled ? "pill pill-success" : "pill"}>{g.enabled ? "on" : "off"}</span>
                  <span className={healthClass(g.lastHealth, g.enabled)}>{healthLabel(g)}</span>
                </div>
              </button>
            ))}
            {visible.length === 0 ? <p className="muted">No gateways match this filter.</p> : null}
          </div>
        </section>

        <div className="admin-pane-stack">
          {showAdd ? (
            <section className="panel admin-card">
              <h2>Add gateway</h2>
              <p className="muted">Starts disabled. Run a health check before enabling live mode.</p>
              <form className="admin-form-grid" onSubmit={createGateway}>
                <label className="field">
                  <span>Provider</span>
                  <select
                    value={form.provider}
                    onChange={(e) => {
                      const provider = e.target.value;
                      const meta = PROVIDERS.find((p) => p.id === provider);
                      setForm({
                        ...form,
                        provider,
                        displayName: meta?.label ?? provider,
                      });
                    }}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Display name</span>
                  <input
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>Mode</span>
                  <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                    <option value="test">Test</option>
                    <option value="live">Live</option>
                  </select>
                </label>
                <label className="field">
                  <span>{credentialLabels(form.provider).keyId}</span>
                  <input value={form.keyId} onChange={(e) => setForm({ ...form, keyId: e.target.value })} autoComplete="off" />
                </label>
                <label className="field">
                  <span>{credentialLabels(form.provider).secret}</span>
                  <input
                    type="password"
                    value={form.keySecret}
                    onChange={(e) => setForm({ ...form, keySecret: e.target.value })}
                    autoComplete="new-password"
                  />
                </label>
                <label className="field">
                  <span>Webhook secret</span>
                  <input
                    type="password"
                    value={form.webhookSecret}
                    onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                    autoComplete="new-password"
                  />
                </label>
                {plans.length > 0 ? (
                  <div className="field gw-plan-field">
                    <span>Map to plans</span>
                    <div className="gw-plan-chips">
                      {plans.map((p) => {
                        const on = form.mappedPlanIds.includes(p.id);
                        return (
                          <button
                            type="button"
                            key={p.id}
                            className={`pill ${on ? "pill-success" : ""}`}
                            onClick={() =>
                              setForm({
                                ...form,
                                mappedPlanIds: on
                                  ? form.mappedPlanIds.filter((id) => id !== p.id)
                                  : [...form.mappedPlanIds, p.id],
                              })
                            }
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="admin-form-row">
                  <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
                    Save gateway
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          ) : selected ? (
            <section className="panel admin-card">
              <div className="analytics-toolbar">
                <div>
                  <h2>{selected.displayName}</h2>
                  <p className="muted">
                    {PROVIDERS.find((p) => p.id === selected.provider)?.hint ?? selected.provider}
                    {" · "}
                    last check {relativeAgo(selected.lastHealthAt)}
                  </p>
                </div>
                <div className="admin-form-row">
                  <span className={selected.mode === "live" ? "pill pill-danger" : "pill pill-warning"}>{selected.mode}</span>
                  <span className={healthClass(selected.lastHealth, selected.enabled)}>{healthLabel(selected)}</span>
                </div>
              </div>
              <div className="admin-tabs">
                {(["health", "config", "plans", "trace"] as Pane[]).map((t) => (
                  <button key={t} type="button" className={pane === t ? "active" : ""} onClick={() => setPane(t)}>
                    {t === "trace" ? `Trace (${events.length})` : t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {pane === "health" ? (
                <div className="admin-stack">
                  <ul className="admin-kv">
                    <li>
                      <span>Provider</span>
                      <strong>{selected.provider}</strong>
                    </li>
                    <li>
                      <span>Mode</span>
                      <strong>{selected.mode}</strong>
                    </li>
                    <li>
                      <span>Status</span>
                      <span className={selected.enabled ? "pill pill-success" : "pill"}>{selected.enabled ? "enabled" : "disabled"}</span>
                    </li>
                    <li>
                      <span>Last health</span>
                      <strong>
                        {healthLabel(selected)} · {fmtWhen(selected.lastHealthAt)}
                      </strong>
                    </li>
                    <li>
                      <span>Key id</span>
                      <strong>{secretPlaceholder(selected.config, "keyId") || "not set"}</strong>
                    </li>
                  </ul>
                  {selected.mode === "live" && selected.enabled ? (
                    <p className="field-error">Live + enabled: this provider can take real payments.</p>
                  ) : null}
                  <div className="admin-form-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={Boolean(busy)}
                      onClick={() => void testGateway(selected)}
                    >
                      Run health check
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => void toggleEnabled(selected)}
                    >
                      {selected.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>
              ) : null}

              {pane === "config" ? (
                <form className="admin-form-grid" onSubmit={saveConfig}>
                  <label className="field">
                    <span>Display name</span>
                    <input
                      value={edit.displayName}
                      onChange={(e) => setEdit({ ...edit, displayName: e.target.value })}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Mode</span>
                    <select value={edit.mode} onChange={(e) => setEdit({ ...edit, mode: e.target.value })}>
                      <option value="test">Test</option>
                      <option value="live">Live</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{labels.keyId}</span>
                    <input
                      value={edit.keyId}
                      onChange={(e) => setEdit({ ...edit, keyId: e.target.value })}
                      placeholder={secretPlaceholder(selected.config, "keyId") || "Leave blank to keep"}
                      autoComplete="off"
                    />
                  </label>
                  <label className="field">
                    <span>{labels.secret}</span>
                    <input
                      type="password"
                      value={edit.keySecret}
                      onChange={(e) => setEdit({ ...edit, keySecret: e.target.value })}
                      placeholder={secretPlaceholder(selected.config, "keySecret") || "Leave blank to keep"}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="field">
                    <span>Webhook secret</span>
                    <input
                      type="password"
                      value={edit.webhookSecret}
                      onChange={(e) => setEdit({ ...edit, webhookSecret: e.target.value })}
                      placeholder={secretPlaceholder(selected.config, "webhookSecret") || "Optional"}
                      autoComplete="new-password"
                    />
                  </label>
                  <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
                    Save config
                  </button>
                </form>
              ) : null}

              {pane === "plans" ? (
                <div className="admin-stack">
                  <p className="muted">Checkout for these plans will use this gateway when it is enabled.</p>
                  {plans.length === 0 ? (
                    <p className="muted">
                      No plans loaded. Create them under <Link href="/admin/subscriptions">Subscriptions</Link>.
                    </p>
                  ) : (
                    <div className="gw-plan-chips">
                      {plans.map((p) => {
                        const on = edit.mappedPlanIds.includes(p.id);
                        return (
                          <button
                            type="button"
                            key={p.id}
                            className={`pill ${on ? "pill-success" : ""}`}
                            onClick={() =>
                              setEdit({
                                ...edit,
                                mappedPlanIds: on
                                  ? edit.mappedPlanIds.filter((id) => id !== p.id)
                                  : [...edit.mappedPlanIds, p.id],
                              })
                            }
                          >
                            {p.name}
                            {!p.available ? " (off)" : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void savePlans()}>
                    Save mapping
                  </button>
                </div>
              ) : null}

              {pane === "trace" ? (
                <ul className="gw-timeline">
                  {events.length === 0 ? (
                    <li className="muted">No events yet. Run a health check to start the trace.</li>
                  ) : (
                    events.map((ev) => (
                      <li key={ev.id}>
                        <span className={`pill ${eventClass(ev.eventType)}`}>{ev.eventType.replace(/_/g, " ")}</span>
                        <div>
                          <strong>{ev.message || ev.eventType}</strong>
                          <span className="muted">{fmtWhen(ev.createdAt)}</span>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </section>
          ) : (
            <section className="panel admin-card">
              <h2>No providers yet</h2>
              <p className="muted">Add Razorpay, Stripe, Cashfree, or a mock gateway for local testing.</p>
              <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
                Add gateway
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
