"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  BarChart,
  Button,
  ChartCard,
  DataTable,
  Grid,
  GroupedBarChart,
  KpiCard,
  ProgressBar,
  SearchInput,
  Select,
  WidgetRow,
  type BosColumn,
  type BosDeltaTone,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
} from "@/components/admin/ui";
import {
  AnalyticsRangePills,
  analyticsRangeLabel,
  formatAnalyticsBucket,
} from "@/components/admin/AnalyticsRangePills";
import { LiveActivityStream } from "@/components/admin/LiveActivityStream";
import { uniqueTools } from "@/config/tools.config";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type ToolRow = {
  toolId: string;
  opens: number;
  creates: number;
  updates: number;
  deletes: number;
  exports: number;
  prints: number;
  calcRuns: number;
  limitBlocks: number;
  uniqueUsers: number;
};

type Overview = {
  days: number;
  grain?: "day" | "week" | "month";
  totals: {
    opens: number;
    creates: number;
    updates: number;
    deletes: number;
    exports: number;
    prints: number;
    calc_runs: number;
    limit_blocks: number;
    upgrade_clicks: number;
    unique_users: number;
  };
  previousTotals: { opens: number; creates: number; exports: number; limit_blocks: number; unique_users: number };
  uniqueUsers: number;
  previousUniqueUsers: number;
  byTool: ToolRow[];
  daily: Array<{ date: string; opens: number; creates: number; exports: number; uniqueUsers: number }>;
};

type DailyRow = Overview["daily"][number];

type Breakdown = {
  devices: Array<{ device: string; count: number }>;
  hours: Array<{ hour: number; count: number }>;
  eventTypes: Array<{ eventType: string; count: number }>;
  users: Array<{ userId: number | null; label: string; count: number; tools: number }>;
  recent: Array<{
    id: number;
    at: string;
    eventType: string;
    toolId: string | null;
    device: string | null;
    appVersion?: string | null;
    sessionId?: string | null;
    userId?: number | null;
    actor: string | null;
    actorEmail?: string | null;
    profileName?: string | null;
    organizationName?: string | null;
    properties?: Record<string, unknown> | null;
  }>;
  stream?: {
    lastHour: number;
    last15m: number;
    uniqueActors: number;
    uniqueTools: number;
    blocks: number;
    upgrades: number;
  };
};

type Insight = {
  id: number;
  title: string;
  body: string;
  actionLabel: string | null;
  actionHref: string | null;
};

type SortKey = "activity" | "opens" | "creates" | "exports" | "conversion";

function toolName(id: string) {
  if (id === "_app") return "App (no tool)";
  return uniqueTools().find((t) => t.id === id)?.name ?? id;
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function delta(now: number, prev: number) {
  if (prev === 0) return now > 0 ? 100 : 0;
  return Math.round(((now - prev) / prev) * 100);
}

/** KPI delta line vs the prior period. `invert` flips good/bad (e.g. limit blocks). */
function vsPrior(now: number, prev: number, hide?: boolean, invert?: boolean): { delta: ReactNode; deltaTone: BosDeltaTone } {
  if (hide) return { delta: "All time", deltaTone: "muted" };
  const d = delta(now, prev);
  const label = `${d > 0 ? `+${d}` : d}% vs prior`;
  if (d === 0) return { delta: label, deltaTone: "muted" };
  const good = invert ? d < 0 : d > 0;
  return { delta: label, deltaTone: good ? "up" : "down" };
}

function rollupTone(msg: string): "blue" | "emerald" | "coral" {
  if (msg.startsWith("Rebuilding")) return "blue";
  if (msg.startsWith("Rollups rebuilt")) return "emerald";
  return "coral";
}

function exportCsv(overview: Overview) {
  const lines = [
    "tool,opens,creates,updates,exports,prints,limit_blocks,unique_users",
    ...overview.byTool.map(
      (t) =>
        `${t.toolId},${t.opens},${t.creates},${t.updates},${t.exports},${t.prints},${t.limitBlocks},${t.uniqueUsers}`,
    ),
    "",
    "date,opens,creates,exports",
    ...overview.daily.map((d) => `${d.date},${d.opens},${d.creates},${d.exports}`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jbt-analytics-${overview.days}d.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("activity");
  const [rollupMsg, setRollupMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (range: number) => {
    setError("");
    try {
      const [ov, br, ins] = await Promise.all([
        api<Overview>(`/admin/analytics/overview?days=${range}`),
        api<Breakdown>(`/admin/analytics/breakdown?days=${range}`),
        api<{ insights: Insight[] }>(`/admin/analytics/insights?days=${range}`),
      ]);
      setOverview(ov);
      setBreakdown(br);
      setInsights(ins.insights);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics");
    }
  }, []);

  useLiveRefresh(() => load(days), { intervalMs: 60_000, deps: [days] });

  const maxHour = useMemo(() => {
    if (!breakdown) return 1;
    return Math.max(1, ...breakdown.hours.map((h) => h.count));
  }, [breakdown]);

  const tools = useMemo(() => {
    if (!overview) return [];
    const q = query.trim().toLowerCase();
    const rows = overview.byTool.filter((t) => {
      const name = toolName(t.toolId).toLowerCase();
      return !q || name.includes(q) || t.toolId.toLowerCase().includes(q);
    });
    const score = (t: ToolRow) => {
      if (sort === "opens") return t.opens;
      if (sort === "creates") return t.creates;
      if (sort === "exports") return t.exports;
      if (sort === "conversion") return t.opens ? t.creates / t.opens : 0;
      return t.opens + t.creates + t.exports;
    };
    return [...rows].sort((a, b) => score(b) - score(a));
  }, [overview, query, sort]);

  const maxToolActivity = Math.max(1, ...tools.map((t) => t.opens + t.creates));

  async function runRollup() {
    setRollupMsg("Rebuilding daily rollups…");
    try {
      await api("/admin/analytics/rollup", { method: "POST", body: JSON.stringify({ days: days || 90 }) });
      await load(days);
      setRollupMsg("Rollups rebuilt for this range.");
    } catch (err) {
      setRollupMsg(err instanceof Error ? err.message : "Rollup failed");
    }
  }

  const rangePills = <AnalyticsRangePills value={days} onChange={setDays} />;

  if (error && !overview) {
    return (
      <AdminPage title="Usage intelligence" sub="Product analytics" toolbar={rangePills}>
        <AdminErrorState message={error} onRetry={() => void load(days)} />
      </AdminPage>
    );
  }
  if (!overview || !breakdown) return <AdminPageSkeleton cards={6} />;

  const t = overview.totals;
  const p = overview.previousTotals;
  const hideDelta = days === 0;
  const conversion = pct(t.creates, t.opens);
  const deviceTotal = breakdown.devices.reduce((s, d) => s + d.count, 0) || 1;
  const grain = overview.grain ?? "day";
  const grainLabel = grain === "month" ? "by month" : grain === "week" ? "by week" : "by day";

  const recentDaily = overview.daily.slice(-6);
  const groupedUsage = recentDaily.map((d) => ({
    label: formatAnalyticsBucket(d.date, grain),
    a: d.opens,
    b: d.creates,
  }));
  const totalUsage = recentDaily.map((d) => ({
    label: formatAnalyticsBucket(d.date, grain),
    value: d.opens + d.creates + d.exports,
  }));

  const funnel: Array<[string, number]> = [
    ["Opens", t.opens],
    ["Creates", t.creates],
    ["Updates", t.updates],
    ["Exports", t.exports],
  ];
  const funnelMax = funnel[0][1] || 1;

  const toolColumns: ReadonlyArray<BosColumn<ToolRow>> = [
    {
      key: "tool",
      header: "Tool",
      cell: (row) => (
        <div>
          <div className="admin-cc-cell-title">{toolName(row.toolId)}</div>
          <div className="admin-cc-cell-sub">
            {row.toolId} · {row.uniqueUsers} people
          </div>
          <div className="admin-cc-cell-bar">
            <ProgressBar
              value={((row.opens + row.creates) / maxToolActivity) * 100}
              tone="blue"
              label={`${toolName(row.toolId)} activity`}
            />
          </div>
        </div>
      ),
    },
    { key: "opens", header: "Opens", align: "right", cell: (row) => row.opens.toLocaleString() },
    { key: "creates", header: "Creates", align: "right", cell: (row) => row.creates.toLocaleString() },
    { key: "conv", header: "Conv.", align: "right", cell: (row) => `${pct(row.creates, row.opens)}%` },
    { key: "exports", header: "Exports", align: "right", cell: (row) => row.exports.toLocaleString() },
    {
      key: "blocked",
      header: "Blocked",
      align: "right",
      cell: (row) => (row.limitBlocks ? <Badge auto tone="amber">{row.limitBlocks} blocked</Badge> : "—"),
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (row) => (
        <Link href={adminDeepLink.analyticsTool(row.toolId)}>
          <Button variant="ghost" size="sm">
            Deep dive
          </Button>
        </Link>
      ),
    },
  ];

  const dailyColumns: ReadonlyArray<BosColumn<DailyRow>> = [
    { key: "date", header: "Period", cell: (row) => formatAnalyticsBucket(row.date, grain) },
    { key: "opens", header: "Opens", align: "right", cell: (row) => row.opens.toLocaleString() },
    { key: "creates", header: "Creates", align: "right", cell: (row) => row.creates.toLocaleString() },
    { key: "exports", header: "Exports", align: "right", cell: (row) => row.exports.toLocaleString() },
    { key: "uniqueUsers", header: "People", align: "right", cell: (row) => (row.uniqueUsers ?? 0).toLocaleString() },
  ];

  return (
    <AdminPage
      title="Usage intelligence"
      sub={`Org-wide product analytics · ${analyticsRangeLabel(days)}`}
      toolbar={
        <>
          {rangePills}
          <Button variant="primary" size="sm" icon="download" onClick={() => exportCsv(overview)}>
            Export CSV
          </Button>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void runRollup()}>
            Rebuild rollups
          </Button>
        </>
      }
    >
      {error ? <AdminErrorState message={error} onRetry={() => void load(days)} /> : null}
      {rollupMsg ? <Alert tone={rollupTone(rollupMsg)} title={rollupMsg} /> : null}

      <Grid cols={6} min={150} gap={12}>
        <KpiCard
          label="Active people"
          value={overview.uniqueUsers.toLocaleString()}
          chip={{ color: "blue", glyph: "👤" }}
          interactive={false}
          {...vsPrior(overview.uniqueUsers, overview.previousUniqueUsers, hideDelta)}
        />
        <KpiCard
          label="Tool opens"
          value={t.opens.toLocaleString()}
          chip={{ color: "mint", glyph: "◎" }}
          interactive={false}
          {...vsPrior(t.opens, p.opens, hideDelta)}
        />
        <KpiCard
          label="Records created"
          value={t.creates.toLocaleString()}
          chip={{ color: "lavender", glyph: "＋" }}
          interactive={false}
          {...vsPrior(t.creates, p.creates, hideDelta)}
        />
        <KpiCard
          label="Open → create"
          value={`${conversion}%`}
          chip={{ color: "sage", glyph: "↗" }}
          interactive={false}
          delta={`${t.updates} edits · ${t.deletes} deletes`}
          deltaTone="muted"
        />
        <KpiCard
          label="Exports / prints"
          value={(t.exports + t.prints).toLocaleString()}
          chip={{ color: "rose", glyph: "⇩" }}
          interactive={false}
          {...vsPrior(t.exports, p.exports, hideDelta)}
        />
        <KpiCard
          label="Limit blocks"
          value={t.limit_blocks.toLocaleString()}
          chip={{ color: "amber", glyph: "▣" }}
          interactive={false}
          {...vsPrior(t.limit_blocks, p.limit_blocks, hideDelta, true)}
        />
      </Grid>

      <Grid cols={2} template="1.35fr 1fr" min={280} gap={14}>
        <AdminSection title="Activity" description={`Opens, creates, and exports ${grainLabel}. Chart shows the latest 6 buckets.`}>
          <ChartCard
            title="Opens vs creates"
            legend={[
              { label: "Opens", tone: "emerald" },
              { label: "Creates", tone: "coral" },
            ]}
          >
            {groupedUsage.length ? (
              <GroupedBarChart data={groupedUsage} ariaLabel="Opens versus creates" series={["Opens", "Creates"]} />
            ) : totalUsage.length ? (
              <BarChart data={totalUsage} ariaLabel="Total activity" />
            ) : (
              <AdminEmpty title="No activity yet" icon="trend" />
            )}
          </ChartCard>
          {overview.daily.length ? (
            <div className="admin-cc-scroll" style={{ marginTop: 12, maxHeight: 280 }}>
              <DataTable
                compact
                caption={`Activity ${grainLabel}`}
                columns={dailyColumns}
                rows={overview.daily}
                rowKey={(row) => row.date}
              />
            </div>
          ) : null}
        </AdminSection>

        <AdminSection title="Conversion funnel" description="How far sessions go from opening a tool to exporting.">
          <div className="admin-cc-stack">
            {funnel.map(([label, value], i) => (
              <div key={label} className="admin-cc-funnel-row">
                <span>{label}</span>
                <ProgressBar
                  value={Math.max(value ? 4 : 0, (value / funnelMax) * 100)}
                  tone={i === 0 ? "blue" : i === funnel.length - 1 ? "emerald" : "blue"}
                  label={`${label} ${value}`}
                />
                <span className="admin-cc-funnel-meta">
                  <strong style={{ color: "var(--bos-text)" }}>{value.toLocaleString()}</strong>
                  {" · "}
                  {i > 0 ? `${pct(value, funnel[i - 1][1])}% of previous` : "100%"}
                </span>
              </div>
            ))}
          </div>
          <p className="admin-cc-note">
            Calculators: {t.calc_runs.toLocaleString()} runs · Upgrade prompts: {t.upgrade_clicks}
          </p>
        </AdminSection>
      </Grid>

      <AdminSection
        title="Tools"
        description={`${tools.length} of ${overview.byTool.length} tools in range.`}
        actions={
          <div className="admin-cc-filters">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools"
              aria-label="Search tools"
            />
            <Select size="sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort tools">
              <option value="activity">Sort: activity</option>
              <option value="opens">Sort: opens</option>
              <option value="creates">Sort: creates</option>
              <option value="exports">Sort: exports</option>
              <option value="conversion">Sort: conversion</option>
            </Select>
          </div>
        }
      >
        <div className="admin-cc-scroll">
          <DataTable
            caption="Tool usage"
            columns={toolColumns}
            rows={tools}
            rowKey={(row) => row.toolId}
            empty="No tool activity in this range. Use the operator app, then rebuild rollups."
          />
        </div>
      </AdminSection>

      <Grid cols={3} min={240} gap={14}>
        <AdminSection title="When people work" description="Events by hour of day (darker = busier).">
          <div className="admin-cc-heat">
            {breakdown.hours.map((h) => (
              <div
                key={h.hour}
                className="admin-cc-heat-cell"
                style={{
                  background: `color-mix(in srgb, var(--bos-blue) ${Math.round(8 + (h.count / maxHour) * 62)}%, transparent)`,
                }}
                title={`${h.hour}:00 — ${h.count} events`}
              >
                {h.hour}
              </div>
            ))}
          </div>
        </AdminSection>

        <AdminSection title="Devices & events">
          {breakdown.devices.length === 0 ? (
            <AdminEmpty title="No device signals yet" icon="grid" />
          ) : (
            <div>
              {breakdown.devices.map((d) => (
                <WidgetRow
                  key={d.device}
                  label={d.device}
                  value={`${d.count.toLocaleString()} · ${pct(d.count, deviceTotal)}%`}
                />
              ))}
            </div>
          )}
          <h4 className="admin-cc-subhead">Event mix</h4>
          <div className="admin-cc-scroll" style={{ maxHeight: 260 }}>
            {breakdown.eventTypes.length === 0 ? (
              <p className="admin-cc-note">No events recorded.</p>
            ) : (
              breakdown.eventTypes.map((e) => (
                <WidgetRow key={e.eventType} label={e.eventType} value={e.count.toLocaleString()} />
              ))
            )}
          </div>
        </AdminSection>

        <AdminSection title="Most active people">
          {breakdown.users.length === 0 ? (
            <AdminEmpty title="No identified users" icon="users">
              No identified users in this window.
            </AdminEmpty>
          ) : (
            <div className="admin-cc-scroll" style={{ maxHeight: 360 }}>
              {breakdown.users.map((u) => (
                <WidgetRow
                  key={String(u.userId ?? u.label)}
                  label={u.label}
                  value={`${u.count} events · ${u.tools} tools`}
                />
              ))}
            </div>
          )}
        </AdminSection>
      </Grid>

      <AdminSection title="Insights" description="Signals worth acting on in this range.">
        {insights.length === 0 ? (
          <AdminEmpty title="Not enough signal yet" icon="sparkle">
            Keep using tools and this will fill in.
          </AdminEmpty>
        ) : (
          <ul className="admin-cc-attention-list">
            {insights.map((ins) => (
              <li key={ins.id} className="admin-cc-attention-item">
                <div className="admin-cc-attention-main">
                  <div>
                    <strong>{ins.title}</strong>
                    <p>{ins.body}</p>
                  </div>
                </div>
                {ins.actionHref ? (
                  <Link href={ins.actionHref}>
                    <Button variant="secondary" size="sm">
                      {ins.actionLabel ?? "Open"}
                    </Button>
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <LiveActivityStream events={breakdown.recent} stream={breakdown.stream} />
    </AdminPage>
  );
}
