"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, DataTable, EmptyState, FilterChip, Input, SearchInput, Select, type BosColumn } from "@/components/bos";
import {
  buildSavedQuoteListRow,
  countActiveSavedFilters,
  countQuotationsByStatus,
  EMPTY_SAVED_FILTERS,
  exportSavedQuotationsExcel,
  exportSavedQuotationsPdf,
  filterSavedQuotations,
  SAVED_STATUS_OPTIONS,
  uniqueSavedCities,
  uniqueSavedPreparedBy,
  type CompanyProfileV1,
  type FollowUpFilter,
  type QuoteStatus,
  type SavedQuoteFilters,
} from "@/lib/quotation-v1";
import type { ImsQuotation, ImsQuoteConvertTarget } from "@/lib/ims/quotations";
import { useIms } from "../core";

type Props = {
  quotations: ImsQuotation[];
  company: CompanyProfileV1;
  onOpen: (q: ImsQuotation) => void;
  onNew: () => void;
  onDuplicate: (q: ImsQuotation) => void;
  onRevise: (q: ImsQuotation) => void;
  onConvert: (q: ImsQuotation, target: ImsQuoteConvertTarget) => void;
  onDelete: (q: ImsQuotation) => void;
  busyId?: string | null;
};

const STATUS_TONE: Record<string, "neutral" | "blue" | "amber" | "emerald" | "coral"> = {
  draft: "neutral",
  submitted: "blue",
  sent: "amber",
  approved: "emerald",
  rejected: "coral",
  cancelled: "neutral",
};

export function QuoteRegister({
  quotations,
  company,
  onOpen,
  onNew,
  onDuplicate,
  onRevise,
  onConvert,
  onDelete,
  busyId,
}: Props) {
  const { navigate, can } = useIms();
  const [filters, setFilters] = useState<SavedQuoteFilters>(EMPTY_SAVED_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const cities = useMemo(() => uniqueSavedCities(quotations), [quotations]);
  const preparers = useMemo(() => uniqueSavedPreparedBy(quotations), [quotations]);
  const statusCounts = useMemo(() => countQuotationsByStatus(quotations), [quotations]);
  const activeCount = useMemo(() => countActiveSavedFilters(filters), [filters]);

  const filtered = useMemo(
    () => filterSavedQuotations(quotations, company, filters),
    [quotations, company, filters],
  );

  const rows = useMemo(
    () => filtered.map((q) => ({ q, row: buildSavedQuoteListRow(q, company) })),
    [filtered, company],
  );

  const toggleStatus = (st: QuoteStatus) => {
    setFilters((f) => ({
      ...f,
      statuses: f.statuses.includes(st) ? f.statuses.filter((x) => x !== st) : [...f.statuses, st],
    }));
  };

  const canSales = can("sales");
  const canBom = can("bom");

  const columns: BosColumn<{ q: ImsQuotation; row: ReturnType<typeof buildSavedQuoteListRow> }>[] = [
    {
      key: "quoteNo",
      header: "Quotation",
      cell: ({ q, row }) => (
        <span className="ims-cell-stack">
          <button
            type="button"
            className="bos-btn-link ims-strong ims-mono"
            style={{ textAlign: "left", padding: 0, background: "none", border: "none", cursor: "pointer", color: "inherit" }}
            onClick={() => onOpen(q)}
          >
            {row.quoteNo}
          </button>
          <small>
            {row.submittedDate !== "—" ? `Submitted ${row.submittedDate}` : q.date || "—"}
            {row.validTill !== "—" ? ` · Valid ${row.validTill}` : ""}
          </small>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: ({ row }) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{row.companyName}</span>
          <small>{row.companyCity}</small>
        </span>
      ),
    },
    {
      key: "desc",
      header: "Items",
      cell: ({ row }) => <span style={{ fontSize: 12.5 }}>{row.description}</span>,
    },
    {
      key: "value",
      header: "Total",
      align: "right",
      cell: ({ row }) => (
        <span className="ims-cell-stack" style={{ alignItems: "flex-end" }}>
          <span className="ims-num ims-strong">₹{row.grandTotalLabel}</span>
          <small className="ims-num">Basic ₹{row.basicTotalLabel}</small>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status & links",
      cell: ({ q, row }) => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</Badge>
          {q.conversions?.salesOrderId ? (
            <button
              type="button"
              className="bos-badge bos-badge-blue"
              style={{ cursor: "pointer", border: "none" }}
              onClick={() => navigate("salesOrders", `open:${q.conversions!.salesOrderId}`)}
            >
              SO {q.conversions.salesOrderNo ?? ""}
            </button>
          ) : null}
          {q.conversions?.invoiceId ? (
            <button
              type="button"
              className="bos-badge bos-badge-emerald"
              style={{ cursor: "pointer", border: "none" }}
              onClick={() => navigate("sales", `open:${q.conversions!.invoiceId}`)}
            >
              INV {q.conversions.invoiceNo ?? ""}
            </button>
          ) : null}
          {q.conversions?.bomId ? (
            <button
              type="button"
              className="bos-badge bos-badge-amber"
              style={{ cursor: "pointer", border: "none" }}
              onClick={() => navigate("bom", q.conversions!.bomId!)}
            >
              BOM {q.conversions.bomDocNo ?? ""}
            </button>
          ) : null}
        </div>
      ),
    },
    {
      key: "followup",
      header: "Follow-up",
      cell: ({ row }) => (
        <span className="ims-cell-stack">
          <span>{row.followUpDate}</span>
          <small>{row.preparedBy}</small>
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: ({ q }) => {
        const busy = busyId === q.id;
        return (
          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onOpen(q)}>
              Open
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRevise(q)} title="Create revision (R2/R3)">
              Revise
            </Button>
            {canSales ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onConvert(q, "sales_order")} title="Convert to Sales Order">
                → SO
              </Button>
            ) : null}
            {canSales ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onConvert(q, "invoice")} title="Convert to Draft Tax Invoice">
                → Inv
              </Button>
            ) : null}
            {canBom ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onConvert(q, "bom")} title="Convert to Customer BOM">
                → BOM
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDuplicate(q)}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDelete(q)}>
              Delete
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Card interactive={false}>
      <div style={{ display: "grid", gap: 12 }}>
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <FilterChip active={filters.statuses.length === 0} onClick={() => setFilters((f) => ({ ...f, statuses: [] }))}>
              All ({quotations.length})
            </FilterChip>
            {SAVED_STATUS_OPTIONS.map((st) => (
              <FilterChip key={st} active={filters.statuses.includes(st)} onClick={() => toggleStatus(st)}>
                {st} ({statusCounts[st] ?? 0})
              </FilterChip>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!filtered.length}
              onClick={() => void exportSavedQuotationsExcel(filtered, company)}
            >
              Export Excel
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!filtered.length}
              onClick={() => void exportSavedQuotationsPdf(filtered, company)}
            >
              Export PDF
            </Button>
            <Button size="sm" variant="primary" onClick={onNew}>
              + New Quotation
            </Button>
          </div>
        </div>

        <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
          <div style={{ flex: "1 1 260px", maxWidth: 420 }}>
            <SearchInput
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Search quote no, customer, city, items, prepared by…"
            />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Button size="sm" variant="ghost" onClick={() => setShowAdvanced((s) => !s)}>
              {showAdvanced ? "Hide filters" : `More filters${activeCount ? ` (${activeCount})` : ""}`}
            </Button>
            {activeCount > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_SAVED_FILTERS)}>
                Reset
              </Button>
            ) : null}
          </div>
        </div>

        {showAdvanced ? (
          <div className="ims-q-filters">
            <Select aria-label="City" value={filters.city} onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}>
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select aria-label="Prepared by" value={filters.preparedBy} onChange={(e) => setFilters((f) => ({ ...f, preparedBy: e.target.value }))}>
              <option value="">All preparers</option>
              {preparers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Follow-up filter"
              value={filters.followUp}
              onChange={(e) => setFilters((f) => ({ ...f, followUp: e.target.value as FollowUpFilter }))}
            >
              <option value="all">Follow-up: Any</option>
              <option value="overdue">Follow-up: Overdue</option>
              <option value="upcoming">Follow-up: Upcoming</option>
              <option value="set">Follow-up: Scheduled</option>
              <option value="none">Follow-up: None</option>
            </Select>
            <Input
              type="date"
              aria-label="Submitted from"
              value={filters.submittedFrom}
              onChange={(e) => setFilters((f) => ({ ...f, submittedFrom: e.target.value }))}
              title="Submitted from"
            />
            <Input
              type="date"
              aria-label="Submitted to"
              value={filters.submittedTo}
              onChange={(e) => setFilters((f) => ({ ...f, submittedTo: e.target.value }))}
              title="Submitted to"
            />
            <Input
              type="number"
              placeholder="Min ₹ value"
              value={filters.valueMin}
              onChange={(e) => setFilters((f) => ({ ...f, valueMin: e.target.value }))}
            />
            <Input
              type="number"
              placeholder="Max ₹ value"
              value={filters.valueMax}
              onChange={(e) => setFilters((f) => ({ ...f, valueMax: e.target.value }))}
            />
          </div>
        ) : null}

        {rows.length ? (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.q.id}
            empty={<EmptyState glyph="📑" title="No quotations match" />}
          />
        ) : (
          <EmptyState glyph="📑" title={quotations.length ? "No quotations match your filters" : "No quotations yet"}>
            {quotations.length ? "Try clearing one or more filters above." : "Create your first quotation to start tracking offers and conversions."}
          </EmptyState>
        )}
      </div>
    </Card>
  );
}
