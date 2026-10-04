"use client";

import {
  AiPill,
  Button,
  ChartCard,
  DonutChart,
  Grid,
  GroupedBarChart,
  KpiCard,
  ModuleToolbar,
  SearchInput,
  WidgetCard,
  WidgetRow,
  type BosDonutSegment,
} from "@/components/bos";
import { bos, type FinanceOverview } from "@/lib/bos-app/api";
import { inr, inrCompact, timeAgo } from "@/lib/bos-app/format";
import { Loaded, Stack, useBosApp, useBosData } from "../core";

function agingSegments(aging: FinanceOverview["aging"]): BosDonutSegment[] {
  const segs: BosDonutSegment[] = [
    { label: "Current", value: aging.current, tone: "emerald" },
    { label: "1–30 days", value: aging["1-30"], tone: "blue" },
    { label: "31–60 days", value: aging["31-60"], tone: "amber" },
    { label: "60+ days", value: aging["61-90"] + aging["90+"], tone: "coral" },
  ];
  return segs.some((s) => s.value > 0) ? segs : [{ label: "Nothing outstanding", value: 1, tone: "faint" }];
}

export function FinanceDashboard() {
  const { navigate, openPalette } = useBosApp();
  const state = useBosData(async () => {
    const [overview, events] = await Promise.all([bos.financeOverview(), bos.events({ limit: 3 })]);
    return { overview, events: events.events };
  });

  return (
    <Loaded state={state} rows={3}>
      {({ overview: o, events }) => {
        const k = o.kpis;
        const net = k.revenueMtd - k.spendMtd;
        const margin = k.revenueMtd > 0 ? Math.round((net / k.revenueMtd) * 1000) / 10 : 0;
        const aging = agingSegments(o.aging);
        const agingTotal = Object.values(o.aging).reduce((s, v) => s + v, 0);
        return (
          <Stack>
            <ModuleToolbar>
              <SearchInput readOnly placeholder="Search or jump to…" aria-label="Open command palette" onClick={openPalette} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPalette()} />
              <AiPill
                action={
                  <Button size="sm" variant="ghost" onClick={() => navigate("finance", k.overdue > 0 ? "receivables" : "invoices")}>
                    Review
                  </Button>
                }
              >
                {k.overdue > 0
                  ? `${inrCompact(k.overdue)} overdue across ${k.overdueCount} invoice${k.overdueCount === 1 ? "" : "s"}`
                  : k.receivable > 0
                    ? `${inrCompact(k.receivable)} receivable — nothing overdue`
                    : "All invoices are settled"}
              </AiPill>
            </ModuleToolbar>

            <Grid cols={4} min={140}>
              <KpiCard label="Revenue (MTD)" value={inrCompact(k.revenueMtd)} chip={{ color: "mint", glyph: "₹" }} delta={`Collected ${inrCompact(k.collectedMtd)}`} />
              <KpiCard
                label="Spend (MTD)"
                value={inrCompact(k.spendMtd)}
                chip={{ color: "rose", glyph: "₹" }}
                delta={k.revenueMtd > 0 ? `${Math.round((k.spendMtd / k.revenueMtd) * 1000) / 10}% of revenue` : "Bills + approved expenses"}
                deltaTone="muted"
              />
              <KpiCard label="Net (MTD)" value={inrCompact(net)} valueTone={net < 0 ? "coral" : undefined} chip={{ color: "blue", glyph: "◎" }} delta={k.revenueMtd > 0 ? `${margin}% margin` : "Revenue − spend"} deltaTone={net < 0 ? "down" : "up"} />
              <KpiCard label="Draft invoices" value={k.draftCount} chip={{ color: "lavender", glyph: "✎" }} delta="Not yet issued" deltaTone="muted" />
            </Grid>
            <Grid cols={2} min={140}>
              <KpiCard
                label="Outstanding Receivables"
                value={inrCompact(k.receivable)}
                chip={{ color: "rose", glyph: "◐" }}
                delta={k.overdue > 0 ? `${inrCompact(k.overdue)} overdue` : "Nothing overdue"}
                deltaTone={k.overdue > 0 ? "warn" : "up"}
              />
              <KpiCard
                label="Outstanding Payables"
                value={inrCompact(k.payable)}
                chip={{ color: "blue", glyph: "◎" }}
                delta={`${k.billsPending} bill${k.billsPending === 1 ? "" : "s"} awaiting approval`}
                deltaTone="muted"
              />
            </Grid>

            <Grid cols={3}>
              <WidgetCard title="🔔 Alerts" dot="blue">
                {events.length ? (
                  events.map((e) => <WidgetRow key={e.id} label={e.summary} value={timeAgo(e.createdAt)} valueTone="faint" soft />)
                ) : (
                  <WidgetRow label={<span className="bos-text-faint">No activity yet</span>} />
                )}
              </WidgetCard>
              <WidgetCard title="⏳ Pending Approvals" dot="rose">
                <WidgetRow label="Vendor bills" value={k.billsPending} valueTone={k.billsPending ? "amber" : "faint"} onClick={() => navigate("finance", "payables")} />
                <WidgetRow label="Expense claims" value={k.expensesPending} valueTone={k.expensesPending ? "amber" : "faint"} onClick={() => navigate("finance", "expenses")} />
                <WidgetRow label="Draft invoices" value={k.draftCount} valueTone={k.draftCount ? "amber" : "faint"} onClick={() => navigate("finance", "invoices")} />
              </WidgetCard>
              <WidgetCard title="🧾 Overdue Invoices" dot="mint">
                {o.overdueInvoices.length ? (
                  o.overdueInvoices.slice(0, 3).map((i) => (
                    <WidgetRow key={i.id} label={`${i.partyName} · ${i.daysOverdue}d`} value={inr(i.balance)} valueTone="coral" onClick={() => navigate("finance", "invoices", `open:${i.id}`)} />
                  ))
                ) : (
                  <WidgetRow label="All invoices on time" value="✓" valueTone="emerald" />
                )}
              </WidgetCard>
            </Grid>

            <Grid template="1.3fr 1fr">
              <ChartCard
                title="Revenue vs Spend trend"
                legend={[
                  { label: "Revenue", tone: "emerald" },
                  { label: "Spend", tone: "coral" },
                ]}
              >
                <GroupedBarChart ariaLabel="Revenue vs spend, last six months" renderHeight={110} series={["Revenue", "Spend"]} data={o.series.map((s) => ({ label: s.label, a: s.revenue, b: s.spend }))} />
              </ChartCard>
              <ChartCard title="Receivables aging" center legend={aging.map((s) => ({ label: s.tone === "faint" ? s.label : `${s.label} ${inrCompact(s.value)}`, tone: s.tone }))}>
                <DonutChart ariaLabel="Receivables by age" size={90} segments={aging} centerValue={agingTotal > 0 ? inrCompact(agingTotal).replace("₹", "") : "0"} centerLabel="OPEN ₹" />
              </ChartCard>
            </Grid>
          </Stack>
        );
      }}
    </Loaded>
  );
}
