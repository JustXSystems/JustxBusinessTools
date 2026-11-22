"use client";

import "../purchase/purchase.css";
import { useState } from "react";
import { Alert, Badge, Button, Card, DataTable, Field, FormGrid, Input, ProgressBar, Switch, Textarea, type BosColumn } from "@/components/bos";
import { dateLabel, inr, num, qtyText } from "@/lib/ims/format";
import { SO_BILLABLE_STATUSES, SO_OPEN_STATUSES, SO_WIZARD_STEPS, salesOrders, type SoDc, type SoDetail, type SoLineProgress, type SoQtyPick, type SoWizardStep } from "@/lib/ims/sales-orders";
import { useIms, useImsAction } from "../core";
import { ConfirmDialog } from "../purchase/ui";

type Pending = { kind: "approve" | "cancel"; dc: SoDc } | null;

const DC_TONE = { draft: "neutral", approved: "emerald", cancelled: "neutral" } as const;

/** Quantity inputs for lines that still have something left; returns picks > 0. */
function QtyTable({ detail, qty, onChange, unitLabel }: { detail: SoDetail; qty: Record<number, string>; onChange: (q: Record<number, string>) => void; unitLabel: string }) {
  const rows = detail.progress.filter((p) => p.remaining > 0);
  const columns: BosColumn<SoLineProgress>[] = [
    { key: "n", header: "#", cell: (p) => p.lineIndex + 1 },
    { key: "item", header: "Item", cell: (p) => detail.order.lines[p.lineIndex]?.name ?? "—" },
    { key: "left", header: "Remaining", align: "right", cell: (p) => <span className="ims-num">{qtyText(p.remaining, detail.order.lines[p.lineIndex]?.unit)}</span> },
    {
      key: "qty",
      header: unitLabel,
      align: "right",
      cell: (p) => (
        <Input
          type="number"
          min={0}
          max={p.remaining}
          step="any"
          inputMode="decimal"
          aria-label={`${unitLabel} for line ${p.lineIndex + 1}`}
          style={{ width: 96, textAlign: "right" }}
          value={qty[p.lineIndex] ?? ""}
          onChange={(e) => onChange({ ...qty, [p.lineIndex]: e.target.value })}
        />
      ),
    },
  ];
  return <DataTable caption={unitLabel} columns={columns} rows={rows} rowKey={(p) => String(p.lineIndex)} empty="Nothing left on this order." />;
}

const defaultQty = (detail: SoDetail): Record<number, string> => Object.fromEntries(detail.progress.filter((p) => p.remaining > 0).map((p) => [p.lineIndex, String(p.remaining)]));

function picksOf(qty: Record<number, string>, detail: SoDetail): SoQtyPick[] {
  return detail.progress.filter((p) => p.remaining > 0 && num(qty[p.lineIndex]) > 0).map((p) => ({ lineIndex: p.lineIndex, qty: Math.min(p.remaining, num(qty[p.lineIndex])) }));
}

const signature = (d: SoDetail) => JSON.stringify([d.order.updatedAt, d.progress.map((p) => p.remaining), d.dcs.map((x) => [x.id, x.status, x.invoiceId])]);

/**
 * Order → Delivery → Invoice wizard for a confirmed sales order.
 * Every unit goes either on a delivery challan (stock out on approve, billed by linking the challan)
 * or straight onto a direct invoice (stock out when that invoice is issued) — never both.
 */
export function SoWizard({ detail, initialStep, onChanged, onOpenInvoice }: { detail: SoDetail; initialStep?: SoWizardStep; onChanged: (d: SoDetail) => void; onOpenInvoice: (invoiceId: string) => void }) {
  const [step, setStep] = useState<SoWizardStep>(initialStep ?? "order");
  const o = detail.order;
  const canDeliver = SO_OPEN_STATUSES.has(o.status);
  const stepIndex = SO_WIZARD_STEPS.findIndex((s) => s.key === step);
  const done: Record<SoWizardStep, boolean> = {
    order: true,
    delivery: detail.summary.deliveredQty > 0,
    invoice: detail.invoices.some((i) => i.status !== "cancelled"),
  };

  return (
    <Card interactive={false}>
      <div className="ims-between" style={{ marginBottom: 12 }}>
        <span className="ims-strong">Fulfil this order</span>
        <span className="ims-faint">
          {qtyText(detail.summary.deliveredQty)} of {qtyText(detail.summary.orderedQty)} units delivered or billed
        </span>
      </div>
      <ProgressBar value={detail.summary.deliveredPct} tone={detail.summary.deliveredPct >= 100 ? "emerald" : "blue"} label={`${detail.summary.deliveredPct}% fulfilled`} />
      <div className="ims-tabs-scroll" role="group" aria-label="Wizard steps" style={{ margin: "14px 0" }}>
        {SO_WIZARD_STEPS.map((s, i) => (
          <Button key={s.key} size="sm" variant={s.key === step ? "primary" : "secondary"} aria-current={s.key === step ? "step" : undefined} onClick={() => setStep(s.key)}>
            {i + 1}. {s.label}
            {done[s.key] && s.key !== step ? " ✓" : ""}
          </Button>
        ))}
      </div>

      {step === "order" ? <OrderStep detail={detail} /> : null}
      {step === "delivery" ? <DeliveryStep key={signature(detail)} detail={detail} canDeliver={canDeliver} onChanged={onChanged} /> : null}
      {step === "invoice" ? <InvoiceStep key={signature(detail)} detail={detail} onChanged={onChanged} onOpenInvoice={onOpenInvoice} /> : null}

      <div className="ims-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
        <Button size="sm" variant="ghost" disabled={stepIndex <= 0} onClick={() => setStep(SO_WIZARD_STEPS[Math.max(0, stepIndex - 1)].key)}>
          Back
        </Button>
        <Button size="sm" disabled={stepIndex >= SO_WIZARD_STEPS.length - 1} onClick={() => setStep(SO_WIZARD_STEPS[Math.min(SO_WIZARD_STEPS.length - 1, stepIndex + 1)].key)}>
          Next
        </Button>
      </div>
    </Card>
  );
}

/* ---------- Step 1 · Order ---------- */

function OrderStep({ detail }: { detail: SoDetail }) {
  const o = detail.order;
  const columns: BosColumn<SoLineProgress>[] = [
    { key: "n", header: "#", cell: (p) => p.lineIndex + 1 },
    { key: "item", header: "Item", cell: (p) => o.lines[p.lineIndex]?.name ?? "—" },
    { key: "ordered", header: "Ordered", align: "right", cell: (p) => qtyText(p.ordered, o.lines[p.lineIndex]?.unit) },
    { key: "delivered", header: "Delivered", align: "right", cell: (p) => qtyText(p.delivered) },
    { key: "reserved", header: "On draft DC", align: "right", cell: (p) => (p.reserved ? qtyText(p.reserved) : "—") },
    { key: "billed", header: "Billed direct", align: "right", cell: (p) => (p.invoicedDirect ? qtyText(p.invoicedDirect) : "—") },
    { key: "remaining", header: "Remaining", align: "right", cell: (p) => <span className="ims-num ims-strong">{qtyText(p.remaining)}</span> },
  ];
  return (
    <div className="bos-stack" style={{ gap: 10 }}>
      <DataTable caption="Order lines and remaining quantity" columns={columns} rows={detail.progress} rowKey={(p) => String(p.lineIndex)} empty="No lines." />
      <p className="ims-faint">
        {detail.summary.remainingQty > 0
          ? `${qtyText(detail.summary.remainingQty)} units can still go on a delivery challan or a direct invoice.`
          : detail.summary.deliveredUnbilledQty > 0
            ? `Everything is on a challan — ${qtyText(detail.summary.deliveredUnbilledQty)} delivered units are waiting to be billed.`
            : "Nothing left to deliver."}
      </p>
    </div>
  );
}

/* ---------- Step 2 · Delivery ---------- */

function DeliveryStep({ detail, canDeliver, onChanged }: { detail: SoDetail; canDeliver: boolean; onChanged: (d: SoDetail) => void }) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const o = detail.order;
  const [qty, setQty] = useState<Record<number, string>>(() => defaultQty(detail));
  const [shipTo, setShipTo] = useState(o.shipToAddress ?? o.billToAddress ?? "");
  const [transporter, setTransporter] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [notes, setNotes] = useState("");
  const [docDate, setDocDate] = useState(session.today);
  const [pending, setPending] = useState<Pending>(null);
  const picks = picksOf(qty, detail);
  const hasRemaining = detail.progress.some((p) => p.remaining > 0);

  const columns: BosColumn<SoDc>[] = [
    {
      key: "dc",
      header: "Challan",
      cell: (d) => (
        <span className="ims-cell-stack">
          <span className="ims-strong ims-mono">{d.docNo}</span>
          <small>{dateLabel(d.docDate)}</small>
        </span>
      ),
    },
    {
      key: "lines",
      header: "Items",
      cell: (d) => (
        <span className="ims-cell-stack">
          {d.lines.slice(0, 3).map((l) => (
            <small key={l.lineIndex}>
              {l.name} × {qtyText(l.qty, l.unit)}
            </small>
          ))}
          {d.lines.length > 3 ? <small>+{d.lines.length - 3} more</small> : null}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (d) => (
        <Badge tone={DC_TONE[d.status] ?? "neutral"} auto>
          {d.status === "approved" ? (d.invoiceId ? "BILLED" : "DELIVERED") : d.status.toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: <span className="bos-sr-only">Actions</span>,
      align: "right",
      cell: (d) =>
        d.status === "draft" ? (
          <span className="ims-row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
            <Button size="sm" variant="primary" disabled={Boolean(busy)} onClick={() => setPending({ kind: "approve", dc: d })}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setPending({ kind: "cancel", dc: d })}>
              Cancel
            </Button>
          </span>
        ) : null,
    },
  ];

  const create = async () => {
    const out = await run("so-dc-create", () => salesOrders.createDc(o.id, { lines: picks, shipTo: shipTo.trim() || null, transporter: transporter.trim() || null, vehicleNo: vehicleNo.trim() || null, notes: notes.trim() || null, docDate }), {
      success: "Challan drafted",
      description: "Approve it to take the stock out",
    });
    if (out) onChanged(out);
  };

  return (
    <div className="bos-stack" style={{ gap: 14 }}>
      {detail.dcs.length ? <DataTable caption="Delivery challans" columns={columns} rows={detail.dcs} rowKey={(d) => d.id} empty="No challans yet." /> : <p className="ims-faint">No delivery challans yet.</p>}

      {canDeliver && hasRemaining ? (
        <div className="bos-stack" style={{ gap: 10 }}>
          <span className="ims-strong">New challan</span>
          <QtyTable detail={detail} qty={qty} onChange={setQty} unitLabel="Deliver now" />
          <FormGrid>
            <Field label="Challan date">
              {({ id }) => <Input id={id} type="date" max={session.today} value={docDate} onChange={(e) => setDocDate(e.target.value || session.today)} />}
            </Field>
            <Field label="Transporter">
              {({ id }) => <Input id={id} value={transporter} maxLength={200} onChange={(e) => setTransporter(e.target.value)} />}
            </Field>
            <Field label="Vehicle no.">
              {({ id }) => <Input id={id} value={vehicleNo} maxLength={40} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} />}
            </Field>
            <Field label="Ship to" full>
              {({ id }) => <Textarea id={id} rows={2} value={shipTo} maxLength={500} onChange={(e) => setShipTo(e.target.value)} />}
            </Field>
            <Field label="Notes" full>
              {({ id }) => <Input id={id} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </FormGrid>
          <div>
            <Button variant="primary" icon="plus" disabled={Boolean(busy) || picks.length === 0} onClick={create}>
              {busy === "so-dc-create" ? "Creating…" : `Create challan (${picks.length} line${picks.length === 1 ? "" : "s"})`}
            </Button>
          </div>
        </div>
      ) : canDeliver ? (
        <Alert tone="blue" title="Everything is allocated">
          All ordered units are on a challan or a direct invoice. Approve the draft challans above to ship them.
        </Alert>
      ) : (
        <Alert tone="blue" title="Delivery is closed">
          This order is {o.status}. Challans can only be added while it is confirmed or partially delivered.
        </Alert>
      )}

      <ConfirmDialog
        open={pending?.kind === "approve"}
        onClose={() => setPending(null)}
        title={pending ? `Approve ${pending.dc.docNo}?` : "Approve"}
        description="Stock goes out now for every item-linked line. Approved challans can't be edited."
        confirmLabel="Approve & post stock"
        busy={busy === "so-dc-approve"}
        onConfirm={async () => {
          if (!pending) return;
          const dc = pending.dc;
          const out = await run("so-dc-approve", () => salesOrders.approveDc(dc.id), { success: "Challan approved — stock out", description: dc.docNo });
          setPending(null);
          if (out) onChanged(out);
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "cancel"}
        onClose={() => setPending(null)}
        title={pending ? `Cancel ${pending.dc.docNo}?` : "Cancel"}
        description="The quantities go back to the order's remaining."
        confirmLabel="Cancel challan"
        destructive
        busy={busy === "so-dc-cancel"}
        onConfirm={async () => {
          if (!pending) return;
          const dc = pending.dc;
          const out = await run("so-dc-cancel", () => salesOrders.cancelDc(dc.id), { success: "Challan cancelled", description: dc.docNo, tone: "amber" });
          setPending(null);
          if (out) onChanged(out);
        }}
      />
    </div>
  );
}

/* ---------- Step 3 · Invoice ---------- */

function InvoiceStep({ detail, onChanged, onOpenInvoice }: { detail: SoDetail; onChanged: (d: SoDetail) => void; onOpenInvoice: (invoiceId: string) => void }) {
  const { run, busy } = useImsAction();
  const o = detail.order;
  const billable = SO_BILLABLE_STATUSES.has(o.status);
  const unbilled = detail.dcs.filter((d) => d.status === "approved" && !d.invoiceId);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(unbilled.map((d) => d.id)));
  const [qty, setQty] = useState<Record<number, string>>(() => defaultQty(detail));
  const [issue, setIssue] = useState(false);
  const picks = picksOf(qty, detail);
  const hasRemaining = detail.progress.some((p) => p.remaining > 0);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async (body: { dcIds?: string[]; lines?: SoQtyPick[] }) => {
    const out = await run("so-invoice", () => salesOrders.invoice(o.id, { ...body, issue }), { success: issue ? "Invoice issued" : "Draft invoice created" });
    if (out) {
      onChanged(out);
      onOpenInvoice(out.invoice.id);
    }
  };

  if (!billable) {
    return (
      <Alert tone="blue" title="Not ready to invoice">
        {o.status === "draft" ? "Confirm the order first." : `A ${o.status} order can't be invoiced.`}
      </Alert>
    );
  }

  return (
    <div className="bos-stack" style={{ gap: 16 }}>
      <label className="ims-force-related" style={{ alignSelf: "flex-start" }}>
        <Switch checked={issue} onChange={setIssue} aria-label="Issue the invoice immediately" />
        <span>{issue ? "Issue immediately (numbered, posts to receivables)" : "Save as draft to review first"}</span>
      </label>

      <div className="bos-stack" style={{ gap: 8 }}>
        <span className="ims-strong">From delivered challans</span>
        {unbilled.length ? (
          <>
            <div className="ims-list">
              {unbilled.map((d) => (
                <label key={d.id} className="ims-list-row" style={{ cursor: "pointer" }}>
                  <span className="ims-row" style={{ gap: 10 }}>
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Bill ${d.docNo}`} />
                    <span className="ims-cell-stack">
                      <span className="ims-strong ims-mono">{d.docNo}</span>
                      <small>
                        {dateLabel(d.docDate)} · {d.lines.map((l) => `${l.name} × ${qtyText(l.qty)}`).join(", ")}
                      </small>
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div>
              <Button variant="primary" icon="file" disabled={Boolean(busy) || selected.size === 0} onClick={() => create({ dcIds: [...selected] })}>
                {busy === "so-invoice" ? "Creating…" : `Invoice ${selected.size} challan${selected.size === 1 ? "" : "s"}`}
              </Button>
            </div>
            <p className="ims-faint">Stock already left on the challans, so the invoice won&apos;t take it out again.</p>
          </>
        ) : (
          <p className="ims-faint">No approved, unbilled challans. Approve a challan in step 2 to bill it here.</p>
        )}
      </div>

      <div className="bos-stack" style={{ gap: 8 }}>
        <span className="ims-strong">From remaining (no challan)</span>
        {hasRemaining ? (
          <>
            <QtyTable detail={detail} qty={qty} onChange={setQty} unitLabel="Invoice now" />
            <div>
              <Button icon="file" disabled={Boolean(busy) || picks.length === 0} onClick={() => create({ lines: picks })}>
                {busy === "so-invoice" ? "Creating…" : `Invoice remaining (${picks.length} line${picks.length === 1 ? "" : "s"})`}
              </Button>
            </div>
            <p className="ims-faint">A direct invoice takes stock out itself when it is issued. Those units can&apos;t also go on a challan.</p>
          </>
        ) : (
          <p className="ims-faint">Nothing left outside challans or invoices.</p>
        )}
      </div>

      {detail.invoices.length ? (
        <div className="bos-stack" style={{ gap: 8 }}>
          <span className="ims-strong">Invoices from this order</span>
          <div className="ims-list">
            {detail.invoices.map((i) => (
              <button key={i.id} type="button" className="ims-list-row" onClick={() => onOpenInvoice(i.id)}>
                <span className="ims-cell-stack">
                  <span className="ims-strong">{i.invoiceNo}</span>
                  <small>
                    {dateLabel(i.invoiceDate)} · {i.status.replace(/_/g, " ")}
                    {i.dcIds.length ? ` · ${i.dcIds.length} challan${i.dcIds.length === 1 ? "" : "s"}` : " · direct"}
                  </small>
                </span>
                <span className="ims-num">{inr(i.grandTotal)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
