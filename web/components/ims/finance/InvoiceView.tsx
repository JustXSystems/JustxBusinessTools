"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, Dialog, WidgetCard } from "@/components/bos";
import { bom, type BomDc } from "@/lib/ims/bom";
import { finance, INVOICE_BADGE, invoiceShareText, methodLabel, whatsappShareLink, type InvoiceDetail } from "@/lib/ims/finance";
import { dateLabel, inrExact, stampLabel } from "@/lib/ims/format";
import { Loaded, Stack, StatusBadge, useIms, useImsAction, useImsData, usePrint } from "../core";
import { DocRefLink } from "../bom/DocRefLink";
import { activityTone, BackLink, ConfirmDialog, InvoicePaper, KeyValues, PaymentDialog, ReasonDialog, Stats, Timeline, type TimelineItem } from "./shared";

type Dlg = null | "pay" | "cancel" | "delete" | "share" | { voidId: string; amount: number };

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
  const isIssued = inv.status === "issued";
  const shareText = invoiceShareText(inv, { name: session.settings.businessName, gstin: session.settings.gstin, phone: session.settings.phone });

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
                <Badge tag="lavender" title={inv.sourceTool === "ims_bom" ? "Created from Bill of Materials" : "Created from quotation"}>
                  {inv.sourceTool === "ims_bom" ? "From BOM" : "From Quotation"}
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
              <Button icon="printer" onClick={print}>
                Print
              </Button>
              <Button icon="sparkle" onClick={() => setDlg("share")}>
                WhatsApp
              </Button>
            </div>
            <div className="ims-row" style={{ marginTop: 8 }}>
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

function activityText(kind: string, channel: string | null, message: string | null, promiseDate: string | null, promiseAmount: number | null): string {
  if (kind === "reminder") return `Reminder sent${channel ? ` by ${channel === "whatsapp" ? "WhatsApp" : channel.toUpperCase()}` : ""}`;
  if (kind === "promise") return promiseDate ? `Promised ${promiseAmount != null ? inrExact(promiseAmount) : "payment"} by ${dateLabel(promiseDate)}${message ? ` — ${message}` : ""}` : (message ?? "Promise updated");
  if (kind === "dispute") return message ?? "Dispute updated";
  if (kind === "call") return `Call${message ? ` — ${message}` : ""}`;
  if (kind === "escalation") return `Escalated${message ? ` — ${message}` : ""}`;
  return message ?? kind;
}
