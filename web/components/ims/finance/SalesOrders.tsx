"use client";

import "../purchase/purchase.css";
import { useEffect, useMemo, useState } from "react";
import { Button, DataTable, EmptyState, FilterChip, Grid, KpiCard, Pagination, ProgressBar, SearchInput, Select, type BosColumn } from "@/components/bos";
import { dateLabel, downloadCsv, inr, inrCompact, type ExportColumn } from "@/lib/ims/format";
import { SO_STATUS_LABEL, salesOrders, soBadge, type SalesOrder, type SalesOrderRow, type SoList, type SoStatus, type SoWizardStep } from "@/lib/ims/sales-orders";
import { PageHeader, RequirePerm, Stack, StatusBadge, useIms, useImsData, Loaded } from "../core";
import { usePartyOptions } from "../shared/pickers";
import { SoDocument } from "./SoDocument";
import { SoEditor } from "./SoEditor";

type View = { mode: "list" } | { mode: "edit"; order: SalesOrder | null } | { mode: "doc"; id: string; step: SoWizardStep | null };

type Tab = "all" | "open" | SoStatus;
const TABS: ReadonlyArray<Tab> = ["all", "open", "draft", "confirmed", "partial", "fulfilled", "cancelled"];
const PAGE = 50;

/** Deep intents: `new`, `open:<id>`, `to-dc:<id>` (delivery step), `to-invoice:<id>` (invoice step). */
export function viewFromIntent(intent: string | null): View {
  if (!intent) return { mode: "list" };
  if (intent === "new") return { mode: "edit", order: null };
  if (intent.startsWith("open:")) return { mode: "doc", id: intent.slice(5), step: null };
  if (intent.startsWith("to-dc:")) return { mode: "doc", id: intent.slice(6), step: "delivery" };
  if (intent.startsWith("to-invoice:")) return { mode: "doc", id: intent.slice(11), step: "invoice" };
  return { mode: "list" };
}

export function SalesOrdersModule() {
  const { takeIntent } = useIms();
  const [view, setView] = useState<View>(() => viewFromIntent(takeIntent("salesOrders")));
  const toList = () => setView({ mode: "list" });
  const open = (id: string, step: SoWizardStep | null = null) => setView({ mode: "doc", id, step });

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view.mode]);

  return (
    <RequirePerm perm={["sales", "receivables"]} what="sales orders">
      {view.mode === "edit" ? (
        <SoEditor key={view.order?.id ?? "new"} order={view.order} onSaved={(d) => open(d.order.id)} onCancel={() => (view.order ? open(view.order.id) : toList())} />
      ) : view.mode === "doc" ? (
        <SoDocument key={`${view.id}:${view.step ?? ""}`} id={view.id} initialStep={view.step} onBack={toList} onEdit={(o) => setView({ mode: "edit", order: o })} />
      ) : (
        <SoListView onNew={() => setView({ mode: "edit", order: null })} onOpen={(id, step) => open(id, step ?? null)} />
      )}
    </RequirePerm>
  );
}

const CSV: ExportColumn<SalesOrderRow>[] = [
  { header: "SO number", value: (o) => o.soNo },
  { header: "Order date", value: (o) => o.orderDate },
  { header: "Customer", value: (o) => o.customerName },
  { header: "Customer PO", value: (o) => o.customerPoRef ?? "" },
  { header: "Status", value: (o) => SO_STATUS_LABEL[o.status] },
  { header: "Delivery by", value: (o) => o.deliveryDate ?? "" },
  { header: "Lines", value: (o) => o.lineCount },
  { header: "Taxable", value: (o) => o.taxable },
  { header: "GST", value: (o) => o.taxTotal },
  { header: "Total", value: (o) => o.grandTotal },
  { header: "Fulfilled %", value: (o) => o.deliveredPct },
];

function SoListView({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string, step?: SoWizardStep) => void }) {
  const { can } = useIms();
  const [tab, setTab] = useState<Tab>("all");
  const [customerId, setCustomerId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const customers = usePartyOptions("customer");
  const canSales = can("sales");

  const status = tab === "all" ? undefined : tab;
  const state = useImsData<SoList>(() => salesOrders.list({ status, customerId: customerId || undefined }), [status, customerId]);

  const filtered = useMemo(() => {
    const list = state.data?.orders ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((o) => [o.soNo, o.customerName, o.customerPoRef, o.notes, ...o.lines.map((l) => l.name)].some((v) => v?.toLowerCase().includes(q)));
  }, [state.data, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const resetPage = () => setPage(0);

  const columns: BosColumn<SalesOrderRow>[] = [
    {
      key: "so",
      header: "Order",
      cell: (o) => (
        <span className="ims-cell-stack">
          <span className="ims-strong ims-mono">{o.soNo}</span>
          <small>{dateLabel(o.orderDate)}</small>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (o) => (
        <span className="ims-cell-stack">
          <span>{o.customerName}</span>
          <small>{o.customerPoRef ? `PO ${o.customerPoRef}` : (o.customerGstin ?? "Unregistered")}</small>
        </span>
      ),
    },
    { key: "lines", header: "Lines", align: "right", cell: (o) => o.lineCount },
    { key: "delivery", header: "Delivery by", mono: true, cell: (o) => (o.deliveryDate ? dateLabel(o.deliveryDate) : "—") },
    { key: "total", header: "Total", align: "right", cell: (o) => <span className="ims-num">{inr(o.grandTotal)}</span> },
    {
      key: "progress",
      header: "Fulfilled",
      cell: (o) =>
        o.status === "partial" || o.status === "fulfilled" ? (
          <div style={{ minWidth: 90 }}>
            <ProgressBar value={o.deliveredPct} tone={o.deliveredPct >= 100 ? "emerald" : "blue"} label={`${o.deliveredPct}% fulfilled`} />
          </div>
        ) : (
          <span className="ims-faint">—</span>
        ),
    },
    { key: "status", header: "Status", cell: (o) => <StatusBadge view={soBadge(o.status)} /> },
    {
      key: "actions",
      header: <span className="bos-sr-only">Actions</span>,
      align: "right",
      cell: (o) => (
        <span className="ims-row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {canSales && (o.status === "confirmed" || o.status === "partial") ? (
            <Button size="sm" icon="box" onClick={() => onOpen(o.id, "delivery")}>
              Deliver
            </Button>
          ) : null}
          {canSales && (o.status === "partial" || o.status === "fulfilled") ? (
            <Button size="sm" icon="file" onClick={() => onOpen(o.id, "invoice")}>
              Invoice
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const s = state.data?.summary;
  const tabLabel = (t: Tab): string => {
    if (t === "all") return `All${s ? ` · ${s.total}` : ""}`;
    if (t === "open") return `Open${s ? ` · ${s.counts.confirmed + s.counts.partial}` : ""}`;
    return `${SO_STATUS_LABEL[t]}${s ? ` · ${s.counts[t]}` : ""}`;
  };

  return (
    <Stack>
      <PageHeader
        title="Sales Orders"
        sub="Take customer orders, ship them on delivery challans and bill them — stock goes out on challan approval."
        actions={
          <>
            <Button size="sm" icon="download" disabled={!filtered.length} onClick={() => downloadCsv("sales-orders", filtered, CSV)}>
              Export
            </Button>
            {canSales ? (
              <Button size="sm" variant="primary" icon="plus" onClick={onNew}>
                New order
              </Button>
            ) : null}
          </>
        }
      />

      {s ? (
        <Grid cols={4} min={150}>
          <KpiCard label="Open orders" value={inrCompact(s.openValue)} chip={{ color: "blue", glyph: "📝" }} delta={`${s.counts.confirmed + s.counts.partial} to deliver`} deltaTone="muted" />
          <KpiCard label="Drafts" value={s.counts.draft} chip={{ color: "amber", glyph: "✎" }} delta={s.counts.draft ? "Confirm to start fulfilment" : "No drafts"} deltaTone="muted" />
          <KpiCard label="Partially delivered" value={s.counts.partial} chip={{ color: "lavender", glyph: "📦" }} delta="Some units still pending" deltaTone="muted" />
          <KpiCard label="Fulfilled" value={s.counts.fulfilled} chip={{ color: "mint", glyph: "✓" }} delta={`${s.counts.cancelled} cancelled`} deltaTone="muted" />
        </Grid>
      ) : null}

      <div>
        <div className="ims-tabs-scroll" role="group" aria-label="Sales order status">
          {TABS.map((t) => (
            <FilterChip
              key={t}
              active={tab === t}
              onClick={() => {
                setTab(t);
                resetPage();
              }}
            >
              {tabLabel(t)}
            </FilterChip>
          ))}
        </div>
        <div className="ims-toolbar" style={{ marginTop: 10 }}>
          <div className="ims-grow">
            <SearchInput
              placeholder="Search order number, customer, PO ref, item…"
              aria-label="Search sales orders"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                resetPage();
              }}
            />
          </div>
          <Select
            size="sm"
            aria-label="Filter by customer"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              resetPage();
            }}
            style={{ width: "auto", minWidth: 170 }}
          >
            <option value="">All customers</option>
            {(customers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Loaded state={state} rows={4}>
        {(d) =>
          d.summary.total === 0 ? (
            <EmptyState
              icon="file"
              title="No sales orders yet"
              actions={
                canSales ? (
                  <Button variant="primary" icon="plus" onClick={onNew}>
                    Create your first order
                  </Button>
                ) : undefined
              }
            >
              Confirm an order, then create delivery challans (stock out on approve) and invoice the delivered quantities.
            </EmptyState>
          ) : (
            <div>
              <DataTable caption="Sales orders" columns={columns} rows={pageRows} rowKey={(o) => o.id} onRowClick={(o) => onOpen(o.id)} chevron empty="No sales orders match these filters." />
              <Pagination
                actions={
                  pages > 1 ? (
                    <>
                      <Button size="sm" icon="chevronLeft" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
                      <span className="ims-faint">
                        Page {page + 1} of {pages}
                      </span>
                      <Button size="sm" icon="chevronRight" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
                    </>
                  ) : undefined
                }
              >
                Showing {pageRows.length} of {filtered.length} · {inr(filtered.reduce((t, o) => t + o.grandTotal, 0))}
              </Pagination>
            </div>
          )
        }
      </Loaded>
    </Stack>
  );
}

export default SalesOrdersModule;
