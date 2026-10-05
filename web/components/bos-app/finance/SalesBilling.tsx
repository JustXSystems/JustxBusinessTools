"use client";

import { useId, useRef, useState } from "react";
import {
  Badge,
  BlockLabel,
  BosIcon,
  Button,
  DataTable,
  Field,
  FilterChip,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  Pagination,
  SearchInput,
  Segmented,
  Select,
  Textarea,
  WidgetCard,
  WidgetRow,
  type BosColumn,
} from "@/components/bos";
import { bos, type BosItem, type ChallanReason, type SalesDoc, type SalesDocInput, type SalesDocSummary, type SalesKind, type SalesOverview } from "@/lib/bos-app/api";
import {
  addDaysISO,
  CHALLAN_REASON_LABEL,
  computeGstTotals,
  dateLabel,
  inr,
  inrCompact,
  isIntraState,
  SALES_KIND_LABEL,
  SALES_KIND_TAG,
  salesBadge,
  timeAgo,
  todayLocal,
  type GstTotals,
} from "@/lib/bos-app/format";
import { Loaded, Stack, StatusBadge, useBosAction, useBosApp, useBosData, usePrint } from "../core";
import { ConfirmDialog, FormDialog, PartyDialog, PartyField, useFormState, usePartyList } from "../dialogs";
import { InvoicePaper } from "./Invoices";
import { PosCounter, ProductsTab } from "./SalesCounter";

type Tab = "documents" | "pos" | "products";
type View = { kind: "home" } | { kind: "detail"; id: string } | { kind: "edit"; docKind: SalesKind; doc: SalesDoc | null };

const KINDS: ReadonlyArray<SalesKind> = ["quotation", "order", "challan"];
const REASONS: ReadonlyArray<ChallanReason> = ["supply", "job_work", "approval", "other"];
const QUOTE_VALID_DAYS = 15;

const PAPER: Record<SalesKind, { title: string; number: string; date: string; due: string | null }> = {
  quotation: { title: "QUOTATION", number: "Quotation Number", date: "Quotation Date", due: "Valid Until" },
  order: { title: "SALES ORDER", number: "Order Number", date: "Order Date", due: "Delivery By" },
  challan: { title: "DELIVERY CHALLAN", number: "Challan Number", date: "Challan Date", due: null },
};

const kindTag = (k: SalesKind) => <Badge tag={SALES_KIND_TAG[k].tag}>{SALES_KIND_TAG[k].text}</Badge>;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const readyToInvoice = (d: SalesDocSummary) =>
  !d.blocks.invoice && (d.stage === "accepted" || d.stage === "delivered" || d.stage === "part_delivered") && !(d.kind === "challan" && d.sourceId);

function intentView(intent: string | null): View {
  if (intent?.startsWith("open:")) return { kind: "detail", id: intent.slice(5) };
  const kind = intent?.startsWith("new:") ? (intent.slice(4) as SalesKind) : null;
  return kind && KINDS.includes(kind) ? { kind: "edit", docKind: kind, doc: null } : { kind: "home" };
}

/**
 * Finance → Sales Billing: quotations, sales orders and delivery challans that convert into GST invoices, the product
 * catalog, and (behind the `bos.sales.pos` admin switch) the POS counter.
 * Links: `open:<docId>`, `new:<quotation|order|challan>`, `pos`, `products`.
 */
export function SalesBilling() {
  const { takeIntent } = useBosApp();
  const [intent] = useState(() => takeIntent("salesbilling"));
  const [tab, setTab] = useState<Tab>(intent === "pos" || intent === "products" ? intent : "documents");
  const [view, setView] = useState<View>(() => intentView(intent));
  const home = () => setView({ kind: "home" });
  const open = (id: string) => setView({ kind: "detail", id });

  if (view.kind === "edit") {
    return <SalesEditor kind={view.docKind} doc={view.doc} onDone={(id) => (id ? open(id) : view.doc ? open(view.doc.id) : home())} />;
  }
  if (view.kind === "detail") {
    return <SalesDocView id={view.id} onBack={home} onOpen={open} onEdit={(doc) => setView({ kind: "edit", docKind: doc.kind, doc })} />;
  }
  return <SalesHome tab={tab} setTab={setTab} onOpen={open} onNew={(docKind) => setView({ kind: "edit", docKind, doc: null })} />;
}

/* ---------- Home ---------- */

function SalesHome({ tab, setTab, onOpen, onNew }: { tab: Tab; setTab: (t: Tab) => void; onOpen: (id: string) => void; onNew: (k: SalesKind) => void }) {
  const state = useBosData(() => bos.salesOverview(), []);
  return (
    <Loaded state={state}>
      {(o) => {
        const current: Tab = tab === "pos" && !o.pos.enabled ? "documents" : tab;
        return (
          <Stack>
            <Kpis o={o} />
            <ModuleToolbar>
              <Segmented<Tab>
                size="sm"
                aria-label="Sales Billing view"
                options={[
                  { value: "documents", label: "Sales Documents" },
                  ...(o.pos.enabled ? [{ value: "pos" as const, label: "POS Counter" }] : []),
                  { value: "products", label: "Products & Services" },
                ]}
                value={current}
                onChange={setTab}
              />
            </ModuleToolbar>
            {current === "documents" ? <Documents o={o} onOpen={onOpen} onNew={onNew} /> : null}
            {current === "pos" ? <PosCounter /> : null}
            {current === "products" ? <ProductsTab posEnabled={o.pos.enabled} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function Kpis({ o }: { o: SalesOverview }) {
  const t = o.totals;
  return (
    <Grid cols={4} min={140}>
      <KpiCard label="Sales orders (MTD)" value={String(t.ordersMonth.count)} chip={{ color: "blue", glyph: "🧾" }} delta={`${inrCompact(t.ordersMonth.value)} value`} deltaTone="muted" />
      <KpiCard label="Quotations open" value={String(t.quotesOpen.count)} chip={{ color: "lavender", glyph: "✎" }} delta={`${inrCompact(t.quotesOpen.value)} pipeline`} deltaTone="muted" />
      <KpiCard
        label="Delivery challans"
        value={String(t.challans.month)}
        chip={{ color: "mint", glyph: "🚚" }}
        delta={t.challans.pendingDispatch ? `${t.challans.pendingDispatch} pending dispatch` : t.challans.inTransit ? `${t.challans.inTransit} in transit` : "This month"}
        deltaTone={t.challans.pendingDispatch ? "warn" : "muted"}
      />
      {o.pos.enabled ? (
        <KpiCard label="POS billing today" value={inrCompact(o.pos.total)} chip={{ color: "amber", glyph: "₹" }} delta={plural(o.pos.count, "transaction")} deltaTone="muted" />
      ) : (
        <KpiCard
          label="Ready to invoice"
          value={String(t.toInvoice.count)}
          chip={{ color: "amber", glyph: "₹" }}
          delta={t.toInvoice.count ? `${inrCompact(t.toInvoice.value)} to bill` : "Nothing waiting"}
          deltaTone={t.toInvoice.count ? "warn" : "muted"}
        />
      )}
    </Grid>
  );
}

type DocFilter = "all" | SalesKind | "ready";

function Documents({ o, onOpen, onNew }: { o: SalesOverview; onOpen: (id: string) => void; onNew: (k: SalesKind) => void }) {
  const [filter, setFilter] = useState<DocFilter>("all");
  const [query, setQuery] = useState("");
  const tests: Record<DocFilter, (d: SalesDocSummary) => boolean> = {
    all: () => true,
    quotation: (d) => d.kind === "quotation",
    order: (d) => d.kind === "order",
    challan: (d) => d.kind === "challan",
    ready: readyToInvoice,
  };
  const q = query.trim().toLowerCase();
  const list = o.docs.filter((d) => tests[filter](d) && (!q || `${d.docNo} ${d.partyName} ${d.customerRef ?? ""} ${d.invoiceNo ?? ""}`.toLowerCase().includes(q)));
  const columns: BosColumn<SalesDocSummary>[] = [
    { key: "docNo", header: "Order #", mono: true, cell: (d) => d.docNo },
    {
      key: "party",
      header: "Customer",
      cell: (d) => (
        <span>
          {d.partyName}
          {d.sourceNo ? <span className="bos-text-faint"> · from {d.sourceNo}</span> : null}
        </span>
      ),
    },
    { key: "kind", header: "Type", cell: (d) => kindTag(d.kind) },
    { key: "date", header: "Date", mono: true, cell: (d) => dateLabel(d.docDate) },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (d) => inr(d.grandTotal) },
    { key: "status", header: "Status", cell: (d) => <StatusBadge view={salesBadge(d.stage)} /> },
  ];
  const labels: Record<DocFilter, string> = { all: "All", quotation: "Quotations", order: "Sales orders", challan: "Challans", ready: "Ready to invoice" };
  return (
    <>
      <ModuleToolbar>
        <SearchInput placeholder="Search number, customer, PO…" aria-label="Search sales documents" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="bos-spacer" />
        <Button size="sm" icon="plus" onClick={() => onNew("challan")}>
          Delivery Challan
        </Button>
        <Button size="sm" icon="plus" onClick={() => onNew("order")}>
          Sales Order
        </Button>
        <Button size="sm" variant="primary" icon="plus" onClick={() => onNew("quotation")}>
          New Quotation
        </Button>
      </ModuleToolbar>
      <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }} role="group" aria-label="Filter sales documents">
        {(Object.keys(labels) as DocFilter[]).map((f) => (
          <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {labels[f]}
            {f !== "all" ? ` · ${o.docs.filter(tests[f]).length}` : ""}
          </FilterChip>
        ))}
      </div>
      <div>
        <DataTable
          caption="Sales documents"
          columns={columns}
          rows={list}
          rowKey={(d) => d.id}
          onRowClick={(d) => onOpen(d.id)}
          chevron
          empty={o.docs.length ? "No documents match this view." : "No sales documents yet — start with a quotation, or book a sales order directly."}
        />
        <Pagination>
          Showing {list.length} of {o.docs.length}
          {o.truncated ? " · the latest 2,000 documents" : ""}
        </Pagination>
      </div>
    </>
  );
}

/* ---------- Detail ---------- */

const totalsOf = (d: SalesDoc): GstTotals => ({
  lines: d.lines,
  subtotal: d.subtotal,
  discountTotal: d.discountTotal,
  taxTotal: d.taxTotal,
  cgst: d.cgst,
  sgst: d.sgst,
  igst: d.igst,
  grandTotal: d.grandTotal,
});

function paperExtras(d: Pick<SalesDoc, "kind" | "customerRef" | "shipTo" | "challanReason" | "transporter" | "vehicleNo" | "dispatchedOn">): Array<[string, string, string?]> {
  if (d.kind === "order") return d.customerRef ? [["Customer PO", d.customerRef]] : [];
  if (d.kind !== "challan") return [];
  const transport = [d.transporter, d.vehicleNo].filter(Boolean).join(" · ");
  return [
    ["Ship To", d.shipTo || "Same as billing"],
    ["Purpose", CHALLAN_REASON_LABEL[d.challanReason ?? "supply"]],
    ...(transport || d.dispatchedOn ? [["Transport", transport || "—", d.dispatchedOn ? `Dispatched ${dateLabel(d.dispatchedOn)}` : undefined] as [string, string, string?]] : []),
  ];
}

type Pending = "decline" | "dispatch" | "deliver" | "cancel" | "delete" | null;

function SalesDocView({ id, onBack, onOpen, onEdit }: { id: string; onBack: () => void; onOpen: (id: string) => void; onEdit: (d: SalesDoc) => void }) {
  const { session, canManage, navigate } = useBosApp();
  const { run, busy } = useBosAction();
  const [pending, setPending] = useState<Pending>(null);
  const print = usePrint();
  const state = useBosData(async () => {
    const [detail, events] = await Promise.all([bos.salesDoc(id), bos.events({ entityType: "sales", entityId: id, limit: 8 })]);
    return { ...detail, events: events.events };
  }, [id]);

  return (
    <Loaded state={state} rows={2}>
      {({ doc: d, children, events }) => {
        const label = SALES_KIND_LABEL[d.kind];
        const paper = PAPER[d.kind];
        const toInvoice = async () => {
          const out = await run("invoice", () => bos.invoiceSalesDoc(d.id), { success: "Draft invoice created", description: `From ${d.docNo}` });
          if (out) navigate("finance", "invoices", `open:${out.invoice.id}`);
        };
        const make = async (key: "order" | "challan") => {
          const out = await run(key, () => (key === "order" ? bos.orderFromQuotation(d.id) : bos.challanFromOrder(d.id)), {
            success: key === "order" ? "Sales order booked" : "Delivery challan drafted",
            description: `From ${d.docNo}`,
          });
          if (out) onOpen(out.doc.id);
        };
        const live = d.stage !== "cancelled";
        const deletable = !d.blocks.delete && (d.status === "draft" || canManage);
        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ← Back to sales billing
              </button>
              <div className="bos-app-actions">
                {!d.blocks.edit ? (
                  <Button size="sm" icon="edit" onClick={() => onEdit(d)}>
                    Edit
                  </Button>
                ) : null}
                <Button size="sm" icon="printer" onClick={print}>
                  Print / PDF
                </Button>
                {d.kind === "quotation" && d.status === "draft" ? (
                  <Button size="sm" icon="check" disabled={busy !== null} onClick={() => run("send", () => bos.sendQuotation(d.id), { success: "Marked as sent", description: d.docNo })}>
                    Mark sent
                  </Button>
                ) : null}
                {d.kind === "quotation" && d.stage !== "converted" && d.status !== "accepted" ? (
                  <Button size="sm" variant="success" icon="check" disabled={busy !== null} onClick={() => run("accept", () => bos.decideQuotation(d.id, "accepted"), { success: "Quotation accepted", description: d.docNo })}>
                    Accepted
                  </Button>
                ) : null}
                {d.kind === "quotation" && !d.blocks.order ? (
                  <Button size="sm" variant="primary" icon="layers" disabled={busy !== null} onClick={() => make("order")}>
                    {busy === "order" ? "Booking…" : "Convert to sales order"}
                  </Button>
                ) : null}
                {d.kind === "order" && !d.blocks.challan ? (
                  <Button size="sm" variant="primary" icon="box" disabled={busy !== null} onClick={() => make("challan")}>
                    {busy === "challan" ? "Drafting…" : "Create delivery challan"}
                  </Button>
                ) : null}
                {d.kind === "challan" && d.status === "draft" ? (
                  <Button size="sm" variant="primary" icon="box" onClick={() => setPending("dispatch")}>
                    Dispatch
                  </Button>
                ) : null}
                {d.kind === "challan" && d.status === "dispatched" ? (
                  <Button size="sm" variant="success" icon="check" onClick={() => setPending("deliver")}>
                    Mark delivered
                  </Button>
                ) : null}
                {!d.blocks.invoice ? (
                  <Button size="sm" variant={d.kind === "quotation" ? "secondary" : "success"} icon="receipt" disabled={busy !== null} onClick={toInvoice}>
                    {busy === "invoice" ? "Creating…" : "Create invoice"}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="bos-inv-layout">
              <Stack gap={16}>
                <Grid cols={2} min={130}>
                  <KpiCard label={`${label} value`} value={inr(d.grandTotal)} chip={{ color: "blue", glyph: "₹" }} delta={`Tax ${inr(d.taxTotal)} · ${plural(d.itemCount, "line")}`} deltaTone="muted" interactive={false} />
                  <StageKpi d={d} />
                </Grid>
                <WidgetCard title="🧾 Details" dot="blue" note={<StatusBadge view={salesBadge(d.stage)} />}>
                  <WidgetRow label="Number" value={d.docNo} />
                  <WidgetRow label="Customer" value={d.partyName} />
                  <WidgetRow label="Date" value={dateLabel(d.docDate)} />
                  {d.kind === "order" && d.customerRef ? <WidgetRow label="Customer PO" value={d.customerRef} /> : null}
                  {d.decisionNote ? <WidgetRow label="Customer note" value={d.decisionNote} /> : null}
                  {d.kind === "challan" && d.receivedBy ? <WidgetRow label="Received by" value={d.receivedBy} /> : null}
                  {d.sourceId && d.sourceNo ? (
                    <WidgetRow
                      label="Made from"
                      value={
                        <button type="button" className="bos-link" onClick={() => onOpen(d.sourceId!)}>
                          {d.sourceNo}
                        </button>
                      }
                    />
                  ) : null}
                  {d.invoiceId && d.invoiceNo ? (
                    <WidgetRow
                      label="Invoice"
                      value={
                        <button type="button" className="bos-link" onClick={() => navigate("finance", "invoices", `open:${d.invoiceId}`)}>
                          {d.invoiceNo}
                        </button>
                      }
                    />
                  ) : null}
                  {d.createdBy ? <WidgetRow label="Created by" value={d.createdBy} valueTone="faint" /> : null}
                </WidgetCard>
                {d.kind !== "challan" ? (
                  <WidgetCard title="🔗 Linked documents" dot="mint" note={children.length ? String(children.length) : undefined}>
                    {children.length ? (
                      children.map((c) => (
                        <WidgetRow
                          key={c.id}
                          label={
                            <button type="button" className="bos-link" onClick={() => onOpen(c.id)}>
                              {c.docNo} · {SALES_KIND_LABEL[c.kind]}
                            </button>
                          }
                          value={<StatusBadge view={salesBadge(c.stage)} />}
                        />
                      ))
                    ) : (
                      <WidgetRow label={<span className="bos-text-faint">{d.kind === "quotation" ? "Convert to a sales order once the customer accepts." : "Ship with delivery challans — part shipments are fine."}</span>} />
                    )}
                  </WidgetCard>
                ) : null}
                {d.blocks.invoice && live && !d.invoiceNo ? <p className="bos-text-faint" style={{ fontSize: 12, margin: 0 }}>Invoicing: {d.blocks.invoice}.</p> : null}
                <WidgetCard title="🕑 Activity" dot="lavender">
                  {events.length ? (
                    events.map((e) => <WidgetRow key={e.id} label={e.summary} value={timeAgo(e.createdAt)} valueTone="faint" soft />)
                  ) : (
                    <WidgetRow label={<span className="bos-text-faint">No activity recorded</span>} />
                  )}
                </WidgetCard>
                {(live && d.kind !== "quotation" && canManage && !d.invoiceNo) || deletable || (d.kind === "quotation" && d.stage !== "converted" && d.status !== "declined") ? (
                  <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {d.kind === "quotation" && d.stage !== "converted" && d.status !== "declined" ? (
                      <Button size="sm" onClick={() => setPending("decline")}>
                        Customer declined
                      </Button>
                    ) : null}
                    {live && d.kind !== "quotation" && canManage && !d.invoiceNo ? (
                      <Button size="sm" variant="destructive" onClick={() => setPending("cancel")}>
                        Cancel {label}
                      </Button>
                    ) : null}
                    {deletable ? (
                      <Button size="sm" variant="destructive" onClick={() => setPending("delete")}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </Stack>
              <InvoicePaper
                settings={session.settings}
                doc={{
                  invoiceNo: d.docNo,
                  partyName: d.partyName,
                  partyGstin: d.partyGstin,
                  partyAddress: d.partyAddress,
                  issueDate: d.docDate,
                  dueDate: (d.kind === "quotation" ? d.validUntil : d.deliveryOn) ?? "",
                  placeOfSupply: d.placeOfSupply,
                  intraState: d.intraState,
                  totals: totalsOf(d),
                  notes: d.notes,
                  title: paper.title,
                  numberTitle: paper.number,
                  dateTitle: paper.date,
                  dueTitle: paper.due,
                  stamp: d.stage === "sent" || d.stage === "confirmed" ? null : salesBadge(d.stage),
                  extraMeta: paperExtras(d),
                }}
              />
            </div>
            {pending === "decline" ? <DeclineDialog doc={d} onClose={() => setPending(null)} /> : null}
            {pending === "dispatch" ? <DispatchDialog doc={d} onClose={() => setPending(null)} /> : null}
            {pending === "deliver" ? <DeliverDialog doc={d} onClose={() => setPending(null)} /> : null}
            <ConfirmDialog
              open={pending === "cancel" || pending === "delete"}
              onClose={() => setPending(null)}
              destructive
              title={pending === "delete" ? `Delete ${d.docNo}?` : `Cancel ${d.docNo}?`}
              description={
                pending === "delete"
                  ? "The document is removed permanently."
                  : d.kind === "order"
                    ? "The order stays on record as CANCELLED. Draft challans made from it are cancelled too."
                    : "The challan stays on record as CANCELLED and its quantities go back to the order."
              }
              confirmLabel={pending === "delete" ? "Delete" : `Cancel ${label}`}
              busy={busy === "cancel" || busy === "delete"}
              onConfirm={async () => {
                if (pending === "delete") {
                  const ok = await run("delete", () => bos.deleteSalesDoc(d.id).then(() => true), { success: "Deleted", description: d.docNo });
                  setPending(null);
                  if (ok) onBack();
                } else {
                  await run("cancel", () => bos.cancelSalesDoc(d.id), { success: `${label.charAt(0).toUpperCase()}${label.slice(1)} cancelled`, description: d.docNo, tone: "amber" });
                  setPending(null);
                }
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

function StageKpi({ d }: { d: SalesDoc }) {
  if (d.kind === "quotation") {
    const expired = d.stage === "expired";
    return (
      <KpiCard
        label="Valid until"
        value={d.validUntil ? dateLabel(d.validUntil) : "—"}
        valueTone={expired ? "coral" : undefined}
        chip={{ color: expired ? "rose" : "lavender", glyph: "⏳" }}
        delta={expired ? "Expired — extend or re-quote" : d.decidedOn ? `Decided ${dateLabel(d.decidedOn)}` : "Awaiting the customer"}
        deltaTone={expired ? "down" : "muted"}
        interactive={false}
      />
    );
  }
  if (d.kind === "order") {
    const pct = d.deliveredPct ?? 0;
    return (
      <KpiCard
        label="Delivered"
        value={`${pct}%`}
        chip={{ color: pct >= 100 ? "mint" : "amber", glyph: "🚚" }}
        delta={d.deliveryOn ? `Due ${dateLabel(d.deliveryOn)}` : d.childCount ? plural(d.childCount, "challan") : "Nothing shipped yet"}
        deltaTone={d.deliveryOn && d.deliveryOn < todayLocal() && pct < 100 ? "down" : "muted"}
        interactive={false}
      />
    );
  }
  return (
    <KpiCard
      label={d.status === "delivered" ? "Delivered" : d.status === "dispatched" ? "Dispatched" : "Dispatch"}
      value={d.deliveredOn ? dateLabel(d.deliveredOn) : d.dispatchedOn ? dateLabel(d.dispatchedOn) : "Pending"}
      chip={{ color: d.status === "delivered" ? "mint" : "amber", glyph: "🚚" }}
      delta={[d.transporter, d.vehicleNo].filter(Boolean).join(" · ") || CHALLAN_REASON_LABEL[d.challanReason ?? "supply"]}
      deltaTone="muted"
      interactive={false}
    />
  );
}

function DeclineDialog({ doc, onClose }: { doc: SalesDoc; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [note, setNote] = useState("");
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Mark ${doc.docNo} declined?`}
      description="The quotation stays on record. You can still accept it later if the customer changes their mind."
      icon={{ tone: "coral", name: "x" }}
      submitLabel="Mark declined"
      busy={busy === "decline"}
      onSubmit={async () => {
        const out = await run("decline", () => bos.decideQuotation(doc.id, "declined", note.trim() || null), { success: "Quotation declined", description: doc.docNo, tone: "amber" });
        if (out) onClose();
      }}
    >
      <Field label="Reason (optional)" full>
        {({ id }) => <Input id={id} value={note} maxLength={500} placeholder="Price, timeline, went with another vendor…" onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function DispatchDialog({ doc, onClose }: { doc: SalesDoc; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ dispatchedOn: todayLocal(), transporter: doc.transporter ?? "", vehicleNo: doc.vehicleNo ?? "" }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Dispatch ${doc.docNo}`}
      description="Goods are on their way. Mark the challan delivered once the customer receives them."
      icon={{ tone: "blue", name: "box" }}
      submitLabel="Dispatch"
      busy={busy === "dispatch"}
      onSubmit={async () => {
        const out = await run("dispatch", () => bos.dispatchChallan(doc.id, { dispatchedOn: v.dispatchedOn, transporter: v.transporter.trim() || null, vehicleNo: v.vehicleNo.trim() || null }), {
          success: "Challan dispatched",
          description: doc.docNo,
        });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Dispatched on">{({ id }) => <Input id={id} type="date" required min={doc.docDate} max={todayLocal()} value={v.dispatchedOn} onChange={(e) => f.set("dispatchedOn")(e.target.value)} />}</Field>
        <Field label="Transporter">{({ id }) => <Input id={id} value={v.transporter} maxLength={120} placeholder="Own vehicle, VRL, courier…" onChange={(e) => f.set("transporter")(e.target.value)} />}</Field>
        <Field label="Vehicle / LR number">{({ id }) => <Input id={id} value={v.vehicleNo} maxLength={30} placeholder="KA 09 AB 1234" onChange={(e) => f.set("vehicleNo")(e.target.value.toUpperCase())} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

function DeliverDialog({ doc, onClose }: { doc: SalesDoc; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ deliveredOn: todayLocal(), receivedBy: "" }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Mark ${doc.docNo} delivered`}
      icon={{ tone: "emerald", name: "check" }}
      submitLabel="Mark delivered"
      busy={busy === "deliver"}
      onSubmit={async () => {
        const out = await run("deliver", () => bos.deliverChallan(doc.id, { deliveredOn: v.deliveredOn, receivedBy: v.receivedBy.trim() || null }), { success: "Challan delivered", description: doc.docNo });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Delivered on">
          {({ id }) => <Input id={id} type="date" required min={doc.dispatchedOn ?? doc.docDate} max={todayLocal()} value={v.deliveredOn} onChange={(e) => f.set("deliveredOn")(e.target.value)} />}
        </Field>
        <Field label="Received by">{({ id }) => <Input id={id} value={v.receivedBy} maxLength={120} placeholder="Name on the signed copy" onChange={(e) => f.set("receivedBy")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Editor ---------- */

/** Raw input strings so partially typed numbers ("1.", "") survive re-renders. */
type DraftLine = { key: string; description: string; hsn: string | null; unit: string | null; quantity: string; rate: string; discountPct: number; taxRate: string };

let lineSeq = 0;
const nextKey = () => `sline-${++lineSeq}`;
const isBlank = (l: DraftLine) => !l.description.trim() && !(Number(l.rate) > 0);
const fromDraft = (l: DraftLine) => ({
  description: l.description.trim(),
  hsn: l.hsn,
  unit: l.unit,
  quantity: Number(l.quantity) || 0,
  rate: Number(l.rate) || 0,
  discountPct: l.discountPct,
  taxRate: Number(l.taxRate) || 0,
});

const SUBMIT: Record<SalesKind, { create: string; icon: "check" | "box" }> = {
  quotation: { create: "Save & mark sent", icon: "check" },
  order: { create: "Book order", icon: "check" },
  challan: { create: "Save challan", icon: "box" },
};

function SalesEditor({ kind, doc, onDone }: { kind: SalesKind; doc: SalesDoc | null; onDone: (id: string | null) => void }) {
  const { session } = useBosApp();
  const settings = session.settings;
  const { run, busy } = useBosAction();
  const customers = usePartyList("customer", true);
  const catalog = useBosData(() => bos.salesItems(), []);
  const items = (catalog.data?.items ?? []).filter((i) => i.active);
  const formRef = useRef<HTMLFormElement>(null);
  const listId = useId();
  const blankLine = (): DraftLine => ({ key: nextKey(), description: "", hsn: null, unit: null, quantity: "1", rate: "", discountPct: 0, taxRate: String(settings.defaultTaxRate) });
  const [form, setForm] = useState(() => {
    const today = todayLocal();
    return {
      partyId: doc?.partyId ?? "",
      partyName: doc?.partyName ?? "",
      partyGstin: doc?.partyGstin ?? "",
      partyAddress: doc?.partyAddress ?? "",
      placeOfSupply: doc?.placeOfSupply ?? settings.state ?? "",
      docDate: doc?.docDate ?? today,
      validUntil: doc?.validUntil ?? addDaysISO(today, QUOTE_VALID_DAYS),
      deliveryOn: doc?.deliveryOn ?? "",
      customerRef: doc?.customerRef ?? "",
      shipTo: doc?.shipTo ?? "",
      challanReason: (doc?.challanReason ?? "supply") as ChallanReason,
      transporter: doc?.transporter ?? "",
      vehicleNo: doc?.vehicleNo ?? "",
      notes: doc?.notes ?? "",
    };
  });
  const [lines, setLines] = useState<DraftLine[]>(() =>
    doc?.lines.length
      ? doc.lines.map((l) => ({ key: nextKey(), description: l.description, hsn: l.hsn ?? null, unit: l.unit ?? null, quantity: String(l.quantity), rate: String(l.rate), discountPct: l.discountPct ?? 0, taxRate: String(l.taxRate) }))
      : [blankLine()],
  );
  const [newParty, setNewParty] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const setLine = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const describe = (key: string, value: string) => {
    const hit = items.find((i: BosItem) => i.name.toLowerCase() === value.trim().toLowerCase());
    setLine(key, hit ? { description: hit.name, hsn: hit.hsn, unit: hit.unit, rate: String(hit.rate), taxRate: String(hit.taxRate) } : { description: value });
  };
  const intra = isIntraState(settings.state, form.placeOfSupply);
  const totals = computeGstTotals(lines.map(fromDraft), intra);
  const print = usePrint();
  const paper = PAPER[kind];
  const label = SALES_KIND_LABEL[kind];

  const save = async (send: boolean) => {
    if (!formRef.current?.reportValidity()) return;
    const filled = lines.filter((l) => !isBlank(l));
    const body: SalesDocInput = {
      partyId: form.partyId || null,
      partyName: form.partyName.trim(),
      partyGstin: form.partyGstin.trim() || null,
      partyAddress: form.partyAddress.trim() || null,
      placeOfSupply: form.placeOfSupply.trim() || null,
      docDate: form.docDate,
      validUntil: kind === "quotation" ? form.validUntil || null : null,
      deliveryOn: kind === "order" ? form.deliveryOn || null : null,
      customerRef: kind === "order" ? form.customerRef.trim() || null : null,
      lines: filled.map(fromDraft),
      notes: form.notes.trim() || null,
      ...(kind === "challan" ? { shipTo: form.shipTo.trim() || null, challanReason: form.challanReason, transporter: form.transporter.trim() || null, vehicleNo: form.vehicleNo.trim() || null } : {}),
    };
    const out = await run(send ? "send" : "save", () => (doc ? bos.updateSalesDoc(doc.id, body) : bos.createSalesDoc({ ...body, kind, send })), {
      success: doc ? `${label} saved` : kind === "order" ? "Sales order booked" : send ? "Quotation sent" : `${label} saved`,
      description: body.partyName,
    });
    if (out) onDone(out.doc.id);
  };

  return (
    <>
      <div className="bos-app-recordbar">
        <button type="button" className="bos-back-link" onClick={() => onDone(doc?.id ?? null)}>
          ← {doc ? `Back to ${doc.docNo}` : "Back to sales billing"}
        </button>
        <div className="bos-app-actions">
          <Button size="sm" icon="printer" onClick={print}>
            Preview print
          </Button>
        </div>
      </div>
      <div className="bos-inv-layout">
        <form ref={formRef} className="bos-inv-form" onSubmit={(e) => e.preventDefault()} aria-label={doc ? `Edit ${doc.docNo}` : `New ${label.toLowerCase()}`}>
          <FormGrid>
            <PartyField
              label={kind === "challan" ? "Consignee" : "Customer"}
              parties={customers}
              required
              placeholder="Customer name"
              value={form.partyName}
              onChange={(name, p) =>
                setForm((f) => ({
                  ...f,
                  partyName: name,
                  partyId: p?.id ?? "",
                  ...(p ? { partyGstin: p.gstin ?? "", partyAddress: [p.address, p.city].filter(Boolean).join(", "), placeOfSupply: p.state || f.placeOfSupply } : {}),
                }))
              }
            />
            <Field label="Customer GSTIN">{({ id }) => <Input id={id} value={form.partyGstin} placeholder="Unregistered" onChange={(e) => set("partyGstin")(e.target.value.toUpperCase())} />}</Field>
            <Field label="Billing address" full>
              {({ id }) => <Input id={id} value={form.partyAddress} onChange={(e) => set("partyAddress")(e.target.value)} />}
            </Field>
            <Field label="Place of supply" hint={intra ? "Same state — CGST + SGST" : "Other state — IGST"}>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={form.placeOfSupply} placeholder={settings.state ?? "State"} onChange={(e) => set("placeOfSupply")(e.target.value)} />}
            </Field>
            <Field label={paper.number}>{({ id }) => <Input id={id} value={doc?.docNo ?? "Assigned on save"} readOnly disabled />}</Field>
            <Field label={paper.date}>{({ id }) => <Input id={id} type="date" required value={form.docDate} onChange={(e) => set("docDate")(e.target.value)} />}</Field>
            {kind === "quotation" ? (
              <Field label="Valid until">{({ id }) => <Input id={id} type="date" required min={form.docDate} value={form.validUntil} onChange={(e) => set("validUntil")(e.target.value)} />}</Field>
            ) : null}
            {kind === "order" ? (
              <>
                <Field label="Delivery by">{({ id }) => <Input id={id} type="date" min={form.docDate} value={form.deliveryOn} onChange={(e) => set("deliveryOn")(e.target.value)} />}</Field>
                <Field label="Customer PO number">{({ id }) => <Input id={id} value={form.customerRef} maxLength={80} placeholder="Optional" onChange={(e) => set("customerRef")(e.target.value)} />}</Field>
              </>
            ) : null}
            {kind === "challan" ? (
              <>
                <Field label="Purpose">
                  {({ id }) => (
                    <Select id={id} value={form.challanReason} onChange={(e) => set("challanReason")(e.target.value)}>
                      {REASONS.map((r) => (
                        <option key={r} value={r}>
                          {CHALLAN_REASON_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Ship to" full hint="Leave blank to deliver to the billing address">
                  {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={form.shipTo} maxLength={500} onChange={(e) => set("shipTo")(e.target.value)} />}
                </Field>
                <Field label="Transporter">{({ id }) => <Input id={id} value={form.transporter} maxLength={120} placeholder="Own vehicle, VRL, courier…" onChange={(e) => set("transporter")(e.target.value)} />}</Field>
                <Field label="Vehicle / LR number">{({ id }) => <Input id={id} value={form.vehicleNo} maxLength={30} onChange={(e) => set("vehicleNo")(e.target.value.toUpperCase())} />}</Field>
              </>
            ) : null}
          </FormGrid>
          {!form.partyId && form.partyName.trim() ? (
            <div className="bos-row" style={{ marginTop: 10, gap: 8 }}>
              <span className="bos-text-faint" style={{ fontSize: 12 }}>
                New customer?
              </span>
              <Button size="sm" variant="ghost" icon="plus" onClick={() => setNewParty(true)}>
                Save to customers
              </Button>
            </div>
          ) : null}

          <div style={{ marginTop: 22 }}>
            <BlockLabel>Line Items</BlockLabel>
          </div>
          {items.length ? (
            <p className="bos-text-faint" style={{ fontSize: 12, margin: "0 0 8px" }}>
              Start typing a product name to fill its HSN, rate and GST from the catalog.
            </p>
          ) : null}
          <datalist id={listId}>
            {items.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
          <div className="bos-app-line-head" aria-hidden="true">
            <span>Description</span>
            <span>Qty</span>
            <span>Rate (₹)</span>
            <span>GST %</span>
            <span style={{ textAlign: "right" }}>Amount</span>
            <span />
          </div>
          <div role="list" aria-label="Line items">
            {lines.map((l, i) => (
              <div key={l.key} className="bos-app-line" role="listitem">
                <Input size="sm" list={listId} aria-label={`Item ${i + 1} description`} placeholder="Item description" value={l.description} onChange={(e) => describe(l.key, e.target.value)} />
                <Input size="sm" aria-label={`Item ${i + 1} quantity`} placeholder="Qty" type="number" inputMode="decimal" min={0} step="any" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                <Input size="sm" aria-label={`Item ${i + 1} rate`} placeholder="Rate (₹)" type="number" inputMode="decimal" min={0} step="any" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} />
                <Input size="sm" aria-label={`Item ${i + 1} GST rate`} placeholder="GST %" type="number" inputMode="decimal" min={0} max={100} step="any" value={l.taxRate} onChange={(e) => setLine(l.key, { taxRate: e.target.value })} />
                <div className="bos-app-line-amount">
                  {inr(totals.lines[i]?.amount ?? 0)}
                  {l.unit ? <small>per {l.unit}</small> : null}
                </div>
                <button type="button" className="bos-inv-remove" aria-label={`Remove item ${i + 1}`} title="Remove item" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <BosIcon name="x" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blankLine()])} style={{ marginTop: 4 }}>
            Add item
          </Button>

          <div style={{ marginTop: 20 }}>
            <Field label={kind === "quotation" ? "Terms & notes" : "Notes"}>
              {({ id }) => <Textarea id={id} rows={3} value={form.notes} placeholder={kind === "quotation" ? "Payment terms, warranty, delivery timeline…" : "Anything the customer should know"} onChange={(e) => set("notes")(e.target.value)} />}
            </Field>
          </div>

          <div className="bos-row" style={{ justifyContent: "flex-end", marginTop: 20, gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" onClick={() => onDone(doc?.id ?? null)}>
              Cancel
            </Button>
            {!doc && kind === "quotation" ? (
              <Button size="sm" icon="file" disabled={busy !== null} onClick={() => save(false)}>
                {busy === "save" ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
            <Button size="sm" variant="primary" icon={SUBMIT[kind].icon} disabled={busy !== null} onClick={() => save(!doc && kind === "quotation")}>
              {busy !== null ? "Saving…" : doc ? "Save changes" : SUBMIT[kind].create}
            </Button>
          </div>
        </form>

        <InvoicePaper
          settings={settings}
          doc={{
            invoiceNo: doc?.docNo ?? `${kind === "quotation" ? "QT" : kind === "order" ? "SO" : "DC"}/…`,
            partyName: form.partyName,
            partyGstin: form.partyGstin || null,
            partyAddress: form.partyAddress || null,
            issueDate: form.docDate,
            dueDate: kind === "quotation" ? form.validUntil : form.deliveryOn,
            placeOfSupply: form.placeOfSupply || null,
            intraState: intra,
            totals,
            notes: form.notes || null,
            title: paper.title,
            numberTitle: paper.number,
            dateTitle: paper.date,
            dueTitle: paper.due,
            stamp: doc ? null : salesBadge("draft"),
            extraMeta: paperExtras({ kind, customerRef: form.customerRef || null, shipTo: form.shipTo || null, challanReason: form.challanReason, transporter: form.transporter || null, vehicleNo: form.vehicleNo || null, dispatchedOn: null }),
          }}
        />
      </div>
      <PartyDialog
        open={newParty}
        onClose={() => setNewParty(false)}
        party={null}
        defaultKind="customer"
        onSaved={(p) => setForm((f) => ({ ...f, partyId: p.id, partyName: p.name, partyGstin: p.gstin ?? f.partyGstin, placeOfSupply: p.state || f.placeOfSupply }))}
      />
    </>
  );
}
