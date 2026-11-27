"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Badge,
  BarChart,
  Button,
  ChartCard,
  DataTable,
  Grid,
  GroupedBarChart,
  KpiCard,
  type BosColumn,
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
import { uniqueTools } from "@/config/tools.config";
import { useOptionalPlatformConfig } from "@/components/config/ConfigProvider";
import { adminDeepLink } from "@/lib/admin-deep-links";
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

function toolTitle(toolId: string, toolNames?: Record<string, string>) {
  if (toolId === "_app") return "App-wide activity";
  return toolNames?.[toolId]?.trim() || uniqueTools().find((t) => t.id === toolId)?.name || toolId;
}

export default function AdminToolAnalyticsPage() {
  const toolNames = useOptionalPlatformConfig()?.config?.toolNames;
  const params = useParams();
  const toolId = String(params.toolId ?? "");
  const name = toolTitle(toolId, toolNames);

  const [days, setDays] = useState(30);
  const [grain, setGrain] = useState<Grain>("day");
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

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
    } finally {
      setLoaded(true);
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

  const recent = useMemo(() => series.slice(-6), [series]);
  const groupedUsage = useMemo(
    () => recent.map((r) => ({ label: formatAnalyticsBucket(r.date, grain), a: r.opens, b: r.creates })),
    [recent, grain],
  );
  const totalUsage = useMemo(
    () =>
      recent.map((r) => ({
        label: formatAnalyticsBucket(r.date, grain),
        value: r.opens + r.creates + r.exports,
      })),
    [recent, grain],
  );

  const mixLabel = grain === "month" ? "Monthly mix" : grain === "week" ? "Weekly mix" : "Daily mix";
  const listLabel = grain === "month" ? "By month" : grain === "week" ? "By week" : "By day";
  const subtitle = `${toolId === "_app" ? "Events not tied to a specific tool" : toolId} · ${analyticsRangeLabel(days)}`;
  const conversion = totals.opens ? Math.round((totals.creates / totals.opens) * 100) : 0;

  const toolbar = (
    <>
      <Link href={adminDeepLink.analytics()}>
        <Button variant="ghost" size="sm">
          ← All tools
        </Button>
      </Link>
      <AnalyticsRangePills value={days} onChange={setDays} />
    </>
  );

  if (!loaded) return <AdminPageSkeleton cards={4} />;

  if (error && series.length === 0) {
    return (
      <AdminPage title={name} sub={subtitle} toolbar={toolbar}>
        <AdminErrorState message={error} onRetry={() => void load()} />
      </AdminPage>
    );
  }

  const columns: ReadonlyArray<BosColumn<SeriesRow>> = [
    { key: "date", header: "Period", cell: (row) => formatAnalyticsBucket(row.date, grain) },
    { key: "opens", header: "Opens", align: "right", cell: (row) => row.opens.toLocaleString() },
    { key: "creates", header: "Creates", align: "right", cell: (row) => row.creates.toLocaleString() },
    { key: "updates", header: "Edits", align: "right", cell: (row) => row.updates.toLocaleString() },
    { key: "exports", header: "Exports", align: "right", cell: (row) => row.exports.toLocaleString() },
    {
      key: "limitBlocks",
      header: "Blocked",
      align: "right",
      cell: (row) => (row.limitBlocks ? <Badge auto tone="amber">{row.limitBlocks} blocked</Badge> : "—"),
    },
  ];

  return (
    <AdminPage title={name} sub={subtitle} toolbar={toolbar}>
      {error ? <AdminErrorState message={error} onRetry={() => void load()} /> : null}

      <Grid cols={4} min={150} gap={12}>
        <KpiCard label="Opens" value={totals.opens.toLocaleString()} chip={{ color: "mint", glyph: "◎" }} interactive={false} />
        <KpiCard
          label="Creates"
          value={totals.creates.toLocaleString()}
          chip={{ color: "lavender", glyph: "＋" }}
          interactive={false}
          delta={`${conversion}% open → create`}
          deltaTone="muted"
        />
        <KpiCard label="Updates" value={totals.updates.toLocaleString()} chip={{ color: "blue", glyph: "✎" }} interactive={false} />
        <KpiCard label="Exports" value={totals.exports.toLocaleString()} chip={{ color: "rose", glyph: "⇩" }} interactive={false} />
        <KpiCard label="Prints" value={totals.prints.toLocaleString()} chip={{ color: "sage", glyph: "▤" }} interactive={false} />
        <KpiCard label="Calc runs" value={totals.calcRuns.toLocaleString()} chip={{ color: "blue", glyph: "∑" }} interactive={false} />
        <KpiCard
          label="Limit blocks"
          value={totals.limitBlocks.toLocaleString()}
          chip={{ color: "amber", glyph: "▣" }}
          interactive={false}
          delta={totals.limitBlocks ? "Freemium friction" : "No limit hits"}
          deltaTone={totals.limitBlocks ? "warn" : "muted"}
        />
      </Grid>

      <AdminSection title={mixLabel} description="Longer ranges roll up so the chart stays readable. Charts show the latest 6 buckets.">
        {series.length === 0 ? (
          <AdminEmpty title="No activity in this range" icon="trend" />
        ) : (
          <Grid cols={2} min={260} gap={12}>
            <ChartCard
              title="Opens vs creates"
              legend={[
                { label: "Opens", tone: "emerald" },
                { label: "Creates", tone: "coral" },
              ]}
            >
              <GroupedBarChart data={groupedUsage} ariaLabel={`${name} opens versus creates`} series={["Opens", "Creates"]} />
            </ChartCard>
            <ChartCard title="Total volume (opens + creates + exports)">
              <BarChart data={totalUsage} ariaLabel={`${name} total activity`} />
            </ChartCard>
          </Grid>
        )}
      </AdminSection>

      <AdminSection title={listLabel} description={`${series.length} buckets in range.`}>
        <div className="admin-cc-scroll">
          <DataTable
            caption={listLabel}
            columns={columns}
            rows={series}
            rowKey={(row) => row.date}
            empty="No rollup rows for this tool yet."
          />
        </div>
      </AdminSection>
    </AdminPage>
  );
}
