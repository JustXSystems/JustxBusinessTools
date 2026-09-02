"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  AnalyticsRangePills,
  analyticsRangeLabel,
  formatAnalyticsBucket,
} from "@/components/admin/AnalyticsRangePills";
import { uniqueTools } from "@/config/tools.config";
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

type Breakdown = {
  devices: Array<{ device: string; count: number }>;
  hours: Array<{ hour: number; count: number }>;
  eventTypes: Array<{ eventType: string; count: number }>;
  users: Array<{ userId: number | null; label: string; count: number; tools: number }>;
  recent: Array<{ at: string; eventType: string; toolId: string | null; device: string | null; actor: string | null }>;
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

function Delta({ now, prev, hide }: { now: number; prev: number; hide?: boolean }) {
  if (hide) return <span className="muted">All time</span>;
  const d = delta(now, prev);
  const cls = d > 0 ? "analytics-delta is-up" : d < 0 ? "analytics-delta is-down" : "analytics-delta";
  const label = d > 0 ? `+${d}%` : `${d}%`;
  return <span className={cls}>{label} vs prior</span>;
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
  const [loading, setLoading] = useState(true);

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
    } finally {
      setLoading(false);
    }
  }, []);

  useLiveRefresh(() => load(days), { intervalMs: 60_000, deps: [days] });

  const maxDaily = useMemo(() => {
    if (!overview) return 1;
    return Math.max(1, ...overview.daily.map((d) => d.opens + d.creates + d.exports));
  }, [overview]);

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

  if (error && !overview) return <p className="field-error">{error}</p>;
  if (!overview || !breakdown) return <p className="muted">Loading analytics…</p>;

  const t = overview.totals;
  const p = overview.previousTotals;
  const conversion = pct(t.creates, t.opens);
  const deviceTotal = breakdown.devices.reduce((s, d) => s + d.count, 0) || 1;

  return (
    <div className="admin-page">
      <div className="admin-stack analytics-page admin-page-scroll">
      <section className="panel admin-card">
        <div className="analytics-toolbar">
          <div>
            <h2>Usage intelligence</h2>
            <p className="muted">Org-wide product analytics — {analyticsRangeLabel(days)}.</p>
          </div>
          <div className="admin-form-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => exportCsv(overview)}>
              Export CSV
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void runRollup()}>
              Rebuild rollups
            </button>
          </div>
        </div>
        <AnalyticsRangePills value={days} onChange={setDays} />
        {rollupMsg ? <p className="muted">{rollupMsg}</p> : null}
        {loading ? <p className="muted">Refreshing…</p> : null}
        <div className="analytics-kpis">
          <article className="result-card">
            <span>Active people</span>
            <strong>{overview.uniqueUsers}</strong>
            <Delta now={overview.uniqueUsers} prev={overview.previousUniqueUsers} hide={days === 0} />
          </article>
          <article className="result-card">
            <span>Tool opens</span>
            <strong>{t.opens.toLocaleString()}</strong>
            <Delta now={t.opens} prev={p.opens} hide={days === 0} />
          </article>
          <article className="result-card">
            <span>Records created</span>
            <strong>{t.creates.toLocaleString()}</strong>
            <Delta now={t.creates} prev={p.creates} hide={days === 0} />
          </article>
          <article className="result-card">
            <span>Open → create</span>
            <strong>{conversion}%</strong>
            <span className="muted">{t.updates} edits · {t.deletes} deletes</span>
          </article>
          <article className="result-card">
            <span>Exports / prints</span>
            <strong>{(t.exports + t.prints).toLocaleString()}</strong>
            <Delta now={t.exports} prev={p.exports} hide={days === 0} />
          </article>
          <article className="result-card">
            <span>Limit blocks</span>
            <strong>{t.limit_blocks.toLocaleString()}</strong>
            <Delta now={t.limit_blocks} prev={p.limit_blocks} hide={days === 0} />
          </article>
        </div>
      </section>

      <div className="analytics-grid">
        <section className="panel admin-card">
          <h2>Activity</h2>
          <p className="muted">
            Opens, creates, and exports
            {overview.grain === "month" ? " by month" : overview.grain === "week" ? " by week" : " by day"}
          </p>
          <div className="chart-bars" role="img" aria-label="Activity chart">
            {overview.daily.map((d) => {
              const total = d.opens + d.creates + d.exports;
              const grain = overview.grain ?? "day";
              return (
                <div key={d.date} className="chart-col" title={`${formatAnalyticsBucket(d.date, grain)}: ${d.opens} opens, ${d.creates} creates, ${d.exports} exports`}>
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
            <span><i className="seg-open" /> Opens</span>
            <span><i className="seg-create" /> Creates</span>
            <span><i className="seg-export" /> Exports</span>
          </div>
        </section>

        <section className="panel admin-card">
          <h2>Conversion funnel</h2>
          <p className="muted">How far sessions go from opening a tool to exporting</p>
          <ul className="funnel">
            {[
              ["Opens", t.opens],
              ["Creates", t.creates],
              ["Updates", t.updates],
              ["Exports", t.exports],
            ].map(([label, value], i, arr) => {
              const max = Number(arr[0][1]) || 1;
              return (
                <li key={String(label)}>
                  <div className="funnel-bar" style={{ width: `${Math.max(8, (Number(value) / max) * 100)}%` }} />
                  <span>{label}</span>
                  <strong>{Number(value).toLocaleString()}</strong>
                  {i > 0 ? <em>{pct(Number(value), Number(arr[i - 1][1]))}% of previous</em> : <em>100%</em>}
                </li>
              );
            })}
          </ul>
          <p className="muted">Calculators: {t.calc_runs.toLocaleString()} runs · Upgrade prompts: {t.upgrade_clicks}</p>
        </section>
      </div>

      <section className="panel admin-card">
        <div className="analytics-toolbar">
          <h2>Tools</h2>
          <div className="admin-form-row">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools" aria-label="Search tools" />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort tools">
              <option value="activity">Sort: activity</option>
              <option value="opens">Sort: opens</option>
              <option value="creates">Sort: creates</option>
              <option value="exports">Sort: exports</option>
              <option value="conversion">Sort: conversion</option>
            </select>
          </div>
        </div>
        <div className="tracker-list admin-scroll-list">
          {tools.map((row) => {
            const activity = row.opens + row.creates;
            return (
              <div key={row.toolId} className="tracker-row analytics-tool-row">
                <div className="tracker-row-main">
                  <span className="tracker-row-title">{toolName(row.toolId)}</span>
                  <span className="tracker-row-sub">{row.toolId} · {row.uniqueUsers} people</span>
                  <div className="usage-bar" aria-hidden>
                    <span style={{ width: `${(activity / maxToolActivity) * 100}%` }} />
                  </div>
                </div>
                <div className="analytics-tool-meta">
                  <span>{row.opens} opens</span>
                  <span>{row.creates} creates</span>
                  <span>{pct(row.creates, row.opens)}% conv.</span>
                  <span>{row.exports} exports</span>
                  {row.limitBlocks ? <span className="pill pill-warning">{row.limitBlocks} blocked</span> : null}
                </div>
                <Link href={`/admin/analytics/tools/${row.toolId}`} className="btn btn-ghost btn-sm">
                  Deep dive
                </Link>
              </div>
            );
          })}
          {tools.length === 0 ? <p className="muted">No tool activity in this range. Use the operator app, then rebuild rollups.</p> : null}
        </div>
      </section>

      <div className="analytics-grid">
        <section className="panel admin-card">
          <h2>When people work</h2>
          <div className="heat-grid">
            {breakdown.hours.map((h) => (
              <div
                key={h.hour}
                className="heat-cell"
                style={{ opacity: 0.18 + (h.count / maxHour) * 0.82 }}
                title={`${h.hour}:00 — ${h.count} events`}
              >
                {h.hour}
              </div>
            ))}
          </div>
        </section>
        <section className="panel admin-card">
          <h2>Devices</h2>
          {breakdown.devices.length === 0 ? (
            <p className="muted">No device signals yet.</p>
          ) : (
            <ul className="admin-list">
              {breakdown.devices.map((d) => (
                <li key={d.device}>
                  <span>{d.device}</span>
                  <span>{d.count.toLocaleString()} · {pct(d.count, deviceTotal)}%</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="analytics-subhead">Event mix</h3>
          <ul className="admin-list">
            {breakdown.eventTypes.map((e) => (
              <li key={e.eventType}>
                <span>{e.eventType}</span>
                <span>{e.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel admin-card">
          <h2>Most active people</h2>
          {breakdown.users.length === 0 ? (
            <p className="muted">No identified users in this window.</p>
          ) : (
            <ul className="admin-list">
              {breakdown.users.map((u) => (
                <li key={String(u.userId ?? u.label)}>
                  <span>{u.label}</span>
                  <span>{u.count} events · {u.tools} tools</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="analytics-grid">
        <section className="panel admin-card">
          <h2>Insights</h2>
          {insights.length === 0 ? (
            <p className="muted">Not enough signal yet — keep using tools and this will fill in.</p>
          ) : (
            <ul className="admin-insights">
              {insights.map((ins) => (
                <li key={ins.id}>
                  <strong>{ins.title}</strong>
                  <p>{ins.body}</p>
                  {ins.actionHref ? (
                    <Link href={ins.actionHref} className="btn btn-ghost btn-sm">{ins.actionLabel ?? "Open"}</Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel admin-card">
          <h2>Live stream</h2>
          <div className="tracker-list admin-scroll-list">
            {breakdown.recent.map((ev, i) => (
              <div key={`${ev.at}-${i}`} className="tracker-row">
                <div className="tracker-row-main">
                  <span className="tracker-row-title">{ev.eventType}</span>
                  <span className="tracker-row-sub">
                    {ev.toolId ? toolName(ev.toolId) : "app"} · {ev.actor ?? "anonymous"} · {ev.device ?? "—"}
                  </span>
                </div>
                <span className="muted">{String(ev.at).slice(0, 16).replace("T", " ")}</span>
              </div>
            ))}
            {breakdown.recent.length === 0 ? <p className="muted">No raw events stored for this range.</p> : null}
          </div>
        </section>
      </div>
      </div>
    </div>
  );
}
