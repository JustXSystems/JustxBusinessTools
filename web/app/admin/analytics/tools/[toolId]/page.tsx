"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AnalyticsRangePills,
  analyticsRangeLabel,
  formatAnalyticsBucket,
} from "@/components/admin/AnalyticsRangePills";
import { uniqueTools } from "@/config/tools.config";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type SeriesRow = {
  date: string;
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

type Grain = "day" | "week" | "month";

function toolTitle(toolId: string) {
  if (toolId === "_app") return "App-wide activity";
  return uniqueTools().find((t) => t.id === toolId)?.name ?? toolId;
}

export default function AdminToolAnalyticsPage() {
  const params = useParams();
  const toolId = String(params.toolId ?? "");
  const name = toolTitle(toolId);
  const [days, setDays] = useState(30);
  const [grain, setGrain] = useState<Grain>("day");
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!toolId) return;
    setError("");
    try {
      const d = await api<{ series: SeriesRow[]; grain: Grain }>(
        `/admin/analytics/tools/${toolId}?days=${days}`,
      );
      setSeries(d.series);
      setGrain(d.grain ?? "day");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load analytics");
    }
  }, [toolId, days]);

  useLiveRefresh(load, { intervalMs: 60_000, deps: [toolId, days] });

  const totals = series.reduce(
    (acc, row) => ({
      opens: acc.opens + row.opens,
      creates: acc.creates + row.creates,
      updates: acc.updates + row.updates,
      exports: acc.exports + row.exports,
      prints: acc.prints + row.prints,
      calcRuns: acc.calcRuns + row.calcRuns,
      limitBlocks: acc.limitBlocks + (row.limitBlocks ?? 0),
    }),
    { opens: 0, creates: 0, updates: 0, exports: 0, prints: 0, calcRuns: 0, limitBlocks: 0 },
  );

  const max = useMemo(
    () => Math.max(1, ...series.map((r) => r.opens + r.creates + r.exports)),
    [series],
  );

  const mixLabel = grain === "month" ? "Monthly mix" : grain === "week" ? "Weekly mix" : "Daily mix";
  const listLabel = grain === "month" ? "By month" : grain === "week" ? "By week" : "By day";

  return (
    <div className="admin-page">
      <div className="admin-stack analytics-page admin-page-scroll">
      <section className="panel admin-card">
        <div className="analytics-toolbar">
          <div>
            <Link href="/admin/analytics" className="btn btn-ghost btn-sm">← All tools</Link>
            <h2>{name}</h2>
            <p className="muted">
              {toolId === "_app"
                ? "Events that were not tied to a specific tool"
                : toolId}{" "}
              · {analyticsRangeLabel(days)}
            </p>
          </div>
        </div>
        <AnalyticsRangePills value={days} onChange={setDays} />
        {error ? <p className="field-error">{error}</p> : null}
        <div className="analytics-kpis">
          <div className="result-card"><span>Opens</span><strong>{totals.opens.toLocaleString()}</strong></div>
          <div className="result-card"><span>Creates</span><strong>{totals.creates.toLocaleString()}</strong></div>
          <div className="result-card"><span>Updates</span><strong>{totals.updates.toLocaleString()}</strong></div>
          <div className="result-card"><span>Exports</span><strong>{totals.exports.toLocaleString()}</strong></div>
          <div className="result-card"><span>Prints</span><strong>{totals.prints.toLocaleString()}</strong></div>
          <div className="result-card"><span>Calc runs</span><strong>{totals.calcRuns.toLocaleString()}</strong></div>
        </div>
      </section>

      <section className="panel admin-card">
        <h2>{mixLabel}</h2>
        <p className="muted">Longer ranges roll up so the chart stays readable.</p>
        <div className="chart-bars">
          {series.map((row) => {
            const total = row.opens + row.creates + row.exports;
            return (
              <div key={row.date} className="chart-col" title={formatAnalyticsBucket(row.date, grain)}>
                <div className="chart-stack" style={{ height: `${Math.max(4, (total / max) * 100)}%` }}>
                  <span className="seg seg-open" style={{ flexGrow: row.opens || 0.01 }} />
                  <span className="seg seg-create" style={{ flexGrow: row.creates || 0.01 }} />
                  <span className="seg seg-export" style={{ flexGrow: row.exports || 0.01 }} />
                </div>
                <span className="chart-label">{formatAnalyticsBucket(row.date, grain)}</span>
              </div>
            );
          })}
        </div>
        {series.length === 0 ? <p className="muted">No activity in this range.</p> : null}
      </section>

      <section className="panel admin-card">
        <h2>{listLabel}</h2>
        <div className="tracker-list admin-scroll-list">
          {series.map((row) => (
            <div key={row.date} className="tracker-row">
              <strong>{formatAnalyticsBucket(row.date, grain)}</strong>
              <span className="muted">
                {row.opens} opens · {row.creates} creates · {row.updates} edits · {row.exports} exports
                {row.limitBlocks ? ` · ${row.limitBlocks} blocked` : ""}
              </span>
            </div>
          ))}
          {series.length === 0 ? <p className="muted">No rollup rows for this tool yet.</p> : null}
        </div>
      </section>
      </div>
    </div>
  );
}
