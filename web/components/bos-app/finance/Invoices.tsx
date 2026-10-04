"use client";

import { useEffect, useRef, useState } from "react";
import {
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
  Textarea,
  WidgetCard,
  WidgetRow,
  type BosColumn,
} from "@/components/bos";
import { bos, type BosInvoice, type BosLineInput, type BosSettings, type InvoiceDisplayStatus, type InvoiceInput } from "@/lib/bos-app/api";
import {
  addDaysISO,
  computeGstTotals,
  dateLabel,
  inr,
  inrCompact,
  inrExact,
  invoiceBadge,
  isIntraState,
  sourceLabel,
  timeAgo,
  todayLocal,
  type GstTotals,
} from "@/lib/bos-app/format";
import { Loaded, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, PartyDialog, PartyField, PaymentDialog, usePartyList } from "../dialogs";

/* ---------- Printing ---------- */

function usePrint() {
  useEffect(() => {
    const clear = () => document.body.classList.remove("bos-printing");
    window.addEventListener("afterprint", clear);
    return () => {
      window.removeEventListener("afterprint", clear);
      clear();
    };
  }, []);
  return () => {
    document.body.classList.add("bos-printing");
    window.print();
  };
}

/* ---------- Paper ---------- */

type PaperDoc = {
  invoiceNo: string;
  partyName: string;
  partyGstin: string | null;
  partyAddress: string | null;
  issueDate: string;
  dueDate: string;
  placeOfSupply: string | null;
  intraState: boolean;
  totals: GstTotals;
  notes: string | null;
  amountPaid?: number;
  status?: InvoiceDisplayStatus;
};

const STAMP_INK: Record<string, string> = { emerald: "var(--bos-emerald-600)", coral: "var(--bos-coral-600)", amber: "var(--bos-amber-600)", blue: "var(--bos-blue-btn)" };

export function InvoicePaper({ settings, doc }: { settings: BosSettings; doc: PaperDoc }) {
  const t = doc.totals;
  const seller = [settings.address, [settings.gstin && `GSTIN ${settings.gstin}`, settings.state].filter(Boolean).join(" · "), [settings.phone, settings.email].filter(Boolean).join(" · ")]
    .filter(Boolean)
    .join("\n");
  const stamp = doc.status && doc.status !== "sent" ? invoiceBadge(doc.status) : null;
  const paid = doc.amountPaid ?? 0;
  const billTo = [doc.partyGstin && `GSTIN ${doc.partyGstin}`, doc.partyAddress].filter(Boolean).join("\n");
  const meta: Array<[string, string, string?]> = [
    ["Bill To", doc.partyName || "Customer name", billTo],
    ["Invoice Number", doc.invoiceNo],
    ["Invoice Date", dateLabel(doc.issueDate)],
    ["Due Date", dateLabel(doc.dueDate)],
    ["Place of Supply", doc.placeOfSupply || settings.state || "—", doc.intraState ? "Intra-state · CGST + SGST" : "Inter-state · IGST"],
  ];

  return (
    <article className="bos-inv-paper" aria-label="Invoice preview">
      <div className="bos-inv-paper-top">
        <div>
          <div className="bos-inv-paper-brand">{settings.companyName || "Your Company"}</div>
          {seller ? <div className="bos-inv-paper-seller">{seller}</div> : null}
          <div className="bos-inv-paper-powered">Powered by Justx BOS</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">{settings.gstin ? "TAX INVOICE" : "INVOICE"}</div>
          {stamp ? (
            <span className="bos-inv-stamp" style={{ color: STAMP_INK[stamp.tone] ?? "#6b7280" }}>
              {stamp.text}
            </span>
          ) : null}
        </div>
      </div>
      <div className="bos-inv-paper-meta">
        {meta.map(([label, value, sub]) => (
          <div key={label}>
            <div className="bos-inv-paper-label">{label}</div>
            <div className="bos-inv-paper-value">{value}</div>
            {sub ? <div className="bos-inv-paper-sub">{sub}</div> : null}
          </div>
        ))}
      </div>
      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>GST</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {t.lines.length ? (
            t.lines.map((line, i) => (
              <tr key={i}>
                <td>
                  {line.description || "Untitled item"}
                  {line.hsn ? <small>HSN/SAC {line.hsn}</small> : null}
                </td>
                <td>
                  {line.quantity}
                  {line.unit ? ` ${line.unit}` : ""}
                </td>
                <td>
                  {inrExact(line.rate)}
                  {line.discountPct ? <small>−{line.discountPct}% disc.</small> : null}
                </td>
                <td>{line.taxRate}%</td>
                <td>{inrExact(line.taxable)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="bos-inv-paper-empty">
                No items added yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="bos-inv-totals">
        <div className="bos-inv-totals-row">
          <span>Subtotal</span>
          <span>{inrExact(t.subtotal)}</span>
        </div>
        {t.discountTotal > 0 ? (
          <div className="bos-inv-totals-row">
            <span>Discount</span>
            <span>−{inrExact(t.discountTotal)}</span>
          </div>
        ) : null}
        {doc.intraState ? (
          <>
            <div className="bos-inv-totals-row">
              <span>CGST</span>
              <span>{inrExact(t.cgst)}</span>
            </div>
            <div className="bos-inv-totals-row">
              <span>SGST</span>
              <span>{inrExact(t.sgst)}</span>
            </div>
          </>
        ) : (
          <div className="bos-inv-totals-row">
            <span>IGST</span>
            <span>{inrExact(t.igst)}</span>
          </div>
        )}
        <div className="bos-inv-totals-row is-total">
          <span>Total</span>
          <span>{inrExact(t.grandTotal)}</span>
        </div>
        {paid > 0 ? (
          <>
            <div className="bos-inv-totals-row">
              <span>Received</span>
              <span>−{inrExact(paid)}</span>
            </div>
            <div className="bos-inv-totals-row is-due">
              <span>Balance due</span>
              <span>{inrExact(Math.max(0, t.grandTotal - paid))}</span>
            </div>
          </>
        ) : null}
      </div>
      {doc.notes ? <div className="bos-inv-notes">{doc.notes}</div> : null}
    </article>
  );
}

const totalsOf = (inv: BosInvoice): GstTotals => ({
  lines: inv.lines,
  subtotal: inv.subtotal,
  discountTotal: inv.discountTotal,
  taxTotal: inv.taxTotal,
  cgst: inv.cgst,
  sgst: inv.sgst,
  igst: inv.igst,
  grandTotal: inv.grandTotal,
});

/* ---------- Editor ---------- */

/** Raw input strings so partially typed numbers ("1.", "") survive re-renders. */
type DraftLine = { key: string; description: string; hsn: string | null; unit: string | null; quantity: string; rate: string; discountPct: number; taxRate: string };

const fromDraft = (d: DraftLine): BosLineInput => ({
  description: d.description.trim(),
  hsn: d.hsn,
  unit: d.unit,
  quantity: Number(d.quantity) || 0,
  rate: Number(d.rate) || 0,
  discountPct: d.discountPct,
  taxRate: Number(d.taxRate) || 0,
});

const isBlank = (d: DraftLine) => !d.description.trim() && !(Number(d.rate) > 0);

let lineSeq = 0;
const nextKey = () => `line-${++lineSeq}`;

function InvoiceEditor({ invoice, onDone }: { invoice: BosInvoice | null; onDone: (id: string | null) => void }) {
  const { session } = useBosApp();
  const settings = session.settings;
  const { run, busy } = useBosAction();
  const customers = usePartyList("customer", true);
  const formRef = useRef<HTMLFormElement>(null);
  const blankLine = (): DraftLine => ({ key: nextKey(), description: "", hsn: null, unit: null, quantity: "1", rate: "", discountPct: 0, taxRate: String(settings.defaultTaxRate) });

  const [form, setForm] = useState(() => {
    const today = todayLocal();
    return {
      partyId: invoice?.partyId ?? "",
      partyName: invoice?.partyName ?? "",
      partyGstin: invoice?.partyGstin ?? "",
      partyAddress: invoice?.partyAddress ?? "",
      placeOfSupply: invoice?.placeOfSupply ?? settings.state ?? "",
      issueDate: invoice?.issueDate ?? today,
      dueDate: invoice?.dueDate ?? addDaysISO(today, settings.paymentTermsDays || 15),
      notes: invoice ? (invoice.notes ?? "") : (settings.invoiceNotes ?? ""),
    };
  });
  const [lines, setLines] = useState<DraftLine[]>(() =>
    invoice?.lines.length
      ? invoice.lines.map((l) => ({
          key: nextKey(),
          description: l.description,
          hsn: l.hsn ?? null,
          unit: l.unit ?? null,
          quantity: String(l.quantity),
          rate: String(l.rate),
          discountPct: l.discountPct ?? 0,
          taxRate: String(l.taxRate),
        }))
      : [blankLine()],
  );
  const [newParty, setNewParty] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const setLine = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const intra = isIntraState(settings.state, form.placeOfSupply);
  const totals = computeGstTotals(lines.map(fromDraft), intra);
  const print = usePrint();

  const save = async (issue: boolean) => {
    if (!formRef.current?.reportValidity()) return;
    const filled = lines.filter((l) => !isBlank(l));
    const body: InvoiceInput = {
      partyId: form.partyId || null,
      partyName: form.partyName.trim(),
      partyGstin: form.partyGstin.trim() || null,
      partyAddress: form.partyAddress.trim() || null,
      placeOfSupply: form.placeOfSupply.trim() || null,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      lines: filled.map(fromDraft),
      notes: form.notes.trim() || null,
      issue,
    };
    const out = await run(issue ? "issue" : "save", () => (invoice ? bos.updateInvoice(invoice.id, body) : bos.createInvoice(body)), {
      success: issue ? "Invoice issued" : invoice ? "Invoice saved" : "Draft saved",
      description: body.partyName,
    });
    if (out) onDone(out.invoice.id);
  };

  return (
    <>
      <div className="bos-app-recordbar">
        <button type="button" className="bos-back-link" onClick={() => onDone(invoice?.id ?? null)}>
          ← {invoice ? `Back to ${invoice.invoiceNo}` : "Back to invoices"}
        </button>
        <div className="bos-app-actions">
          <Button size="sm" icon="printer" onClick={print}>
            Preview print
          </Button>
        </div>
      </div>
      <div className="bos-inv-layout">
        <form ref={formRef} className="bos-inv-form" onSubmit={(e) => e.preventDefault()} aria-label={invoice ? `Edit ${invoice.invoiceNo}` : "New invoice"}>
          <FormGrid>
            <PartyField
              label="Bill To"
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
            <Field label="Invoice Number">{({ id }) => <Input id={id} value={invoice?.invoiceNo ?? "Assigned on save"} readOnly disabled />}</Field>
            <Field label="Invoice Date">{({ id }) => <Input id={id} type="date" required value={form.issueDate} onChange={(e) => set("issueDate")(e.target.value)} />}</Field>
            <Field label="Due Date">{({ id }) => <Input id={id} type="date" required min={form.issueDate} value={form.dueDate} onChange={(e) => set("dueDate")(e.target.value)} />}</Field>
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
                <Input size="sm" aria-label={`Item ${i + 1} description`} placeholder="Item description" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                <Input size="sm" aria-label={`Item ${i + 1} quantity`} placeholder="Qty" type="number" inputMode="decimal" min={0} step="any" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                <Input size="sm" aria-label={`Item ${i + 1} rate`} placeholder="Rate (₹)" type="number" inputMode="decimal" min={0} step="any" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} />
                <Input size="sm" aria-label={`Item ${i + 1} GST rate`} placeholder="GST %" type="number" inputMode="decimal" min={0} max={100} step="any" value={l.taxRate} onChange={(e) => setLine(l.key, { taxRate: e.target.value })} />
                <div className="bos-app-line-amount">
                  {inr(totals.lines[i]?.amount ?? 0)}
                  {l.discountPct ? <small>after {l.discountPct}% disc.</small> : null}
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
            <Field label="Notes">{({ id }) => <Textarea id={id} rows={3} value={form.notes} placeholder="Bank details, terms…" onChange={(e) => set("notes")(e.target.value)} />}</Field>
          </div>

          <div className="bos-row" style={{ justifyContent: "flex-end", marginTop: 20, gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" onClick={() => onDone(invoice?.id ?? null)}>
              Cancel
            </Button>
            {!invoice || invoice.status === "draft" ? (
              <Button size="sm" icon="file" disabled={busy !== null} onClick={() => save(false)}>
                {busy === "save" ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
            <Button size="sm" variant="primary" icon="check" disabled={busy !== null} onClick={() => save(!invoice || invoice.status === "draft")}>
              {busy === "issue" ? "Issuing…" : invoice && invoice.status !== "draft" ? "Save changes" : "Save & issue"}
            </Button>
          </div>
        </form>

        <InvoicePaper
          settings={settings}
          doc={{
            invoiceNo: invoice?.invoiceNo ?? `${settings.invoicePrefix || "INV"}/…`,
            partyName: form.partyName,
            partyGstin: form.partyGstin || null,
            partyAddress: form.partyAddress || null,
            issueDate: form.issueDate,
            dueDate: form.dueDate,
            placeOfSupply: form.placeOfSupply || null,
            intraState: intra,
            totals,
            notes: form.notes || null,
            status: invoice?.displayStatus ?? "draft",
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

/* ---------- Detail ---------- */

const METHOD_LABEL = { bank: "Bank transfer", upi: "UPI", cash: "Cash", cheque: "Cheque", card: "Card", other: "Other" } as const;

function InvoiceDetail({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: (inv: BosInvoice) => void }) {
  const { session, canManage } = useBosApp();
  const { run, busy } = useBosAction();
  const [paying, setPaying] = useState<BosInvoice | null>(null);
  const [confirm, setConfirm] = useState<"void" | "delete" | null>(null);
  const print = usePrint();
  const state = useBosData(async () => {
    const [detail, events] = await Promise.all([bos.invoice(id), bos.events({ entityType: "invoice", entityId: id, limit: 8 })]);
    return { ...detail, events: events.events };
  }, [id]);

  return (
    <Loaded state={state} rows={2}>
      {({ invoice: inv, payments, events }) => {
        const open = inv.status === "sent" || inv.status === "partial";
        const editable = inv.status !== "void" && inv.status !== "paid" && inv.amountPaid === 0;
        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ← Back to invoices
              </button>
              <div className="bos-app-actions">
                {editable ? (
                  <Button size="sm" icon="edit" onClick={() => onEdit(inv)}>
                    Edit
                  </Button>
                ) : null}
                <Button size="sm" icon="printer" onClick={print}>
                  Print / PDF
                </Button>
                {inv.status === "draft" ? (
                  <Button size="sm" variant="primary" icon="check" disabled={busy !== null} onClick={() => run("issue", () => bos.issueInvoice(inv.id), { success: "Invoice issued", description: inv.invoiceNo })}>
                    Issue invoice
                  </Button>
                ) : null}
                {open ? (
                  <Button size="sm" variant="success" icon="wallet" onClick={() => setPaying(inv)}>
                    Record payment
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="bos-inv-layout">
              <Stack gap={16}>
                <Grid cols={2} min={130}>
                  <KpiCard label="Invoice total" value={inr(inv.grandTotal)} chip={{ color: "blue", glyph: "₹" }} delta={`Tax ${inr(inv.taxTotal)}`} deltaTone="muted" interactive={false} />
                  <KpiCard
                    label="Balance due"
                    value={inr(inv.balance)}
                    valueTone={inv.displayStatus === "overdue" ? "coral" : undefined}
                    chip={{ color: inv.balance > 0 ? "amber" : "mint", glyph: inv.balance > 0 ? "◐" : "✓" }}
                    delta={inv.displayStatus === "overdue" ? `${inv.daysOverdue} days overdue` : `Due ${dateLabel(inv.dueDate)}`}
                    deltaTone={inv.displayStatus === "overdue" ? "down" : "muted"}
                    interactive={false}
                  />
                </Grid>
                <WidgetCard title="🧾 Details" dot="blue" note={<StatusBadge view={invoiceBadge(inv.displayStatus)} />}>
                  <WidgetRow label="Invoice no." value={inv.invoiceNo} />
                  <WidgetRow label="Customer" value={inv.partyName} />
                  <WidgetRow label="Issued" value={dateLabel(inv.issueDate)} />
                  <WidgetRow label="Supply" value={inv.intraState ? "Intra-state (CGST+SGST)" : "Inter-state (IGST)"} />
                  {inv.sourceTool ? <WidgetRow label="Created from" value={`${sourceLabel(inv.sourceTool)} · ${inv.sourceRef ?? ""}`} valueTone="blue" /> : null}
                </WidgetCard>
                <WidgetCard title="💳 Payments" dot="mint" note={payments.length ? `${payments.length} received` : undefined}>
                  {payments.length ? (
                    payments.map((p) => (
                      <WidgetRow
                        key={p.id}
                        label={
                          <span>
                            {dateLabel(p.paidOn)} · {METHOD_LABEL[p.method]}
                            {p.reference ? <span className="bos-text-faint"> · {p.reference}</span> : null}
                          </span>
                        }
                        value={
                          <span className="bos-row" style={{ gap: 6 }}>
                            <span className="bos-widget-value" style={{ color: "var(--bos-emerald-600)" }}>
                              {inr(p.amount)}
                            </span>
                            {canManage ? (
                              <button
                                type="button"
                                className="bos-inv-remove"
                                aria-label={`Remove payment of ${inr(p.amount)}`}
                                title="Remove payment"
                                disabled={busy !== null}
                                onClick={() => run("unpay", () => bos.removePayment(inv.id, p.id), { success: "Payment removed" })}
                              >
                                <BosIcon name="x" />
                              </button>
                            ) : null}
                          </span>
                        }
                      />
                    ))
                  ) : (
                    <WidgetRow label={<span className="bos-text-faint">{inv.status === "draft" ? "Issue the invoice to start collecting." : "No payments yet"}</span>} />
                  )}
                </WidgetCard>
                <WidgetCard title="🕑 Activity" dot="lavender">
                  {events.length ? (
                    events.map((e) => <WidgetRow key={e.id} label={e.summary} value={timeAgo(e.createdAt)} valueTone="faint" soft />)
                  ) : (
                    <WidgetRow label={<span className="bos-text-faint">No activity recorded</span>} />
                  )}
                </WidgetCard>
                {inv.status === "draft" || (canManage && inv.status !== "void" && inv.amountPaid === 0) ? (
                  <div className="bos-row" style={{ gap: 8 }}>
                    {inv.status === "draft" ? (
                      <Button size="sm" variant="destructive" onClick={() => setConfirm("delete")}>
                        Delete draft
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => setConfirm("void")}>
                        Void invoice
                      </Button>
                    )}
                  </div>
                ) : null}
              </Stack>
              <InvoicePaper
                settings={session.settings}
                doc={{ ...inv, totals: totalsOf(inv), status: inv.displayStatus }}
              />
            </div>
            <PaymentDialog invoice={paying} onClose={() => setPaying(null)} />
            <ConfirmDialog
              open={confirm !== null}
              onClose={() => setConfirm(null)}
              destructive
              title={confirm === "delete" ? `Delete draft ${inv.invoiceNo}?` : `Void ${inv.invoiceNo}?`}
              description={confirm === "delete" ? "The draft is removed permanently." : "The invoice stays on record as VOID and drops out of receivables and GST."}
              confirmLabel={confirm === "delete" ? "Delete" : "Void invoice"}
              busy={busy === "void" || busy === "delete"}
              onConfirm={async () => {
                if (confirm === "delete") {
                  const ok = await run("delete", async () => {
                    await bos.deleteInvoice(inv.id);
                    return true;
                  }, { success: "Draft deleted", description: inv.invoiceNo });
                  setConfirm(null);
                  if (ok) onBack();
                } else {
                  await run("void", () => bos.voidInvoice(inv.id), { success: "Invoice voided", description: inv.invoiceNo, tone: "amber" });
                  setConfirm(null);
                }
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

/* ---------- List ---------- */

type ListFilter = "all" | "draft" | "open" | "overdue" | "paid" | "void";

const FILTERS: ReadonlyArray<{ key: ListFilter; label: string; test: (i: BosInvoice) => boolean }> = [
  { key: "all", label: "All", test: () => true },
  { key: "draft", label: "Drafts", test: (i) => i.status === "draft" },
  { key: "open", label: "Unpaid", test: (i) => i.status === "sent" || i.status === "partial" },
  { key: "overdue", label: "Overdue", test: (i) => i.displayStatus === "overdue" },
  { key: "paid", label: "Paid", test: (i) => i.status === "paid" },
  { key: "void", label: "Void", test: (i) => i.status === "void" },
];

function InvoiceList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [filter, setFilter] = useState<ListFilter>("all");
  const [query, setQuery] = useState("");
  const state = useBosData(() => bos.invoices(), []);

  return (
    <Loaded state={state}>
      {({ invoices }) => {
        const q = query.trim().toLowerCase();
        const test = FILTERS.find((f) => f.key === filter)?.test ?? (() => true);
        const rows = invoices.filter((i) => test(i) && (!q || `${i.invoiceNo} ${i.partyName} ${i.partyGstin ?? ""}`.toLowerCase().includes(q)));
        const month = todayLocal().slice(0, 7);
        const issued = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
        const thisMonth = issued.filter((i) => i.issueDate.startsWith(month));
        const outstanding = issued.reduce((s, i) => s + i.balance, 0);
        const overdue = invoices.filter((i) => i.displayStatus === "overdue");
        const columns: BosColumn<BosInvoice>[] = [
          { key: "invoiceNo", header: "Invoice", mono: true, cell: (i) => i.invoiceNo },
          {
            key: "party",
            header: "Customer",
            cell: (i) => (
              <span>
                {i.partyName}
                {i.sourceTool ? <span className="bos-text-faint"> · {sourceLabel(i.sourceTool)}</span> : null}
              </span>
            ),
          },
          { key: "issueDate", header: "Date", mono: true, cell: (i) => dateLabel(i.issueDate) },
          { key: "dueDate", header: "Due", mono: true, cell: (i) => dateLabel(i.dueDate) },
          { key: "grandTotal", header: "Amount", align: "right", mono: true, cell: (i) => inr(i.grandTotal) },
          { key: "balance", header: "Balance", align: "right", mono: true, cell: (i) => (i.balance > 0 && i.status !== "draft" ? inr(i.balance) : "—") },
          { key: "status", header: "Status", cell: (i) => <StatusBadge view={invoiceBadge(i.displayStatus)} /> },
        ];
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Invoiced this month" value={inrCompact(thisMonth.reduce((s, i) => s + i.grandTotal, 0))} chip={{ color: "mint", glyph: "₹" }} delta={`${thisMonth.length} invoice${thisMonth.length === 1 ? "" : "s"}`} deltaTone="muted" />
              <KpiCard label="Outstanding" value={inrCompact(outstanding)} chip={{ color: "rose", glyph: "◐" }} delta={`${issued.filter((i) => i.balance > 0).length} unpaid`} deltaTone={outstanding ? "warn" : "muted"} />
              <KpiCard
                label="Overdue"
                value={inrCompact(overdue.reduce((s, i) => s + i.balance, 0))}
                valueTone={overdue.length ? "coral" : undefined}
                chip={{ color: "amber", glyph: "!" }}
                delta={overdue.length ? `${overdue.length} past due date` : "None overdue"}
                deltaTone={overdue.length ? "down" : "up"}
              />
              <KpiCard label="Drafts" value={invoices.filter((i) => i.status === "draft").length} chip={{ color: "lavender", glyph: "✎" }} delta="Ready to issue" deltaTone="muted" />
            </Grid>
            <ModuleToolbar>
              <SearchInput placeholder="Search invoice no., customer, GSTIN…" aria-label="Search invoices" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="bos-spacer" />
              <Button size="sm" variant="primary" icon="plus" onClick={onNew}>
                Create Invoice
              </Button>
            </ModuleToolbar>
            <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }} role="group" aria-label="Filter invoices">
              {FILTERS.map((f) => (
                <FilterChip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label}
                  {f.key !== "all" ? ` · ${invoices.filter(f.test).length}` : ""}
                </FilterChip>
              ))}
            </div>
            <div>
              <DataTable
                caption="Invoices"
                columns={columns}
                rows={rows}
                rowKey={(i) => i.id}
                onRowClick={(i) => onOpen(i.id)}
                chevron
                empty={invoices.length ? "No invoices match this view." : "No invoices yet — create one, or import an accepted quotation from Connected Tools."}
              />
              <Pagination>
                Showing {rows.length} of {invoices.length}
              </Pagination>
            </div>
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- Controller ---------- */

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "edit"; invoice: BosInvoice | null };

function viewFromIntent(intent: string | null): View {
  if (intent === "new") return { kind: "edit", invoice: null };
  if (intent?.startsWith("open:")) return { kind: "detail", id: intent.slice(5) };
  return { kind: "list" };
}

export function Invoices() {
  const { takeIntent } = useBosApp();
  const [view, setView] = useState<View>(() => viewFromIntent(takeIntent("invoices")));

  if (view.kind === "edit") {
    return <InvoiceEditor invoice={view.invoice} onDone={(id) => setView(id ? { kind: "detail", id } : { kind: "list" })} />;
  }
  if (view.kind === "detail") {
    return <InvoiceDetail id={view.id} onBack={() => setView({ kind: "list" })} onEdit={(invoice) => setView({ kind: "edit", invoice })} />;
  }
  return <InvoiceList onOpen={(id) => setView({ kind: "detail", id })} onNew={() => setView({ kind: "edit", invoice: null })} />;
}
