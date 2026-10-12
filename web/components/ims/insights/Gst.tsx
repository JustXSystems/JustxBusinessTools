"use client";

import "./insights.css";
import { useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, DataTable, EmptyState, FilterChip, Grid, Input, KpiCard, ProgressBar, Segmented, type BosColumn } from "@/components/bos";
import { Loaded, PageHeader, PeriodPicker, RequirePerm, Stack, SubTabs, useIms, useImsData, usePrint } from "../core";
import type { Period } from "@/lib/ims/api";
import {
  gst,
  type B2bRow,
  type B2clRow,
  type B2csRow,
  type CreditNoteRow,
  type GstHsn,
  type GstItemIssue,
  type GstItemsCheck,
  type GstSummary,
  type HsnRow,
  type InwardRow,
  type ProvisionalRow,
  type RateRow,
} from "@/lib/ims/reports";
import { addDaysISO, dateLabel, dateRange, downloadCsv, downloadXlsx, inr, inrExact, qtyText, type ExportColumn } from "@/lib/ims/format";
import { CHART_PALETTE } from "./report-view";

type Tab = "gstr1" | "gstr3b" | "hsn" | "rates" | "items";
type Gstr1Section = "b2b" | "b2cl" | "b2cs" | "cdn" | "docs";

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "gstr1", label: "GSTR-1 (outward)" },
  { value: "gstr3b", label: "GSTR-3B (summary)" },
  { value: "hsn", label: "HSN summary" },
  { value: "rates", label: "Rate-wise" },
  { value: "items", label: "Item HSN check" },
];

/* ---------- Generic GST tables (GSTN-style column names) ---------- */

type Kind = "text" | "money" | "pct" | "date" | "qty";
type GstCol<T> = { key: Extract<keyof T, string>; header: string; kind?: Kind; total?: boolean };

const NUMERIC_KINDS: ReadonlySet<Kind> = new Set(["money", "pct", "qty"]);

function fmt(v: unknown, kind: Kind = "text", exact = false): string {
  if (v === null || v === undefined || v === "") return "—";
  if (kind === "money") return exact ? inrExact(Number(v)) : inr(Number(v));
  if (kind === "pct") return `${Number(v)}%`;
  if (kind === "qty") return qtyText(Number(v));
  if (kind === "date") return dateLabel(String(v));
  return String(v);
}

const valueOf = <T,>(row: T, key: string): unknown => (row as Record<string, unknown>)[key];

function totalsOf<T>(columns: ReadonlyArray<GstCol<T>>, rows: ReadonlyArray<T>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of columns) if (c.total) out[c.key] = Math.round(rows.reduce((s, r) => s + (Number(valueOf(r, c.key)) || 0), 0) * 100) / 100;
  return out;
}

function exportCols<T>(columns: ReadonlyArray<GstCol<T>>): ExportColumn<T>[] {
  return columns.map((c) => ({ header: c.header, value: (r: T) => valueOf(r, c.key) as string | number | null }));
}

function ExportButtons<T>({ file, sheet, rows, columns }: { file: string; sheet: string; rows: ReadonlyArray<T>; columns: ReadonlyArray<GstCol<T>> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="ims-row">
      <Button size="sm" icon="download" disabled={!rows.length} onClick={() => downloadCsv(file, rows, exportCols(columns))}>
        CSV
      </Button>
      <Button
        size="sm"
        icon="download"
        disabled={!rows.length || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await downloadXlsx(file, sheet, rows, exportCols(columns));
          } finally {
            setBusy(false);
          }
        }}
      >
        Excel
      </Button>
    </div>
  );
}

function GstTable<T>({ columns, rows, empty, caption, onRowClick }: { columns: ReadonlyArray<GstCol<T>>; rows: ReadonlyArray<T>; empty: string; caption: string; onRowClick?: (row: T) => void }) {
  const totals = totalsOf(columns, rows);
  type W = { id: string; row: T | null };
  const wrapped: W[] = rows.map((row, i) => ({ id: String(i), row }));
  if (rows.length && Object.keys(totals).length) wrapped.push({ id: "__total", row: null });
  const cols: BosColumn<W>[] = columns.map((c, i) => ({
    key: c.key,
    header: c.header,
    align: NUMERIC_KINDS.has(c.kind ?? "text") ? "right" : undefined,
    mono: c.kind === "date",
    cell: (w) => (w.row ? fmt(valueOf(w.row, c.key), c.kind) : c.key in totals ? <strong>{fmt(totals[c.key], c.kind)}</strong> : i === 0 ? <strong>Total</strong> : ""),
  }));
  return (
    <div style={{ overflowX: "auto" }}>
      <DataTable
        columns={cols}
        rows={wrapped}
        rowKey={(w) => w.id}
        compact
        empty={empty}
        caption={caption}
        onRowClick={
          onRowClick
            ? (w) => {
                if (w.row) onRowClick(w.row);
              }
            : undefined
        }
      />
    </div>
  );
}

function PaperTable<T>({ title, columns, rows }: { title: string; columns: ReadonlyArray<GstCol<T>>; rows: ReadonlyArray<T> }) {
  const totals = totalsOf(columns, rows);
  const align = (c: GstCol<T>) => (NUMERIC_KINDS.has(c.kind ?? "text") ? "right" : "left");
  return (
    <>
      <h3>{title}</h3>
      <table className="bos-inv-paper-table ims-rp-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: align(c) }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: align(c) }}>
                    {fmt(valueOf(r, c.key), c.kind, true)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="bos-inv-paper-empty">
                Nil
              </td>
            </tr>
          )}
          {rows.length && Object.keys(totals).length ? (
            <tr className="ims-rp-total">
              {columns.map((c, i) => (
                <td key={c.key} style={{ textAlign: align(c) }}>
                  {c.key in totals ? fmt(totals[c.key], c.kind, true) : i === 0 ? "Total" : ""}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}

/* ---------- Column sets ---------- */

const B2B_COLS: ReadonlyArray<GstCol<B2bRow>> = [
  { key: "gstin", header: "GSTIN/UIN of Recipient" },
  { key: "receiverName", header: "Receiver Name" },
  { key: "invoiceNo", header: "Invoice Number" },
  { key: "invoiceDate", header: "Invoice date", kind: "date" },
  { key: "invoiceValue", header: "Invoice Value", kind: "money" },
  { key: "placeOfSupply", header: "Place Of Supply" },
  { key: "reverseCharge", header: "Reverse Charge" },
  { key: "invoiceType", header: "Invoice Type" },
  { key: "rate", header: "Rate", kind: "pct" },
  { key: "taxableValue", header: "Taxable Value", kind: "money", total: true },
  { key: "igst", header: "Integrated Tax Amount", kind: "money", total: true },
  { key: "cgst", header: "Central Tax Amount", kind: "money", total: true },
  { key: "sgst", header: "State/UT Tax Amount", kind: "money", total: true },
  { key: "cess", header: "Cess Amount", kind: "money", total: true },
];

const B2CL_COLS: ReadonlyArray<GstCol<B2clRow>> = [
  { key: "invoiceNo", header: "Invoice Number" },
  { key: "invoiceDate", header: "Invoice date", kind: "date" },
  { key: "invoiceValue", header: "Invoice Value", kind: "money" },
  { key: "placeOfSupply", header: "Place Of Supply" },
  { key: "rate", header: "Rate", kind: "pct" },
  { key: "taxableValue", header: "Taxable Value", kind: "money", total: true },
  { key: "igst", header: "Integrated Tax Amount", kind: "money", total: true },
  { key: "cess", header: "Cess Amount", kind: "money", total: true },
];

const B2CS_COLS: ReadonlyArray<GstCol<B2csRow>> = [
  { key: "type", header: "Type" },
  { key: "placeOfSupply", header: "Place Of Supply" },
  { key: "rate", header: "Rate", kind: "pct" },
  { key: "taxableValue", header: "Taxable Value", kind: "money", total: true },
  { key: "igst", header: "Integrated Tax Amount", kind: "money", total: true },
  { key: "cgst", header: "Central Tax Amount", kind: "money", total: true },
  { key: "sgst", header: "State/UT Tax Amount", kind: "money", total: true },
  { key: "cess", header: "Cess Amount", kind: "money", total: true },
];

const CDN_COLS: ReadonlyArray<GstCol<CreditNoteRow>> = [
  { key: "noteNo", header: "Note Number" },
  { key: "noteDate", header: "Note Date", kind: "date" },
  { key: "noteType", header: "Note Type" },
  { key: "party", header: "Receiver Name" },
  { key: "gstin", header: "GSTIN/UIN of Recipient" },
  { key: "registered", header: "Supply Type" },
  { key: "originalInvoice", header: "Original Invoice Number" },
  { key: "taxableValue", header: "Taxable Value", kind: "money", total: true },
  { key: "igst", header: "Integrated Tax Amount", kind: "money", total: true },
  { key: "cgst", header: "Central Tax Amount", kind: "money", total: true },
  { key: "sgst", header: "State/UT Tax Amount", kind: "money", total: true },
  { key: "noteValue", header: "Note Value", kind: "money", total: true },
];

const HSN_COLS: ReadonlyArray<GstCol<HsnRow>> = [
  { key: "hsn", header: "HSN" },
  { key: "description", header: "Description" },
  { key: "uqc", header: "UQC" },
  { key: "totalQuantity", header: "Total Quantity", kind: "qty", total: true },
  { key: "totalValue", header: "Total Value", kind: "money", total: true },
  { key: "rate", header: "Rate", kind: "pct" },
  { key: "taxableValue", header: "Taxable Value", kind: "money", total: true },
  { key: "igst", header: "Integrated Tax Amount", kind: "money", total: true },
  { key: "cgst", header: "Central Tax Amount", kind: "money", total: true },
  { key: "sgst", header: "State/UT Tax Amount", kind: "money", total: true },
  { key: "cess", header: "Cess Amount", kind: "money", total: true },
];

const RATE_COLS: ReadonlyArray<GstCol<RateRow>> = [
  { key: "rate", header: "Rate", kind: "pct" },
  { key: "taxable", header: "Taxable Value", kind: "money", total: true },
  { key: "igst", header: "Integrated Tax", kind: "money", total: true },
  { key: "cgst", header: "Central Tax", kind: "money", total: true },
  { key: "sgst", header: "State/UT Tax", kind: "money", total: true },
  { key: "tax", header: "Total Tax", kind: "money", total: true },
];

const INWARD_COLS: ReadonlyArray<GstCol<InwardRow>> = [
  { key: "billNo", header: "Bill Number" },
  { key: "supplierBillNo", header: "Supplier Invoice Number" },
  { key: "billDate", header: "Invoice Date", kind: "date" },
  { key: "supplier", header: "Supplier Name" },
  { key: "gstin", header: "GSTIN of Supplier" },
  { key: "taxableValue", header: "Taxable Value", kind: "money", total: true },
  { key: "igst", header: "Integrated Tax", kind: "money", total: true },
  { key: "cgst", header: "Central Tax", kind: "money", total: true },
  { key: "sgst", header: "State/UT Tax", kind: "money", total: true },
  { key: "itcEligible", header: "ITC Eligible" },
  { key: "billValue", header: "Invoice Value", kind: "money", total: true },
];

const PROVISIONAL_COLS: ReadonlyArray<GstCol<ProvisionalRow>> = [
  { key: "poNo", header: "PO Number" },
  { key: "supplier", header: "Supplier Name" },
  { key: "receivedOn", header: "Received On", kind: "date" },
  { key: "taxableValue", header: "Taxable Value (received)", kind: "money", total: true },
  { key: "igst", header: "Integrated Tax", kind: "money", total: true },
  { key: "cgst", header: "Central Tax", kind: "money", total: true },
  { key: "sgst", header: "State/UT Tax", kind: "money", total: true },
];

type ItemRow = GstItemIssue & { issueText: string; suggestion: string };
const ITEM_COLS: ReadonlyArray<GstCol<ItemRow>> = [
  { key: "name", header: "Item" },
  { key: "sku", header: "SKU" },
  { key: "category", header: "Category" },
  { key: "hsn", header: "HSN / SAC" },
  { key: "gstRate", header: "GST Rate", kind: "pct" },
  { key: "issueText", header: "Issues" },
  { key: "suggestion", header: "Suggestion (from category)" },
];

/* ---------- Module ---------- */

export function GstModule() {
  return (
    <RequirePerm perm={["reports", "audit"]} what="GST summaries (Reports & GST or Auditor)">
      <GstWorkspace />
    </RequirePerm>
  );
}

function GstWorkspace() {
  const { session, navigate } = useIms();
  const today = session.today;
  const print = usePrint();
  const [tab, setTab] = useState<Tab>("gstr1");
  const [period, setPeriod] = useState<Period>("lastmonth");
  const [from, setFrom] = useState(addDaysISO(today, -30));
  const [to, setTo] = useState(today);
  const [paper, setPaper] = useState(false);
  const customOk = period !== "custom" || Boolean(from && to && from <= to);
  const params = { period, from: period === "custom" ? from : undefined, to: period === "custom" ? to : undefined };
  const key = JSON.stringify(params);
  const summary = useImsData<GstSummary | null>(() => (customOk ? gst.summary(params) : Promise.resolve(null)), [key, customOk]);
  const hsn = useImsData<GstHsn | null>(() => (customOk && tab === "hsn" ? gst.hsn(params) : Promise.resolve(null)), [key, customOk, tab === "hsn"]);
  const items = useImsData<GstItemsCheck | null>(() => (tab === "items" ? gst.itemsCheck() : Promise.resolve(null)), [tab === "items"]);

  const business = {
    name: session.brand?.name || session.settings.businessName,
    gstin: session.brand?.gstin ?? session.settings.gstin,
    address: [session.brand?.address ?? session.settings.address, session.brand?.state ?? session.settings.state].filter(Boolean).join(", ") || null,
  };
  const startPrint = () => {
    setPaper(true);
    window.setTimeout(print, 80);
  };

  return (
    <Stack>
      <PageHeader
        title="GST / HSN"
        sub="GSTR-1 and GSTR-3B ready summaries, HSN-wise outward supplies and an item master check."
        actions={
          <>
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => (tab === "hsn" ? hsn.reload() : tab === "items" ? items.reload() : summary.reload())}>
              Refresh
            </Button>
            <Button size="sm" icon="printer" onClick={startPrint} disabled={tab === "items" ? !items.data : tab === "hsn" ? !hsn.data : !summary.data}>
              Print
            </Button>
          </>
        }
      />
      <SubTabs label="GST sections" value={tab} onChange={setTab} options={TABS} />

      {tab !== "items" ? (
        <div className="ims-rp-controls">
          <PeriodPicker value={period} onChange={setPeriod} />
          <FilterChip active={period === "custom"} onClick={() => setPeriod("custom")}>
            Custom
          </FilterChip>
          {period === "custom" ? (
            <>
              <Input type="date" size="sm" aria-label="From" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
              <Input type="date" size="sm" aria-label="To" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
            </>
          ) : null}
          {summary.data ? <span className="ims-faint">Return period {dateRange(summary.data.range.from, summary.data.range.to)}</span> : null}
        </div>
      ) : null}

      {!customOk && tab !== "items" ? (
        <Alert tone="amber" title="Check the dates">
          The start date must be on or before the end date.
        </Alert>
      ) : tab === "items" ? (
        <Loaded state={items} rows={1}>
          {(d) => (d ? <ItemsTab data={d} onOpenItem={(id) => navigate("items", `open:${id}`)} onOpenItems={() => navigate("items")} /> : null)}
        </Loaded>
      ) : tab === "hsn" ? (
        <Loaded state={hsn} rows={1}>
          {(d) => (d ? <HsnTab data={d} /> : null)}
        </Loaded>
      ) : (
        <Loaded state={summary} rows={2}>
          {(d) =>
            d ? (
              <Stack gap={16}>
                <SellerStrip data={d} />
                {tab === "gstr1" ? <Gstr1Tab data={d} /> : tab === "gstr3b" ? <Gstr3bTab data={d} /> : <RatesTab data={d} />}
              </Stack>
            ) : null
          }
        </Loaded>
      )}

      <Alert tone="blue" title="Prepared from your IMS records — not a filing">
        Figures come from issued invoices, supplier bills, received purchase orders and customer returns in Justx IMS. Always reconcile with your CA and the GSTN portal (GSTR-2B for ITC) before filing.
      </Alert>

      {paper ? (
        <Card interactive={false}>
          <div className="ims-between" style={{ marginBottom: 12 }}>
            <h3 className="ims-rp-section-title" style={{ margin: 0 }}>
              Print view
            </h3>
            <div className="ims-row">
              <Button size="sm" icon="printer" onClick={print}>
                Print again
              </Button>
              <Button size="sm" variant="ghost" icon="x" onClick={() => setPaper(false)}>
                Close
              </Button>
            </div>
          </div>
          <GstPaper tab={tab} summary={summary.data} hsn={hsn.data} items={items.data} business={business} />
        </Card>
      ) : null}
    </Stack>
  );
}

function SellerStrip({ data }: { data: GstSummary }) {
  return (
    <>
      {data.warnings.length ? (
        <Alert tone="amber" title={`${data.warnings.length} thing${data.warnings.length === 1 ? "" : "s"} to check before filing`}>
          <ul className="ims-rp-steps" style={{ marginTop: 4 }}>
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="ims-row ims-faint">
        <span>
          <strong>{data.seller.businessName || "Your business"}</strong>
        </span>
        <span>· GSTIN {data.seller.gstin ?? "not set"}</span>
        {data.seller.state ? <span>· {data.seller.state}</span> : null}
        <span>· Intra-state when the customer&apos;s state (or GSTIN state code) matches yours; otherwise IGST.</span>
      </div>
    </>
  );
}

/* ---------- GSTR-1 ---------- */

function Gstr1Tab({ data }: { data: GstSummary }) {
  const [section, setSection] = useState<Gstr1Section>("b2b");
  const file = (s: string) => `gstr1-${s}-${data.range.from}-to-${data.range.to}`;
  const sections: Record<Gstr1Section, ReactNode> = {
    b2b: (
      <GstCard title="4A · B2B invoices" sub={`${data.b2b.invoices} invoices to registered customers`} actions={<ExportButtons file={file("b2b")} sheet="b2b" rows={data.b2b.rows} columns={B2B_COLS} />}>
        <GstTable columns={B2B_COLS} rows={data.b2b.rows} empty="No B2B invoices in this period." caption="B2B invoices" />
      </GstCard>
    ),
    b2cl: (
      <GstCard title="5 · B2C large (inter-state, invoice value above ₹1 lakh)" sub={`${data.b2cl.invoices} invoices`} actions={<ExportButtons file={file("b2cl")} sheet="b2cl" rows={data.b2cl.rows} columns={B2CL_COLS} />}>
        <GstTable columns={B2CL_COLS} rows={data.b2cl.rows} empty="No B2C large invoices in this period." caption="B2C large invoices" />
      </GstCard>
    ),
    b2cs: (
      <GstCard title="7 · B2C small (place of supply × rate)" sub={`${data.b2cs.invoices} invoices summarised`} actions={<ExportButtons file={file("b2cs")} sheet="b2cs" rows={data.b2cs.rows} columns={B2CS_COLS} />}>
        <GstTable columns={B2CS_COLS} rows={data.b2cs.rows} empty="No B2C small supplies in this period." caption="B2C small supplies" />
      </GstCard>
    ),
    cdn: (
      <GstCard title="9B · Credit notes (customer returns)" sub={`${data.creditNotes.count} notes · tax estimated from item GST rates`} actions={<ExportButtons file={file("cdnr")} sheet="cdnr" rows={data.creditNotes.rows} columns={CDN_COLS} />}>
        <GstTable columns={CDN_COLS} rows={data.creditNotes.rows} empty="No customer returns in this period." caption="Credit notes" />
      </GstCard>
    ),
    docs: (
      <GstCard title="13 · Documents issued" sub="Invoice series used in this period">
        <dl className="ims-rp-kv" style={{ maxWidth: 460 }}>
          <dt>Nature of document</dt>
          <dd>Invoices for outward supply</dd>
          <dt>Sr. No. From</dt>
          <dd>{data.documents.from ?? "—"}</dd>
          <dt>Sr. No. To</dt>
          <dd>{data.documents.to ?? "—"}</dd>
          <dt>Total Number</dt>
          <dd>{data.documents.total}</dd>
          <dt>Cancelled</dt>
          <dd>{data.documents.cancelled}</dd>
          <dt className="is-sep is-strong">Net Issued</dt>
          <dd className="is-sep is-strong">{data.documents.issued}</dd>
          <dt>Credit notes</dt>
          <dd>{data.documents.creditNotes}</dd>
        </dl>
      </GstCard>
    ),
  };
  return (
    <Stack gap={16}>
      <Grid cols={4} min={150}>
        <KpiCard label="B2B taxable" value={inr(data.b2b.taxable)} chip={{ color: "blue", glyph: "🏢" }} delta={`${data.b2b.invoices} invoices · tax ${inr(data.b2b.tax)}`} deltaTone="muted" interactive={false} />
        <KpiCard label="B2C taxable" value={inr(data.b2cl.taxable + data.b2cs.taxable)} chip={{ color: "mint", glyph: "🛒" }} delta={`${data.b2cl.invoices} large · ${data.b2cs.invoices} small`} deltaTone="muted" interactive={false} />
        <KpiCard label="Credit notes" value={inr(data.creditNotes.taxable)} chip={{ color: "rose", glyph: "↩" }} delta={`${data.creditNotes.count} notes · tax ${inr(data.creditNotes.tax)}`} deltaTone={data.creditNotes.count ? "warn" : "muted"} interactive={false} />
        <KpiCard label="Net output tax" value={inr(data.outward.tax)} chip={{ color: "amber", glyph: "₹" }} delta={`CGST ${inr(data.outward.cgst)} · SGST ${inr(data.outward.sgst)} · IGST ${inr(data.outward.igst)}`} deltaTone="muted" interactive={false} />
      </Grid>
      <Segmented
        size="sm"
        scroll
        aria-label="GSTR-1 table"
        value={section}
        onChange={setSection}
        options={[
          { value: "b2b", label: `B2B · ${data.b2b.invoices}` },
          { value: "b2cl", label: `B2CL · ${data.b2cl.invoices}` },
          { value: "b2cs", label: `B2CS · ${data.b2cs.rows.length}` },
          { value: "cdn", label: `Credit notes · ${data.creditNotes.count}` },
          { value: "docs", label: "Documents" },
        ]}
      />
      {sections[section]}
    </Stack>
  );
}

function GstCard({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card interactive={false}>
      <div className="ims-between" style={{ marginBottom: 12 }}>
        <div className="ims-cell-stack">
          <h3 className="ims-rp-section-title" style={{ margin: 0 }}>
            {title}
          </h3>
          {sub ? <small>{sub}</small> : null}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

/* ---------- GSTR-3B ---------- */

function TaxKv({ rows }: { rows: ReadonlyArray<{ label: string; value: number; strong?: boolean; sep?: boolean; tone?: string }> }) {
  return (
    <dl className="ims-rp-kv">
      {rows.map((r) => (
        <div key={r.label} style={{ display: "contents" }}>
          <dt className={[r.strong ? "is-strong" : "", r.sep ? "is-sep" : ""].join(" ").trim() || undefined}>{r.label}</dt>
          <dd className={[r.strong ? "is-strong" : "", r.sep ? "is-sep" : ""].join(" ").trim() || undefined} style={r.tone ? { color: r.tone } : undefined}>
            {inrExact(r.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Gstr3bTab({ data }: { data: GstSummary }) {
  const file = (s: string) => `gstr3b-${s}-${data.range.from}-to-${data.range.to}`;
  const bars = [
    { label: "Output tax", value: data.outward.tax, color: CHART_PALETTE[0] },
    { label: "Eligible ITC", value: data.itc.total, color: CHART_PALETTE[1] },
    { label: "Net payable", value: data.net.payable.total, color: CHART_PALETTE[3] },
    { label: "ITC carried forward", value: data.net.carryForward.total, color: CHART_PALETTE[4] },
  ];
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <Stack gap={16}>
      <Grid cols={4} min={150}>
        <KpiCard label="Outward taxable" value={inr(data.outward.taxable)} chip={{ color: "blue", glyph: "↗" }} delta="Net of credit notes" deltaTone="muted" interactive={false} />
        <KpiCard label="Output tax" value={inr(data.outward.tax)} chip={{ color: "amber", glyph: "₹" }} interactive={false} />
        <KpiCard label="Eligible ITC" value={inr(data.itc.total)} chip={{ color: "mint", glyph: "↙" }} delta={`${data.inward.bills} supplier bills`} deltaTone="muted" interactive={false} />
        <KpiCard
          label="Net GST payable"
          value={inr(data.net.payable.total)}
          chip={{ color: "rose", glyph: "=" }}
          valueTone={data.net.payable.total > 0 ? "coral" : "emerald"}
          delta={data.net.carryForward.total ? `${inr(data.net.carryForward.total)} ITC carried forward` : "After ITC set-off"}
          deltaTone="muted"
          interactive={false}
        />
      </Grid>

      <Grid cols={3} min={260}>
        <GstCard title="3.1(a) · Outward taxable supplies" sub="Issued invoices less customer credit notes">
          <TaxKv
            rows={[
              { label: "Gross taxable value", value: data.gross.taxable },
              { label: "Less: credit notes", value: -data.creditNotes.taxable },
              { label: "Net taxable value", value: data.outward.taxable, strong: true, sep: true },
              { label: "Integrated tax", value: data.outward.igst },
              { label: "Central tax", value: data.outward.cgst },
              { label: "State/UT tax", value: data.outward.sgst },
              { label: "Total output tax", value: data.outward.tax, strong: true, sep: true },
            ]}
          />
        </GstCard>
        <GstCard title="4 · Eligible ITC (estimate)" sub="Supplier bills from GSTIN-registered suppliers">
          <TaxKv
            rows={[
              { label: "Inward taxable value", value: data.inward.taxable },
              { label: "Integrated tax", value: data.itc.igst },
              { label: "Central tax", value: data.itc.cgst },
              { label: "State/UT tax", value: data.itc.sgst },
              { label: "Total eligible ITC", value: data.itc.total, strong: true, sep: true },
              { label: "Ineligible (no supplier GSTIN)", value: data.inward.ineligibleTax, tone: data.inward.ineligibleTax ? "var(--bos-coral)" : undefined },
            ]}
          />
        </GstCard>
        <GstCard title="6.1 · Payment of tax" sub="Statutory set-off: IGST credit first, then CGST / SGST">
          <TaxKv
            rows={[
              { label: "Integrated tax payable", value: data.net.payable.igst },
              { label: "Central tax payable", value: data.net.payable.cgst },
              { label: "State/UT tax payable", value: data.net.payable.sgst },
              { label: "Net payable in cash", value: data.net.payable.total, strong: true, sep: true, tone: data.net.payable.total > 0 ? "var(--bos-coral)" : undefined },
              { label: "ITC carried forward", value: data.net.carryForward.total },
            ]}
          />
        </GstCard>
      </Grid>

      <Card interactive={false}>
        <h3 className="ims-rp-section-title">Output tax vs ITC</h3>
        <div className="ims-bars" role="list" aria-label="Output tax versus input tax credit">
          {bars.map((b) => (
            <div key={b.label} className="ims-bar-row" role="listitem">
              <span>{b.label}</span>
              <div className="ims-bar-track">
                <div className="ims-bar-fill" style={{ width: `${Math.max(2, (b.value / max) * 100)}%`, background: b.color }} />
              </div>
              <span className="ims-num">{inr(b.value)}</span>
            </div>
          ))}
        </div>
      </Card>

      <GstCard title="Inward supplies · supplier bills" sub={`${data.inward.bills} bills · value ${inr(data.inward.value)}`} actions={<ExportButtons file={file("inward")} sheet="inward" rows={data.inward.rows} columns={INWARD_COLS} />}>
        <GstTable columns={INWARD_COLS} rows={data.inward.rows} empty="No supplier bills in this period." caption="Supplier bills" />
      </GstCard>

      <GstCard
        title="Received but not yet billed (provisional — not claimed)"
        sub={data.provisional.rows.length ? `Tax ${inr(data.provisional.tax)} becomes ITC once the supplier's bill is recorded` : undefined}
        actions={<ExportButtons file={file("provisional")} sheet="provisional" rows={data.provisional.rows} columns={PROVISIONAL_COLS} />}
      >
        <GstTable columns={PROVISIONAL_COLS} rows={data.provisional.rows} empty="Every received purchase order in this period has a bill." caption="Received purchase orders without a bill" />
      </GstCard>
    </Stack>
  );
}

/* ---------- Rate-wise ---------- */

function RateStack({ rows }: { rows: ReadonlyArray<RateRow> }) {
  const total = rows.reduce((s, r) => s + Math.max(0, r.taxable), 0);
  if (!total) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="ims-stackbar" role="img" aria-label={rows.map((r) => `${r.rate}%: ${inr(r.taxable)}`).join(", ")}>
        {rows.map((r, i) => (
          <span key={r.rate} style={{ width: `${(Math.max(0, r.taxable) / total) * 100}%`, background: CHART_PALETTE[i % CHART_PALETTE.length] }} title={`${r.rate}% · ${inr(r.taxable)}`} />
        ))}
      </div>
      <div className="ims-legend">
        {rows.map((r, i) => (
          <span key={r.rate}>
            <i style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
            {r.rate}% · {Math.round((r.taxable / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function RatesTab({ data }: { data: GstSummary }) {
  const file = (s: string) => `gst-ratewise-${s}-${data.range.from}-to-${data.range.to}`;
  return (
    <Grid cols={2} min={320}>
      <GstCard title="Outward supplies by rate" sub="Issued invoices (before credit notes)" actions={<ExportButtons file={file("outward")} sheet="outward" rows={data.outwardRate} columns={RATE_COLS} />}>
        <RateStack rows={data.outwardRate} />
        <GstTable columns={RATE_COLS} rows={data.outwardRate} empty="No outward supplies in this period." caption="Outward supplies by rate" />
      </GstCard>
      <GstCard title="Inward supplies by rate" sub="Supplier bills (all, incl. ineligible)" actions={<ExportButtons file={file("inward")} sheet="inward" rows={data.inwardRate} columns={RATE_COLS} />}>
        <RateStack rows={data.inwardRate} />
        <GstTable columns={RATE_COLS} rows={data.inwardRate} empty="No supplier bills in this period." caption="Inward supplies by rate" />
      </GstCard>
    </Grid>
  );
}

/* ---------- HSN ---------- */

function HsnTab({ data }: { data: GstHsn }) {
  return (
    <Stack gap={16}>
      {data.missingHsnLines ? (
        <Alert tone="amber" title={`${data.missingHsnLines} invoice line${data.missingHsnLines === 1 ? "" : "s"} without HSN`}>
          They are grouped under “—”. Fill HSN codes in the item master (see Item HSN check) so future invoices carry them.
        </Alert>
      ) : null}
      <Grid cols={4} min={150}>
        <KpiCard label="HSN codes" value={data.totals.codes} chip={{ color: "lavender", glyph: "#" }} interactive={false} />
        <KpiCard label="Taxable value" value={inr(data.totals.taxableValue)} chip={{ color: "blue", glyph: "₹" }} interactive={false} />
        <KpiCard label="Total tax" value={inr(data.totals.igst + data.totals.cgst + data.totals.sgst)} chip={{ color: "amber", glyph: "%" }} delta={`IGST ${inr(data.totals.igst)} · CGST ${inr(data.totals.cgst)} · SGST ${inr(data.totals.sgst)}`} deltaTone="muted" interactive={false} />
        <KpiCard label="Total value" value={inr(data.totals.totalValue)} chip={{ color: "mint", glyph: "Σ" }} interactive={false} />
      </Grid>
      <GstCard
        title="12 · HSN-wise summary of outward supplies"
        sub={dateRange(data.range.from, data.range.to)}
        actions={<ExportButtons file={`gstr1-hsn-${data.range.from}-to-${data.range.to}`} sheet="hsn" rows={data.rows} columns={HSN_COLS} />}
      >
        <GstTable columns={HSN_COLS} rows={data.rows} empty="No outward supplies in this period." caption="HSN summary" />
      </GstCard>
    </Stack>
  );
}

/* ---------- Item master check ---------- */

function itemRows(items: ReadonlyArray<GstItemIssue>): ItemRow[] {
  return items.map((i) => ({
    ...i,
    issueText: i.issues.join("; "),
    suggestion: [i.suggestedHsn ? `HSN ${i.suggestedHsn}` : null, i.suggestedRate !== null && i.suggestedRate !== i.gstRate ? `GST ${i.suggestedRate}%` : null].filter(Boolean).join(" · "),
  }));
}

function ItemsTab({ data, onOpenItem, onOpenItems }: { data: GstItemsCheck; onOpenItem: (id: string) => void; onOpenItems: () => void }) {
  const [kind, setKind] = useState<"all" | "hsn" | "rate">("all");
  const rows = itemRows(data.items).filter((i) => kind === "all" || (kind === "hsn" ? i.issues.some((s) => s.includes("HSN")) : i.issues.some((s) => s.startsWith("GST"))));
  const s = data.summary;
  const tone = s.completenessPct >= 95 ? "emerald" : s.completenessPct >= 75 ? "amber" : "coral";
  return (
    <Stack gap={16}>
      <Grid cols={4} min={150}>
        <Card interactive={false}>
          <div className="bos-kpi-label">Master completeness</div>
          <div className="bos-kpi-value">{s.completenessPct.toFixed(0)}%</div>
          <div style={{ marginTop: 10 }}>
            <ProgressBar value={s.completenessPct} tone={tone} label="HSN / GST completeness" />
          </div>
          <div className="bos-kpi-delta bos-kpi-delta-muted">
            {s.complete} of {s.total} active items complete
          </div>
        </Card>
        <KpiCard label="Missing HSN" value={s.missingHsn} chip={{ color: "rose", glyph: "∅" }} valueTone={s.missingHsn ? "coral" : undefined} interactive={false} />
        <KpiCard label="Invalid HSN length" value={s.badHsn} chip={{ color: "amber", glyph: "#" }} valueTone={s.badHsn ? "amber" : undefined} delta="Must be 4, 6 or 8 digits" deltaTone="muted" interactive={false} />
        <KpiCard label="GST rate to confirm" value={s.rateIssues} chip={{ color: "lavender", glyph: "%" }} delta="Non-standard or 0% rates" deltaTone="muted" interactive={false} />
      </Grid>
      <GstCard
        title="Items needing attention"
        sub="Click an item to open it in the item master"
        actions={
          <div className="ims-row">
            <Segmented
              size="sm"
              role="radio"
              aria-label="Issue type"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: `All · ${data.items.length}` },
                { value: "hsn", label: "HSN" },
                { value: "rate", label: "GST rate" },
              ]}
            />
            <ExportButtons file="gst-item-master-check" sheet="items" rows={rows} columns={ITEM_COLS} />
            <Button size="sm" variant="ghost" icon="box" onClick={onOpenItems}>
              Item master
            </Button>
          </div>
        }
      >
        {data.items.length ? (
          <div style={{ overflowX: "auto" }}>
            <DataTable
              columns={[
                {
                  key: "name",
                  header: "Item",
                  cell: (i: ItemRow) => (
                    <div className="ims-cell-stack">
                      <span className="ims-strong">{i.name}</span>
                      <small>{[i.sku, i.category].filter(Boolean).join(" · ")}</small>
                    </div>
                  ),
                },
                { key: "hsn", header: "HSN / SAC", mono: true, cell: (i: ItemRow) => i.hsn || "—" },
                { key: "rate", header: "GST", align: "right", cell: (i: ItemRow) => `${i.gstRate}%` },
                {
                  key: "issues",
                  header: "Issues",
                  cell: (i: ItemRow) => (
                    <div className="ims-row" style={{ gap: 4 }}>
                      {i.issues.map((t) => (
                        <Badge key={t} tone={t.startsWith("Missing") ? "coral" : "amber"} auto>
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ),
                },
                { key: "suggestion", header: "Suggestion", cell: (i: ItemRow) => (i.suggestion ? <span className="ims-muted">{i.suggestion}</span> : "") },
              ]}
              rows={rows}
              rowKey={(i) => i.id}
              onRowClick={(i) => onOpenItem(i.id)}
              chevron
              compact
              empty="No items with this kind of issue."
              caption="Items with HSN or GST issues"
            />
          </div>
        ) : (
          <EmptyState icon="check" title="Item master looks complete">
            Every active item has a valid HSN code and a standard GST rate.
          </EmptyState>
        )}
      </GstCard>
    </Stack>
  );
}

/* ---------- Print ---------- */

function GstPaper({
  tab,
  summary,
  hsn,
  items,
  business,
}: {
  tab: Tab;
  summary: GstSummary | null;
  hsn: GstHsn | null;
  items: GstItemsCheck | null;
  business: { name: string; gstin: string | null; address: string | null };
}) {
  const range = tab === "hsn" ? hsn?.range : summary?.range;
  const title = TABS.find((t) => t.value === tab)?.label ?? "GST";
  return (
    <article className="bos-inv-paper ims-rp-paper" aria-label={`${title} — print view`} style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <div>
          <div className="bos-inv-paper-brand">{business.name || "Your business"}</div>
          <div className="ims-paper-seller">{[business.address, business.gstin ? `GSTIN ${business.gstin}` : "GSTIN not set"].filter(Boolean).join("\n")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">{title}</div>
          <div className="ims-paper-sub">{tab === "items" ? `As of ${new Date().toLocaleDateString("en-IN")}` : range ? `Return period ${dateRange(range.from, range.to)}` : ""}</div>
        </div>
      </div>

      {tab === "gstr1" && summary ? (
        <>
          <PaperTable title="4A · B2B invoices" columns={B2B_COLS} rows={summary.b2b.rows} />
          <PaperTable title="5 · B2C large" columns={B2CL_COLS} rows={summary.b2cl.rows} />
          <PaperTable title="7 · B2C small" columns={B2CS_COLS} rows={summary.b2cs.rows} />
          <PaperTable title="9B · Credit notes" columns={CDN_COLS} rows={summary.creditNotes.rows} />
          <h3>13 · Documents issued</h3>
          <div className="ims-paper-sub">
            Invoices {summary.documents.from ?? "—"} to {summary.documents.to ?? "—"} · total {summary.documents.total} · cancelled {summary.documents.cancelled} · net issued {summary.documents.issued} · credit notes {summary.documents.creditNotes}
          </div>
        </>
      ) : null}

      {tab === "gstr3b" && summary ? (
        <>
          <PaperTable
            title="3.1 · Outward supplies & tax · 4 · ITC · 6.1 · Payment"
            columns={[
              { key: "label", header: "Particulars" },
              { key: "taxable", header: "Taxable Value", kind: "money" },
              { key: "igst", header: "Integrated Tax", kind: "money" },
              { key: "cgst", header: "Central Tax", kind: "money" },
              { key: "sgst", header: "State/UT Tax", kind: "money" },
            ]}
            rows={[
              { label: "(a) Outward taxable supplies (net of credit notes)", taxable: summary.outward.taxable, igst: summary.outward.igst, cgst: summary.outward.cgst, sgst: summary.outward.sgst },
              { label: "Eligible ITC — supplier bills", taxable: summary.inward.taxable, igst: summary.itc.igst, cgst: summary.itc.cgst, sgst: summary.itc.sgst },
              { label: "Tax payable in cash (after set-off)", taxable: null, igst: summary.net.payable.igst, cgst: summary.net.payable.cgst, sgst: summary.net.payable.sgst },
              { label: "ITC carried forward", taxable: null, igst: summary.net.carryForward.igst, cgst: summary.net.carryForward.cgst, sgst: summary.net.carryForward.sgst },
            ]}
          />
          <div className="bos-inv-totals">
            <div className="bos-inv-totals-row">
              <span>Total output tax</span>
              <span>{inrExact(summary.outward.tax)}</span>
            </div>
            <div className="bos-inv-totals-row">
              <span>Eligible ITC</span>
              <span>{inrExact(summary.itc.total)}</span>
            </div>
            <div className="bos-inv-totals-row is-total">
              <span>Net GST payable</span>
              <span>{inrExact(summary.net.payable.total)}</span>
            </div>
          </div>
          <PaperTable title="Inward supplies · supplier bills" columns={INWARD_COLS} rows={summary.inward.rows} />
        </>
      ) : null}

      {tab === "rates" && summary ? (
        <>
          <PaperTable title="Outward supplies by rate" columns={RATE_COLS} rows={summary.outwardRate} />
          <PaperTable title="Inward supplies by rate" columns={RATE_COLS} rows={summary.inwardRate} />
        </>
      ) : null}

      {tab === "hsn" && hsn ? <PaperTable title="12 · HSN-wise summary of outward supplies" columns={HSN_COLS} rows={hsn.rows} /> : null}

      {tab === "items" && items ? <PaperTable title={`Items needing attention (${items.summary.flagged} of ${items.summary.total})`} columns={ITEM_COLS} rows={itemRows(items.items)} /> : null}

      {summary?.warnings.length && tab !== "items" && tab !== "hsn" ? <div className="bos-inv-notes">{summary.warnings.join("\n")}</div> : null}
      <div className="bos-inv-notes">Prepared from Justx IMS records for review. Not a GST filing — reconcile with your CA and the GSTN portal before filing.</div>
      <div className="ims-paper-sign">
        <div className="ims-paper-sub">Generated {new Date().toLocaleString("en-IN")}</div>
        <div>
          <div className="ims-paper-sign-line" />
          Reviewed by
        </div>
      </div>
    </article>
  );
}
