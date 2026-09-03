"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { formatAnalyticsBucket } from "@/components/admin/AnalyticsRangePills";
import { uniqueTools } from "@/config/tools.config";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type AttentionItem = {
  id: string;
  severity: "critical" | "high" | "medium" | "info";
  title: string;
  detail: string;
  count: number;
  href: string;
};

type DashboardData = {
  analytics: {
    totals: { creates: number; opens: number; exports: number; limit_blocks: number };
    topTools: Array<{ toolId: string; creates: number; opens: number; exports?: number; uniqueUsers?: number }>;
    dailyCreates: Array<{ date: string; creates: number }>;
    daily?: Array<{ date: string; opens: number; creates: number; exports: number; uniqueUsers?: number }>;
    grain?: "day" | "week" | "month";
  };
  collections: {
    totalReceivable: number;
    overdueReceivable: number;
    netPosition: number;
    amcRenewalsNext30d: number;
  };
  subscription: { planId: string; status: string; mrrInr: number } | null;
  payments: { collectedInr: number; failedCount: number; failureRate: number };
  inbox?: {
    profiles: number;
    users: number;
    deskOps: number;
    upiClaims: number;
    upiAmountInr: number;
    renewalsSoon: number;
    total: number;
  };
  attention?: AttentionItem[];
  health?: {
    gateways: { total: number; enabled: number; unhealthy: number };
    delivery: { failed7d: number; pending7d: number };
    audit: { highRisk7d: number };
    payments: { failedCount: number; failureRate: number; collectedInr: number };
  };
  pulse?: { lastHour: number; last15m: number; actorsHour: number };
};

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function toolName(id: string) {
  if (id === "_app") return "App";
  return uniqueTools().find((t) => t.id === id)?.name ?? id;
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function severityPill(sev: AttentionItem["severity"]) {
  if (sev === "critical") return "pill pill-danger";
  if (sev === "high") return "pill pill-warning";
  if (sev === "medium") return "pill";
  return "pill";
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api<DashboardData>("/admin/dashboard");
      setData(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    }
  }, []);

  useLiveRefresh(load, { intervalMs: 30_000 });

  const daily = useMemo(() => {
    if (!data) return [];
    if (data.analytics.daily?.length) return data.analytics.daily;
    return (data.analytics.dailyCreates ?? []).map((d) => ({
      date: d.date,
      opens: 0,
      creates: d.creates,
      exports: 0,
    }));
  }, [data]);

  const maxDaily = useMemo(
    () => Math.max(1, ...daily.map((d) => d.opens + d.creates + d.exports)),
    [daily],
  );

  if (error && !data) return <p className="field-error">{error}</p>;
  if (!data) return <p className="muted">Loading dashboard…</p>;

  const inbox = data.inbox ?? {
    profiles: 0,
    users: 0,
    deskOps: 0,
    upiClaims: 0,
    upiAmountInr: 0,
    renewalsSoon: 0,
    total: 0,
  };
  const attention = data.attention ?? [];
  const health = data.health ?? {
    gateways: { total: 0, enabled: 0, unhealthy: 0 },
    delivery: { failed7d: 0, pending7d: 0 },
    audit: { highRisk7d: 0 },
    payments: {
      failedCount: data.payments.failedCount,
      failureRate: data.payments.failureRate,
      collectedInr: data.payments.collectedInr,
    },
  };
  const pulse = data.pulse ?? { lastHour: 0, last15m: 0, actorsHour: 0 };
  const grain = data.analytics.grain ?? "day";
  const t = data.analytics.totals;
  const conversion = pct(t.creates, t.opens);
  const topMax = Math.max(1, ...data.analytics.topTools.map((row) => row.opens + row.creates));

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Command center</h2>
            <p className="muted">
              What needs attention now — then health, usage pulse, and cash. Refreshes every 30s.
            </p>
          </div>
          <span className="muted small">
            {pulse.last15m} events / 15m · {pulse.actorsHour} people / 1h
          </span>
        </div>
        <div className="analytics-kpis">
          <Link href={adminDeepLink.approvals()} className={`result-card${inbox.total ? " dash-kpi-alert" : ""}`}>
            <span>Approvals inbox</span>
            <strong>{inbox.total}</strong>
            <span className="analytics-delta">
              {inbox.profiles} branches · {inbox.users} users · {inbox.deskOps} desk · {inbox.upiClaims} UPI
            </span>
          </Link>
          <Link
            href={adminDeepLink.approvals("user")}
            className={`result-card${inbox.users ? " dash-kpi-alert" : ""}`}
          >
            <span>Pending users</span>
            <strong>{inbox.users}</strong>
            <span className="analytics-delta">Approvals → users</span>
          </Link>
          <Link href={adminDeepLink.upiClaimPending()} className={`result-card${inbox.upiClaims ? " dash-kpi-alert" : ""}`}>
            <span>UPI pending</span>
            <strong>{inbox.upiClaims}</strong>
            <span className="analytics-delta">{inr(inbox.upiAmountInr)}</span>
          </Link>
          <Link href={adminDeepLink.subscriptions()} className={`result-card${inbox.renewalsSoon ? " dash-kpi-warn" : ""}`}>
            <span>Renewals ≤14d</span>
            <strong>{inbox.renewalsSoon}</strong>
            <span className="analytics-delta">Plans &amp; notice job</span>
          </Link>
          <Link href={adminDeepLink.analytics()} className={`result-card${t.limit_blocks ? " dash-kpi-warn" : ""}`}>
            <span>Limit blocks (30d)</span>
            <strong>{t.limit_blocks}</strong>
            <span className="analytics-delta">{conversion}% open → create</span>
          </Link>
        </div>
      </section>

      <div className="admin-page-scroll">
        <section className="panel admin-card dash-attention">
          <div className="analytics-toolbar">
            <div>
              <h2>Needs attention</h2>
              <p className="muted">Ranked queue of pending work and risk signals.</p>
            </div>
            {attention.length ? (
              <span className="pill pill-warning">{attention.length} open</span>
            ) : (
              <span className="pill pill-success">Clear</span>
            )}
          </div>
          {attention.length === 0 ? (
            <p className="muted">Nothing urgent. Approvals, UPI, renewals, and health look quiet.</p>
          ) : (
            <ul className="dash-attention-list">
              {attention.map((item) => (
                <li key={item.id} className={`dash-attention-item severity-${item.severity}`}>
                  <div className="dash-attention-main">
                    <span className={severityPill(item.severity)}>{item.severity}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p className="muted">{item.detail}</p>
                    </div>
                    <span className="dash-attention-count">{item.count}</span>
                  </div>
                  <Link href={item.href} className="btn btn-secondary btn-sm">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="admin-grid dash-health-grid">
          <Link
            href={health.gateways.unhealthy ? adminDeepLink.gateways("unhealthy") : adminDeepLink.gateways()}
            className="panel admin-card dash-health-card"
          >
            <h2>Gateways</h2>
            <strong>
              {health.gateways.enabled}/{health.gateways.total || "—"} enabled
            </strong>
            <p className={health.gateways.unhealthy ? "analytics-delta is-down" : "muted"}>
              {health.gateways.unhealthy
                ? `${health.gateways.unhealthy} need a health check`
                : "All enabled gateways look healthy"}
            </p>
          </Link>
          <Link href={adminDeepLink.profiles()} className="panel admin-card dash-health-card">
            <h2>Document delivery</h2>
            <strong>{health.delivery.failed7d} failed</strong>
            <p className={health.delivery.failed7d ? "analytics-delta is-down" : "muted"}>
              {health.delivery.pending7d} pending · last 7 days
            </p>
          </Link>
          <Link href={adminDeepLink.audit()} className="panel admin-card dash-health-card">
            <h2>Audit risk</h2>
            <strong>{health.audit.highRisk7d}</strong>
            <p className={health.audit.highRisk7d ? "analytics-delta is-down" : "muted"}>
              High-risk events in 7 days
            </p>
          </Link>
          <Link href={adminDeepLink.paymentSaas()} className="panel admin-card dash-health-card">
            <h2>Payment failures</h2>
            <strong>{health.payments.failedCount}</strong>
            <p className={health.payments.failedCount ? "analytics-delta is-down" : "muted"}>
              {Math.round((health.payments.failureRate || 0) * 100)}% fail rate · {inr(health.payments.collectedInr)} collected
            </p>
          </Link>
        </div>

        <div className="analytics-grid">
          <section className="panel admin-card">
            <div className="analytics-toolbar">
              <div>
                <h2>Usage pulse (30d)</h2>
                <p className="muted">Opens, creates, and exports by {grain === "month" ? "month" : grain === "week" ? "week" : "day"}.</p>
              </div>
              <Link href={adminDeepLink.analytics()} className="btn btn-ghost btn-sm">
                Full analytics
              </Link>
            </div>
            <div className="result-grid dash-usage-kpis">
              <div className="result-card">
                <span>Opens</span>
                <strong>{t.opens.toLocaleString()}</strong>
              </div>
              <div className="result-card">
                <span>Creates</span>
                <strong>{t.creates.toLocaleString()}</strong>
              </div>
              <div className="result-card">
                <span>Exports</span>
                <strong>{t.exports.toLocaleString()}</strong>
              </div>
              <div className="result-card">
                <span>Conversion</span>
                <strong>{conversion}%</strong>
              </div>
            </div>
            <div className="chart-bars" role="img" aria-label="Usage activity chart">
              {daily.map((d) => {
                const total = d.opens + d.creates + d.exports;
                return (
                  <div
                    key={d.date}
                    className="chart-col"
                    title={`${formatAnalyticsBucket(d.date, grain)}: ${d.opens} opens, ${d.creates} creates, ${d.exports} exports`}
                  >
                    <div className="chart-stack" style={{ height: `${Math.max(4, (total / maxDaily) * 100)}%` }}>
                      <span className="seg seg-open" style={{ flexGrow: d.opens || 0.01 }} />
                      <span className="seg seg-create" style={{ flexGrow: d.creates || 0.01 }} />
                      <span className="seg seg-export" style={{ flexGrow: d.exports || 0.01 }} />
                    </div>
                    <span className="chart-label">{formatAnalyticsBucket(d.date, grain)}</span>
                  </div>
                );
              })}
            </div>
            <div className="chart-legend">
              <span>
                <i className="seg-open" /> Opens
              </span>
              <span>
                <i className="seg-create" /> Creates
              </span>
              <span>
                <i className="seg-export" /> Exports
              </span>
            </div>
          </section>

          <section className="panel admin-card">
            <div className="analytics-toolbar">
              <div>
                <h2>Cash &amp; plan</h2>
                <p className="muted">Collections health and SaaS billing.</p>
              </div>
              <div className="admin-form-row">
                <Link href={adminDeepLink.payments()} className="btn btn-ghost btn-sm">
                  Payments
                </Link>
                <Link href="/admin/subscriptions" className="btn btn-ghost btn-sm">
                  Plans
                </Link>
              </div>
            </div>
            <div className="result-grid">
              <div className="result-card">
                <span>Receivable</span>
                <strong>{inr(data.collections.totalReceivable)}</strong>
              </div>
              <div className="result-card">
                <span>Overdue</span>
                <strong>{inr(data.collections.overdueReceivable)}</strong>
              </div>
              <div className="result-card">
                <span>Net position</span>
                <strong>{inr(data.collections.netPosition)}</strong>
              </div>
              <div className="result-card">
                <span>AMC ≤30d</span>
                <strong>{data.collections.amcRenewalsNext30d}</strong>
              </div>
            </div>
            {data.subscription ? (
              <ul className="admin-kv" style={{ marginTop: 12 }}>
                <li>
                  <span>Plan</span>
                  <strong>{data.subscription.planId}</strong>
                </li>
                <li>
                  <span>Status</span>
                  <strong>{data.subscription.status}</strong>
                </li>
                <li>
                  <span>MRR</span>
                  <strong>{inr(data.subscription.mrrInr)}</strong>
                </li>
                <li>
                  <span>Collected (90d)</span>
                  <strong>{inr(data.payments.collectedInr)}</strong>
                </li>
              </ul>
            ) : (
              <p className="muted" style={{ marginTop: 12 }}>
                No org subscription row yet.
              </p>
            )}
          </section>
        </div>

        <section className="panel admin-card">
          <div className="analytics-toolbar">
            <div>
              <h2>Top tools</h2>
              <p className="muted">Most used tools in the last 30 days.</p>
            </div>
            <Link href={adminDeepLink.tools()} className="btn btn-ghost btn-sm">
              Manage tools
            </Link>
          </div>
          {data.analytics.topTools.length === 0 ? (
            <p className="muted">No tool activity yet.</p>
          ) : (
            <div className="tracker-list">
              {data.analytics.topTools.map((row) => {
                const activity = row.opens + row.creates;
                return (
                  <div key={row.toolId} className="tracker-row analytics-tool-row">
                    <div className="tracker-row-main">
                      <span className="tracker-row-title">{toolName(row.toolId)}</span>
                      <span className="tracker-row-sub">
                        {row.toolId}
                        {row.uniqueUsers != null ? ` · ${row.uniqueUsers} people` : ""}
                      </span>
                      <div className="usage-bar" aria-hidden>
                        <span style={{ width: `${(activity / topMax) * 100}%` }} />
                      </div>
                    </div>
                    <div className="analytics-tool-meta">
                      <span>{row.opens} opens</span>
                      <span>{row.creates} creates</span>
                      <span>{pct(row.creates, row.opens)}% conv.</span>
                    </div>
                    <Link href={`/admin/analytics/tools/${row.toolId}`} className="btn btn-ghost btn-sm">
                      Deep dive
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel admin-card dash-quick-links">
          <h2>Quick links</h2>
          <div className="dash-link-row">
            <Link href={adminDeepLink.users()} className="btn btn-secondary btn-sm">
              Team
            </Link>
            <Link href={adminDeepLink.profiles()} className="btn btn-secondary btn-sm">
              Profiles
            </Link>
            <Link href={adminDeepLink.gateways()} className="btn btn-secondary btn-sm">
              Gateways
            </Link>
            <Link href={adminDeepLink.audit()} className="btn btn-secondary btn-sm">
              Audit
            </Link>
            <Link href={adminDeepLink.ops()} className="btn btn-secondary btn-sm">
              Operations
            </Link>
            <Link href={adminDeepLink.experienceBranding()} className="btn btn-secondary btn-sm">
              Experience
            </Link>
            <Link href={adminDeepLink.analytics()} className="btn btn-secondary btn-sm">
              Analytics
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
