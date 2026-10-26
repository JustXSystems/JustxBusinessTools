"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, EmptyState, Grid, KpiCard, SearchInput, Segmented, Select, type BosColumn } from "@/components/bos";
import { finance, INVOICE_BADGE, type ImsInvoice, type InvoiceDisplayStatus } from "@/lib/ims/finance";
import { dateLabel, downloadCsv, inr, inrCompact, inrExact, pct } from "@/lib/ims/format";
import { Loaded, PageHeader, RequirePerm, Stack, StatusBadge, SubTabs, useIms, useImsData } from "../core";
import { usePartyOptions } from "../shared/pickers";
import { InvoiceEditor } from "./InvoiceEditor";
import { InvoiceView } from "./InvoiceView";
import { PosCounter } from "./Pos";
import { PeriodSelect, type PeriodOrAll } from "./shared";

type View = { kind: "list" } | { kind: "edit"; id: string | null } | { kind: "view"; id: string };
type Tab = "invoices" | "pos";

const STATUS_TABS: ReadonlyArray<{ value: "all" | InvoiceDisplayStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partly paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
];

export const sourceBadge = (inv: Pick<ImsInvoice, "sourceTool">) =>
  inv.sourceTool === "pos" ? (
    <Badge tag="mint">POS</Badge>
  ) : inv.sourceTool ? (
    <Badge tag="lavender" title={`Created from ${inv.sourceTool}`}>
      From Quotation
    </Badge>
  ) : null;

export function SalesModule() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("sales"));
  const [view, setView] = useState<View>(() => {
    if (intent === "new") return { kind: "edit", id: null };
    if (intent?.startsWith("open:")) return { kind: "view", id: intent.slice(5) };
    return { kind: "list" };
  });
  const [tab, setTab] = useState<Tab>(intent === "pos" ? "pos" : "invoices");

  return (
    <RequirePerm perm="sales" what="invoices & billing">
      {view.kind === "edit" ? (
        <InvoiceEditor id={view.id} onClose={(id) => setView(id ? { kind: "view", id } : { kind: "list" })} />
      ) : view.kind === "view" ? (
        <InvoiceView id={view.id} onBack={() => setView({ kind: "list" })} onEdit={(id) => setView({ kind: "edit", id })} />
      ) : (
        <Stack>
          <PageHeader title="Invoices & Billing" sub="GST tax invoices, payments and the POS counter." actions={tab === "invoices" ? <NewInvoiceButton onClick={() => setView({ kind: "edit", id: null })} /> : null} />
          <SubTabs
            label="Sales sections"
            value={tab}
            onChange={setTab}
            options={[
              { value: "invoices", label: "Invoices" },
              { value: "pos", label: "POS counter" },
            ]}
          />
          {tab === "invoices" ? <InvoiceList onOpen={(id) => setView({ kind: "view", id })} onNew={() => setView({ kind: "edit", id: null })} /> : <PosCounter onOpen={(id) => setView({ kind: "view", id })} />}
        </Stack>
      )}
    </RequirePerm>
  );
}

function NewInvoiceButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" icon="plus" onClick={onClick}>
      New invoice
    </Button>
  );
}

function InvoiceList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [status, setStatus] = useState<"all" | InvoiceDisplayStatus>("all");
  const [period, setPeriod] = useState<PeriodOrAll>("all");
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [source, setSource] = useState<"" | "pos" | "quotation">("");
  const customers = usePartyOptions("customer");
  const state = useImsData(() => finance.invoices({ period, status, q: q.trim() || undefined, customerId: customerId || undefined, source: source || undefined }), [period, status, q, customerId, source]);

  const columns: BosColumn<ImsInvoice>[] = [
    {
      key: "no",
      header: "Invoice",
      cell: (i) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{i.isDraftNo ? "Draft" : i.invoiceNo}</span>
          <small>{dateLabel(i.invoiceDate)}</small>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (i) => (
        <span className="ims-cell-stack">
          <span className="ims-row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <span className="ims-strong" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {i.customerName}
            </span>
            {sourceBadge(i)}
          </span>
          <small>{[i.customerGstin, `${i.lineCount} line${i.lineCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</small>
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      cell: (i) =>
        i.status !== "issued" ? (
          <span className="ims-faint">—</span>
        ) : i.daysOverdue > 0 ? (
          <span className="ims-cell-stack">
            <span className="ims-neg">{dateLabel(i.dueDate)}</span>
            <small>{i.daysOverdue}d overdue</small>
          </span>
        ) : (
          dateLabel(i.dueDate)
        ),
    },
    { key: "total", header: "Total", align: "right", mono: true, cell: (i) => inrExact(i.grandTotal) },
    { key: "balance", header: "Balance", align: "right", mono: true, cell: (i) => (i.balance > 0 ? <span className={i.daysOverdue > 0 ? "ims-neg" : undefined}>{inrExact(i.balance)}</span> : <span className="ims-faint">—</span>) },
    { key: "status", header: "Status", cell: (i) => <StatusBadge view={INVOICE_BADGE[i.displayStatus]} /> },
  ];

  return (
    <Loaded state={state}>
      {(data) => {
        const k = data.kpis;
        const mtdDelta = k.salesLastMonthToDate > 0 ? ((k.salesMtd - k.salesLastMonthToDate) / k.salesLastMonthToDate) * 100 : null;
        return (
          <Stack gap={16}>
            <Grid cols={4} min={150}>
              <KpiCard
                label="Sales this month"
                value={inrCompact(k.salesMtd)}
                chip={{ color: "sage", glyph: "🧾" }}
                delta={mtdDelta === null ? `${k.invoicesMtd} invoices` : `${mtdDelta >= 0 ? "▲" : "▼"} ${pct(Math.abs(mtdDelta))} vs last month`}
                deltaTone={mtdDelta === null ? "muted" : mtdDelta >= 0 ? "up" : "down"}
              />
              <KpiCard label="Outstanding" value={inrCompact(k.outstanding)} chip={{ color: "blue", glyph: "💰" }} delta="Unpaid balance on issued invoices" deltaTone="muted" />
              <KpiCard
                label="Overdue"
                value={inrCompact(k.overdue)}
                valueTone={k.overdue > 0 ? "coral" : undefined}
                chip={{ color: "rose", glyph: "⏰" }}
                delta={k.overdueCount ? `${k.overdueCount} invoice${k.overdueCount === 1 ? "" : "s"} past due` : "Nothing overdue"}
                deltaTone={k.overdueCount ? "down" : "up"}
              />
              <KpiCard label="Average invoice" value={inr(k.avgInvoice)} chip={{ color: "lavender", glyph: "≈" }} delta={`${k.periodCount} issued in view`} deltaTone="muted" />
            </Grid>

            <Card interactive={false}>
              <div className="ims-toolbar">
                <SearchInput wrapperClassName="ims-grow" placeholder="Search invoice no., customer, GSTIN, mobile…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" />
                <Select size="sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer" style={{ maxWidth: 220 }}>
                  <option value="">All customers</option>
                  {(customers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Select size="sm" value={source} onChange={(e) => setSource(e.target.value as "" | "pos" | "quotation")} aria-label="Source" style={{ maxWidth: 170 }}>
                  <option value="">All sources</option>
                  <option value="pos">POS counter</option>
                  <option value="quotation">From quotations</option>
                </Select>
                <Button
                  size="sm"
                  icon="download"
                  disabled={!data.invoices.length}
                  onClick={() =>
                    downloadCsv(`invoices-${period}`, data.invoices, [
                      { header: "Invoice no", value: (i) => (i.isDraftNo ? "DRAFT" : i.invoiceNo) },
                      { header: "Date", value: (i) => i.invoiceDate },
                      { header: "Customer", value: (i) => i.customerName },
                      { header: "GSTIN", value: (i) => i.customerGstin },
                      { header: "Place of supply", value: (i) => i.placeOfSupply },
                      { header: "Taxable", value: (i) => i.taxable },
                      { header: "CGST", value: (i) => i.cgst },
                      { header: "SGST", value: (i) => i.sgst },
                      { header: "IGST", value: (i) => i.igst },
                      { header: "Total", value: (i) => i.grandTotal },
                      { header: "Paid", value: (i) => i.amountPaid },
                      { header: "Balance", value: (i) => i.balance },
                      { header: "Due date", value: (i) => i.dueDate },
                      { header: "Status", value: (i) => INVOICE_BADGE[i.displayStatus].text },
                    ])
                  }
                >
                  Export
                </Button>
              </div>
              <div className="ims-toolbar">
                <PeriodSelect value={period} onChange={setPeriod} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <Segmented
                  size="sm"
                  scroll
                  role="tabs"
                  aria-label="Invoice status"
                  value={status}
                  onChange={setStatus}
                  options={STATUS_TABS.map((t) => ({ value: t.value, label: `${t.label} · ${data.counts[t.value] ?? 0}` }))}
                />
              </div>
              <DataTable
                caption="Invoices"
                columns={columns}
                rows={data.invoices}
                rowKey={(i) => i.id}
                onRowClick={(i) => onOpen(i.id)}
                chevron
                empty={
                  <EmptyState
                    glyph="🧾"
                    title={q || customerId || source || status !== "all" || period !== "all" ? "No invoices match these filters" : "No invoices yet"}
                    actions={
                      <Button variant="primary" icon="plus" onClick={onNew}>
                        New invoice
                      </Button>
                    }
                  >
                    Create a GST invoice, or ring up a counter sale from the POS tab.
                  </EmptyState>
                }
              />
            </Card>
          </Stack>
        );
      }}
    </Loaded>
  );
}

export default SalesModule;
