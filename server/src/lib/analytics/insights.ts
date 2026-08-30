import { getAnalyticsOverview } from "./events.js";

export async function generateInsights(days: unknown = 30): Promise<
  Array<{ id: number; title: string; body: string; actionLabel: string | null; actionHref: string | null }>
> {
  const overview = await getAnalyticsOverview(days);
  const insights: Array<{ type: string; title: string; body: string; actionLabel?: string; actionHref?: string }> = [];

  if (overview.totals.limit_blocks > 0) {
    insights.push({
      type: "upgrade",
      title: "Record limits are blocking work",
      body: `${overview.totals.limit_blocks} blocked saves ${overview.days ? `in the last ${overview.days} days` : "across all recorded time"}. Upgrading to Pro removes per-tool limits.`,
      actionLabel: "View subscription",
      actionHref: "/subscription",
    });
  }

  const invoiceTool = overview.byTool.find((t) => t.toolId === "invoice");
  const paymentTool = overview.byTool.find((t) => t.toolId === "paymenttracker");
  if (invoiceTool && invoiceTool.creates > 5 && (paymentTool?.creates ?? 0) < invoiceTool.creates / 2) {
    insights.push({
      type: "collections",
      title: "Invoices outpace payment tracking",
      body: "You create many invoices but few payment tracker entries. Enable reminders in Collections.",
      actionLabel: "Open collections",
      actionHref: "/admin/payments/collections",
    });
  }

  const top = [...overview.byTool].sort((a, b) => b.creates - a.creates)[0];
  if (top && top.creates > 0) {
    insights.push({
      type: "adoption",
      title: `Top tool: ${top.toolId}`,
      body: `${top.creates} records created in the selected window. Share this workflow with the rest of the team.`,
      actionLabel: "Tool analytics",
      actionHref: `/admin/analytics/tools/${top.toolId}`,
    });
  }

  const quiet = overview.byTool.filter((t) => t.toolId !== "_app" && t.opens === 0 && t.creates === 0);
  if (overview.byTool.length > 3 && quiet.length > overview.byTool.length / 2) {
    insights.push({
      type: "adoption",
      title: "Many tools are unused",
      body: `${quiet.length} catalog tools had no activity. Hide unused tools or train staff on the ones that matter.`,
      actionLabel: "Tools catalog",
      actionHref: "/admin/tools",
    });
  }

  const createRate = overview.totals.opens > 0 ? overview.totals.creates / overview.totals.opens : 0;
  if (overview.totals.opens >= 20 && createRate < 0.15) {
    insights.push({
      type: "conversion",
      title: "Opens are not turning into records",
      body: `Only ${Math.round(createRate * 100)}% of tool opens created a record. Check form friction or permissions.`,
    });
  }

  return insights.map((ins, id) => ({
    id: id + 1,
    title: ins.title,
    body: ins.body,
    actionLabel: ins.actionLabel ?? null,
    actionHref: ins.actionHref ?? null,
  }));
}
