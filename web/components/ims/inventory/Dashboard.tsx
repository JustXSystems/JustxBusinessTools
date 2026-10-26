"use client";

import "./inventory-a.css";

import { useState, type ReactNode } from "react";
import { DonutChart, Grid, WidgetCard, WidgetRow, type BosKpi } from "@/components/bos";
import type { ImsModuleKey, ImsPermission, MovementType, Period } from "@/lib/ims/api";
import { MOVEMENT_LABEL, dateLabel, dateRange, dayMonth, greetingFor, inr, inrCompact, pct, qtyText, signedQty, timeAgo } from "@/lib/ims/format";
import { invA, type ImsDashboardPlus } from "@/lib/ims/inventory-a";
import { Loaded, PeriodPicker, Stack, useIms, useImsData } from "../core";
import { KpiLink, movementDelta } from "./ItemDetail";

type Nav = (module: ImsModuleKey, intent?: string) => void;

/* ---------- 14-day flow chart (two series; the kit charts are sized for ≤6 bars) ---------- */

function FlowChart({ series, today }: { series: ImsDashboardPlus["series"]; today: string }) {
  const slot = 26;
  const height = 150;
  const base = height - 20;
  const top = 12;
  const max = Math.max(1, ...series.flatMap((s) => [s.in, s.out]));
  const h = (v: number) => (v > 0 ? Math.max(3, Math.round((v / max) * (base - top))) : 0);
  const width = series.length * slot + 8;
  const totalIn = series.reduce((s, d) => s + d.in, 0);
  const totalOut = series.reduce((s, d) => s + d.out, 0);
  return (
    <svg
      className="ims-flow"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Stock in versus out, last 14 days: ${qtyText(totalIn)} in, ${qtyText(totalOut)} out`}
    >
      <line className="ims-flow-grid" x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} />
      <line className="ims-flow-grid" x1={0} x2={width} y1={top} y2={top} strokeDasharray="3 4" />
      <text className="ims-flow-axis" x={width} y={top - 3} textAnchor="end">
        {qtyText(max)}
      </text>
      {series.map((d, i) => {
        const x = 4 + i * slot;
        const isToday = d.date === today;
        return (
          <g key={d.date}>
            <rect className="ims-flow-in" x={x + 3} y={base - h(d.in)} width={9} height={h(d.in)} rx={2.5}>
              <title>{`${dayMonth(d.date)} · in ${qtyText(d.in)}`}</title>
            </rect>
            <rect className="ims-flow-out" x={x + 13} y={base - h(d.out)} width={9} height={h(d.out)} rx={2.5}>
              <title>{`${dayMonth(d.date)} · out ${qtyText(d.out)}`}</title>
            </rect>
            {i % 2 === series.length % 2 || isToday ? (
              <text className={`ims-flow-axis${isToday ? " ims-flow-today" : ""}`} x={x + 12.5} y={height - 6} textAnchor="middle">
                {isToday ? "Today" : d.date.slice(8)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Pieces ---------- */

function AttentionRow({ icon, tone, title, body, meta, onClick }: { icon: string; tone: string; title: ReactNode; body?: ReactNode; meta?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="ims-attn-row" onClick={onClick}>
      <span className="ims-attn-ic" style={{ background: `var(--bos-${tone}-100)` }} aria-hidden="true">
        {icon}
      </span>
      <span className="ims-cell-stack">
        <span className="ims-strong">{title}</span>
        {body ? <small>{body}</small> : null}
      </span>
      <span className="ims-faint">{meta ?? "›"}</span>
    </button>
  );
}

const NOTE_ICON: Partial<Record<ImsModuleKey, string>> = { lowstock: "⚠", approvals: "🛡", checks: "☑", receivables: "💰", payables: "📤" };

const MOVE_ICON: Record<MovementType, string> = { OPENING: "✦", IN: "⬇", OUT: "⬆", DAMAGE: "🔧", ADJUSTMENT: "⚖", RETURN_IN: "↩", RETURN_OUT: "↪", WRITE_OFF: "✕" };
const MOVE_TONE: Record<MovementType, string> = { OPENING: "blue", IN: "emerald", OUT: "blue", DAMAGE: "coral", ADJUSTMENT: "amber", RETURN_IN: "amber", RETURN_OUT: "amber", WRITE_OFF: "coral" };

function Onboarding({ can, navigate }: { can: (p: ImsPermission) => boolean; navigate: Nav }) {
  const steps = [
    can("items") ? { ic: "📦", title: "Add your first item", sub: "Name, price, GST and opening stock", go: () => navigate("items", "new") } : null,
    can("items") ? { ic: "📄", title: "Import from Excel", sub: "Bring your whole catalogue in one go", go: () => navigate("items", "import") } : null,
    { ic: "⧉", title: "Import from BOS", sub: "Reuse products from Justx BOS / Quotations", go: () => navigate("connect") },
    can("suppliers") ? { ic: "🚚", title: "Add suppliers", sub: "Needed for purchase orders and restock", go: () => navigate("parties", "new") } : null,
  ].filter((s): s is NonNullable<typeof s> => s !== null);
  return (
    <section className="ims-inv-onboard" aria-labelledby="ims-onboard-title">
      <h2 id="ims-onboard-title">Let&apos;s set up your inventory</h2>
      <p>Add products to start tracking stock, value and reorders. Everything else — invoices, POs, scanning — builds on your item list.</p>
      <div className="ims-inv-steps">
        {steps.map((s) => (
          <button key={s.title} type="button" className="ims-inv-step" onClick={s.go}>
            <span className="ims-inv-step-ic" aria-hidden="true">
              {s.ic}
            </span>
            <span>
              <b>{s.title}</b>
              <span>{s.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- Module ---------- */

export function DashboardModule() {
  const { session, can, navigate } = useIms();
  const [period, setPeriod] = useState<Period>("30d");
  const state = useImsData(() => invA.dashboard({ period }), [period]);
  const d = state.data;
  const canSeeCost = can("reports") || can("items") || can("po");
  const firstName = (session.actor.name ?? "").trim().split(/\s+/)[0] ?? "";
  const businessName = session.settings.businessName || session.brand?.name || "Your business";

  const quick = [
    { label: "Create invoice", ic: "🧾", show: can("sales"), go: () => navigate("sales", "new") },
    { label: "Add product", ic: "📦", show: can("items"), go: () => navigate("items", "new") },
    { label: "Stock in", ic: "⬇", show: can("stockIn"), go: () => navigate("stockin") },
    { label: "Stock out", ic: "⬆", show: can("stockOut"), go: () => navigate("stockout") },
    { label: "Scan stock", ic: "⌗", show: (["stockIn", "stockOut", "stockCheck", "items"] as const).some(can), go: () => navigate("scanner") },
    { label: "Receive payment", ic: "💰", show: can("receivables"), go: () => navigate("receivables", "pay") },
    { label: "Create PO", ic: "🛒", show: can("po"), go: () => navigate("purchase", "new") },
  ].filter((q) => q.show);

  return (
    <Stack>
      <section className="ims-hero" aria-label="Today">
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="ims-hero-greet">
            {greetingFor()}
            {firstName ? `, ${firstName}` : ""} 👋
          </div>
          <h1 className="ims-hero-title">{businessName}</h1>
          <div className="ims-hero-sub">
            {dateLabel(d?.today ?? session.today)} · {session.access.roleLabel}
          </div>
        </div>
        <div className="ims-hero-stats">
          <div className="ims-hero-stat">
            <b>{d ? qtyText(d.kpis.todayIn) : "—"}</b>
            <span>Stock in today</span>
          </div>
          <div className="ims-hero-stat">
            <b>{d ? qtyText(d.kpis.todayOut) : "—"}</b>
            <span>Stock out today</span>
          </div>
          <div className="ims-hero-stat">
            <b>{d ? d.kpis.todayEntries : "—"}</b>
            <span>Entries today</span>
          </div>
          {canSeeCost ? (
            <div className="ims-hero-stat">
              <b>{d ? inrCompact(d.kpis.stockValue) : "—"}</b>
              <span>Stock value</span>
            </div>
          ) : null}
        </div>
      </section>

      {quick.length ? (
        <nav className="ims-quick" aria-label="Quick actions">
          {quick.map((q) => (
            <button key={q.label} type="button" className="ims-quick-btn" onClick={q.go}>
              <span className="ims-quick-ic" aria-hidden="true">
                {q.ic}
              </span>
              {q.label}
            </button>
          ))}
        </nav>
      ) : null}

      <Loaded state={state} rows={3}>
        {(data) => <DashboardBody d={data} period={period} setPeriod={setPeriod} canSeeCost={canSeeCost} />}
      </Loaded>
    </Stack>
  );
}

function DashboardBody({ d, period, setPeriod, canSeeCost }: { d: ImsDashboardPlus; period: Period; setPeriod: (p: Period) => void; canSeeCost: boolean }) {
  const { can, navigate } = useIms();
  const k = d.kpis;
  const ins = d.insights;
  const totalItems = Number(k?.totalItems ?? 0);
  const lowStock = Number(k?.lowStock ?? 0);
  const outOfStock = Number(k?.outOfStock ?? 0);
  const empty = totalItems === 0;
  const attention = lowStock + outOfStock;

  const kpis: Array<(BosKpi & { key: string; onClick?: () => void }) | null> = [
    {
      key: "items",
      label: "Total items",
      value: totalItems.toLocaleString("en-IN"),
      chip: { color: "blue", glyph: "📦" },
      delta: ins ? `${qtyText(ins.totalUnits)} units on hand` : `${Number(k?.goodStock ?? 0)} in stock`,
      deltaTone: "muted",
      onClick: () => navigate("items"),
    },
    canSeeCost
      ? {
          key: "value",
          label: "Stock value (cost)",
          value: inrCompact(k.stockValue),
          chip: { color: "mint", glyph: "₹" },
          delta: `Retail ${inrCompact(k.retailValue)}${ins && ins.marginPct ? ` · ${pct(ins.marginPct, 1)} margin` : ""}`,
          deltaTone: "info",
          onClick: () => navigate("stock"),
        }
      : null,
    {
      key: "low",
      label: "Low / out of stock",
      value: attention,
      valueTone: k.outOfStock ? "coral" : attention ? "amber" : undefined,
      chip: { color: "amber", glyph: "⚠" },
      delta: attention ? `${k.outOfStock} out · ${k.lowStock} low` : "All above minimum",
      deltaTone: k.outOfStock ? "down" : attention ? "warn" : "up",
      onClick: () => navigate("lowstock"),
    },
    {
      key: "damaged",
      label: "Damaged units",
      value: qtyText(k.damagedUnits),
      chip: { color: "rose", glyph: "🔧" },
      delta: k.overStock ? `${k.overStock} items overstocked` : "Quarantined from sale",
      deltaTone: k.damagedUnits ? "warn" : "muted",
      onClick: can("damage") ? () => navigate("returns") : undefined,
    },
    can("sales") || can("reports")
      ? { key: "sales", label: "Sales this month", value: inrCompact(k.salesMtd), chip: { color: "sage", glyph: "🧾" }, delta: "Issued GST invoices", deltaTone: "muted", onClick: can("sales") ? () => navigate("sales") : undefined }
      : null,
    can("receivables")
      ? {
          key: "ar",
          label: "Receivable",
          value: inrCompact(k.receivable),
          chip: { color: "lavender", glyph: "💰" },
          delta: k.overdue > 0 ? `${inrCompact(k.overdue)} overdue · ${k.overdueCount} invoice${k.overdueCount === 1 ? "" : "s"}` : "Nothing overdue",
          deltaTone: k.overdue > 0 ? "down" : "up",
          onClick: () => navigate("receivables"),
        }
      : null,
    can("payables") ? { key: "ap", label: "Payable", value: inrCompact(k.payable), chip: { color: "blue", glyph: "📤" }, delta: "Open supplier bills", deltaTone: "muted", onClick: () => navigate("payables") } : null,
    can("approvals")
      ? {
          key: "approvals",
          label: "Pending approvals",
          value: k.pendingApprovals,
          valueTone: k.pendingApprovals ? "blue" : undefined,
          chip: { color: "amber", glyph: "🛡" },
          delta: k.pendingApprovals ? `${d.pending.po} PO · ${d.pending.bills} bills · ${d.pending.checks} checks` : "You're all caught up",
          deltaTone: k.pendingApprovals ? "info" : "up",
          onClick: () => navigate("approvals"),
        }
      : null,
  ];

  const health = [
    { key: "GOOD", label: "In stock", value: k.goodStock, tone: "emerald" as const },
    { key: "LOW", label: "Low", value: k.lowStock, tone: "amber" as const },
    { key: "OUT_OF_STOCK", label: "Out", value: k.outOfStock, tone: "coral" as const },
    { key: "OVERSTOCK", label: "Overstock", value: k.overStock, tone: "blue" as const },
  ];
  const agingTotal = d.aging.reduce((s, a) => s + (canSeeCost ? a.value : a.items), 0);
  const catMax = Math.max(1, ...d.categories.map((c) => (canSeeCost ? c.value : c.units)));
  const moverMax = Math.max(1, ...d.topMovers.map((m) => m.qty));
  const fastest = d.topMovers[0];

  return (
    <Stack>
      {empty ? <Onboarding can={can} navigate={navigate} /> : null}

      <Grid cols={4} min={170}>
        {kpis
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .map(({ key, ...kpi }) => (
            <KpiLink key={key} {...kpi} />
          ))}
      </Grid>

      {!empty ? (
        <>
          <WidgetCard title="Stock flow" dot="mint" note={dateRange(d.range.from, d.range.to)}>
            <div className="ims-inv-section-head">
              <span className="ims-inv-section-sub">Movement totals for the selected period</span>
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
            <div className="ims-inv-tiles">
              <div className="ims-inv-tile">
                <small>Stock in</small>
                <b className="ims-pos">{qtyText(k.stockIn)}</b>
                <span>{canSeeCost && ins ? `Purchases ${inrCompact(ins.period.purchasedValue)}` : "Units received"}</span>
              </div>
              <div className="ims-inv-tile">
                <small>Stock out</small>
                <b>{qtyText(k.stockOut)}</b>
                <span>Sales value {inrCompact(k.salesValue)}</span>
              </div>
              <div className="ims-inv-tile">
                <small>Damaged</small>
                <b className={k.damaged ? "ims-neg" : undefined}>{qtyText(k.damaged)}</b>
                <span>{canSeeCost && ins?.period.damagedValue ? `Loss ${inrCompact(ins.period.damagedValue)}` : "Units written down"}</span>
              </div>
              {ins ? (
                <div className="ims-inv-tile">
                  <small>Invoiced</small>
                  <b>{inrCompact(ins.period.invoiced)}</b>
                  <span>
                    {ins.period.invoices} invoice{ins.period.invoices === 1 ? "" : "s"}
                  </span>
                </div>
              ) : null}
              {ins ? (
                <div className="ims-inv-tile">
                  <small>Entries</small>
                  <b>{ins.period.entries.toLocaleString("en-IN")}</b>
                  <span>{ins.period.returnsIn ? `${qtyText(ins.period.returnsIn)} returned in` : "Stock movements"}</span>
                </div>
              ) : null}
            </div>
          </WidgetCard>

          <Grid template="minmax(0, 1.6fr) minmax(0, 1fr)">
            <WidgetCard title="Stock in vs out" dot="blue" note="Last 14 days">
              <FlowChart series={d.series} today={d.today} />
              <div className="ims-legend">
                <span>
                  <i style={{ background: "var(--bos-emerald)" }} />
                  In {qtyText(d.series.reduce((s, x) => s + x.in, 0))}
                </span>
                <span>
                  <i style={{ background: "var(--bos-blue)" }} />
                  Out {qtyText(d.series.reduce((s, x) => s + x.out, 0))}
                </span>
              </div>
            </WidgetCard>
            <WidgetCard title="Stock health" dot="sage" note={`${k.totalItems} items`}>
              <div className="ims-row" style={{ justifyContent: "center", gap: 20 }}>
                <DonutChart segments={health.map((h) => ({ label: h.label, value: h.value, tone: h.tone }))} centerValue={pct(k.totalItems ? (k.goodStock / k.totalItems) * 100 : 0)} centerLabel="HEALTHY" rounded ariaLabel="Stock health" />
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
                  {health.map((h) => (
                    <WidgetRow
                      key={h.key}
                      label={
                        <span>
                          <span className="ims-inv-dot" style={{ background: `var(--bos-${h.tone})` }} />
                          {h.label}
                        </span>
                      }
                      value={String(h.value)}
                      onClick={() => navigate("stock", `status:${h.key}`)}
                    />
                  ))}
                </div>
              </div>
            </WidgetCard>
          </Grid>

          <Grid template="minmax(0, 1fr) minmax(0, 1fr)">
            <WidgetCard title={canSeeCost ? "Value by category" : "Units by category"} dot="lavender" note={`${d.categories.length} categories`}>
              {d.categories.length ? (
                <div className="ims-bars">
                  {d.categories.slice(0, 7).map((c) => {
                    const v = canSeeCost ? c.value : c.units;
                    return (
                      <button
                        key={c.category}
                        type="button"
                        className="ims-bar-row"
                        style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
                        onClick={() => navigate("stock", `category:${c.category}`)}
                      >
                        <span className="ims-cell-stack">
                          <span className="ims-strong">{c.category}</span>
                          <small>
                            {c.items} item{c.items === 1 ? "" : "s"} · {qtyText(c.units)} units
                          </small>
                        </span>
                        <span className="ims-bar-track">
                          <span className="ims-bar-fill" style={{ display: "block", width: `${Math.max(2, (v / catMax) * 100)}%` }} />
                        </span>
                        <span className="ims-num ims-strong">{canSeeCost ? inrCompact(c.value) : qtyText(c.units)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="ims-faint">No categorised stock yet.</p>
              )}
            </WidgetCard>

            <WidgetCard title="Stock aging" dot="rose" note="Days since last movement">
              <div className="ims-stackbar" role="img" aria-label={`Stock aging: ${d.aging.map((a) => `${a.label} ${a.items} items`).join(", ")}`}>
                {d.aging.map((a) => {
                  const v = canSeeCost ? a.value : a.items;
                  return agingTotal > 0 && v > 0 ? <span key={a.key} style={{ width: `${(v / agingTotal) * 100}%`, background: a.color }} title={`${a.label}: ${a.items} items`} /> : null;
                })}
              </div>
              <div style={{ marginTop: 12 }}>
                {d.aging.map((a) => (
                  <WidgetRow
                    key={a.key}
                    label={
                      <span>
                        <span className="ims-inv-dot" style={{ background: a.color }} />
                        {a.label}
                      </span>
                    }
                    value={`${a.items} item${a.items === 1 ? "" : "s"}${canSeeCost ? ` · ${inrCompact(a.value)}` : ""}`}
                    onClick={() => navigate("stock", `aging:${a.key}`)}
                  />
                ))}
              </div>
            </WidgetCard>
          </Grid>
        </>
      ) : null}

      <Grid template="minmax(0, 1.3fr) minmax(0, 1fr)">
        <WidgetCard title="Needs attention" dot="rose" note={d.notifications.length ? `${d.notifications.length}` : undefined}>
          {d.notifications.length ? (
            <div className="ims-attn">
              {d.notifications.slice(0, 8).map((n) => (
                <AttentionRow
                  key={n.id}
                  icon={NOTE_ICON[n.module] ?? "•"}
                  tone={n.tone}
                  title={n.title}
                  body={n.body}
                  meta={n.at ? timeAgo(n.at) : undefined}
                  onClick={() => navigate(n.module, n.open ? `open:${n.open}` : undefined)}
                />
              ))}
            </div>
          ) : (
            <p className="ims-faint">Nothing needs you right now — no low stock, approvals or overdue dues. ✓</p>
          )}
          {can("approvals") && k.pendingApprovals ? (
            <div style={{ marginTop: 12 }}>
              <WidgetRow label="Purchase orders awaiting approval" value={String(d.pending.po)} valueTone={d.pending.po ? "blue" : "faint"} onClick={() => navigate("approvals")} />
              <WidgetRow label="Supplier bills awaiting approval" value={String(d.pending.bills)} valueTone={d.pending.bills ? "blue" : "faint"} onClick={() => navigate("approvals")} />
              <WidgetRow label="Stock checks awaiting approval" value={String(d.pending.checks)} valueTone={d.pending.checks ? "blue" : "faint"} onClick={() => navigate("checks")} />
            </div>
          ) : null}
        </WidgetCard>

        <WidgetCard title="Inventory insights" dot="mint">
          <WidgetRow label={attention ? `${attention} item${attention === 1 ? " is" : "s are"} at or below minimum` : "Every item is above its minimum level"} value={attention ? "Restock ›" : "✓"} valueTone={attention ? "amber" : "emerald"} onClick={() => navigate("lowstock")} />
          {canSeeCost ? <WidgetRow label={`${inr(k.stockValue)} of stock on hand at cost`} value={ins ? `${pct(ins.marginPct, 1)} margin` : inrCompact(k.retailValue)} valueTone="emerald" onClick={() => navigate("stock")} /> : null}
          {fastest ? <WidgetRow label={`${fastest.name} is the fastest mover`} value={`${qtyText(fastest.qty)} out`} valueTone="blue" onClick={() => navigate("items", `open:${fastest.itemId}`)} /> : null}
          {ins && ins.deadStock.items ? (
            <WidgetRow label={`${ins.deadStock.items} item${ins.deadStock.items === 1 ? "" : "s"} idle for 90+ days`} value={canSeeCost ? inrCompact(ins.deadStock.value) : "View ›"} valueTone="coral" onClick={() => navigate("stock", "aging:90+")} />
          ) : null}
          {ins && ins.slowMovers.items ? (
            <WidgetRow label={`${ins.slowMovers.items} in-stock item${ins.slowMovers.items === 1 ? "" : "s"} didn't sell in 30 days`} value="Review ›" valueTone="amber" onClick={() => navigate("stock", "velocity:DEAD")} />
          ) : null}
          {ins && ins.missingHsn && can("items") ? <WidgetRow label={`${ins.missingHsn} item${ins.missingHsn === 1 ? "" : "s"} missing HSN code`} value="Fix ›" valueTone="amber" onClick={() => navigate("items")} /> : null}
          {ins && ins.missingPrice && can("items") ? <WidgetRow label={`${ins.missingPrice} item${ins.missingPrice === 1 ? "" : "s"} without a selling price`} value="Fix ›" valueTone="amber" onClick={() => navigate("items")} /> : null}
          {empty ? <WidgetRow label="Add items to unlock stock insights" value="Start ›" onClick={() => navigate("items", can("items") ? "new" : undefined)} /> : null}
        </WidgetCard>
      </Grid>

      {!empty ? (
        <Grid template="minmax(0, 1fr) minmax(0, 1fr)">
          <WidgetCard title="Top movers" dot="blue" note={dateRange(d.range.from, d.range.to)}>
            {d.topMovers.length ? (
              <div className="ims-bars">
                {d.topMovers.map((m) => (
                  <button
                    key={m.itemId}
                    type="button"
                    className="ims-bar-row"
                    style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
                    onClick={() => navigate("items", `open:${m.itemId}`)}
                  >
                    <span className="ims-strong" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.name}
                    </span>
                    <span className="ims-bar-track">
                      <span className="ims-bar-fill" style={{ display: "block", width: `${Math.max(2, (m.qty / moverMax) * 100)}%` }} />
                    </span>
                    <span className="ims-num">
                      <b>{qtyText(m.qty)}</b>
                      {m.value ? <span className="ims-faint"> · {inrCompact(m.value)}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="ims-faint">No stock went out in this period.</p>
            )}
          </WidgetCard>

          <WidgetCard title="Recent movements" dot="sage">
            {d.recent.length ? (
              <div className="ims-attn">
                {d.recent.map((m) => {
                  const delta = movementDelta({ type: m.type, qty: m.qty });
                  return (
                    <AttentionRow
                      key={m.id}
                      icon={MOVE_ICON[m.type]}
                      tone={MOVE_TONE[m.type]}
                      title={m.itemName}
                      body={[MOVEMENT_LABEL[m.type], m.partyName ?? m.refNo, m.actorName].filter(Boolean).join(" · ")}
                      meta={
                        <span className="ims-cell-stack" style={{ alignItems: "flex-end" }}>
                          <span className={delta < 0 ? "ims-neg ims-strong" : "ims-pos ims-strong"}>{m.type === "ADJUSTMENT" ? qtyText(m.qty) : signedQty(delta)}</span>
                          <small>{timeAgo(m.createdAt)}</small>
                        </span>
                      }
                      onClick={() => navigate("items", `open:${m.itemId}`)}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="ims-faint">No movements yet.</p>
            )}
            <div style={{ marginTop: 10 }}>
              <WidgetRow label="All transactions & activity" chevron onClick={() => navigate("history")} />
            </div>
          </WidgetCard>
        </Grid>
      ) : null}
    </Stack>
  );
}

export default DashboardModule;
