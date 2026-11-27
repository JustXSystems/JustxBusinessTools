"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  BarChart,
  Button,
  Card,
  ChartCard,
  Grid,
  GroupedBarChart,
  KpiCard,
  ProgressBar,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
} from "@/components/admin/ui";
import { formatAnalyticsBucket } from "@/components/admin/AnalyticsRangePills";
import { uniqueTools } from "@/config/tools.config";
import { useOptionalPlatformConfig } from "@/components/config/ConfigProvider";
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

function toolName(id: string, toolNames?: Record<string, string>) {
  if (id === "_app") return "App";
  return toolNames?.[id]?.trim() || uniqueTools().find((t) => t.id === id)?.name || id;
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function severityTone(sev: AttentionItem["severity"]): "coral" | "amber" | "blue" | "emerald" {
  if (sev === "critical" || sev === "high") return "coral";
  if (sev === "medium") return "amber";
  return "blue";
}

export default function AdminDashboardPage() {
  const toolNames = useOptionalPlatformConfig()?.config?.toolNames;
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

  if (error && !data) {
    return (
      <AdminPage section="Overview" title="Command center" sub="Platform pulse">
        <AdminErrorState message={error} onRetry={load} />
      </AdminPage>
    );
  }
  if (!data) return <AdminPageSkeleton cards={5} />;

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

  const usageBars = daily.slice(-6).map((d) => ({
    label: formatAnalyticsBucket(d.date, grain),
    value: d.opens + d.creates + d.exports,
  }));

  const groupedUsage = daily.slice(-6).map((d) => ({
    label: formatAnalyticsBucket(d.date, grain),
    a: d.opens,
    b: d.creates,
  }));

  return (
    <AdminPage
      section="Overview"
      title="Command center"
      sub="Attention · health · usage · cash"
      toolbar={
        <>
          <Badge auto tone={inbox.total ? "amber" : "emerald"}>
            {pulse.last15m} events / 15m · {pulse.actorsHour} people / 1h
          </Badge>
          <Button variant="ghost" size="sm" icon="refresh" onClick={load}>
            Refresh
          </Button>
        </>
      }
    >
      <Grid cols={5} min={140} gap={12}>
        <Link href={adminDeepLink.approvals()} className="admin-cc-kpi-link">
          <KpiCard
            label="Approvals inbox"
            value={inbox.total}
            delta={`${inbox.profiles} orgs · ${inbox.users} users · ${inbox.deskOps} desk · ${inbox.upiClaims} UPI`}
            deltaTone={inbox.total ? "warn" : "muted"}
            chip={{ color: inbox.total ? "amber" : "mint", glyph: "◎" }}
          />
        </Link>
        <Link href={adminDeepLink.userPending()} className="admin-cc-kpi-link">
          <KpiCard
            label="Pending users"
            value={inbox.users}
            delta="People → pending filter"
            deltaTone={inbox.users ? "warn" : "muted"}
            chip={{ color: "blue", glyph: "👤" }}
          />
        </Link>
        <Link href={adminDeepLink.upiClaimPending()} className="admin-cc-kpi-link">
          <KpiCard
            label="UPI pending"
            value={inbox.upiClaims}
            delta={inr(inbox.upiAmountInr)}
            deltaTone={inbox.upiClaims ? "warn" : "muted"}
            chip={{ color: "lavender", glyph: "₹" }}
          />
        </Link>
        <Link href={adminDeepLink.subscriptionsRenewals()} className="admin-cc-kpi-link">
          <KpiCard
            label="Renewals ≤14d"
            value={inbox.renewalsSoon}
            delta="Plans & notice job"
            deltaTone={inbox.renewalsSoon ? "warn" : "muted"}
            chip={{ color: "rose", glyph: "↻" }}
          />
        </Link>
        <Link href={adminDeepLink.analytics("limit_blocks")} className="admin-cc-kpi-link">
          <KpiCard
            label="Limit blocks (30d)"
            value={t.limit_blocks}
            delta={`${conversion}% open → create`}
            deltaTone={t.limit_blocks ? "warn" : "up"}
            chip={{ color: "sage", glyph: "▣" }}
          />
        </Link>
      </Grid>

      <AdminSection
        title="Needs attention"
        description="Ranked queue of pending work and risk signals."
        actions={
          attention.length ? (
            <Badge tone="amber">{attention.length} open</Badge>
          ) : (
            <Badge tone="emerald">Clear</Badge>
          )
        }
      >
        {attention.length === 0 ? (
          <AdminEmpty title="Nothing urgent" icon="check">
            Approvals, UPI, renewals, and health look quiet.
          </AdminEmpty>
        ) : (
          <ul className="admin-cc-attention-list">
            {attention.map((item) => (
              <li key={item.id} className="admin-cc-attention-item">
                <div className="admin-cc-attention-main">
                  <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <span className="admin-cc-attention-count">{item.count}</span>
                </div>
                <Link href={item.href}>
                  <Button variant="secondary" size="sm">
                    Open
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <Grid cols={4} min={160} gap={12} className="admin-cc-health-grid">
        <Link href={health.gateways.unhealthy ? adminDeepLink.gateways("unhealthy") : adminDeepLink.gateways()}>
          <Card interactive>
            <div className="bos-kpi-label">Gateways</div>
            <div className="bos-kpi-value">
              {health.gateways.enabled}/{health.gateways.total || "—"} enabled
            </div>
            <div className={`bos-kpi-delta${health.gateways.unhealthy ? " bos-kpi-delta-down" : ""}`}>
              {health.gateways.unhealthy
                ? `${health.gateways.unhealthy} need a health check`
                : "All enabled gateways look healthy"}
            </div>
          </Card>
        </Link>
        <Link href={adminDeepLink.delivery()}>
          <Card interactive>
            <div className="bos-kpi-label">Document delivery</div>
            <div className="bos-kpi-value">{health.delivery.failed7d} failed</div>
            <div className={`bos-kpi-delta${health.delivery.failed7d ? " bos-kpi-delta-down" : ""}`}>
              {health.delivery.pending7d} pending · last 7 days
            </div>
          </Card>
        </Link>
        <Link href={adminDeepLink.audit()}>
          <Card interactive>
            <div className="bos-kpi-label">Audit risk</div>
            <div className="bos-kpi-value">{health.audit.highRisk7d}</div>
            <div className={`bos-kpi-delta${health.audit.highRisk7d ? " bos-kpi-delta-down" : ""}`}>
              High-risk events in 7 days
            </div>
          </Card>
        </Link>
        <Link href={adminDeepLink.paymentSaasFailed()}>
          <Card interactive>
            <div className="bos-kpi-label">Payment failures</div>
            <div className="bos-kpi-value">{health.payments.failedCount}</div>
            <div className={`bos-kpi-delta${health.payments.failedCount ? " bos-kpi-delta-down" : ""}`}>
              {Math.round((health.payments.failureRate || 0) * 100)}% fail rate · {inr(health.payments.collectedInr)} collected
            </div>
          </Card>
        </Link>
      </Grid>

      <Grid cols={2} template="1.35fr 1fr" min={280} gap={14}>
        <AdminSection
          title="Usage pulse (30d)"
          description={`Opens vs creates by ${grain === "month" ? "month" : grain === "week" ? "week" : "day"}.`}
          actions={
            <Link href={adminDeepLink.analytics()}>
              <Button variant="ghost" size="sm">
                Full analytics
              </Button>
            </Link>
          }
        >
          <Grid cols={4} min={90} gap={8}>
            <KpiCard label="Opens" value={t.opens.toLocaleString()} interactive={false} />
            <KpiCard label="Creates" value={t.creates.toLocaleString()} interactive={false} />
            <KpiCard label="Exports" value={t.exports.toLocaleString()} interactive={false} />
            <KpiCard label="Conversion" value={`${conversion}%`} interactive={false} />
          </Grid>
          <div style={{ height: 12 }} />
          <ChartCard
            title="Activity"
            legend={[
              { label: "Opens", tone: "emerald" },
              { label: "Creates", tone: "coral" },
            ]}
          >
            {groupedUsage.length ? (
              <GroupedBarChart data={groupedUsage} ariaLabel="Opens versus creates" series={["Opens", "Creates"]} />
            ) : usageBars.length ? (
              <BarChart data={usageBars} ariaLabel="Usage activity" />
            ) : (
              <AdminEmpty title="No usage yet" />
            )}
          </ChartCard>
        </AdminSection>

        <AdminSection
          title="Cash & plan"
          description="Collections health and SaaS billing."
          actions={
            <>
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
            </>
          }
        >
          <Grid cols={2} min={120} gap={8}>
            <Link href={adminDeepLink.paymentCollections()} className="admin-cc-kpi-link">
              <KpiCard label="Receivable" value={inr(data.collections.totalReceivable)} />
            </Link>
            <Link href={adminDeepLink.paymentCollectionsOverdue()} className="admin-cc-kpi-link">
              <KpiCard label="Overdue" value={inr(data.collections.overdueReceivable)} valueTone="coral" />
            </Link>
            <Link href={adminDeepLink.payments()} className="admin-cc-kpi-link">
              <KpiCard label="Net position" value={inr(data.collections.netPosition)} />
            </Link>
            <Link href={adminDeepLink.subscriptionsRenewals()} className="admin-cc-kpi-link">
              <KpiCard label="AMC ≤30d" value={data.collections.amcRenewalsNext30d} />
            </Link>
          </Grid>
          <div style={{ height: 12 }} />
          {data.subscription ? (
            <Card flat>
              <Grid cols={2} min={120} gap={8}>
                <div>
                  <div className="bos-text-caption">Plan</div>
                  <strong>{data.subscription.planId}</strong>
                </div>
                <div>
                  <div className="bos-text-caption">Status</div>
                  <strong>{data.subscription.status}</strong>
                </div>
                <div>
                  <div className="bos-text-caption">MRR</div>
                  <strong>{inr(data.subscription.mrrInr)}</strong>
                </div>
                <div>
                  <div className="bos-text-caption">Collected (90d)</div>
                  <strong>{inr(data.payments.collectedInr)}</strong>
                </div>
              </Grid>
            </Card>
          ) : (
            <p className="bos-text-muted" style={{ margin: 0, fontSize: 13 }}>
              No org subscription row yet.
            </p>
          )}
        </AdminSection>
      </Grid>

      <AdminSection
        title="Top tools"
        description="Most used tools in the last 30 days."
        actions={
          <Link href={adminDeepLink.tools()}>
            <Button variant="ghost" size="sm">
              Manage catalog
            </Button>
          </Link>
        }
      >
        {data.analytics.topTools.length === 0 ? (
          <AdminEmpty title="No tool activity yet" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.analytics.topTools.map((row) => {
              const activity = row.opens + row.creates;
              return (
                <Card key={row.toolId} flat style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <strong>{toolName(row.toolId, toolNames)}</strong>
                      <div className="bos-text-caption">
                        {row.toolId}
                        {row.uniqueUsers != null ? ` · ${row.uniqueUsers} people` : ""}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <ProgressBar value={(activity / topMax) * 100} tone="blue" label={`${toolName(row.toolId, toolNames)} activity`} />
                      </div>
                    </div>
                    <span className="bos-text-caption">{row.opens} opens</span>
                    <span className="bos-text-caption">{row.creates} creates</span>
                    <span className="bos-text-caption">{pct(row.creates, row.opens)}% conv.</span>
                    <Link href={adminDeepLink.analyticsTool(row.toolId)}>
                      <Button variant="ghost" size="sm">
                        Deep dive
                      </Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </AdminSection>

      <AdminSection title="Quick links" description="Jump into the most used consoles.">
        <div className="admin-cc-link-row">
          <Link href={adminDeepLink.users()}>
            <Button variant="primary" size="sm">
              People
            </Button>
          </Link>
          <Link href={adminDeepLink.profiles()}>
            <Button variant="secondary" size="sm">
              Business Profiles
            </Button>
          </Link>
          <Link href={adminDeepLink.subscriptions()}>
            <Button variant="secondary" size="sm">
              Plans
            </Button>
          </Link>
          <Link href={adminDeepLink.gateways()}>
            <Button variant="secondary" size="sm">
              Gateways
            </Button>
          </Link>
          <Link href={adminDeepLink.audit()}>
            <Button variant="secondary" size="sm">
              Audit
            </Button>
          </Link>
          <Link href={adminDeepLink.ops()}>
            <Button variant="secondary" size="sm">
              Operations
            </Button>
          </Link>
          <Link href={adminDeepLink.experienceTheme()}>
            <Button variant="secondary" size="sm">
              Theme
            </Button>
          </Link>
          <Link href={adminDeepLink.experiencePublicHome()}>
            <Button variant="secondary" size="sm">
              Public home
            </Button>
          </Link>
          <Link href={adminDeepLink.analytics()}>
            <Button variant="secondary" size="sm">
              Analytics
            </Button>
          </Link>
        </div>
      </AdminSection>
    </AdminPage>
  );
}
