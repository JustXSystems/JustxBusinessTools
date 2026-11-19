"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminOrgSelect } from "@/components/admin/AdminOrgSelect";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
} from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  FormGrid,
  Grid,
  KpiCard,
  SearchInput,
  cx,
  type BosBadgeTone,
} from "@/components/bos";
import { api } from "@/lib/api";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useRevealWhenStacked } from "@/hooks/useRevealWhenStacked";
import { adminDeepLink } from "@/lib/admin-deep-links";

type Gateway = {
  id: number;
  organizationId?: number;
  organizationName?: string | null;
  provider: string;
  displayName: string;
  mode: string;
  enabled: boolean;
  mappedPlanIds: string[];
  config?: Record<string, unknown>;
  lastHealth: string | null;
  lastHealthAt: string | null;
};

type GwEvent = {
  id: number;
  eventType: string;
  message: string | null;
  createdAt: string;
  hasPayload?: boolean;
  payload?: unknown;
};
type Plan = { id: string; name: string; available: boolean };
type Filter = "all" | "live" | "test" | "enabled" | "off" | "unhealthy";
type Pane = "health" | "config" | "plans" | "trace";

const PROVIDERS = [
  { id: "razorpay", label: "Razorpay", hint: "UPI, cards, netbanking (India)" },
  { id: "stripe", label: "Stripe", hint: "Cards and international" },
  { id: "cashfree", label: "Cashfree", hint: "UPI and payouts" },
  { id: "mock", label: "Mock (dev)", hint: "Sandbox — no live charges" },
] as const;

const FILTERS: ReadonlyArray<Filter> = ["all", "enabled", "off", "live", "test", "unhealthy"];
const PANES: ReadonlyArray<Pane> = ["health", "config", "plans", "trace"];

const emptyForm = {
  provider: "razorpay",
  displayName: "Razorpay",
  mode: "test",
  keyId: "",
  keySecret: "",
  webhookSecret: "",
  mappedPlanIds: [] as string[],
};

function healthTone(health: string | null, enabled: boolean): BosBadgeTone {
  if (!enabled) return "neutral";
  if (health === "ok" || health === "healthy") return "emerald";
  if (health === "fail" || health === "error" || health === "down") return "coral";
  return "amber";
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

function eventTone(type: string): BosBadgeTone {
  if (type === "health_check" || type === "created" || type === "webhook.replay") return "emerald";
  if (type.startsWith("webhook.")) return "amber";
  if (type === "updated") return "amber";
  if (type.includes("fail") || type.includes("error")) return "coral";
  return "neutral";
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

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export default function AdminGatewaysPage() {
  return (
    <Suspense fallback={<AdminPageSkeleton cards={4} />}>
      <AdminGatewaysInner />
    </Suspense>
  );
}

function AdminGatewaysInner() {
  const search = useSearchParams();
  const filterFromUrl = useMemo((): Filter => {
    const f = search.get("filter");
    if (f === "live" || f === "test" || f === "enabled" || f === "off" || f === "unhealthy") return f;
    return "all";
  }, [search]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [events, setEvents] = useState<GwEvent[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { ref: detailRef, reveal: revealDetail } = useRevealWhenStacked<HTMLElement>();
  const [filter, setFilter] = useState<Filter>(filterFromUrl);
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
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [createOrgId, setCreateOrgId] = useState<number | null>(null);

  useEffect(() => {
    setFilter(filterFromUrl);
  }, [filterFromUrl]);

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

  const refresh = useCallback(async () => {
    try {
      const { nextId } = await load();
      if (nextId != null) await loadEvents(nextId);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load gateways");
    } finally {
      setLoading(false);
    }
  }, [load, loadEvents]);

  useLiveRefresh(refresh, { intervalMs: 45_000 });

  const selected = gateways.find((g) => g.id === selectedId) ?? null;
  const editSeededFor = useRef<number | null>(null);

  useEffect(() => {
    if (selectedId == null) {
      editSeededFor.current = null;
      return;
    }
    if (editSeededFor.current === selectedId) return;
    const row = gateways.find((g) => g.id === selectedId);
    if (!row) return;
    editSeededFor.current = selectedId;
    setEdit({
      displayName: row.displayName,
      mode: row.mode,
      keyId: "",
      keySecret: "",
      webhookSecret: "",
      mappedPlanIds: [...(row.mappedPlanIds ?? [])],
    });
  }, [selectedId, gateways]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return gateways.filter((g) => {
      if (filter === "live" && g.mode !== "live") return false;
      if (filter === "test" && g.mode !== "test") return false;
      if (filter === "enabled" && !g.enabled) return false;
      if (filter === "off" && g.enabled) return false;
      if (filter === "unhealthy" && (g.lastHealth === "ok" || !g.enabled)) return false;
      if (!q) return true;
      return `${g.displayName} ${g.organizationName ?? ""} ${g.provider} ${g.mode} ${(g.mappedPlanIds ?? []).join(" ")}`.toLowerCase().includes(q);
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
      invalidateAdminData("admin-gateways");
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

  async function replayEvent(g: Gateway, ev: GwEvent) {
    await run(`Replayed event #${ev.id}.`, async () => {
      await api(`/admin/gateways/${g.id}/events/${ev.id}/replay`, { method: "POST", body: "{}" });
      await loadEvents(g.id);
      setPane("trace");
    });
  }

  async function injectSampleWebhook(g: Gateway) {
    const sample = {
      type: "subscription.activated",
      profileId: 1,
      planId: "pro",
      sessionId: `replay_${Date.now()}`,
      periodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await run("Sample webhook processed.", async () => {
      await api(`/admin/gateways/${g.id}/events/0/replay`, {
        method: "POST",
        body: JSON.stringify({ payload: sample }),
      });
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
    if (createOrgId == null) {
      setError("Select an organization for the new gateway");
      return;
    }
    await run("Gateway created (starts disabled).", async () => {
      const created = await api<{ id: number }>("/admin/gateways", {
        method: "POST",
        body: JSON.stringify({
          organizationId: createOrgId,
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
      setCreateOrgId(null);
      setShowAdd(false);
      const { nextId } = await load(created.id);
      if (nextId != null) await loadEvents(nextId);
    });
  }

  if (!loaded) {
    if (error) {
      return (
        <AdminPage title="Gateways" sub="Payment providers per organization">
          <AdminErrorState message={error} onRetry={() => void refresh()} />
        </AdminPage>
      );
    }
    return <AdminPageSkeleton cards={4} />;
  }

  const labels = credentialLabels(selected?.provider ?? form.provider);

  const filterOptions = FILTERS.map((f) => ({ value: f, label: cap(f) }));
  const paneOptions = PANES.map((p) => ({
    value: p,
    label: p === "trace" ? `Trace (${events.length})` : cap(p),
  }));

  const kpi = (
    key: Filter,
    label: string,
    value: number,
    chip: { color: "blue" | "amber" | "mint" | "lavender" | "rose" | "sage"; glyph: string },
    delta: string,
    deltaTone: "up" | "down" | "warn" | "info" | "muted",
  ) => (
    <button
      type="button"
      className={cx("admin-cc-kpi-btn", filter === key && "is-selected")}
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
    >
      <KpiCard label={label} value={value} chip={chip} delta={delta} deltaTone={deltaTone} />
    </button>
  );

  const planChips = (
    selectedIds: string[],
    toggle: (id: string, on: boolean) => void,
    showOff: boolean,
  ) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {plans.map((p) => {
        const on = selectedIds.includes(p.id);
        return (
          <Button
            key={p.id}
            size="sm"
            variant={on ? "primary" : "secondary"}
            aria-pressed={on}
            onClick={() => toggle(p.id, on)}
          >
            {p.name}
            {showOff && !p.available ? " (off)" : ""}
          </Button>
        );
      })}
    </div>
  );

  return (
    <AdminPage
      title="Gateways"
      sub="Razorpay · Stripe · Cashfree per organization"
      toolbar={
        <>
          <Badge auto tone={summary.unhealthy ? "amber" : "emerald"}>
            {summary.unhealthy ? `${summary.unhealthy} need check` : "All healthy"}
          </Badge>
          <Link href={adminDeepLink.upi()}>
            <Button variant="ghost" size="sm">
              UPI QR (default)
            </Button>
          </Link>
          <Link href={adminDeepLink.payments()}>
            <Button variant="ghost" size="sm">
              Payments
            </Button>
          </Link>
          <Link href={adminDeepLink.subscriptions()}>
            <Button variant="ghost" size="sm">
              Plans
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            icon="refresh"
            disabled={loading || Boolean(busy)}
            onClick={() =>
              void run("Refreshed.", async () => {
                const { nextId } = await load(selectedId);
                if (nextId != null) await loadEvents(nextId);
              })
            }
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setShowAdd(true)}>
            Add gateway
          </Button>
        </>
      }
    >
      <Alert tone="blue" title="Per-organization gateways">
        Connect Razorpay, Stripe, or Cashfree per organization. Operator Business Profile selection is ignored — pick the
        org when adding a gateway.
      </Alert>

      <Grid cols={4} min={140} gap={12}>
        {kpi("all", "Providers", summary.total, { color: "blue", glyph: "◎" }, "Show all", "muted")}
        {kpi("enabled", "Enabled", summary.enabled, { color: "mint", glyph: "✓" }, "Taking checkouts", "muted")}
        {kpi("live", "Live mode", summary.live, { color: "rose", glyph: "₹" }, "Real charges", summary.live ? "down" : "muted")}
        {kpi(
          "unhealthy",
          "Needs check",
          summary.unhealthy,
          { color: "amber", glyph: "◈" },
          "Untested or failed",
          summary.unhealthy ? "warn" : "up",
        )}
      </Grid>

      {error ? <AdminErrorState title="Action or refresh failed" message={error} onRetry={() => void refresh()} /> : null}
      {message ? <Alert tone="emerald" title={message} /> : null}

      <div className="admin-cc-split">
        <AdminSection title="Directory" description={`${visible.length} of ${gateways.length} shown`}>
          <div className="admin-cc-stack">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, provider, plan"
              aria-label="Search gateways"
            />
            <AdminTabs aria-label="Gateway filter" options={filterOptions} value={filter} onChange={setFilter} />
          </div>
          <div className="admin-cc-dir-list">
            {visible.map((g) => {
              const active = selectedId === g.id;
              return (
                <button
                  type="button"
                  key={g.id}
                  className={cx("admin-cc-row", active && "is-selected")}
                  aria-pressed={active}
                  onClick={() => {
                    void selectGateway(g.id);
                    revealDetail();
                  }}
                >
                  <div className="admin-cc-row-main">
                    <div className="admin-cc-cell-title">
                      {g.displayName}
                      {g.organizationName ? <span className="admin-cc-cell-sub"> · {g.organizationName}</span> : null}
                    </div>
                    <div className="admin-cc-cell-sub">
                      {g.provider} · {g.mode} · {(g.mappedPlanIds ?? []).join(", ") || "no plans"}
                    </div>
                  </div>
                  <div className="admin-cc-row-badges">
                    <Badge auto tone={g.enabled ? "emerald" : "neutral"}>
                      {g.enabled ? "on" : "off"}
                    </Badge>
                    <Badge auto tone={healthTone(g.lastHealth, g.enabled)}>
                      {healthLabel(g)}
                    </Badge>
                  </div>
                </button>
              );
            })}
            {visible.length === 0 ? (
              <AdminEmpty title="No gateways match" icon="search">
                No gateways match this filter.
              </AdminEmpty>
            ) : null}
          </div>
        </AdminSection>

        <section ref={detailRef} className="bos-widget admin-cc-section" style={{ minWidth: 0 }}>
          {selected ? (
            <>
              <div className="admin-cc-detail-head">
                <div>
                  <h3 className="admin-cc-detail-title">{selected.displayName}</h3>
                  <p className="admin-cc-detail-sub">
                    {PROVIDERS.find((p) => p.id === selected.provider)?.hint ?? selected.provider}
                    {" · "}
                    last check {relativeAgo(selected.lastHealthAt)}
                  </p>
                </div>
                <div className="admin-cc-actions">
                  <Badge auto tone={selected.mode === "live" ? "coral" : "amber"}>
                    {selected.mode}
                  </Badge>
                  <Badge auto tone={healthTone(selected.lastHealth, selected.enabled)}>
                    {healthLabel(selected)}
                  </Badge>
                </div>
              </div>

              <div className="admin-cc-tabs-bar">
                <AdminTabs aria-label="Gateway detail" options={paneOptions} value={pane} onChange={setPane} />
                <div className="admin-cc-actions">
                  {pane === "health" ? (
                    <Button variant="primary" size="sm" disabled={Boolean(busy)} onClick={() => void testGateway(selected)}>
                      Run health check
                    </Button>
                  ) : null}
                  {pane === "config" ? (
                    <Button type="submit" form="gateway-config-form" variant="primary" size="sm" disabled={Boolean(busy)}>
                      Save config
                    </Button>
                  ) : null}
                  {pane === "plans" ? (
                    <Button variant="primary" size="sm" disabled={Boolean(busy)} onClick={() => void savePlans()}>
                      Save mapping
                    </Button>
                  ) : null}
                </div>
              </div>

              {pane === "health" ? (
                <div className="admin-cc-form">
                  <ul className="admin-cc-kv">
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
                      <strong>
                        <Badge auto tone={selected.enabled ? "emerald" : "neutral"}>
                          {selected.enabled ? "enabled" : "disabled"}
                        </Badge>
                      </strong>
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
                    <Alert tone="coral" title="Live + enabled">
                      This provider can take real payments.
                    </Alert>
                  ) : null}
                  <div className="admin-cc-form-actions">
                    <Button
                      variant={selected.enabled ? "destructive" : "secondary"}
                      disabled={Boolean(busy)}
                      onClick={() => void toggleEnabled(selected)}
                    >
                      {selected.enabled ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {pane === "config" ? (
                <form id="gateway-config-form" className="admin-cc-form" onSubmit={saveConfig}>
                  <FormGrid>
                    <TextField
                      label="Display name"
                      value={edit.displayName}
                      onChange={(e) => setEdit({ ...edit, displayName: e.target.value })}
                      required
                    />
                    <SelectField
                      label="Mode"
                      value={edit.mode}
                      onChange={(e) => setEdit({ ...edit, mode: e.target.value })}
                    >
                      <option value="test">Test</option>
                      <option value="live">Live</option>
                    </SelectField>
                    <TextField
                      label={labels.keyId}
                      value={edit.keyId}
                      onChange={(e) => setEdit({ ...edit, keyId: e.target.value })}
                      placeholder={secretPlaceholder(selected.config, "keyId") || "Leave blank to keep"}
                      autoComplete="off"
                    />
                    <TextField
                      label={labels.secret}
                      type="password"
                      value={edit.keySecret}
                      onChange={(e) => setEdit({ ...edit, keySecret: e.target.value })}
                      placeholder={secretPlaceholder(selected.config, "keySecret") || "Leave blank to keep"}
                      autoComplete="new-password"
                    />
                    <TextField
                      label="Webhook secret"
                      type="password"
                      value={edit.webhookSecret}
                      onChange={(e) => setEdit({ ...edit, webhookSecret: e.target.value })}
                      placeholder={secretPlaceholder(selected.config, "webhookSecret") || "Optional"}
                      autoComplete="new-password"
                    />
                  </FormGrid>
                </form>
              ) : null}

              {pane === "plans" ? (
                <div className="admin-cc-form">
                  <p className="admin-cc-note-text">
                    Checkout for these plans will use this gateway when it is enabled.
                  </p>
                  {plans.length === 0 ? (
                    <AdminEmpty title="No plans loaded" icon="wallet">
                      Create them under{" "}
                      <Link className="admin-cc-link" href={adminDeepLink.subscriptions()}>
                        Plans &amp; entitlements
                      </Link>
                      .
                    </AdminEmpty>
                  ) : (
                    planChips(
                      edit.mappedPlanIds,
                      (id, on) =>
                        setEdit({
                          ...edit,
                          mappedPlanIds: on ? edit.mappedPlanIds.filter((x) => x !== id) : [...edit.mappedPlanIds, id],
                        }),
                      true,
                    )
                  )}
                </div>
              ) : null}

              {pane === "trace" ? (
                <div className="admin-cc-form">
                  <div className="admin-cc-form-actions">
                    <Button variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void injectSampleWebhook(selected)}>
                      Inject sample webhook
                    </Button>
                    <span className="admin-cc-cell-sub">Replays skip signature checks. Use for mock / recovery only.</span>
                  </div>
                  {events.length === 0 ? (
                    <AdminEmpty title="No events yet" icon="clock">
                      Run a health check or inject a sample webhook.
                    </AdminEmpty>
                  ) : (
                    <ul className="admin-cc-timeline">
                      {events.map((ev) => (
                        <li key={ev.id}>
                          <Badge auto tone={eventTone(ev.eventType)}>
                            {ev.eventType.replace(/_/g, " ")}
                          </Badge>
                          <div>
                            <div className="admin-cc-cell-title">{ev.message || ev.eventType}</div>
                            <div className="admin-cc-cell-sub">{fmtWhen(ev.createdAt)}</div>
                          </div>
                          {ev.hasPayload ? (
                            <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void replayEvent(selected, ev)}>
                              Replay
                            </Button>
                          ) : (
                            <span />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <AdminEmpty
              title="No providers yet"
              icon="wallet"
              actions={
                <Button variant="primary" onClick={() => setShowAdd(true)}>
                  Add gateway
                </Button>
              }
            >
              Add Razorpay, Stripe, Cashfree, or a mock gateway for local testing.
            </AdminEmpty>
          )}
        </section>
      </div>

      <Dialog
        wide
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add gateway"
        description="Starts disabled. Run a health check before enabling live mode."
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit" form="gateway-create-form" variant="primary" disabled={Boolean(busy)}>
              Save gateway
            </Button>
          </>
        }
      >
        {/* Dialogs portal outside `.admin-bos`, so use BOS-only classes in here. */}
        <form id="gateway-create-form" onSubmit={createGateway}>
          <FormGrid>
            <AdminOrgSelect full value={createOrgId} onChange={setCreateOrgId} />
            <SelectField
              label="Provider"
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
            </SelectField>
            <TextField
              label="Display name"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
            />
            <SelectField label="Mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </SelectField>
            <TextField
              label={credentialLabels(form.provider).keyId}
              value={form.keyId}
              onChange={(e) => setForm({ ...form, keyId: e.target.value })}
              autoComplete="off"
            />
            <TextField
              label={credentialLabels(form.provider).secret}
              type="password"
              value={form.keySecret}
              onChange={(e) => setForm({ ...form, keySecret: e.target.value })}
              autoComplete="new-password"
            />
            <TextField
              label="Webhook secret"
              type="password"
              value={form.webhookSecret}
              onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
              autoComplete="new-password"
            />
            {plans.length > 0 ? (
              <Field label="Map to plans" full>
                {() =>
                  planChips(
                    form.mappedPlanIds,
                    (id, on) =>
                      setForm({
                        ...form,
                        mappedPlanIds: on ? form.mappedPlanIds.filter((x) => x !== id) : [...form.mappedPlanIds, id],
                      }),
                    false,
                  )
                }
              </Field>
            ) : null}
          </FormGrid>
        </form>
      </Dialog>
    </AdminPage>
  );
}
