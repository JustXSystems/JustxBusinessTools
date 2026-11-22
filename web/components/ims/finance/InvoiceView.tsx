"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, Dialog, Field, FormGrid, Input, WidgetCard } from "@/components/bos";
import { bom, type BomDc } from "@/lib/ims/bom";
import {
  DOC_KIND_LABEL,
  finance,
  INVOICE_BADGE,
  invoiceEmailShareLink,
  invoiceShareText,
  methodLabel,
  whatsappShareLink,
  type InvoiceDetail,
} from "@/lib/ims/finance";
import { dateLabel, inrExact, stampLabel } from "@/lib/ims/format";
import { imsSystem, saveBlob, type AuditDocument } from "@/lib/ims/system";
import { Loaded, Stack, StatusBadge, useIms, useImsAction, useImsData, usePrint } from "../core";
import { DocRefLink } from "../bom/DocRefLink";
import { activityTone, BackLink, ConfirmDialog, InvoicePaper, KeyValues, PaymentDialog, ReasonDialog, Stats, Timeline, type TimelineItem } from "./shared";

type Dlg = null | "pay" | "cancel" | "reject" | "delete" | "share" | "einvoice" | { voidId: string; amount: number };

export function InvoiceView({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: (id: string) => void }) {
  const state = useImsData(() => finance.invoice(id), [id]);
  return (
    <Stack gap={16}>
      <BackLink onClick={onBack}>All invoices</BackLink>
      <Loaded state={state} rows={3}>
        {(d) => <InvoiceBody detail={d} onEdit={onEdit} onGone={onBack} onReload={state.reload} />}
      </Loaded>
    </Stack>
  );
}

function InvoiceBody({
  detail,
  onEdit,
  onGone,
  onReload,
}: {
  detail: InvoiceDetail;
  onEdit: (id: string) => void;
  onGone: () => void;
  onReload: () => void;
}) {
  const { session, can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const print = usePrint();
  const [dlg, setDlg] = useState<Dlg>(null);
  const inv = detail.invoice;
  const canWrite = can("sales");
  const canCollect = can("sales") || can("receivables");
  const isDraft = inv.status === "draft";
  const isPending = inv.status === "pending_approval";
  const isIssued = inv.status === "issued";
  const canApprove = can("approvals");
  const shareSeller = { name: session.settings.businessName, gstin: session.settings.gstin, phone: session.settings.phone };
  const shareText = invoiceShareText(inv, shareSeller);
  const emailHref = invoiceEmailShareLink(inv, shareSeller);

  const timeline: TimelineItem[] = [
    ...detail.payments.map((p) => ({
      key: `p-${p.id}`,
      at: p.createdAt ?? p.paidOn,
      text: `Received ${inrExact(p.amount)} by ${methodLabel(p.method)}${p.reference ? ` · ${p.reference}` : ""}`,
      meta: `${dateLabel(p.paidOn)} · ${p.createdByName ?? "—"}`,
      tone: "good" as const,
    })),
    ...detail.activity.map((a) => ({
      key: `a-${a.id}`,
      at: a.createdAt ?? "",
      text: activityText(a.kind, a.channel, a.message, a.promiseDate, a.promiseAmount),
      meta: `${stampLabel(a.createdAt)} · ${a.createdByName ?? "System"}`,
      tone: activityTone(a.kind, a.status),
    })),
    ...(inv.issuedAt ? [{ key: "issued", at: inv.issuedAt, text: `Issued as ${inv.invoiceNo}`, meta: stampLabel(inv.issuedAt), tone: null }] : []),
    ...(inv.cancelledAt ? [{ key: "cancelled", at: inv.cancelledAt, text: `Cancelled${inv.cancelReason ? ` — ${inv.cancelReason}` : ""}`, meta: stampLabel(inv.cancelledAt), tone: "bad" as const }] : []),
    { key: "created", at: inv.createdAt ?? "", text: "Created", meta: `${stampLabel(inv.createdAt)} · ${inv.createdByName ?? "—"}`, tone: null },
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <>
      <div className="fin-doc-page">
        <div style={{ minWidth: 0 }}>
          <InvoicePaper detail={detail} session={session} />
        </div>

        <aside className="fin-doc-side" aria-label="Invoice actions">
          <Card interactive={false}>
            <div className="ims-between" style={{ marginBottom: 10 }}>
              <span className="ims-strong" style={{ fontSize: 16 }}>
                {inv.isDraftNo ? "Draft invoice" : inv.invoiceNo}
              </span>
              <StatusBadge view={INVOICE_BADGE[inv.displayStatus]} />
            </div>
            {inv.sourceTool && inv.sourceTool !== "pos" ? (
              <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Badge
                  tag={inv.sourceTool === "tally" ? "blue" : "lavender"}
                  title={inv.sourceTool === "ims_bom" ? "Created from Bill of Materials" : inv.sourceTool === "tally" ? "Imported from Tally" : "Created from quotation"}
                >
                  {inv.sourceTool === "ims_bom" ? "From BOM" : inv.sourceTool === "tally" ? "From Tally" : "From Quotation"}
                </Badge>
                {inv.sourceTool === "ims_bom" && inv.sourceLabel ? (
                  <DocRefLink module="bom" intent={inv.sourceRef ? `open:${inv.sourceRef}` : undefined} enabled={can("bom") && Boolean(inv.sourceRef)}>
                    {inv.sourceLabel}
                  </DocRefLink>
                ) : null}
              </div>
            ) : null}
            <Stats
              items={[
                { label: "Total", value: inrExact(inv.grandTotal) },
                { label: "Received", value: inrExact(inv.amountPaid), tone: inv.amountPaid > 0 ? "emerald" : null },
                { label: "Balance", value: inrExact(inv.balance), tone: inv.daysOverdue > 0 ? "coral" : inv.balance > 0 ? "amber" : null },
              ]}
            />
            <div style={{ marginTop: 12 }}>
              <KeyValues
                rows={[
                  ["Customer", inv.customerName],
                  ...(inv.docKind && inv.docKind !== "tax_invoice"
                    ? ([["Document", DOC_KIND_LABEL[inv.docKind] || inv.docKind]] as Array<[string, ReactNode]>)
                    : []),
                  ...(inv.advanceApplied > 0.005 ? ([["Advance applied", inrExact(inv.advanceApplied)]] as Array<[string, ReactNode]>) : []),
                  ...(isPending && inv.approvalNote ? ([["Approval note", inv.approvalNote]] as Array<[string, ReactNode]>) : []),
                  ...(inv.againstInvoiceNo
                    ? ([
                        [
                          "Against",
                          inv.againstInvoiceId ? (
                            <DocRefLink key="against" module="sales" intent={`open:${inv.againstInvoiceId}`} enabled>
                              {inv.againstInvoiceNo}
                            </DocRefLink>
                          ) : (
                            inv.againstInvoiceNo
                          ),
                        ],
                      ] as Array<[string, ReactNode]>)
                    : []),
                  ...(inv.customerPoNo ? ([["Customer PO", inv.customerPoNo]] as Array<[string, ReactNode]>) : []),
                  ...(inv.shipToName || inv.shipToAddress ? ([["Ship to", [inv.shipToName, inv.shipToAddress].filter(Boolean).join(" · ")]] as Array<[string, ReactNode]>) : []),
                  ...(inv.creditApplied > 0.005 ? ([["Credits applied", inrExact(inv.creditApplied)]] as Array<[string, ReactNode]>) : []),
                  ...(inv.sourceTool === "ims_bom" && inv.sourceLabel
                    ? ([
                        [
                          "BOM",
                          <DocRefLink key="bom" module="bom" intent={inv.sourceRef ? `open:${inv.sourceRef}` : undefined} enabled={can("bom") && Boolean(inv.sourceRef)}>
                            {inv.sourceLabel}
                          </DocRefLink>,
                        ],
                      ] as Array<[string, ReactNode]>)
                    : []),
                  ["Due", inv.status === "issued" ? `${dateLabel(inv.dueDate)}${inv.daysOverdue > 0 ? ` · ${inv.daysOverdue} days overdue` : ""}` : dateLabel(inv.dueDate)],
                  ["Tax", inv.intraState ? `CGST ${inrExact(inv.cgst)} + SGST ${inrExact(inv.sgst)}` : `IGST ${inrExact(inv.igst)}`],
                  [
                    "e-Invoice",
                    inv.irn ? `Pushed · IRN ${inv.irn.slice(0, 12)}…` : inv.einvStatus || (inv.status === "issued" && (inv.docKind || "tax_invoice") === "tax_invoice" ? "Yet to push (Wave 2)" : "Not applicable"),
                  ],
                  [
                    "Stock",
                    inv.dcLinks?.length ? (
                      <span>
                        {inv.stockPosted ? `Via ${inv.dcLinks.length} DC${inv.dcLinks.length === 1 ? "" : "s"} · ` : "DC linked · "}
                        {inv.dcLinks.map((d, i) => (
                          <span key={d.id}>
                            <DocRefLink module="bomDc" intent={`open:${d.id}`} enabled={can("bom")}>
                              {d.docNo}
                            </DocRefLink>
                            {i < inv.dcLinks!.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </span>
                    ) : inv.stockPosted ? (
                      "Moved out"
                    ) : isDraft ? (
                      "Moves when issued"
                    ) : detail.activity.some((a) => /stock remains on delivery challan/i.test(String(a.message ?? ""))) ? (
                      "Remained on delivery challans"
                    ) : (
                      "Returned"
                    ),
                  ],
                  ...(inv.promiseDate ? ([["Promise", `${inrExact(inv.promiseAmount ?? inv.balance)} by ${dateLabel(inv.promiseDate)}`]] as Array<[string, ReactNode]>) : []),
                  ...(inv.disputed ? ([["Dispute", inv.disputeReason ?? "Disputed"]] as Array<[string, ReactNode]>) : []),
                ]}
              />
            </div>

            <div className="ims-row" style={{ marginTop: 14 }}>
              {isIssued && inv.balance > 0 && canCollect ? (
                <Button variant="success" icon="wallet" onClick={() => setDlg("pay")}>
                  Record payment
                </Button>
              ) : null}
              {isDraft && canWrite ? (
                <>
                  <Button
                    variant="primary"
                    icon="check"
                    disabled={busy === "issue"}
                    onClick={() =>
                      run("issue", () => finance.issueInvoice(inv.id), {
                        success: inv.dcLinks?.length ? "Invoice issued — stock stays on linked DCs" : "Invoice issued — stock updated",
                      }).then((out) => {
                        if (out?.invoice.status === "pending_approval") onReload();
                      })
                    }
                  >
                    {busy === "issue" ? "Issuing…" : "Issue"}
                  </Button>
                  <Button icon="edit" onClick={() => onEdit(inv.id)}>
                    Edit
                  </Button>
                </>
              ) : null}
              {isPending && canApprove ? (
                <>
                  <Button
                    variant="success"
                    icon="check"
                    disabled={busy === "approve"}
                    onClick={() => run("approve", () => finance.approveInvoice(inv.id), { success: "Approved and issued" }).then(() => onReload())}
                  >
                    {busy === "approve" ? "Approving…" : "Approve & issue"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDlg("reject")}>
                    Reject…
                  </Button>
                </>
              ) : null}
              {isPending && canWrite ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === "withdraw"}
                  onClick={() => run("withdraw", () => finance.withdrawInvoiceApproval(inv.id), { success: "Withdrawn to draft" }).then(() => onReload())}
                >
                  {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
                </Button>
              ) : null}
              <Button icon="printer" onClick={print}>
                Print
              </Button>
              <Button icon="sparkle" onClick={() => setDlg("share")}>
                WhatsApp
              </Button>
              {emailHref ? (
                <Button
                  onClick={() => {
                    window.location.href = emailHref;
                  }}
                >
                  Email
                </Button>
              ) : null}
              {isIssued && inv.sourceTool !== "tally" && (canWrite || can("integrations") || can("audit")) ? (
                <Button
                  icon="download"
                  disabled={busy === "tally-xml"}
                  onClick={() =>
                    void run(
                      "tally-xml",
                      async () => {
                        const file = await imsSystem.exportInvoiceTally(inv.id);
                        saveBlob(file);
                        return file;
                      },
                      { success: "Tally XML downloaded", description: "Import it in Tally: Gateway of Tally → Import → Transactions.", refresh: false },
                    )
                  }
                >
                  {busy === "tally-xml" ? "Preparing…" : "Tally XML"}
                </Button>
              ) : null}
            </div>
            <div className="ims-row" style={{ marginTop: 8 }}>
              {canWrite && isIssued && (inv.docKind || "tax_invoice") === "tax_invoice" ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === "cn"}
                    onClick={async () => {
                      const out = await run("cn", () => finance.createCreditNote(inv.id), { success: "Credit note draft created" });
                      if (out) onEdit(out.invoice.id);
                    }}
                  >
                    {busy === "cn" ? "Creating…" : "Credit note"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === "dn"}
                    onClick={async () => {
                      const out = await run("dn", () => finance.createDebitNote(inv.id), { success: "Debit note draft created" });
                      if (out) onEdit(out.invoice.id);
                    }}
                  >
                    {busy === "dn" ? "Creating…" : "Debit note"}
                  </Button>
                </>
              ) : null}
              {canWrite && (inv.docKind || "tax_invoice") === "proforma" && inv.status !== "cancelled" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === "pf"}
                  onClick={async () => {
                    const out = await run("pf", () => finance.convertProforma(inv.id), { success: "Tax invoice draft created from proforma" });
                    if (out) onEdit(out.invoice.id);
                  }}
                >
                  {busy === "pf" ? "Converting…" : "Convert to tax invoice"}
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === "dup"}
                  onClick={async () => {
                    const out = await run("dup", () => finance.duplicateInvoice(inv.id), { success: "Copied into a new draft" });
                    if (out) onEdit(out.invoice.id);
                  }}
                >
                  Duplicate
                </Button>
              ) : null}
              {inv.sourceTool === "tally" ? (
                <Button size="sm" variant="ghost" onClick={() => navigate("integrations", "import")}>
                  Tally import
                </Button>
              ) : null}
              {isIssued && can("receivables") ? (
                <Button size="sm" variant="ghost" onClick={() => navigate("receivables", `open:${inv.id}`)}>
                  Collections view
                </Button>
              ) : null}
              {isIssued && canWrite ? (
                <Button size="sm" variant="ghost" onClick={() => setDlg("cancel")} disabled={inv.amountPaid > 0.005} title={inv.amountPaid > 0.005 ? "Void the payments first" : undefined}>
                  Cancel invoice
                </Button>
              ) : null}
              {isDraft && canWrite ? (
                <Button size="sm" variant="ghost" onClick={() => setDlg("delete")}>
                  Delete draft
                </Button>
              ) : null}
            </div>
          </Card>

          {inv.status === "cancelled" ? (
            <Alert tone="blue" title="Cancelled">
              {inv.cancelReason ?? "This invoice was cancelled"}.{" "}
              {detail.activity.some((a) => /stock remains on delivery challan/i.test(String(a.message ?? "")))
                ? "Stock remains on the linked delivery challans."
                : "Stock was returned."}{" "}
              Duplicate it to issue a corrected invoice.
            </Alert>
          ) : null}

          {isIssued && (inv.docKind || "tax_invoice") !== "proforma" ? (
            <WidgetCard
              title="e-Invoice / IRP"
              note={inv.irn ? "Pushed" : inv.einvStatus === "yet_to_push" ? "Yet to push" : inv.einvStatus === "marked_cancelled" ? "Marked cancelled" : inv.customerGstin ? "Ready" : "B2C"}
            >
              <p className="fin-note" style={{ marginBottom: 8 }}>
                {inv.irn
                  ? "IRN is on this document. Live GSP push lands in a later wave — associate portal IRNs here today."
                  : inv.customerGstin
                    ? "B2B document is IRP-eligible. Associate an IRN from the portal, or wait for the live GSP connector."
                    : "No buyer GSTIN — e-Invoice is not required for this B2C sale."}
              </p>
              {inv.irn ? (
                <KeyValues
                  rows={[
                    ["IRN", <span key="irn" className="ims-mono" style={{ fontSize: 11 }}>{inv.irn}</span>],
                    ...(inv.ackNo ? ([["Ack no.", inv.ackNo]] as Array<[string, ReactNode]>) : []),
                    ...(inv.ewayBillNo ? ([["E-Way bill", inv.ewayBillNo]] as Array<[string, ReactNode]>) : []),
                  ]}
                />
              ) : null}
              <div className="ims-row" style={{ marginTop: 8 }}>
                {canWrite || can("integrations") || can("audit") ? (
                  <Button size="sm" variant="ghost" onClick={() => setDlg("einvoice")}>
                    {inv.irn ? "Update IRN" : "Associate IRN"}
                  </Button>
                ) : null}
                {inv.irn && inv.einvStatus !== "marked_cancelled" && (canWrite || can("integrations")) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === "einv-cancel"}
                    onClick={() =>
                      void run("einv-cancel", () => finance.markEInvoiceCancelled(inv.id, "Cancelled in IMS"), {
                        success: "Marked cancelled in IMS — also cancel on the GST portal if needed",
                      })
                    }
                  >
                    Mark IRN cancelled
                  </Button>
                ) : null}
              </div>
            </WidgetCard>
          ) : null}

          {isDraft && inv.sourceTool === "ims_bom" && inv.sourceRef && canWrite ? (
            <InvoiceBomDcLinks
              invoiceId={inv.id}
              bomDocId={inv.sourceRef}
              linkedIds={inv.dcIds ?? inv.dcLinks?.map((d) => d.id) ?? []}
              onChanged={onReload}
            />
          ) : null}

          {isIssued && (inv.dcLinks?.length ?? 0) > 0 ? (
            <WidgetCard title="Delivery challans" note={`${inv.dcLinks!.length} linked`}>
              <p className="fin-note" style={{ marginBottom: 8 }}>
                Stock was issued via these DCs. Return or reverse on a DC is blocked until this invoice is cancelled.
              </p>
              <div style={{ display: "grid", gap: 6 }}>
                {inv.dcLinks!.map((dc) => (
                  <div key={dc.id} className="ims-row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13 }}>
                      <DocRefLink module="bomDc" intent={`open:${dc.id}`} enabled={can("bom")}>
                        {dc.docNo}
                      </DocRefLink>
                      {dc.status ? ` · ${dc.status}` : ""}
                      {dc.stockPosted ? " · stock out" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </WidgetCard>
          ) : null}

          {detail.payments.length ? (
            <WidgetCard title="Payments" note={`${detail.payments.length}`}>
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <tbody>
                    {detail.payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <span className="ims-cell-stack">
                            <span>{dateLabel(p.paidOn)}</span>
                            <small>
                              {methodLabel(p.method)}
                              {p.reference ? ` · ${p.reference}` : ""}
                            </small>
                          </span>
                        </td>
                        <td className="is-num">{inrExact(p.amount)}</td>
                        <td style={{ width: 1 }}>
                          {canCollect ? (
                            <Button size="sm" variant="ghost" onClick={() => setDlg({ voidId: p.id, amount: p.amount })}>
                              Void
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </WidgetCard>
          ) : null}

          <InvoiceAttachments invoiceId={inv.id} invoiceNo={inv.isDraftNo ? "Draft" : inv.invoiceNo} canWrite={canWrite || canCollect} />

          <WidgetCard title="Activity">
            <Timeline items={timeline} />
          </WidgetCard>
        </aside>
      </div>

      <PaymentDialog
        open={dlg === "pay"}
        onClose={() => setDlg(null)}
        title={`Record payment · ${inv.invoiceNo}`}
        description={`From ${inv.customerName}`}
        balance={inv.balance}
        today={session.today}
        busy={busy === "pay"}
        onSubmit={(input) => run("pay", () => finance.recordInvoicePayment(inv.id, input), { success: `Payment of ${inrExact(input.amount)} recorded` })}
      />
      <EInvoiceAssociateDialog
        open={dlg === "einvoice"}
        onClose={() => setDlg(null)}
        invoiceNo={inv.invoiceNo}
        initial={{ irn: inv.irn, ackNo: inv.ackNo, ewayBillNo: inv.ewayBillNo }}
        busy={busy === "einv"}
        onSubmit={async (input) => {
          const out = await run("einv", () => finance.associateEInvoice(inv.id, input), { success: "IRN associated" });
          if (out) setDlg(null);
        }}
      />
      <ReasonDialog
        open={dlg === "cancel"}
        onClose={() => setDlg(null)}
        title={`Cancel ${inv.invoiceNo}?`}
        description={
          inv.dcLinks?.length
            ? "Stock stays on the linked delivery challans. The invoice stops counting towards sales and dues. This can’t be undone."
            : "Stock on this invoice goes back into inventory and the invoice stops counting towards sales and dues. This can’t be undone."
        }
        confirmLabel="Cancel invoice"
        destructive
        busy={busy === "cancel"}
        suggestions={["Wrong customer", "Wrong items or rates", "Duplicate invoice", "Order cancelled by customer"]}
        onConfirm={async (reason) => {
          const out = await run("cancel", () => finance.cancelInvoice(inv.id, reason), {
            success: inv.dcLinks?.length ? "Invoice cancelled — stock remains on delivery challans" : "Invoice cancelled — stock returned",
          });
          if (out) setDlg(null);
        }}
      />
      <ReasonDialog
        open={dlg === "reject"}
        onClose={() => setDlg(null)}
        title="Reject this invoice?"
        description="It returns to draft so the raiser can fix it and re-submit."
        confirmLabel="Reject"
        destructive
        busy={busy === "reject"}
        suggestions={["Price too high", "Wrong customer", "Wrong items or rates", "Needs manager review"]}
        onConfirm={async (reason) => {
          const out = await run("reject", () => finance.rejectInvoice(inv.id, reason), { success: "Rejected — back to draft" });
          if (out) setDlg(null);
        }}
      />
      <ConfirmDialog
        open={dlg === "delete"}
        onClose={() => setDlg(null)}
        title="Delete this draft?"
        description="The draft is removed. No stock or invoice number was used."
        confirmLabel="Delete draft"
        destructive
        busy={busy === "delete"}
        onConfirm={async () => {
          const out = await run("delete", () => finance.deleteInvoice(inv.id).then(() => true), { success: "Draft deleted" });
          if (out) onGone();
        }}
      />
      <ConfirmDialog
        open={typeof dlg === "object" && dlg !== null}
        onClose={() => setDlg(null)}
        title="Void this payment?"
        description={typeof dlg === "object" && dlg ? `${inrExact(dlg.amount)} will be removed and the invoice balance goes back up.` : undefined}
        confirmLabel="Void payment"
        destructive
        busy={busy === "void"}
        onConfirm={async () => {
          if (typeof dlg !== "object" || !dlg) return;
          const out = await run("void", () => finance.voidPayment(dlg.voidId).then(() => true), { success: "Payment voided" });
          if (out) setDlg(null);
        }}
      />
      <Dialog
        open={dlg === "share"}
        onClose={() => setDlg(null)}
        title="Share on WhatsApp"
        description={inv.customerMobile ? `Opens WhatsApp with a message to ${inv.customerMobile}.` : "No mobile on file — WhatsApp will ask who to send it to."}
        wide
        actions={
          <>
            <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(shareText)}>
              Copy text
            </Button>
            <Button variant="primary" onClick={() => window.open(whatsappShareLink(shareText, inv.customerMobile), "_blank", "noopener,noreferrer")}>
              Open WhatsApp
            </Button>
          </>
        }
      >
        <div className="fin-lg">
          <pre className="fin-share">{shareText}</pre>
          <p className="fin-note" style={{ marginTop: 8 }}>
            Tip: print or save the invoice as PDF and attach it in the chat for a formal copy.
          </p>
        </div>
      </Dialog>
    </>
  );
}

function EInvoiceAssociateDialog({
  open,
  onClose,
  invoiceNo,
  initial,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  invoiceNo: string;
  initial: { irn: string | null; ackNo: string | null; ewayBillNo: string | null };
  busy: boolean;
  onSubmit: (input: { irn: string; ackNo?: string | null; ewayBillNo?: string | null }) => void | Promise<void>;
}) {
  const [irn, setIrn] = useState(initial.irn ?? "");
  const [ackNo, setAckNo] = useState(initial.ackNo ?? "");
  const [ewayBillNo, setEway] = useState(initial.ewayBillNo ?? "");
  useEffect(() => {
    if (!open) return;
    setIrn(initial.irn ?? "");
    setAckNo(initial.ackNo ?? "");
    setEway(initial.ewayBillNo ?? "");
  }, [open, initial.irn, initial.ackNo, initial.ewayBillNo]);
  const trimmed = irn.trim();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`e-Invoice · ${invoiceNo}`}
      description="Paste the IRN (and optional Ack / e-Way bill) from the IRP or your GSP. Live push arrives in a later wave."
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || trimmed.length < 8}
            onClick={() => void onSubmit({ irn: trimmed, ackNo: ackNo.trim() || null, ewayBillNo: ewayBillNo.trim() || null })}
          >
            {busy ? "Saving…" : "Associate IRN"}
          </Button>
        </>
      }
    >
      <FormGrid columns="1fr">
        <Field label="IRN *">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} className="ims-mono" value={irn} maxLength={64} onChange={(e) => setIrn(e.target.value)} placeholder="64-char IRN" />}
        </Field>
        <FormGrid columns="1fr 1fr">
          <Field label="Ack no.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} className="ims-mono" value={ackNo} maxLength={64} onChange={(e) => setAckNo(e.target.value)} />}
          </Field>
          <Field label="E-Way bill no.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} className="ims-mono" value={ewayBillNo} maxLength={24} onChange={(e) => setEway(e.target.value)} />}
          </Field>
        </FormGrid>
      </FormGrid>
    </Dialog>
  );
}

/** Link approved BOM delivery challans so issue skips invoice stock OUT. */
function InvoiceBomDcLinks({
  invoiceId,
  bomDocId,
  linkedIds,
  onChanged,
}: {
  invoiceId: string;
  bomDocId: string;
  linkedIds: string[];
  onChanged: () => void;
}) {
  const { run, busy } = useImsAction();
  const dcsState = useImsData(() => bom.listDcs(bomDocId), [bomDocId]);
  const [selected, setSelected] = useState<string[]>(linkedIds);
  useEffect(() => {
    setSelected(linkedIds);
  }, [linkedIds.join("|")]);
  const allDcs = dcsState.data?.dcs ?? [];
  const approved = allDcs.filter((d: BomDc) => d.status === "approved" && d.stockPosted);
  const approvedIds = new Set(approved.map((d) => d.id));
  const orphanLinked = linkedIds.filter((id) => !approvedIds.has(id));
  const dirty = selected.slice().sort().join("|") !== linkedIds.slice().sort().join("|");
  const linkable = approved.filter((dc) => !dc.invoiceLinked || linkedIds.includes(dc.id) || dc.invoiceId === invoiceId);
  const blockedElsewhere = approved.filter((dc) => dc.invoiceLinked && !linkedIds.includes(dc.id) && dc.invoiceId !== invoiceId);

  return (
    <WidgetCard title="Delivery challans" note={selected.length ? `${selected.length} linked` : "required if DCs own stock"}>
      <p className="fin-note" style={{ marginBottom: 8 }}>
        Link every approved DC so issuing does not post stock again and returns stay blocked while this invoice is live.
      </p>
      {dcsState.loading && !dcsState.data ? (
        <span className="ims-muted" style={{ fontSize: 13 }}>
          Loading DCs…
        </span>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {linkable.map((dc) => (
            <label key={dc.id} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={selected.includes(dc.id)}
                onChange={() =>
                  setSelected((prev) => (prev.includes(dc.id) ? prev.filter((x) => x !== dc.id) : [...prev, dc.id]))
                }
              />
              <span>
                <b>{dc.docNo}</b> · {dc.docDate}
                {(dc.lines ?? []).length ? ` · ${(dc.lines ?? []).reduce((s, l) => s + l.qty, 0)} units` : ""}
              </span>
            </label>
          ))}
          {blockedElsewhere.map((dc) => (
            <div key={dc.id} style={{ fontSize: 13, opacity: 0.75 }}>
              <b>{dc.docNo}</b> — already on {dc.invoiceNo || "another invoice"}; unlink there first
            </div>
          ))}
          {orphanLinked.map((id) => {
            const dc = allDcs.find((d) => d.id === id);
            return (
              <label key={id} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  onChange={() =>
                    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
                  }
                />
                <span style={{ opacity: 0.85 }}>
                  <b>{dc?.docNo ?? id.slice(0, 8)}</b>
                  {dc ? ` · ${dc.status}` : " · missing"} — not linkable; untick and save to clear
                </span>
              </label>
            );
          })}
          {!approved.length && !orphanLinked.length ? (
            <span className="ims-muted" style={{ fontSize: 13 }}>
              No approved delivery challans on this BOM yet. Create and approve DCs from the BOM, then link them here.
            </span>
          ) : null}
          {linkable.length > 0 && selected.filter((id) => approvedIds.has(id)).length < linkable.length ? (
            <Alert tone="amber" title="Link all approved DCs">
              Issue is blocked until every approved delivery challan on this BOM is linked (or cancel those DCs first).
            </Alert>
          ) : null}
          {approved.length || orphanLinked.length || dirty ? (
            <Button
              size="sm"
              disabled={Boolean(busy) || !dirty}
              onClick={async () => {
                // Only persist approved+posted IDs (orphans must be cleared, not re-saved).
                const next = selected.filter((id) => approvedIds.has(id));
                const out = await run("dc-links", () => bom.setInvoiceDcLinks(invoiceId, next), {
                  success: next.length ? "Delivery challans linked" : "Delivery challan links cleared",
                });
                if (out) {
                  setSelected(next);
                  onChanged();
                }
              }}
            >
              {busy === "dc-links" ? "Saving…" : dirty ? "Save DC links" : "Links saved"}
            </Button>
          ) : null}
        </div>
      )}
    </WidgetCard>
  );
}

function InvoiceAttachments({ invoiceId, invoiceNo, canWrite }: { invoiceId: string; invoiceNo: string; canWrite: boolean }) {
  const { run, busy } = useImsAction();
  const state = useImsData(() => imsSystem.documents({ entityType: "invoice", entityId: invoiceId }), [invoiceId]);
  const docs = state.data?.documents ?? [];
  const maxBytes = state.data?.maxBytes ?? 2 * 1024 * 1024;

  const onFile = async (file: File | null) => {
    if (!file || !canWrite) return;
    if (file.size > maxBytes) {
      await run("attach", async () => {
        throw new Error(`Files up to ${Math.round(maxBytes / (1024 * 1024))} MB can be attached`);
      });
      return;
    }
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read the file"));
      reader.readAsDataURL(file);
    });
    await run(
      "attach",
      () =>
        imsSystem.addDocument({
          title: file.name.replace(/\.[^.]+$/, "") || file.name,
          category: "invoice",
          content,
          fileName: file.name,
          entityType: "invoice",
          entityId: invoiceId,
          entityLabel: invoiceNo,
        }),
      { success: "Attachment added" },
    );
    state.reload();
  };

  return (
    <WidgetCard title="Attachments" note={docs.length ? String(docs.length) : undefined}>
      {docs.length ? (
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          {docs.map((d: AuditDocument) => (
            <div key={d.id} className="ims-row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span className="ims-cell-stack" style={{ minWidth: 0 }}>
                <span className="ims-strong" style={{ fontSize: 13 }}>
                  {d.title}
                </span>
                <small>
                  {d.fileName || d.url || "Link"}
                  {d.sizeBytes ? ` · ${Math.round(d.sizeBytes / 1024)} KB` : ""}
                </small>
              </span>
              <span className="ims-row" style={{ gap: 4, flexShrink: 0 }}>
                {d.hasFile ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === `dl-${d.id}`}
                    onClick={() =>
                      void run(
                        `dl-${d.id}`,
                        async () => {
                          const file = await imsSystem.documentFile(d.id, d.fileName || d.title);
                          saveBlob(file);
                          return file;
                        },
                        { success: "Downloaded", refresh: false },
                      )
                    }
                  >
                    Download
                  </Button>
                ) : d.url ? (
                  <a className="bos-btn bos-btn-ghost bos-btn-sm" href={d.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                ) : null}
                {canWrite ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === `del-${d.id}`}
                    onClick={() =>
                      void run(`del-${d.id}`, () => imsSystem.deleteDocument(d.id), { success: "Attachment removed" }).then(() => state.reload())
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="fin-note" style={{ marginBottom: 8 }}>
          PO copies, delivery proofs, or customer POs — up to {Math.round(maxBytes / (1024 * 1024))} MB.
        </p>
      )}
      {canWrite ? (
        <label className="bos-btn bos-btn-ghost bos-btn-sm" style={{ cursor: busy === "attach" ? "wait" : "pointer" }}>
          {busy === "attach" ? "Uploading…" : "Add file"}
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.csv,.txt,.xlsx,.xls,.doc,.docx,.zip,.xml"
            hidden
            disabled={busy === "attach"}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              void onFile(f);
            }}
          />
        </label>
      ) : null}
    </WidgetCard>
  );
}

function activityText(kind: string, channel: string | null, message: string | null, promiseDate: string | null, promiseAmount: number | null): string {
  if (kind === "reminder") return `Reminder sent${channel ? ` by ${channel === "whatsapp" ? "WhatsApp" : channel.toUpperCase()}` : ""}`;
  if (kind === "promise") return promiseDate ? `Promised ${promiseAmount != null ? inrExact(promiseAmount) : "payment"} by ${dateLabel(promiseDate)}${message ? ` — ${message}` : ""}` : (message ?? "Promise updated");
  if (kind === "dispute") return message ?? "Dispute updated";
  if (kind === "call") return `Call${message ? ` — ${message}` : ""}`;
  if (kind === "escalation") return `Escalated${message ? ` — ${message}` : ""}`;
  return message ?? kind;
}
