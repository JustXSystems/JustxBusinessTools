"use client";

import "./purchase.css";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Alert, Badge, Button, DataTable, EmptyState, FilterChip, Grid, KpiCard, Pagination, ProgressBar, SearchInput, Select, type BosColumn } from "@/components/bos";
import type { Period } from "@/lib/ims/api";
import { PERIOD_OPTIONS, dateLabel, downloadCsv, inr, inrCompact, type ExportColumn } from "@/lib/ims/format";
import { PO_STATUS_LABEL, RECEIVABLE_STATUSES, purchase, type PoList, type PoShare, type PoStatus, type PurchaseOrder, type ReorderDraft } from "@/lib/ims/purchase";
import { ErrorBlock, LoadingBlock, Loaded, PageHeader, RequirePerm, Stack, useIms, useImsAction, useImsData } from "../core";
import { lineKey } from "../shared/LineEditor";
import { usePartyOptions } from "../shared/pickers";
import { PoDocument } from "./PoDocument";
import { PoEditor, type PoPrefill } from "./PoEditor";
import { ReceiveDialog } from "./ReceiveDialog";
import { PoStatusBadge, ReasonDialog } from "./ui";

type View = { mode: "list" } | { mode: "edit"; order: PurchaseOrder | null; prefill: PoPrefill | null } | { mode: "doc"; id: string; share: PoShare | null } | { mode: "reorder"; supplierId: string };

type Tab = "all" | "open" | PoStatus;
const TABS: ReadonlyArray<Tab> = ["all", "open", "draft", "pending_approval", "approved", "sent", "partially_received", "received", "rejected", "cancelled"];
const PAGE = 50;

function viewFromIntent(intent: string | null): View {
  if (!intent) return { mode: "list" };
  if (intent === "new") return { mode: "edit", order: null, prefill: null };
  if (intent.startsWith("new:")) return { mode: "edit", order: null, prefill: { supplierId: intent.slice(4) || null, lines: [] } };
  if (intent.startsWith("open:")) return { mode: "doc", id: intent.slice(5), share: null };
  if (intent.startsWith("reorder:")) return { mode: "reorder", supplierId: intent.slice(8) || "none" };
  return { mode: "list" };
}

export function PurchaseModule() {
  const { takeIntent } = useIms();
  const [view, setView] = useState<View>(() => viewFromIntent(takeIntent("purchase")));
  const toList = () => setView({ mode: "list" });
  const open = (id: string, share: PoShare | null = null) => setView({ mode: "doc", id, share });

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view.mode]);

  return (
    <RequirePerm perm={["po", "approvals"]} what="purchase orders">
      {view.mode === "edit" ? (
        <PoEditor
          key={view.order?.id ?? "new"}
          order={view.order}
          prefill={view.prefill}
          onSaved={(o, share) => open(o.id, share)}
          onCancel={() => (view.order ? open(view.order.id) : toList())}
        />
      ) : view.mode === "doc" ? (
        <PoDocument key={view.id} id={view.id} initialShare={view.share} onBack={toList} onEdit={(o) => setView({ mode: "edit", order: o, prefill: null })} onOpen={(id) => open(id)} />
      ) : view.mode === "reorder" ? (
        <ReorderLoader supplierId={view.supplierId} onReady={(prefill) => setView({ mode: "edit", order: null, prefill })} onCancel={toList} />
      ) : (
        <PoList onNew={() => setView({ mode: "edit", order: null, prefill: null })} onOpen={(id) => open(id)} />
      )}
    </RequirePerm>
  );
}

/** Turns a `reorder:<supplierId|none>` intent into a prefilled draft of low-stock lines. */
function ReorderLoader({ supplierId, onReady, onCancel }: { supplierId: string; onReady: (p: PoPrefill) => void; onCancel: () => void }) {
  const state = useImsData(() => purchase.reorderDraft(supplierId), [supplierId]);
  const d = state.data;
  const ready = useEffectEvent((draft: ReorderDraft) =>
    onReady({
      supplierId: draft.supplier?.id ?? null,
      supplierName: draft.supplier?.name,
      lines: draft.lines.map((l) => ({ key: lineKey(), itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct ?? 0, gstRate: l.gstRate })),
      note: `Restock of ${draft.lines.length} low-stock item${draft.lines.length === 1 ? "" : "s"}${draft.supplier ? ` from ${draft.supplier.name}` : ""}.`,
    }),
  );
  useEffect(() => {
    if (d && d.lines.length > 0) ready(d);
  }, [d]);

  return (
    <Stack>
      <PageHeader
        title="Restock purchase order"
        actions={
          <Button size="sm" icon="chevronLeft" onClick={onCancel}>
            All POs
          </Button>
        }
      />
      {state.error ? (
        <ErrorBlock error={state.error} onRetry={state.reload} />
      ) : !d ? (
        <LoadingBlock rows={3} />
      ) : (
        <EmptyState
          icon="check"
          title="Nothing to restock"
          actions={
            <>
              <Button variant="primary" icon="plus" onClick={() => onReady({ supplierId: d.supplier?.id ?? null, supplierName: d.supplier?.name, lines: [] })}>
                Start a blank PO
              </Button>
              <Button onClick={onCancel}>Back to POs</Button>
            </>
          }
        >
          {d.supplier ? `Every item from ${d.supplier.name} is above its minimum stock.` : "Every item without a supplier is above its minimum stock."}
        </EmptyState>
      )}
    </Stack>
  );
}

const CSV: ExportColumn<PurchaseOrder>[] = [
  { header: "PO number", value: (o) => o.poNo },
  { header: "Order date", value: (o) => o.orderDate },
  { header: "Supplier", value: (o) => o.supplierName },
  { header: "Supplier GSTIN", value: (o) => o.supplier.gstin ?? "" },
  { header: "Status", value: (o) => PO_STATUS_LABEL[o.status] },
  { header: "Expected", value: (o) => o.expectedDate ?? "" },
  { header: "Lines", value: (o) => o.lineCount },
  { header: "Taxable", value: (o) => o.taxable },
  { header: "GST", value: (o) => o.taxTotal },
  { header: "Total", value: (o) => o.grandTotal },
  { header: "Received %", value: (o) => o.receivedPct },
  { header: "Raised by", value: (o) => o.createdByName ?? "" },
];

function PoList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const { can } = useIms();
  const { run, busy } = useImsAction();
  const [tab, setTab] = useState<Tab>("all");
  const [supplierId, setSupplierId] = useState("");
  const [period, setPeriod] = useState<Period | "all">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [rejecting, setRejecting] = useState<PurchaseOrder | null>(null);
  const suppliers = usePartyOptions("supplier");

  const status = overdueOnly ? "overdue" : tab === "all" ? undefined : tab;
  const state = useImsData<PoList>(() => purchase.orders({ status, supplierId: supplierId || undefined, period }), [status, supplierId, period]);

  const filtered = useMemo(() => {
    const list = state.data?.orders ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((o) => [o.poNo, o.supplierName, o.supplier.gstin, o.notes, o.createdByName, ...o.lines.map((l) => l.name)].some((v) => v?.toLowerCase().includes(q)));
  }, [state.data, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const resetPage = () => setPage(0);
  const canPo = can("po");
  const canApprove = can("approvals");
  const canReceive = can("stockIn") || canPo;

  const columns: BosColumn<PurchaseOrder>[] = [
    {
      key: "po",
      header: "PO",
      cell: (o) => (
        <span className="ims-cell-stack">
          <span className="ims-strong ims-mono">{o.poNo}</span>
          <small>{dateLabel(o.orderDate)}</small>
        </span>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (o) => (
        <span className="ims-cell-stack">
          <span>{o.supplierName}</span>
          <small>{o.createdByName ? `by ${o.createdByName}` : (o.supplier.gstin ?? "Unregistered")}</small>
        </span>
      ),
    },
    { key: "lines", header: "Lines", align: "right", cell: (o) => o.lineCount },
    {
      key: "expected",
      header: "Expected",
      mono: true,
      cell: (o) =>
        o.expectedDate ? (
          <span className="ims-row" style={{ gap: 6 }}>
            {dateLabel(o.expectedDate)}
            {o.overdue ? (
              <Badge tone="coral" auto>
                LATE
              </Badge>
            ) : null}
          </span>
        ) : (
          "—"
        ),
    },
    { key: "total", header: "Total", align: "right", cell: (o) => <span className="ims-num">{inr(o.grandTotal)}</span> },
    {
      key: "progress",
      header: "Received",
      cell: (o) =>
        o.status === "partially_received" || o.status === "received" ? (
          <div style={{ minWidth: 90 }}>
            <ProgressBar value={o.receivedPct} tone={o.receivedPct >= 100 ? "emerald" : "blue"} label={`${o.receivedPct}% received`} />
          </div>
        ) : (
          <span className="ims-faint">—</span>
        ),
    },
    { key: "status", header: "Status", cell: (o) => <PoStatusBadge status={o.status} /> },
    {
      key: "actions",
      header: <span className="bos-sr-only">Actions</span>,
      align: "right",
      cell: (o) => (
        <span className="ims-row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {o.status === "pending_approval" && canApprove ? (
            <>
              <Button size="sm" variant="success" disabled={Boolean(busy)} onClick={() => run(`approve-${o.id}`, () => purchase.approveOrder(o.id), { success: "Approved", description: o.poNo })}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(o)}>
                Reject
              </Button>
            </>
          ) : RECEIVABLE_STATUSES.has(o.status) && canReceive ? (
            <Button size="sm" icon="box" onClick={() => setReceiving(o)}>
              Receive
            </Button>
          ) : o.status === "draft" && canPo ? (
            <Button size="sm" disabled={Boolean(busy)} onClick={() => run(`submit-${o.id}`, () => purchase.submitOrder(o.id), { success: "Submitted", description: o.poNo })}>
              Submit
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const s = state.data?.summary;
  const tabLabel = (t: Tab): string => {
    if (t === "all") return `All${s ? ` · ${s.total}` : ""}`;
    if (t === "open") return `Open${s ? ` · ${s.counts.approved + s.counts.sent + s.counts.partially_received}` : ""}`;
    return `${PO_STATUS_LABEL[t]}${s ? ` · ${s.counts[t]}` : ""}`;
  };
  const tabs = TABS.filter((t) => t !== "rejected" || (s?.counts.rejected ?? 0) > 0 || tab === "rejected");

  return (
    <Stack>
      <PageHeader
        title="Purchase Orders"
        sub="Raise, approve, send and receive supplier orders — receipts post stock and create the payable bill."
        actions={
          <>
            <Button size="sm" icon="download" disabled={!filtered.length} onClick={() => downloadCsv("purchase-orders", filtered, CSV)}>
              Export
            </Button>
            {canPo ? (
              <Button size="sm" variant="primary" icon="plus" onClick={onNew}>
                New PO
              </Button>
            ) : null}
          </>
        }
      />

      {s ? (
        <Grid cols={4} min={150}>
          <KpiCard label="Open orders" value={inrCompact(s.openValue)} chip={{ color: "blue", glyph: "🛒" }} delta={`${s.counts.approved + s.counts.sent + s.counts.partially_received} awaiting delivery`} deltaTone="muted" />
          <KpiCard label="Awaiting approval" value={s.awaitingApproval} chip={{ color: "amber", glyph: "⏳" }} delta={s.awaitingApproval ? inrCompact(s.awaitingValue) : "Nothing pending"} deltaTone={s.awaitingApproval ? "warn" : "muted"} />
          <KpiCard label="Due this week" value={s.dueThisWeek} chip={{ color: "lavender", glyph: "📦" }} delta={s.overdue ? `${s.overdue} overdue` : "None overdue"} deltaTone={s.overdue ? "down" : "up"} />
          <KpiCard label="Received this month" value={inrCompact(s.receivedThisMonth)} chip={{ color: "mint", glyph: "✓" }} delta={`${s.receivedPosThisMonth} PO${s.receivedPosThisMonth === 1 ? "" : "s"}`} deltaTone="muted" />
        </Grid>
      ) : null}

      <div>
        <div className="ims-tabs-scroll" role="group" aria-label="Purchase order status">
          {tabs.map((t) => (
            <FilterChip
              key={t}
              active={!overdueOnly && tab === t}
              onClick={() => {
                setTab(t);
                setOverdueOnly(false);
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
              placeholder="Search PO number, supplier, item, notes…"
              aria-label="Search purchase orders"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                resetPage();
              }}
            />
          </div>
          <Select
            size="sm"
            aria-label="Filter by supplier"
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              resetPage();
            }}
            style={{ width: "auto", minWidth: 170 }}
          >
            <option value="">All suppliers</option>
            {(suppliers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label="Order date"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as Period | "all");
              resetPage();
            }}
            style={{ width: "auto" }}
          >
            <option value="all">Any date</option>
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <FilterChip
            active={overdueOnly}
            onClick={() => {
              setOverdueOnly((v) => !v);
              resetPage();
            }}
          >
            Overdue{s?.overdue ? ` · ${s.overdue}` : ""}
          </FilterChip>
        </div>
      </div>

      {state.data && state.data.draftPurgeDays > 0 && (tab === "draft" || tab === "all") && (s?.counts.draft ?? 0) > 0 ? (
        <Alert tone="blue" title="Old drafts are cleaned up">
          Drafts untouched for {state.data.draftPurgeDays} days are removed automatically.
        </Alert>
      ) : null}

      <Loaded state={state} rows={4}>
        {(d) =>
          d.summary.total === 0 ? (
            <EmptyState
              icon="file"
              title="No purchase orders yet"
              actions={
                canPo ? (
                  <Button variant="primary" icon="plus" onClick={onNew}>
                    Raise your first PO
                  </Button>
                ) : undefined
              }
            >
              POs above {inr(d.approvalLimit)} go to an approver first; approved POs can be shared on WhatsApp and received into stock.
            </EmptyState>
          ) : (
            <div>
              <DataTable caption="Purchase orders" columns={columns} rows={pageRows} rowKey={(o) => o.id} onRowClick={(o) => onOpen(o.id)} chevron empty="No purchase orders match these filters." />
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

      {receiving ? <ReceiveDialog order={receiving} open onClose={() => setReceiving(null)} /> : null}
      <ReasonDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.poNo}?` : "Reject"}
        description="The requester is notified with your reason."
        confirmLabel="Reject PO"
        destructive
        busy={Boolean(busy)}
        suggestions={["Price too high — renegotiate", "Quantity too large", "Wrong supplier", "Not needed now"]}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          await run(`reject-${rejecting.id}`, () => purchase.rejectOrder(rejecting.id, reason), { success: "Rejected", description: rejecting.poNo, tone: "amber" });
          setRejecting(null);
        }}
      />
    </Stack>
  );
}
