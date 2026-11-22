"use client";

import "../purchase/purchase.css";
import { useState } from "react";
import { Alert, Button, Card, WidgetCard } from "@/components/bos";
import type { ImsTotals } from "@/lib/ims/format";
import { dateLabel, inr, inrExact, qtyText } from "@/lib/ims/format";
import { SO_BILLABLE_STATUSES, SO_OPEN_STATUSES, SO_STAMP, SO_STATUS_LABEL, salesOrders, soBadge, type SalesOrder, type SoDetail, type SoWizardStep } from "@/lib/ims/sales-orders";
import { Loaded, PageHeader, StatusBadge, useIms, useImsAction, useImsData, usePrint } from "../core";
import { ConfirmDialog, KeyValues, ReasonDialog, Timeline } from "../purchase/ui";
import { DocumentPaper } from "../shared/DocumentPaper";
import { sellerOf } from "./shared";
import { SoWizard } from "./SoWizard";

export const soTotalsOf = (o: SalesOrder): ImsTotals => ({
  lines: o.lines,
  subtotal: o.subtotal,
  discountTotal: o.discountTotal,
  taxable: o.taxable,
  taxTotal: o.taxTotal,
  cgst: o.cgst,
  sgst: o.sgst,
  igst: o.igst,
  roundOff: 0,
  grandTotal: o.grandTotal,
});

export function SoPaper({ order }: { order: SalesOrder }) {
  const { session } = useIms();
  return (
    <DocumentPaper
      title="SALES ORDER"
      seller={sellerOf(session)}
      party={{ label: "Customer", name: order.customerName, gstin: order.customerGstin, address: order.billToAddress, phone: order.customerMobile, email: order.customerEmail }}
      shipTo={order.shipToAddress ? { label: "Ship to", name: order.customerName, address: order.shipToAddress } : null}
      meta={[
        { label: "Order no.", value: order.soNo },
        { label: "Order date", value: dateLabel(order.orderDate) },
        { label: "Delivery by", value: order.deliveryDate ? dateLabel(order.deliveryDate) : "—" },
        { label: "Customer PO", value: order.customerPoRef || "—" },
        { label: "Supply", value: order.intraState ? "Intra-state (CGST + SGST)" : "Inter-state (IGST)" },
        { label: "Status", value: SO_STATUS_LABEL[order.status] },
      ]}
      totals={soTotalsOf(order)}
      intraState={order.intraState}
      notes={order.notes}
      terms={order.terms}
      stamp={SO_STAMP[order.status] ?? null}
    />
  );
}

type Pending = null | "cancel" | "delete" | "confirm";

export function SoDocument({ id, initialStep, onBack, onEdit }: { id: string; initialStep?: SoWizardStep | null; onBack: () => void; onEdit: (o: SalesOrder) => void }) {
  const state = useImsData(() => salesOrders.detail(id), [id]);
  return (
    <div>
      <Loaded state={state} rows={3}>
        {(d) => <DocView d={d} initialStep={initialStep ?? null} onBack={onBack} onEdit={onEdit} />}
      </Loaded>
    </div>
  );
}

function DocView({ d, initialStep, onBack, onEdit }: { d: SoDetail; initialStep: SoWizardStep | null; onBack: () => void; onEdit: (o: SalesOrder) => void }) {
  const { can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const print = usePrint();
  const o = d.order;
  const canSales = can("sales");
  const [pending, setPending] = useState<Pending>(null);
  const [step, setStep] = useState<SoWizardStep | null>(initialStep);
  const openWizard = (s: SoWizardStep) => {
    setStep(s);
    document.getElementById("so-wizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const inWizard = SO_BILLABLE_STATUSES.has(o.status);
  const canDeliver = SO_OPEN_STATUSES.has(o.status) && d.summary.remainingQty > 0;
  const canInvoice = inWizard && (d.summary.deliveredUnbilledQty > 0 || d.summary.remainingQty > 0);
  const cancellable = (o.status === "draft" || o.status === "confirmed") && !d.dcs.some((x) => x.status === "approved") && !d.invoices.some((i) => i.status !== "cancelled");

  return (
    <div>
      <PageHeader
        title={
          <span className="ims-row" style={{ gap: 10 }}>
            {o.soNo}
            <StatusBadge view={soBadge(o.status)} />
          </span>
        }
        sub={`${o.customerName} · ${dateLabel(o.orderDate)} · ${inrExact(o.grandTotal)}${o.createdByName ? ` · by ${o.createdByName}` : ""}`}
        actions={
          <>
            <Button size="sm" icon="chevronLeft" onClick={onBack}>
              All orders
            </Button>
            <Button size="sm" icon="printer" onClick={print}>
              Print / PDF
            </Button>
            {canSales && o.status === "draft" ? (
              <>
                <Button size="sm" icon="edit" onClick={() => onEdit(o)}>
                  Edit
                </Button>
                <Button variant="primary" size="sm" icon="check" onClick={() => setPending("confirm")}>
                  Confirm
                </Button>
              </>
            ) : null}
            {canSales && canDeliver ? (
              <Button size="sm" icon="box" onClick={() => openWizard("delivery")}>
                Create DC
              </Button>
            ) : null}
            {canSales && canInvoice ? (
              <Button size="sm" variant="primary" icon="file" onClick={() => openWizard("invoice")}>
                Create invoice
              </Button>
            ) : null}
            {canSales && cancellable && o.status !== "draft" ? (
              <Button size="sm" variant="ghost" onClick={() => setPending("cancel")}>
                Cancel
              </Button>
            ) : null}
          </>
        }
      />

      {o.status === "cancelled" ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="coral" title="Cancelled">
            {o.cancelReason ?? "No reason given."}
          </Alert>
        </div>
      ) : null}

      <div className="ims-doc-page">
        <div className="bos-stack" style={{ minWidth: 0, gap: 16 }}>
          {inWizard && canSales ? (
            <div id="so-wizard">
              <SoWizard key={step ?? "order"} detail={d} initialStep={step ?? undefined} onChanged={() => undefined} onOpenInvoice={(invoiceId) => navigate("sales", `open:${invoiceId}`)} />
            </div>
          ) : null}
          <div style={{ minWidth: 0, overflowX: "auto" }}>
            <SoPaper order={o} />
          </div>
        </div>
        <aside className="ims-doc-side" aria-label="Order details">
          {o.status !== "draft" && o.status !== "cancelled" ? (
            <WidgetCard title="Fulfilment" dot="mint" note={`${d.summary.deliveredPct}%`}>
              <p className="ims-faint">
                {qtyText(d.summary.deliveredQty)} of {qtyText(d.summary.orderedQty)} units delivered or billed · {qtyText(d.summary.remainingQty)} left
              </p>
              {d.dcs.length ? (
                <div className="ims-list" style={{ marginTop: 6 }}>
                  {d.dcs.map((c) => (
                    <div key={c.id} className="ims-list-row">
                      <span className="ims-cell-stack">
                        <span className="ims-strong ims-mono">{c.docNo}</span>
                        <small>
                          {dateLabel(c.docDate)} · {c.status === "approved" ? (c.invoiceId ? "billed" : "delivered") : c.status}
                        </small>
                      </span>
                      <span className="ims-num">{qtyText(c.lines.reduce((s, l) => s + l.qty, 0))}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </WidgetCard>
          ) : null}

          {d.invoices.length ? (
            <WidgetCard title="Invoices" dot="rose">
              <div className="ims-list">
                {d.invoices.map((i) => (
                  <button key={i.id} type="button" className="ims-list-row" onClick={() => navigate("sales", `open:${i.id}`)}>
                    <span className="ims-cell-stack">
                      <span className="ims-strong">{i.invoiceNo}</span>
                      <small>
                        {dateLabel(i.invoiceDate)} · {i.status.replace(/_/g, " ")}
                      </small>
                    </span>
                    <span className="ims-num">{inr(i.grandTotal)}</span>
                  </button>
                ))}
              </div>
            </WidgetCard>
          ) : null}

          <Card interactive={false}>
            <KeyValues
              rows={[
                ["Customer PO", o.customerPoRef],
                ["Confirmed", o.confirmedAt ? dateLabel(o.confirmedAt.slice(0, 10)) : null],
                ["Delivery by", o.deliveryDate ? dateLabel(o.deliveryDate) : null],
                ["Currency", o.currencyCode],
              ]}
            />
          </Card>

          <WidgetCard title="Timeline" dot="lavender">
            <Timeline entityType="sales_order" entityId={o.id} />
          </WidgetCard>

          {canSales && o.status === "draft" ? (
            <div className="ims-row">
              <Button size="sm" variant="ghost" onClick={() => setPending("cancel")}>
                Cancel order
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending("delete")}>
                Delete draft
              </Button>
            </div>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={pending === "confirm"}
        onClose={() => setPending(null)}
        title={`Confirm ${o.soNo}?`}
        description="A confirmed order can't be edited. You can then deliver it on challans and invoice it."
        confirmLabel="Confirm order"
        busy={busy === "confirm"}
        onConfirm={async () => {
          await run("confirm", () => salesOrders.confirm(o.id), { success: "Order confirmed", description: o.soNo });
          setPending(null);
        }}
      />
      <ReasonDialog
        open={pending === "cancel"}
        onClose={() => setPending(null)}
        title={`Cancel ${o.soNo}?`}
        description="Cancelled orders stay on record but can't be delivered or invoiced. Draft challans are cancelled with it."
        confirmLabel="Cancel order"
        destructive
        busy={busy === "cancel"}
        suggestions={["Customer cancelled", "Out of stock", "Price dispute", "Duplicate order"]}
        onConfirm={async (reason) => {
          await run("cancel", () => salesOrders.cancel(o.id, reason), { success: "Order cancelled", description: o.soNo, tone: "amber" });
          setPending(null);
        }}
      />
      <ConfirmDialog
        open={pending === "delete"}
        onClose={() => setPending(null)}
        title={`Delete draft ${o.soNo}?`}
        description="The draft is removed permanently."
        confirmLabel="Delete"
        destructive
        busy={busy === "delete"}
        onConfirm={async () => {
          const ok = await run(
            "delete",
            async () => {
              await salesOrders.remove(o.id);
              return true;
            },
            { success: "Draft deleted" },
          );
          setPending(null);
          if (ok) onBack();
        }}
      />
    </div>
  );
}
