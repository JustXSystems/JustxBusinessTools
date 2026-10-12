"use client";

import "./purchase.css";
import { useState } from "react";
import { Alert, Badge, Button, Card, Dialog, ProgressBar, WidgetCard, useToast } from "@/components/bos";
import { dateLabel, inr, inrExact, qtyText, stampLabel, type ImsTotals } from "@/lib/ims/format";
import { CANCELLABLE_STATUSES, EDITABLE_STATUSES, PO_STAMP, PO_STATUS_LABEL, RECEIVABLE_STATUSES, copyText, purchase, type PoDetail, type PoShare, type PurchaseOrder } from "@/lib/ims/purchase";
import { Loaded, PageHeader, useIms, useImsAction, useImsData, usePrint } from "../core";
import { DocumentPaper } from "../shared/DocumentPaper";
import { ReceiveDialog } from "./ReceiveDialog";
import { ConfirmDialog, KeyValues, PoStatusBadge, ReasonDialog, Timeline } from "./ui";

export const totalsOf = (o: PurchaseOrder): ImsTotals => ({
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

export function PoPaper({ order }: { order: PurchaseOrder }) {
  const s = order.supplier;
  const b = order.business;
  return (
    <DocumentPaper
      title="PURCHASE ORDER"
      seller={{ label: "From", name: b.name, gstin: b.gstin, address: b.address, state: b.state ? `${b.state}${b.stateCode ? ` (${b.stateCode})` : ""}` : null, phone: b.phone, email: b.email }}
      party={{ label: "Supplier", name: s.name, gstin: s.gstin, address: [s.contactPerson ? `Attn: ${s.contactPerson}` : null, s.address, s.city].filter(Boolean).join("\n") || null, state: s.state ? `${s.state}${s.stateCode ? ` (${s.stateCode})` : ""}` : null, phone: s.mobile, email: s.email }}
      shipTo={order.deliveryAddress ? { label: "Deliver to", name: b.name, address: order.deliveryAddress } : null}
      meta={[
        { label: "PO number", value: order.poNo },
        { label: "Order date", value: dateLabel(order.orderDate) },
        { label: "Expected by", value: order.expectedDate ? dateLabel(order.expectedDate) : "—" },
        { label: "Payment terms", value: order.paymentTermsDays == null ? "As agreed" : order.paymentTermsDays === 0 ? "Immediate" : `${order.paymentTermsDays} days` },
        { label: "Supply", value: order.intraState ? "Intra-state (CGST + SGST)" : "Inter-state (IGST)" },
        { label: "Status", value: PO_STATUS_LABEL[order.status] },
      ]}
      totals={totalsOf(order)}
      intraState={order.intraState}
      notes={order.notes}
      terms={order.terms}
      stamp={PO_STAMP[order.status] ?? null}
      showReceived={order.lines.some((l) => l.receivedQty > 0)}
    />
  );
}

/** Share text preview + WhatsApp / email / copy; marks an approved PO as sent. */
export function ShareDialog({ order, share, open, onClose }: { order: PurchaseOrder; share: PoShare | null; open: boolean; onClose: () => void }) {
  const { can } = useIms();
  const { run, busy } = useImsAction();
  const { show } = useToast();
  const markable = order.status === "approved" || order.status === "sent" || order.status === "partially_received";
  const send = async (via: "whatsapp" | "email" | "manual") => {
    if (!share) return;
    if (via === "whatsapp") window.open(share.whatsappUrl, "_blank", "noopener,noreferrer");
    if (via === "email") window.location.href = share.mailto;
    if (markable && can("po")) await run(`send-${via}`, () => purchase.sendOrder(order.id, via), { success: order.status === "approved" ? "Marked as sent" : "Re-send recorded", description: order.poNo });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={`Share ${order.poNo}`}
      description={order.supplier.mobile || order.supplier.email ? `To ${order.supplierName}${order.supplier.mobile ? ` · ${order.supplier.mobile}` : ""}${order.supplier.email ? ` · ${order.supplier.email}` : ""}` : "No supplier mobile or email saved — WhatsApp will ask you to pick a chat."}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {markable && order.status === "approved" && can("po") ? (
            <Button onClick={() => send("manual")} disabled={Boolean(busy)}>
              Mark as sent
            </Button>
          ) : null}
        </>
      }
    >
      <div className="ims-lg bos-stack" style={{ gap: 12 }}>
        {share ? <pre className="ims-share">{share.text}</pre> : <p className="ims-faint">Preparing…</p>}
        <div className="ims-row">
          <Button variant="primary" onClick={() => send("whatsapp")} disabled={!share || Boolean(busy)}>
            WhatsApp
          </Button>
          <Button icon="file" onClick={() => send("email")} disabled={!share || Boolean(busy)}>
            Email
          </Button>
          <Button
            icon="check"
            disabled={!share}
            onClick={async () => {
              if (!share) return;
              const ok = await copyText(share.text);
              show({ tone: ok ? "emerald" : "coral", title: ok ? "Copied to clipboard" : "Couldn't copy — select the text instead" });
            }}
          >
            Copy text
          </Button>
        </div>
        {markable && order.status === "approved" ? <p className="ims-faint">Sending via WhatsApp or email marks the PO as sent.</p> : null}
      </div>
    </Dialog>
  );
}

type Pending = null | "share" | "receive" | "reject" | "cancel" | "delete" | "approve";

export function PoDocument({ id, initialShare, onBack, onEdit, onOpen }: { id: string; initialShare?: PoShare | null; onBack: () => void; onEdit: (o: PurchaseOrder) => void; onOpen: (id: string) => void }) {
  const state = useImsData(() => purchase.order(id), [id]);
  return (
    <div>
      <Loaded state={state} rows={3}>
        {(d) => <DocView d={d} initialShare={initialShare ?? null} onBack={onBack} onEdit={onEdit} onOpen={onOpen} />}
      </Loaded>
    </div>
  );
}

function DocView({ d, initialShare, onBack, onEdit, onOpen }: { d: PoDetail; initialShare: PoShare | null; onBack: () => void; onEdit: (o: PurchaseOrder) => void; onOpen: (id: string) => void }) {
  const { can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const print = usePrint();
  const o = d.order;
  const [pending, setPending] = useState<Pending>(initialShare ? "share" : null);
  const canPo = can("po");
  const canApprove = can("approvals");
  const canReceive = (can("stockIn") || canPo) && RECEIVABLE_STATUSES.has(o.status);
  const ordered = o.lines.reduce((s, l) => s + l.qty, 0);
  const received = o.lines.reduce((s, l) => s + Math.min(l.qty, l.receivedQty), 0);

  const primary = (() => {
    if (o.status === "pending_approval" && canApprove)
      return (
        <>
          <Button variant="destructive" size="sm" onClick={() => setPending("reject")}>
            Reject
          </Button>
          <Button variant="success" size="sm" icon="check" onClick={() => setPending("approve")}>
            Approve
          </Button>
        </>
      );
    if (EDITABLE_STATUSES.has(o.status) && canPo)
      return (
        <>
          <Button size="sm" icon="edit" onClick={() => onEdit(o)}>
            Edit
          </Button>
          <Button variant="primary" size="sm" icon="check" onClick={() => run("submit", () => purchase.submitOrder(o.id), { success: "Submitted", description: o.poNo })}>
            {busy === "submit" ? "Submitting…" : "Submit"}
          </Button>
        </>
      );
    if (o.status === "approved" && canPo)
      return (
        <Button variant="primary" size="sm" onClick={() => setPending("share")}>
          Send to supplier
        </Button>
      );
    return null;
  })();

  return (
    <div>
      <PageHeader
        title={
          <span className="ims-row" style={{ gap: 10 }}>
            {o.poNo}
            <PoStatusBadge status={o.status} />
            {o.overdue ? (
              <Badge tone="coral" auto>
                OVERDUE
              </Badge>
            ) : null}
          </span>
        }
        sub={`${o.supplierName} · ${dateLabel(o.orderDate)} · ${inrExact(o.grandTotal)}${o.createdByName ? ` · raised by ${o.createdByName}` : ""}`}
        actions={
          <>
            <Button size="sm" icon="chevronLeft" onClick={onBack}>
              All POs
            </Button>
            <Button size="sm" icon="printer" onClick={print}>
              Print / PDF
            </Button>
            <Button size="sm" onClick={() => setPending("share")}>
              Share
            </Button>
            {canPo ? (
              <Button
                size="sm"
                onClick={async () => {
                  const out = await run("duplicate", () => purchase.duplicateOrder(o.id), { success: "Duplicated as a new draft" });
                  if (out) onOpen(out.order.id);
                }}
              >
                Duplicate
              </Button>
            ) : null}
            {canReceive ? (
              <Button size="sm" variant={o.status === "approved" ? "secondary" : "primary"} icon="box" onClick={() => setPending("receive")}>
                Receive goods
              </Button>
            ) : null}
            {primary}
          </>
        }
      />

      {o.status === "rejected" ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="coral" title={`Rejected by ${o.decidedByName ?? "an approver"}`}>
            {o.approvalNote ?? "No reason given."} {canPo ? "Edit the PO and submit it again." : ""}
          </Alert>
        </div>
      ) : o.status === "pending_approval" ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="amber" title="Waiting for approval">
            {inrExact(o.grandTotal)} is at or above the {inr(d.approvalLimit)} approval limit{o.submittedAt ? ` · submitted ${stampLabel(o.submittedAt)}` : ""}.
          </Alert>
        </div>
      ) : null}

      <div className="ims-doc-page">
        <div style={{ minWidth: 0, overflowX: "auto" }}>
          <PoPaper order={o} />
        </div>
        <aside className="ims-doc-side" aria-label="PO details">
          {o.status !== "draft" && o.status !== "pending_approval" && o.status !== "rejected" && o.status !== "cancelled" ? (
            <WidgetCard title="Receiving" dot="mint" note={`${o.receivedPct}%`}>
              <ProgressBar value={o.receivedPct} tone={o.receivedPct >= 100 ? "emerald" : "blue"} label="Received" />
              <p className="ims-faint" style={{ marginTop: 8 }}>
                {qtyText(received)} of {qtyText(ordered)} units · {inr(o.receivedValue)} of {inr(o.grandTotal)}
              </p>
              {d.receipts.length ? (
                <div className="ims-list" style={{ marginTop: 6 }}>
                  {d.receipts.slice(0, 8).map((r) => (
                    <div key={r.id} className="ims-list-row">
                      <span className="ims-cell-stack">
                        <span>{r.itemName}</span>
                        <small>
                          {dateLabel(r.date)}
                          {r.actorName ? ` · ${r.actorName}` : ""}
                        </small>
                      </span>
                      <span className="ims-num">+{qtyText(r.qty)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </WidgetCard>
          ) : null}

          {d.bills.length ? (
            <WidgetCard title="Supplier bills" dot="rose">
              <div className="ims-list">
                {d.bills.map((b) =>
                  can("payables") ? (
                    <button key={b.id} type="button" className="ims-list-row" onClick={() => navigate("payables", `open:${b.id}`)}>
                      <span className="ims-cell-stack">
                        <span className="ims-strong">{b.billNo}</span>
                        <small>
                          Due {dateLabel(b.dueDate)} · {b.status.replace(/_/g, " ")}
                        </small>
                      </span>
                      <span className="ims-num">{inr(b.grandTotal)}</span>
                    </button>
                  ) : (
                    <div key={b.id} className="ims-list-row">
                      <span className="ims-cell-stack">
                        <span className="ims-strong">{b.billNo}</span>
                        <small>Due {dateLabel(b.dueDate)}</small>
                      </span>
                      <span className="ims-num">{inr(b.grandTotal)}</span>
                    </div>
                  ),
                )}
              </div>
            </WidgetCard>
          ) : null}

          <Card interactive={false}>
            <KeyValues
              rows={[
                ["Approval", o.decidedByName ? `${o.status === "rejected" ? "Rejected" : "Approved"} by ${o.decidedByName}` : o.approvalNote && o.status !== "rejected" ? o.approvalNote : o.status === "pending_approval" ? "Pending" : null],
                ["Decided", o.decidedAt ? stampLabel(o.decidedAt) : null],
                ["Sent", o.sentAt ? `${stampLabel(o.sentAt)}${o.sentVia ? ` via ${o.sentVia}` : ""}` : null],
                ["Received", o.receivedAt ? stampLabel(o.receivedAt) : null],
                ["Note", o.approvalNote && o.decidedByName ? o.approvalNote : null],
              ]}
            />
          </Card>

          <WidgetCard title="Timeline" dot="lavender">
            <Timeline entityType="po" entityId={o.id} />
          </WidgetCard>

          {canPo && (CANCELLABLE_STATUSES.has(o.status) || o.status === "draft") ? (
            <div className="ims-row">
              {CANCELLABLE_STATUSES.has(o.status) ? (
                <Button size="sm" variant="ghost" onClick={() => setPending("cancel")}>
                  Cancel PO
                </Button>
              ) : null}
              {o.status === "draft" ? (
                <Button size="sm" variant="ghost" onClick={() => setPending("delete")}>
                  Delete draft
                </Button>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>

      <ShareDialog order={o} share={d.share} open={pending === "share"} onClose={() => setPending(null)} />
      <ReceiveDialog order={o} open={pending === "receive"} onClose={() => setPending(null)} />
      <ReasonDialog
        open={pending === "reject"}
        onClose={() => setPending(null)}
        title={`Reject ${o.poNo}?`}
        description="The requester is notified with your reason and can edit and resubmit."
        confirmLabel="Reject PO"
        destructive
        busy={busy === "reject"}
        suggestions={["Price too high — renegotiate", "Quantity too large", "Wrong supplier", "Not needed now"]}
        onConfirm={async (reason) => {
          await run("reject", () => purchase.rejectOrder(o.id, reason), { success: "Rejected", description: o.poNo, tone: "amber" });
          setPending(null);
        }}
      />
      <ReasonDialog
        open={pending === "approve"}
        onClose={() => setPending(null)}
        title={`Approve ${o.poNo}?`}
        description={`${o.supplierName} · ${inrExact(o.grandTotal)}. The requester is notified and can send it to the supplier.`}
        label="Note"
        minLength={0}
        confirmLabel="Approve"
        busy={busy === "approve"}
        onConfirm={async (note) => {
          await run("approve", () => purchase.approveOrder(o.id, note), { success: "Approved", description: o.poNo });
          setPending(null);
        }}
      />
      <ReasonDialog
        open={pending === "cancel"}
        onClose={() => setPending(null)}
        title={`Cancel ${o.poNo}?`}
        description="Cancelled POs stay on record but can't be received or edited."
        minLength={0}
        confirmLabel="Cancel PO"
        destructive
        busy={busy === "cancel"}
        onConfirm={async (reason) => {
          await run("cancel", () => purchase.cancelOrder(o.id, reason), { success: "Cancelled", description: o.poNo, tone: "amber" });
          setPending(null);
        }}
      />
      <ConfirmDialog
        open={pending === "delete"}
        onClose={() => setPending(null)}
        title={`Delete draft ${o.poNo}?`}
        description="The draft is removed permanently."
        confirmLabel="Delete"
        destructive
        busy={busy === "delete"}
        onConfirm={async () => {
          const ok = await run("delete", async () => {
            await purchase.deleteOrder(o.id);
            return true;
          }, { success: "Draft deleted" });
          setPending(null);
          if (ok) onBack();
        }}
      />
    </div>
  );
}
