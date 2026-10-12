"use client";

import "./insights.css";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, DataTable, Pagination, Select, type BosBadgeTone, type BosColumn } from "@/components/bos";
import type { ReportCatalogEntry, ReportCell, ReportCellKind, ReportChart, ReportFilterKey, ReportFilters, ReportMeta, ReportResult, ReportRow } from "@/lib/ims/reports";
import { dateLabel, dateRange, inr, inrExact, pct, qtyText, type ExportColumn } from "@/lib/ims/format";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useDialog<T>(initial: T) {
  const [s, setS] = useState({ open: false, seq: 0, value: initial });
  return {
    ...s,
    show: (value: T) => setS((p) => ({ open: true, seq: p.seq + 1, value })),
    hide: () => setS((p) => ({ ...p, open: false })),
  };
}

/* ---------- Cells ---------- */

const NUMERIC: ReadonlySet<ReportCellKind> = new Set(["number", "money", "qty", "pct"]);
export const isNumericKind = (k: ReportCellKind) => NUMERIC.has(k);

export function cellText(v: ReportCell | undefined, kind: ReportCellKind, exact = false): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && kind !== "date" && !Number.isFinite(Number(v))) return v;
  switch (kind) {
    case "money":
      return exact ? inrExact(Number(v)) : inr(Number(v));
    case "qty":
      return qtyText(Number(v));
    case "number":
      return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
    case "pct":
      return pct(Number(v), 1);
    case "date":
      return dateLabel(String(v));
    default:
      return String(v);
  }
}

export function statusTone(value: string): BosBadgeTone {
  const s = value.toLowerCase();
  if (/(overdue|out of stock|out_of_stock|rejected|cancel|dead|critical|unavailable|ineligible|no —)/.test(s)) return "coral";
  if (/(unpaid|low|pending|partial|draft|open|due|follow|idle)/.test(s)) return "amber";
  if (/(paid|received|good|done|approved|complete|in stock|ok|active|yes)/.test(s)) return "emerald";
  if (/(sent|issued|progress|over)/.test(s)) return "blue";
  return "neutral";
}

export function renderCell(v: ReportCell | undefined, kind: ReportCellKind): ReactNode {
  if (kind === "status" && v !== null && v !== undefined && v !== "") {
    return (
      <Badge tone={statusTone(String(v))} auto>
        {String(v)}
      </Badge>
    );
  }
  return cellText(v, kind);
}

export function columnTotals(report: ReportResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of report.columns) {
    if (!c.total) continue;
    out[c.key] = Math.round(report.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) * 1000) / 1000;
  }
  return out;
}

export const exportColumns = (report: ReportResult): ExportColumn<ReportRow>[] => report.columns.map((c) => ({ header: c.label, value: (r) => r[c.key] }));

export const periodText = (report: ReportResult) => (report.range ? dateRange(report.range.from, report.range.to) : `As of ${dateLabel(report.asOf)}`);

/* ---------- Chart ---------- */

export const CHART_PALETTE = ["#4C6FF5", "#1FA679", "#D98A1F", "#E1483F", "#7C6CF2", "#2BB6C9", "#A9762B", "#9098B8"];

export function ReportChartView({ chart }: { chart: NonNullable<ReportChart> }) {
  if (!chart.data.length) return <div className="ims-muted">Nothing to chart for this selection.</div>;
  if (chart.kind === "stack") {
    const total = chart.data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
    return (
      <div>
        <div className="ims-stackbar" role="img" aria-label={`${chart.title}: ${chart.data.map((d) => `${d.label} ${cellText(d.value, chart.valueKind)}`).join(", ")}`}>
          {chart.data.map((d, i) => (
            <span key={d.label} style={{ width: `${(Math.max(0, d.value) / total) * 100}%`, background: d.color ?? CHART_PALETTE[i % CHART_PALETTE.length] }} title={`${d.label}: ${cellText(d.value, chart.valueKind)}`} />
          ))}
        </div>
        <div className="ims-legend">
          {chart.data.map((d, i) => (
            <span key={d.label}>
              <i style={{ background: d.color ?? CHART_PALETTE[i % CHART_PALETTE.length] }} />
              {d.label} · {cellText(d.value, chart.valueKind)}
            </span>
          ))}
        </div>
      </div>
    );
  }
  const max = Math.max(1, ...chart.data.map((d) => Math.abs(d.value)));
  return (
    <div className="ims-bars" role="list" aria-label={chart.title}>
      {chart.data.map((d) => (
        <div key={d.label} className="ims-bar-row" role="listitem">
          <span className="ims-rp-bar-label" title={d.label}>
            {d.label}
          </span>
          <div className="ims-bar-track">
            <div className="ims-bar-fill" style={{ width: `${Math.max(2, (Math.abs(d.value) / max) * 100)}%`, background: d.color }} />
          </div>
          <span className="ims-num">{cellText(d.value, chart.valueKind)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Table ---------- */

type TableRow = { id: string; row: ReportRow; total?: boolean };
const PAGE = 100;

export function ReportTable({ report, onRowClick }: { report: ReportResult; onRowClick?: (row: ReportRow) => void }) {
  const [page, setPage] = useState(0);
  const totals = columnTotals(report);
  const hasTotals = Object.keys(totals).length > 0;
  const pages = Math.max(1, Math.ceil(report.rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice: TableRow[] = report.rows.slice(current * PAGE, current * PAGE + PAGE).map((row, i) => ({ id: String(current * PAGE + i), row }));
  if (hasTotals && report.rows.length) slice.push({ id: "__total", row: totals, total: true });
  const columns: BosColumn<TableRow>[] = report.columns.map((c, i) => ({
    key: c.key,
    header: c.label,
    align: isNumericKind(c.kind) ? "right" : undefined,
    mono: c.kind === "date",
    cell: (r) => {
      if (!r.total) return renderCell(r.row[c.key], c.kind);
      if (c.key in totals) return <strong>{cellText(totals[c.key], c.kind)}</strong>;
      return i === 0 ? <strong>Total · {report.rows.length} rows</strong> : "";
    },
  }));
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <DataTable
          columns={columns}
          rows={slice}
          rowKey={(r) => r.id}
          compact
          onRowClick={onRowClick ? (r) => (r.total ? undefined : onRowClick(r.row)) : undefined}
          empty="No rows for this selection — try a wider period or fewer filters."
          caption={report.title}
        />
      </div>
      {pages > 1 ? (
        <Pagination
          actions={
            <>
              <Button size="sm" variant="ghost" icon="chevronLeft" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page" iconOnly />
              <Button size="sm" variant="ghost" icon="chevronRight" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Next page" iconOnly />
            </>
          }
        >
          Rows {current * PAGE + 1}–{Math.min(report.rows.length, (current + 1) * PAGE)} of {report.rows.length.toLocaleString("en-IN")}
        </Pagination>
      ) : null}
    </>
  );
}

/* ---------- Filters ---------- */

const DAY_OPTIONS = [30, 60, 90, 180, 365];

export type FilterControl = { key: ReportFilterKey; label: string; render: (id?: string) => ReactNode };

/** Filter selects for a report type; the caller lays them out (toolbar or form). Search (`q`) is left to the caller. */
export function filterControls(entry: ReportCatalogEntry, meta: ReportMeta | null, filters: ReportFilters, set: (key: ReportFilterKey, value: string) => void, size: "sm" | "md" = "sm"): FilterControl[] {
  const out: FilterControl[] = [];
  const sel = (key: ReportFilterKey, label: string, all: string, options: ReadonlyArray<{ value: string; label: string }>) =>
    out.push({
      key,
      label,
      render: (id) => (
        <Select id={id} size={size} aria-label={id ? undefined : label} value={filters[key] ?? ""} onChange={(e) => set(key, e.target.value)} style={size === "sm" ? { width: 180 } : undefined}>
          {all ? <option value="">{all}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    });
  for (const key of entry.filters) {
    if (key === "category") sel(key, "Category", "All categories", (meta?.categories ?? []).map((c) => ({ value: c, label: c })));
    if (key === "supplierId") sel(key, "Supplier", "All suppliers", (meta?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })));
    if (key === "partyId") sel(key, "Customer", "All customers", (meta?.customers ?? []).map((s) => ({ value: s.id, label: s.name })));
    if (key === "userId") sel(key, "Team member", "Everyone", (meta?.members ?? []).map((m) => ({ value: String(m.userId), label: m.name })));
    if (key === "status" && entry.statusOptions) sel(key, "Status", "Any status", entry.statusOptions);
    if (key === "groupBy") sel(key, "Group by", "", [
      { value: "item", label: "By item" },
      { value: "category", label: "By category" },
    ]);
    if (key === "days") sel(key, "Idle for", "", DAY_OPTIONS.map((d) => ({ value: String(d), label: `Idle > ${d} days` })));
  }
  return out;
}

/** Human-readable filter summary for print headers and email bodies. */
export function filtersText(entry: ReportCatalogEntry, meta: ReportMeta | null, filters: ReportFilters): string[] {
  const out: string[] = [];
  if (filters.category) out.push(`Category: ${filters.category}`);
  if (filters.supplierId) out.push(`Supplier: ${meta?.suppliers.find((s) => s.id === filters.supplierId)?.name ?? "selected"}`);
  if (filters.partyId) out.push(`Customer: ${meta?.customers.find((s) => s.id === filters.partyId)?.name ?? "selected"}`);
  if (filters.userId) out.push(`Member: ${meta?.members.find((m) => String(m.userId) === filters.userId)?.name ?? "selected"}`);
  if (filters.status) out.push(`Status: ${entry.statusOptions?.find((o) => o.value === filters.status)?.label ?? filters.status}`);
  if (filters.groupBy === "category") out.push("Grouped by category");
  if (filters.days && entry.type === "deadstock") out.push(`Idle > ${filters.days} days`);
  if (filters.q) out.push(`Search: “${filters.q}”`);
  return out;
}

/* ---------- Printable sheet ---------- */

const PRINT_ROWS = 1500;

export type PaperBusiness = { name: string; gstin: string | null; address: string | null };

export function ReportPaper({ report, business, filters, preparedBy }: { report: ReportResult; business: PaperBusiness; filters: string[]; preparedBy: string | null }) {
  const totals = columnTotals(report);
  const hasTotals = Object.keys(totals).length > 0;
  const rows = report.rows.slice(0, PRINT_ROWS);
  const align = (k: ReportCellKind) => (isNumericKind(k) ? "right" : "left");
  return (
    <article className="bos-inv-paper ims-rp-paper" aria-label={`${report.title} — print view`} style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <div>
          <div className="bos-inv-paper-brand">{business.name || "Your business"}</div>
          <div className="ims-paper-seller">{[business.address, business.gstin ? `GSTIN ${business.gstin}` : null].filter(Boolean).join("\n")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">{report.title}</div>
          <div className="ims-paper-sub">{periodText(report)}</div>
        </div>
      </div>
      {report.summary.length ? (
        <div className="ims-paper-meta">
          {report.summary.slice(0, 6).map((s) => (
            <div key={s.label}>
              <b>{s.label}</b>
              {typeof s.value === "number" ? cellText(s.value, s.kind, true) : s.value}
            </div>
          ))}
        </div>
      ) : null}
      {filters.length ? (
        <div className="ims-paper-sub" style={{ marginBottom: 10 }}>
          Filters: {filters.join(" · ")}
        </div>
      ) : null}
      <table className="bos-inv-paper-table ims-rp-table">
        <thead>
          <tr>
            {report.columns.map((c) => (
              <th key={c.key} style={{ textAlign: align(c.kind) }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {report.columns.map((c) => (
                  <td key={c.key} style={{ textAlign: align(c.kind), whiteSpace: c.kind === "text" ? "normal" : undefined }}>
                    {cellText(r[c.key], c.kind, true)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={report.columns.length} className="bos-inv-paper-empty">
                No rows for this selection
              </td>
            </tr>
          )}
          {hasTotals && rows.length ? (
            <tr className="ims-rp-total">
              {report.columns.map((c, i) => (
                <td key={c.key} style={{ textAlign: align(c.kind) }}>
                  {c.key in totals ? cellText(totals[c.key], c.kind, true) : i === 0 ? "Total" : ""}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
      {report.rows.length > rows.length ? (
        <div className="ims-paper-sub" style={{ marginTop: 8 }}>
          Showing the first {PRINT_ROWS.toLocaleString("en-IN")} of {report.rows.length.toLocaleString("en-IN")} rows (totals cover all rows). Export to Excel for the full list.
        </div>
      ) : null}
      {report.notes.length ? <div className="bos-inv-notes">{report.notes.join("\n")}</div> : null}
      <div className="ims-paper-sign">
        <div className="ims-paper-sub">Generated {new Date(report.generatedAt).toLocaleString("en-IN")} · Justx IMS</div>
        <div>
          <div className="ims-paper-sign-line" />
          Prepared by {preparedBy ?? "—"}
        </div>
      </div>
    </article>
  );
}
