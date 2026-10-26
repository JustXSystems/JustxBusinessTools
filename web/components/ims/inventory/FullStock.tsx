"use client";

import "./inventory-a.css";

import { useMemo, useState } from "react";
import { Badge, Button, Card, DataTable, EmptyState, FilterChip, Grid, KpiCard, Pagination, SearchInput, Select, Switch, WidgetCard, type BosBadgeTone, type BosColumn } from "@/components/bos";
import { ims, type AgingKey, type ImsItem, type StockStatus } from "@/lib/ims/api";
import { AGING_BUCKETS, STOCK_STATUS_LABEL, downloadCsv, downloadXlsx, inr, inrCompact, inrExact, pct, qtyText, stockBadge, timeAgo, todayLocal, type ExportColumn } from "@/lib/ims/format";
import { VELOCITY_LABEL, velocityTiers, type Velocity } from "@/lib/ims/inventory-a";
import { Loaded, PageHeader, Stack, StatusBadge, useIms, useImsData } from "../core";
import { ItemDialog, type ItemEditorState } from "./ItemDialog";
import { AgingChip, ItemCell, ItemDetailDialog, agingOf, useInventoryMeta } from "./ItemDetail";

type SortKey = "value" | "name" | "stock" | "idle" | "moved";

const SORTS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "value", label: "Value (high → low)" },
  { value: "name", label: "Name A–Z" },
  { value: "stock", label: "Stock (high → low)" },
  { value: "idle", label: "Idle days (longest)" },
  { value: "moved", label: "30-day movement" },
];

const VELOCITY_TONE: Record<Velocity, BosBadgeTone> = { BEST: "emerald", AVERAGE: "blue", SLOW: "amber", DEAD: "coral" };
const STATUSES: ReadonlyArray<StockStatus> = ["GOOD", "LOW", "OUT_OF_STOCK", "OVERSTOCK"];
const PAGE_SIZE = 50;

const retailOf = (i: ImsItem) => Math.max(0, i.currentStock) * i.sellingPrice;

type Intent = { open?: string; aging?: AgingKey; status?: StockStatus; category?: string; velocity?: Velocity };

function parseIntent(raw: string | null): Intent {
  if (!raw) return {};
  const [kind, ...rest] = raw.split(":");
  const value = rest.join(":");
  if (kind === "open") return { open: value };
  if (kind === "aging" && AGING_BUCKETS.some((b) => b.key === value)) return { aging: value as AgingKey };
  if (kind === "status" && (STATUSES as readonly string[]).includes(value)) return { status: value as StockStatus };
  if (kind === "category") return { category: value };
  if (kind === "velocity" && value in VELOCITY_LABEL) return { velocity: value as Velocity };
  return {};
}

export function FullStockModule() {
  const { can, navigate, takeIntent } = useIms();
  const [intent] = useState(() => parseIntent(takeIntent("stock")));
  const list = useImsData(() => ims.items(), []);
  const meta = useInventoryMeta();
  const canSeeCost = meta.data?.canSeeCost ?? true;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"ALL" | StockStatus>(intent.status ?? "ALL");
  const [aging, setAging] = useState<"ALL" | AgingKey>(intent.aging ?? "ALL");
  const [velocity, setVelocity] = useState<"ALL" | Velocity>(intent.velocity ?? "ALL");
  const [category, setCategory] = useState(intent.category ?? "");
  const [grouped, setGrouped] = useState(false);
  const [sort, setSort] = useState<SortKey>(intent.aging ? "idle" : "value");
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(intent.open ?? null);
  const [editor, setEditor] = useState<ItemEditorState>(null);

  const all = useMemo(() => list.data?.items ?? [], [list.data]);
  const tiers = useMemo(() => velocityTiers(all), [all]);
  const stocked = useMemo(() => all.filter((i) => i.currentStock > 0), [all]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = all.filter(
      (i) =>
        (!t || [i.name, i.sku, i.barcode, i.brand, i.category, i.location].some((v) => v && v.toLowerCase().includes(t))) &&
        (status === "ALL" || i.status === status) &&
        (aging === "ALL" || (i.currentStock > 0 && i.agingBucket === aging)) &&
        (velocity === "ALL" || tiers.get(i.id) === velocity) &&
        (!category || (i.category || "Uncategorised") === category),
    );
    const by: Record<SortKey, (a: ImsItem, b: ImsItem) => number> = {
      value: (a, b) => b.stockValue - a.stockValue,
      name: (a, b) => a.name.localeCompare(b.name),
      stock: (a, b) => b.currentStock - a.currentStock,
      idle: (a, b) => b.idleDays - a.idleDays,
      moved: (a, b) => b.movement30d - a.movement30d,
    };
    return out.sort(by[sort]);
  }, [all, q, status, aging, velocity, category, sort, tiers]);

  const totals = useMemo(() => {
    const cost = filtered.reduce((s, i) => s + i.stockValue, 0);
    const retail = filtered.reduce((s, i) => s + retailOf(i), 0);
    return { cost, retail, margin: retail - cost, units: filtered.reduce((s, i) => s + Math.max(0, i.currentStock), 0) };
  }, [filtered]);

  const categories = useMemo(() => [...new Set(all.map((i) => i.category || "Uncategorised"))].sort((a, b) => a.localeCompare(b)), [all]);
  const groups = useMemo(() => {
    const m = new Map<string, ImsItem[]>();
    for (const i of filtered) {
      const k = i.category || "Uncategorised";
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()].map(([name, items]) => ({ name, items, value: items.reduce((s, i) => s + i.stockValue, 0), units: items.reduce((s, i) => s + Math.max(0, i.currentStock), 0) })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const filtersOn = Boolean(q || status !== "ALL" || aging !== "ALL" || velocity !== "ALL" || category);
  const clear = () => {
    setQ("");
    setStatus("ALL");
    setAging("ALL");
    setVelocity("ALL");
    setCategory("");
    setPage(0);
  };
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const exportCols: ReadonlyArray<ExportColumn<ImsItem>> = [
    { header: "Item", value: (i) => i.name },
    { header: "SKU", value: (i) => i.sku },
    { header: "Category", value: (i) => i.category },
    { header: "Brand", value: (i) => i.brand },
    { header: "Unit", value: (i) => i.unit },
    { header: "Stock", value: (i) => i.currentStock },
    { header: "Damaged", value: (i) => i.damagedStock },
    { header: "Status", value: (i) => STOCK_STATUS_LABEL[i.status] },
    ...(canSeeCost
      ? [
          { header: "Unit cost", value: (i: ImsItem) => i.purchasePrice },
          { header: "Value at cost", value: (i: ImsItem) => i.stockValue },
        ]
      : []),
    { header: "Selling price", value: (i) => i.sellingPrice },
    { header: "Retail value", value: (i) => retailOf(i) },
    { header: "Idle days", value: (i) => i.idleDays },
    { header: "Aging", value: (i) => agingOf(i.agingBucket).label },
    { header: "Out (30 days)", value: (i) => i.movement30d },
    { header: "Velocity", value: (i) => (tiers.get(i.id) ? VELOCITY_LABEL[tiers.get(i.id) as Velocity] : "—") },
    { header: "Location", value: (i) => i.location },
  ];
  const exportAs = (kind: "csv" | "xlsx") => {
    const name = `ims-stock-valuation-${todayLocal()}`;
    if (kind === "csv") downloadCsv(name, filtered, exportCols);
    else void downloadXlsx(name, "Stock", filtered, exportCols);
  };

  const columns: BosColumn<ImsItem>[] = [
    { key: "item", header: "Item", cell: (i) => <ItemCell item={i} sub={[i.sku, i.brand].filter(Boolean).join(" · ") || undefined} />, width: "24%" },
    ...(grouped ? [] : [{ key: "category", header: "Category", cell: (i: ImsItem) => i.category ?? <span className="ims-faint">—</span> }]),
    {
      key: "stock",
      header: "Stock",
      align: "right",
      cell: (i) => (
        <span className="ims-inv-stock">
          <span className="ims-strong">{qtyText(i.currentStock, i.unit)}</span>
          <StatusBadge view={stockBadge(i.status)} />
        </span>
      ),
    },
    ...(canSeeCost
      ? [
          { key: "cost", header: "Unit cost", align: "right" as const, cell: (i: ImsItem) => inrExact(i.purchasePrice) },
          { key: "value", header: "Value", align: "right" as const, cell: (i: ImsItem) => <span className="ims-strong">{inr(i.stockValue)}</span> },
        ]
      : []),
    { key: "retail", header: "Retail", align: "right", cell: (i) => inr(retailOf(i)) },
    { key: "idle", header: "Idle", align: "right", cell: (i) => <span className={i.idleDays > 90 ? "ims-neg" : undefined}>{i.idleDays} d</span> },
    { key: "aging", header: "Aging", cell: (i) => (i.currentStock > 0 ? <AgingChip bucket={i.agingBucket} days={i.idleDays} /> : <span className="ims-faint">—</span>) },
    {
      key: "moved",
      header: "Out · 30d",
      align: "right",
      cell: (i) => {
        const v = tiers.get(i.id);
        return (
          <span className="ims-inv-stock">
            <span>{qtyText(i.movement30d)}</span>
            {v ? (
              <Badge tone={VELOCITY_TONE[v]} auto>
                {VELOCITY_LABEL[v].toUpperCase()}
              </Badge>
            ) : null}
          </span>
        );
      },
    },
    { key: "last", header: "Last move", cell: (i) => <span className="ims-faint">{i.lastMovementAt ? timeAgo(i.lastMovementAt) : "Never"}</span> },
    {
      key: "actions",
      header: <span className="bos-sr-only">Actions</span>,
      align: "right",
      cell: (i) => (
        <span className="ims-row" style={{ gap: 4, flexWrap: "nowrap", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {can("stockIn") ? (
            <Button size="sm" variant="ghost" onClick={() => navigate("stockin", `item:${i.id}`)} aria-label={`Stock in ${i.name}`}>
              ⬇ In
            </Button>
          ) : null}
          {can("stockOut") ? (
            <Button size="sm" variant="ghost" onClick={() => navigate("stockout", `item:${i.id}`)} disabled={i.currentStock <= 0} aria-label={`Stock out ${i.name}`}>
              ⬆ Out
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const table = (rows: ImsItem[]) => (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(i) => i.id}
      onRowClick={(i) => setDetailId(i.id)}
      caption="Stock valuation"
      empty={
        <span>
          Nothing matches these filters.{" "}
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear filters
          </Button>
        </span>
      }
    />
  );

  return (
    <Stack>
      <PageHeader
        title="Full Stock"
        sub="Every item with quantity, valuation, aging and movement — find dead stock and where your money sits."
        actions={
          <>
            <Button size="sm" variant="ghost" icon="download" onClick={() => exportAs("csv")} disabled={!filtered.length}>
              CSV
            </Button>
            <Button size="sm" variant="ghost" icon="download" onClick={() => exportAs("xlsx")} disabled={!filtered.length}>
              Excel
            </Button>
          </>
        }
      />
      <Loaded state={list} rows={3}>
        {() =>
          all.length === 0 ? (
            <Card interactive={false}>
              <EmptyState
                glyph="▦"
                title="No stock to value yet"
                actions={
                  can("items") ? (
                    <Button variant="primary" icon="plus" onClick={() => navigate("items", "new")}>
                      Add an item
                    </Button>
                  ) : undefined
                }
              >
                Add items with opening stock and they&apos;ll appear here with value and aging.
              </EmptyState>
            </Card>
          ) : (
            <Stack gap={14}>
              <Grid cols={5} min={150}>
                <KpiCard interactive={false} label="Items" value={filtered.length.toLocaleString("en-IN")} delta={filtersOn ? `of ${all.length} in catalogue` : `${stocked.length} with stock`} deltaTone="muted" chip={{ color: "blue", glyph: "📦" }} />
                <KpiCard interactive={false} label="Units on hand" value={qtyText(totals.units)} delta={`${filtered.filter((i) => i.damagedStock > 0).length} with damaged units`} deltaTone="muted" chip={{ color: "sage", glyph: "▦" }} />
                {canSeeCost ? <KpiCard interactive={false} label="Value at cost" value={inrCompact(totals.cost)} delta={inr(totals.cost)} deltaTone="info" chip={{ color: "mint", glyph: "₹" }} /> : null}
                <KpiCard interactive={false} label="Retail value" value={inrCompact(totals.retail)} delta="At selling price" deltaTone="muted" chip={{ color: "lavender", glyph: "🏷" }} />
                {canSeeCost ? (
                  <KpiCard
                    interactive={false}
                    label="Potential margin"
                    value={inrCompact(totals.margin)}
                    valueTone={totals.margin < 0 ? "coral" : "emerald"}
                    delta={totals.retail > 0 ? `${pct((totals.margin / totals.retail) * 100, 1)} of retail` : "—"}
                    deltaTone={totals.margin < 0 ? "down" : "up"}
                    chip={{ color: "amber", glyph: "↗" }}
                  />
                ) : null}
              </Grid>

              <div className="ims-toolbar" style={{ marginBottom: 0 }}>
                <SearchInput wrapperClassName="ims-grow" placeholder="Search item, SKU, brand, location…" aria-label="Search stock" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
                <Select size="sm" aria-label="Category" value={category} onChange={(e) => reset(setCategory)(e.target.value)} style={{ width: "auto" }}>
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Select size="sm" aria-label="Status" value={status} onChange={(e) => reset(setStatus)(e.target.value as "ALL" | StockStatus)} style={{ width: "auto" }}>
                  <option value="ALL">All status</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STOCK_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
                <Select size="sm" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: "auto" }}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <span className="ims-row ims-faint" style={{ gap: 8 }}>
                  <Switch checked={grouped} onChange={setGrouped} aria-label="Group by category" />
                  Group by category
                </span>
              </div>

              <div className="ims-row" role="group" aria-label="Aging">
                <span className="ims-faint">Aging</span>
                <FilterChip active={aging === "ALL"} onClick={() => reset(setAging)("ALL")}>
                  Any
                </FilterChip>
                {AGING_BUCKETS.map((b) => (
                  <FilterChip key={b.key} active={aging === b.key} onClick={() => reset(setAging)(aging === b.key ? "ALL" : b.key)}>
                    <span className="ims-inv-dot" style={{ background: b.color }} />
                    {b.label} <span className="ims-faint">{stocked.filter((i) => i.agingBucket === b.key).length}</span>
                  </FilterChip>
                ))}
              </div>
              <div className="ims-between">
                <div className="ims-row" role="group" aria-label="Sales velocity">
                  <span className="ims-faint">Velocity</span>
                  {(Object.keys(VELOCITY_LABEL) as Velocity[]).map((v) => (
                    <FilterChip key={v} active={velocity === v} onClick={() => reset(setVelocity)(velocity === v ? "ALL" : v)}>
                      {VELOCITY_LABEL[v]} <span className="ims-faint">{all.filter((i) => tiers.get(i.id) === v).length}</span>
                    </FilterChip>
                  ))}
                </div>
                {filtersOn ? (
                  <Button size="sm" variant="ghost" icon="x" onClick={clear}>
                    Clear filters
                  </Button>
                ) : null}
              </div>

              {grouped ? (
                groups.length ? (
                  groups.map((g) => (
                    <WidgetCard key={g.name} title={g.name} dot="lavender" note={`${g.items.length} item${g.items.length === 1 ? "" : "s"} · ${qtyText(g.units)} units${canSeeCost ? ` · ${inr(g.value)}` : ""}`}>
                      {table(g.items)}
                    </WidgetCard>
                  ))
                ) : (
                  table([])
                )
              ) : (
                <>
                  {table(pageRows)}
                  {filtered.length > PAGE_SIZE ? (
                    <Pagination
                      actions={
                        <>
                          <Button size="sm" variant="ghost" icon="chevronLeft" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page" />
                          <span className="ims-faint">
                            {current + 1} / {pageCount}
                          </span>
                          <Button size="sm" variant="ghost" icon="chevronRight" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} aria-label="Next page" />
                        </>
                      }
                    >
                      Showing {current * PAGE_SIZE + 1}–{Math.min(filtered.length, (current + 1) * PAGE_SIZE)} of {filtered.length}
                    </Pagination>
                  ) : null}
                </>
              )}
            </Stack>
          )
        }
      </Loaded>
      <ItemDetailDialog
        itemId={detailId}
        canSeeCost={canSeeCost}
        onClose={() => setDetailId(null)}
        onEdit={(item) => {
          setDetailId(null);
          setEditor({ item, seq: Date.now() });
        }}
      />
      <ItemDialog editor={editor} meta={meta.data} facets={list.data?.facets} onClose={() => setEditor(null)} />
    </Stack>
  );
}

export default FullStockModule;
