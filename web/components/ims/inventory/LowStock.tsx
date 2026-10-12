"use client";

import "./inventory-a.css";

import { useState } from "react";
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, Grid, Input, KpiCard, ProgressBar, SearchInput, WidgetCard, type BosColumn } from "@/components/bos";
import { ims, type ImsItem, type LowStockGroup } from "@/lib/ims/api";
import { downloadCsv, inr, inrCompact, num, qtyText, stockBadge, todayLocal, type ExportColumn } from "@/lib/ims/format";
import { Loaded, PageHeader, Stack, StatusBadge, SubTabs, useIms, useImsData } from "../core";
import { AgingChip, ItemCell, ItemDetailDialog, useInventoryMeta } from "./ItemDetail";

type Tab = "supplier" | "items" | "dead";

/** Read by Purchase Orders when it handles the `reorder:<supplierId|none>` intent (optional — it can re-derive from /low-stock). */
export const REORDER_SELECTION_KEY = "ims.reorder.selection";
export type ReorderSelection = { supplierId: string | null; lines: Array<{ itemId: string; qty: number }>; at: string };

const DEAD_DAYS = 90;

export function LowStockModule() {
  const { session, can, navigate, takeIntent } = useIms();
  const [highlight] = useState(() => {
    const i = takeIntent("lowstock");
    return i?.startsWith("open:") ? i.slice(5) : null;
  });
  const [tab, setTab] = useState<Tab>("supplier");
  const low = useImsData(() => ims.lowStock(), []);
  const dead = useImsData(() => (tab === "dead" ? ims.items() : Promise.resolve(null)), [tab]);
  const meta = useInventoryMeta();
  const canSeeCost = meta.data?.canSeeCost ?? true;

  const [q, setQ] = useState("");
  const [unselected, setUnselected] = useState<Set<string>>(() => new Set());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [detailId, setDetailId] = useState<string | null>(null);

  const qtyOf = (i: ImsItem) => {
    const raw = qty[i.id];
    return raw === undefined ? i.suggestedReorder : Math.max(0, num(raw));
  };
  const isSelected = (id: string) => !unselected.has(id);
  const toggle = (id: string) =>
    setUnselected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setGroup = (g: LowStockGroup, on: boolean) =>
    setUnselected((s) => {
      const next = new Set(s);
      for (const i of g.items) {
        if (on) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });

  const matches = (i: ImsItem) => {
    const t = q.trim().toLowerCase();
    return !t || [i.name, i.sku, i.brand, i.category, i.supplierName].some((v) => v && v.toLowerCase().includes(t));
  };

  const createPo = (g: LowStockGroup) => {
    const lines = g.items.filter((i) => isSelected(i.id) && qtyOf(i) > 0).map((i) => ({ itemId: i.id, qty: qtyOf(i) }));
    const selection: ReorderSelection = { supplierId: g.supplierId, lines, at: new Date().toISOString() };
    try {
      sessionStorage.setItem(REORDER_SELECTION_KEY, JSON.stringify(selection));
    } catch {
      /* storage unavailable; Purchase falls back to the full suggestion */
    }
    navigate("purchase", `reorder:${g.supplierId ?? "none"}`);
  };

  const share = (g: LowStockGroup) => {
    const lines = g.items.filter((i) => isSelected(i.id) && qtyOf(i) > 0);
    const business = session.settings.businessName || session.brand?.name || "";
    const text = [`Restock order${business ? ` — ${business}` : ""}`, g.supplierId ? `For: ${g.supplierName}` : "", "", ...lines.map((i) => `• ${i.name}${i.sku ? ` (${i.sku})` : ""} — ${qtyText(qtyOf(i), i.unit)}`)]
      .filter((l, idx) => l || idx === 2)
      .join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const exportCols: ReadonlyArray<ExportColumn<ImsItem>> = [
    { header: "Supplier", value: (i) => i.supplierName ?? "No preferred supplier" },
    { header: "Item", value: (i) => i.name },
    { header: "SKU", value: (i) => i.sku },
    { header: "Category", value: (i) => i.category },
    { header: "Current stock", value: (i) => i.currentStock },
    { header: "Minimum", value: (i) => i.minStock },
    { header: "Maximum", value: (i) => i.maxStock },
    { header: "Order qty", value: (i) => qtyOf(i) },
    { header: "Unit", value: (i) => i.unit },
    ...(canSeeCost
      ? [
          { header: "Unit cost", value: (i: ImsItem) => i.purchasePrice },
          { header: "Order value", value: (i: ImsItem) => qtyOf(i) * i.purchasePrice },
        ]
      : []),
  ];

  const rowActions = (i: ImsItem) => (
    <span className="ims-row" style={{ gap: 4, flexWrap: "nowrap", justifyContent: "flex-end" }}>
      {can("stockIn") ? (
        <Button size="sm" variant="success" onClick={() => navigate("stockin", `item:${i.id}`)} aria-label={`Stock in ${i.name}`}>
          ⬇ Stock in
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setDetailId(i.id)} aria-label={`View ${i.name}`}>
        View
      </Button>
    </span>
  );

  const allCols: BosColumn<ImsItem>[] = [
    { key: "item", header: "Item", cell: (i) => <ItemCell item={i} /> },
    { key: "supplier", header: "Supplier", cell: (i) => i.supplierName ?? <span className="ims-faint">None</span> },
    { key: "stock", header: "Stock / min", align: "right", cell: (i) => `${qtyText(i.currentStock)} / ${qtyText(i.minStock, i.unit)}` },
    { key: "status", header: "Status", cell: (i) => <StatusBadge view={stockBadge(i.status)} /> },
    { key: "order", header: "Suggested", align: "right", cell: (i) => <span className="ims-strong">{qtyText(i.suggestedReorder, i.unit)}</span> },
    ...(canSeeCost ? [{ key: "value", header: "Value", align: "right" as const, cell: (i: ImsItem) => inr(i.suggestedReorder * i.purchasePrice) }] : []),
    { key: "actions", header: <span className="bos-sr-only">Actions</span>, align: "right", cell: rowActions },
  ];

  const deadCols: BosColumn<ImsItem>[] = [
    { key: "item", header: "Item", cell: (i) => <ItemCell item={i} sub={[i.brand, i.category].filter(Boolean).join(" · ") || undefined} /> },
    { key: "stock", header: "Stock", align: "right", cell: (i) => qtyText(i.currentStock, i.unit) },
    ...(canSeeCost ? [{ key: "value", header: "Tied up", align: "right" as const, cell: (i: ImsItem) => <span className="ims-strong">{inr(i.stockValue)}</span> }] : []),
    { key: "idle", header: "Idle", align: "right", cell: (i) => <span className="ims-neg ims-strong">{i.idleDays >= 60 ? `${Math.floor(i.idleDays / 30)} months` : `${i.idleDays} days`}</span> },
    { key: "aging", header: "Aging", cell: (i) => <AgingChip bucket={i.agingBucket} days={i.idleDays} /> },
    {
      key: "actions",
      header: <span className="bos-sr-only">Actions</span>,
      align: "right",
      cell: (i) => (
        <span className="ims-row" style={{ gap: 4, flexWrap: "nowrap", justifyContent: "flex-end" }}>
          {can("stockOut") ? (
            <Button size="sm" variant="ghost" onClick={() => navigate("stockout", `item:${i.id}`)}>
              ⬆ Sell / issue
            </Button>
          ) : null}
          {can("damage") ? (
            <Button size="sm" variant="ghost" onClick={() => navigate("returns", `item:${i.id}`)}>
              ↪ Return
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setDetailId(i.id)}>
            View
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Restock List"
        sub="Items at or below their minimum, grouped by preferred supplier with suggested order quantities."
        actions={
          low.data?.items.length ? (
            <Button size="sm" variant="ghost" icon="download" onClick={() => downloadCsv(`ims-restock-${todayLocal()}`, low.data?.items ?? [], exportCols)}>
              Export CSV
            </Button>
          ) : undefined
        }
      />
      <SubTabs
        label="Restock views"
        value={tab}
        onChange={setTab}
        options={[
          { value: "supplier", label: `By supplier${low.data ? ` (${low.data.bySupplier.length})` : ""}` },
          { value: "items", label: `All low items${low.data ? ` (${low.data.items.length})` : ""}` },
          { value: "dead", label: "Dead stock" },
        ]}
      />

      {tab === "dead" ? (
        <Loaded state={dead}>
          {(data) => {
            const rows = (data?.items ?? []).filter((i) => i.currentStock > 0 && i.idleDays >= DEAD_DAYS && matches(i)).sort((a, b) => b.idleDays - a.idleDays);
            return (
              <Stack gap={14}>
                <div className="ims-between">
                  <p className="ims-muted" style={{ margin: 0 }}>
                    In-stock items with no movement for {DEAD_DAYS}+ days{canSeeCost && rows.length ? ` — ${inr(rows.reduce((s, i) => s + i.stockValue, 0))} tied up` : ""}.
                  </p>
                  <SearchInput placeholder="Filter…" aria-label="Filter dead stock" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                {rows.length ? (
                  <DataTable columns={deadCols} rows={rows} rowKey={(i) => i.id} caption="Dead stock" />
                ) : (
                  <Card interactive={false}>
                    <EmptyState glyph="✓" title="No dead stock">
                      Everything in stock has moved in the last {DEAD_DAYS} days.
                    </EmptyState>
                  </Card>
                )}
              </Stack>
            );
          }}
        </Loaded>
      ) : (
        <Loaded state={low}>
          {(data) => {
            if (!data.items.length) {
              return (
                <Card interactive={false}>
                  <EmptyState
                    glyph="✓"
                    title="All stocked up"
                    actions={
                      <Button size="sm" onClick={() => navigate("stock")}>
                        View full stock
                      </Button>
                    }
                  >
                    Every item is above its minimum level. Set minimum stock on items to get reorder suggestions here.
                  </EmptyState>
                </Card>
              );
            }
            const out = data.items.filter((i) => i.status === "OUT_OF_STOCK").length;
            const reorderValue = data.items.filter((i) => isSelected(i.id)).reduce((s, i) => s + qtyOf(i) * i.purchasePrice, 0);
            return (
              <Stack gap={14}>
                <Grid cols={4} min={150}>
                  <KpiCard interactive={false} label="Items to restock" value={data.items.length} chip={{ color: "amber", glyph: "⚠" }} delta={`${data.items.length - out} low`} deltaTone="warn" />
                  <KpiCard interactive={false} label="Out of stock" value={out} valueTone={out ? "coral" : undefined} chip={{ color: "rose", glyph: "✕" }} delta={out ? "Losing sales now" : "None at zero"} deltaTone={out ? "down" : "up"} />
                  <KpiCard interactive={false} label="Suppliers" value={data.bySupplier.filter((g) => g.supplierId).length} chip={{ color: "blue", glyph: "🚚" }} delta={data.bySupplier.some((g) => !g.supplierId) ? "Some items have no supplier" : "All items mapped"} deltaTone={data.bySupplier.some((g) => !g.supplierId) ? "warn" : "muted"} />
                  {canSeeCost ? <KpiCard interactive={false} label="Selected order value" value={inrCompact(reorderValue)} chip={{ color: "mint", glyph: "₹" }} delta={inr(reorderValue)} deltaTone="info" /> : null}
                </Grid>

                <SearchInput placeholder="Filter by item, SKU, brand or supplier…" aria-label="Filter restock list" value={q} onChange={(e) => setQ(e.target.value)} />

                {tab === "items" ? (
                  <DataTable columns={allCols} rows={data.items.filter(matches)} rowKey={(i) => i.id} caption="Low stock items" empty="No items match." />
                ) : (
                  data.bySupplier
                    .map((g) => ({ g, items: g.items.filter(matches) }))
                    .filter(({ items }) => items.length)
                    .map(({ g, items }) => {
                      const chosen = g.items.filter((i) => isSelected(i.id));
                      const value = chosen.reduce((s, i) => s + qtyOf(i) * i.purchasePrice, 0);
                      const allOn = chosen.length === g.items.length;
                      return (
                        <WidgetCard
                          key={g.supplierId ?? "none"}
                          title={g.supplierName}
                          dot={g.supplierId ? "blue" : "rose"}
                          note={`${g.items.length} item${g.items.length === 1 ? "" : "s"}${canSeeCost ? ` · ${inr(value)} selected` : ""}`}
                        >
                          <div className="ims-between" style={{ marginBottom: 8 }}>
                            <span className="ims-row ims-faint" style={{ gap: 8 }}>
                              <Checkbox checked={allOn} indeterminate={chosen.length > 0 && !allOn} onChange={() => setGroup(g, !allOn)} aria-label={`Select all items from ${g.supplierName}`} />
                              {chosen.length} of {g.items.length} selected
                              {!g.supplierId ? (
                                <Badge tone="amber" auto>
                                  SET A SUPPLIER ON THESE ITEMS
                                </Badge>
                              ) : null}
                            </span>
                            <span className="ims-row" style={{ gap: 6 }}>
                              <Button size="sm" variant="ghost" onClick={() => share(g)} disabled={!chosen.length}>
                                ✆ Share list
                              </Button>
                              {can("po") ? (
                                <Button size="sm" variant="primary" icon="plus" onClick={() => createPo(g)} disabled={!chosen.length}>
                                  {g.supplierId ? "Create PO" : "Create PO (pick supplier)"}
                                </Button>
                              ) : null}
                            </span>
                          </div>
                          <div className="ims-inv-rs ims-inv-rs-head" aria-hidden="true">
                            <span />
                            <span>Item</span>
                            <span>Stock vs minimum</span>
                            <span style={{ textAlign: "right" }}>Order qty</span>
                            <span style={{ textAlign: "right" }}>{canSeeCost ? "Value" : ""}</span>
                            <span />
                          </div>
                          {items.map((i) => {
                            const fill = i.minStock > 0 ? (Math.max(0, i.currentStock) / i.minStock) * 100 : 0;
                            return (
                              <div key={i.id} id={`restock-${i.id}`} className={`ims-inv-rs${highlight === i.id ? " ims-inv-hl" : ""}`} ref={highlight === i.id ? (el) => el?.scrollIntoView({ block: "center", behavior: "smooth" }) : undefined}>
                                <Checkbox checked={isSelected(i.id)} onChange={() => toggle(i.id)} aria-label={`Include ${i.name}`} />
                                <ItemCell item={i} />
                                <span className="ims-cell-stack" style={{ gap: 4 }}>
                                  <span className="ims-row" style={{ gap: 6 }}>
                                    <span className="ims-strong">{qtyText(i.currentStock)}</span>
                                    <span className="ims-faint">/ {qtyText(i.minStock, i.unit)}</span>
                                    <StatusBadge view={stockBadge(i.status)} auto />
                                  </span>
                                  <ProgressBar value={fill} tone={i.status === "OUT_OF_STOCK" ? "coral" : "amber"} label={`${i.name} at ${Math.round(fill)}% of minimum`} />
                                </span>
                                <Input
                                  size="sm"
                                  className="ims-inv-qty"
                                  inputMode="decimal"
                                  aria-label={`Order quantity for ${i.name}`}
                                  value={qty[i.id] ?? String(i.suggestedReorder)}
                                  onChange={(e) => setQty((m) => ({ ...m, [i.id]: e.target.value }))}
                                />
                                <span className="ims-num">{canSeeCost ? inr(qtyOf(i) * i.purchasePrice) : ""}</span>
                                {rowActions(i)}
                              </div>
                            );
                          })}
                        </WidgetCard>
                      );
                    })
                )}
              </Stack>
            );
          }}
        </Loaded>
      )}
      <ItemDetailDialog itemId={detailId} canSeeCost={canSeeCost} onClose={() => setDetailId(null)} />
    </Stack>
  );
}
