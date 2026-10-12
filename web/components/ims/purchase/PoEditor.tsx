"use client";

import "./purchase.css";
import { useMemo, useState } from "react";
import { Alert, Button, Card, Field, FormGrid, Input, Textarea } from "@/components/bos";
import type { ImsItem, ImsSettings, PartyOption } from "@/lib/ims/api";
import { addDaysISO, computeTotals, inr, inrExact, num, qtyText, todayLocal } from "@/lib/ims/format";
import { purchase, type PoAction, type PoShare, type PurchaseOrder } from "@/lib/ims/purchase";
import { stateCodeOf } from "@/lib/ims/settings";
import { PageHeader, Stack, useIms, useImsAction } from "../core";
import { LineEditor, lineFromItem, lineKey, toLineInputs, type EditableLine } from "../shared/LineEditor";
import { PartySelect, useItemCatalog, usePartyOptions } from "../shared/pickers";
import { PartyDialog } from "./PartyDialog";

export type PoPrefill = { supplierId: string | null; supplierName?: string; lines: EditableLine[]; note?: string };

type PartyPlace = { state?: string | null; stateCode?: string | null; address?: string | null; gstin?: string | null };

/** Same rule as the server: compare GST state codes; unknown on either side → intra-state. */
function intraFor(settings: ImsSettings, party: PartyPlace | null): boolean {
  const a = stateCodeOf(settings.stateCode) ?? stateCodeOf(settings.state);
  const b = stateCodeOf(party?.stateCode) ?? stateCodeOf(party?.state);
  if (a && b) return a === b;
  const sa = String(settings.state ?? "").trim().toLowerCase();
  const sb = String(party?.state ?? "").trim().toLowerCase();
  return !sa || !sb || sa === sb;
}

const fromOrderLines = (order: PurchaseOrder): EditableLine[] =>
  order.lines.map((l) => ({ key: lineKey(), itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate }));

/**
 * Full-page PO editor: supplier (with inline add), supplier-first quick add, GST lines,
 * delivery, terms and the three exits — save draft, submit, save & send.
 */
export function PoEditor({ order, prefill, onSaved, onCancel }: { order?: PurchaseOrder | null; prefill?: PoPrefill | null; onSaved: (order: PurchaseOrder, share: PoShare | null) => void; onCancel: () => void }) {
  const { session, can } = useIms();
  const settings = session.settings;
  const { run, busy } = useImsAction();
  const today = todayLocal();
  const suppliers = usePartyOptions("supplier");
  const catalog = useItemCatalog();

  const [supplier, setSupplier] = useState<{ id: string | null; name: string }>(() =>
    order ? { id: order.supplierId, name: order.supplierName } : { id: prefill?.supplierId ?? null, name: prefill?.supplierName ?? "" },
  );
  const [orderDate, setOrderDate] = useState(order?.orderDate ?? today);
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? addDaysISO(today, 7));
  const [deliveryAddress, setDeliveryAddress] = useState(order?.deliveryAddress ?? settings.address ?? "");
  const [terms, setTerms] = useState(order ? (order.terms ?? "") : (settings.terms ?? ""));
  const [paymentTerms, setPaymentTerms] = useState(order?.paymentTermsDays != null ? String(order.paymentTermsDays) : "");
  const [notes, setNotes] = useState(order?.notes ?? prefill?.note ?? "");
  const [lines, setLines] = useState<EditableLine[]>(() => (order ? fromOrderLines(order) : (prefill?.lines ?? [])));
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [touched, setTouched] = useState(false);

  const party: PartyOption | null = useMemo(() => (supplier.id ? ((suppliers.data ?? []).find((p) => p.id === supplier.id) ?? null) : null), [supplier.id, suppliers.data]);
  const supplierName = supplier.name || party?.name || "";
  const place: PartyPlace | null = party ?? (order && order.supplierId === supplier.id ? order.supplier : null);
  const intraState = intraFor(settings, place);
  const totals = useMemo(() => computeTotals(lines, intraState), [lines, intraState]);
  const valid = toLineInputs(lines);
  const needsApproval = settings.poApprovalLimit > 0 && totals.grandTotal >= settings.poApprovalLimit;
  const effectiveTerms = paymentTerms.trim() ? Number(paymentTerms) : (party?.paymentTermsDays ?? settings.paymentTermsDays);

  const supplierItems = useMemo(() => {
    if (!supplier.id) return [] as ImsItem[];
    const inPo = new Set(lines.map((l) => l.itemId).filter(Boolean));
    return (catalog.data ?? [])
      .filter((i) => i.supplierId === supplier.id && !inPo.has(i.id))
      .sort((a, b) => Number(b.status === "LOW" || b.status === "OUT_OF_STOCK") - Number(a.status === "LOW" || a.status === "OUT_OF_STOCK") || a.name.localeCompare(b.name));
  }, [catalog.data, supplier.id, lines]);
  const lowItems = supplierItems.filter((i) => i.status === "LOW" || i.status === "OUT_OF_STOCK");

  const errors = {
    supplier: !supplierName.trim() ? "Choose a supplier" : null,
    lines: valid.length === 0 ? "Add at least one item with a quantity" : lines.some((l) => l.name.trim() && num(l.qty) <= 0) ? "Every line needs a quantity above zero" : null,
    expected: expectedDate && expectedDate < orderDate ? "Must be on or after the order date" : null,
    terms: paymentTerms.trim() && !(Number.isInteger(Number(paymentTerms)) && Number(paymentTerms) >= 0 && Number(paymentTerms) <= 365) ? "0–365 days" : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const shown = touched ? errors : { supplier: null, lines: null, expected: null, terms: null };

  const addItems = (items: ImsItem[]) => setLines((ls) => [...ls.filter((l) => l.name.trim() || l.itemId), ...items.map((i) => lineFromItem(i, "purchase", Math.max(1, Math.ceil(i.suggestedReorder || 1))))]);

  const save = async (action: PoAction) => {
    setTouched(true);
    if (hasErrors) return;
    const input = {
      supplierId: supplier.id,
      supplierName: supplierName.trim(),
      orderDate,
      expectedDate: expectedDate || null,
      deliveryAddress: deliveryAddress.trim() || null,
      paymentTermsDays: paymentTerms.trim() ? Number(paymentTerms) : null,
      lines: valid,
      terms: terms.trim() || null,
      notes: notes.trim() || null,
      action,
    };
    const success = action === "draft" ? "Draft saved" : action === "send" && !needsApproval ? "PO approved — ready to send" : needsApproval ? "Sent for approval" : "PO approved";
    const out = await run(`po-${action}`, () => (order ? purchase.updateOrder(order.id, input) : purchase.createOrder(input)), { success });
    if (out) onSaved(out.order, out.share);
  };

  const anyBusy = busy?.startsWith("po-") ?? false;
  return (
    <div>
      <PageHeader
        title={order ? `Edit ${order.poNo}` : "New purchase order"}
        sub={order?.status === "rejected" ? `Rejected${order.approvalNote ? `: ${order.approvalNote}` : ""}. Fix it and resubmit.` : "Raise a GST purchase order to a supplier. Linked items receive into stock when goods arrive."}
        actions={
          <Button size="sm" icon="chevronLeft" onClick={onCancel}>
            Back to list
          </Button>
        }
      />
      <Stack gap={16}>
        {!order && settings.draftPoPurgeDays > 0 ? (
          <Alert tone="blue" title="Drafts are temporary">
            Drafts untouched for {settings.draftPoPurgeDays} day{settings.draftPoPurgeDays === 1 ? "" : "s"} are deleted automatically. Submitting makes the PO permanent.
          </Alert>
        ) : null}
        {prefill?.note && !order ? <Alert tone="emerald" title="Prefilled from the restock list">{prefill.note}</Alert> : null}

        <div className="ims-doc-grid">
          <div className="ims-doc-box">
            <div className="ims-doc-box-label">From (your business)</div>
            <div className="ims-strong">{settings.businessName || session.brand?.name || "Your business"}</div>
            <div className="ims-muted">{settings.address || "Add your address in Settings → Business profile"}</div>
            <div className="ims-muted">
              {[settings.state, settings.gstin ? `GSTIN ${settings.gstin}` : "GSTIN not set", settings.phone].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="ims-doc-box">
            <div className="ims-doc-box-label">
              <span>To (supplier) *</span>
              {can("suppliers") || can("po") ? (
                <Button size="sm" variant="ghost" icon="plus" onClick={() => setAddingSupplier(true)}>
                  New supplier
                </Button>
              ) : null}
            </div>
            <PartySelect
              kind="supplier"
              value={{ id: supplier.id, name: supplierName }}
              onChange={(v) => {
                setSupplier({ id: v.id, name: v.name });
                if (v.party?.paymentTermsDays != null && !paymentTerms.trim()) setPaymentTerms(String(v.party.paymentTermsDays));
              }}
              placeholder="Supplier name"
            />
            {shown.supplier ? <div className="bos-field-error">{shown.supplier}</div> : null}
            {place ? (
              <div className="ims-muted" style={{ marginTop: 6 }}>
                {[party?.contactPerson, party?.mobile, place.address, place.state, place.gstin ? `GSTIN ${place.gstin}` : "Unregistered"].filter(Boolean).join(" · ")}
              </div>
            ) : supplierName && !supplier.id ? (
              <div className="ims-faint" style={{ marginTop: 6 }}>
                One-off supplier — not saved to your parties.
              </div>
            ) : null}
            <div className="ims-faint" style={{ marginTop: 4 }}>
              GST: {intraState ? "CGST + SGST (intra-state)" : "IGST (inter-state)"}
            </div>
          </div>
        </div>

        {supplierItems.length ? (
          <Card interactive={false}>
            <div className="ims-between" style={{ marginBottom: 8 }}>
              <span className="ims-strong">Items from {supplierName}</span>
              {lowItems.length ? (
                <Button size="sm" onClick={() => addItems(lowItems)}>
                  Add all {lowItems.length} low-stock
                </Button>
              ) : null}
            </div>
            <div className="ims-quickadd" role="group" aria-label={`Quick add items from ${supplierName}`}>
              {supplierItems.slice(0, 40).map((i) => (
                <button key={i.id} type="button" className={i.status === "LOW" || i.status === "OUT_OF_STOCK" ? "is-low" : undefined} onClick={() => addItems([i])} title={`${qtyText(i.currentStock, i.unit)} in stock · min ${qtyText(i.minStock)}`}>
                  + {i.name}
                  <small>
                    {qtyText(i.currentStock, i.unit)} · {inr(i.purchasePrice)}
                  </small>
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        <Card interactive={false}>
          <div className="ims-between" style={{ marginBottom: 10 }}>
            <span className="ims-strong">Items</span>
            <span className="ims-faint">{valid.length} line{valid.length === 1 ? "" : "s"}</span>
          </div>
          <LineEditor lines={lines} onChange={setLines} intraState={intraState} price="purchase" />
          {shown.lines ? <div className="bos-field-error">{shown.lines}</div> : null}
        </Card>

        {needsApproval ? (
          <Alert tone="amber" title="This PO needs approval">
            {inrExact(totals.grandTotal)} is at or above the {inr(settings.poApprovalLimit)} approval limit. Submitting sends it to approvers; it can be sent to the supplier once approved.
          </Alert>
        ) : null}

        <Card interactive={false}>
          <FormGrid>
            <Field label="Order date">
              {({ id }) => <Input id={id} type="date" value={orderDate} max={today} onChange={(e) => setOrderDate(e.target.value || today)} />}
            </Field>
            <Field label="Expected delivery" error={shown.expected}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="date" min={orderDate} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />}
            </Field>
            <Field label="Payment terms (days)" error={shown.terms} hint={paymentTerms.trim() ? undefined : `Using ${effectiveTerms === 0 ? "immediate" : `${effectiveTerms} days`} (${party?.paymentTermsDays != null ? "supplier" : "Settings"} default)`}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} max={365} inputMode="numeric" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder={String(effectiveTerms)} />}
            </Field>
            <Field label="Deliver to">
              {({ id }) => <Input id={id} value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} maxLength={500} placeholder="Godown / store address" />}
            </Field>
            <Field label="Notes to supplier" full>
              {({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Packing, brand preferences, delivery window…" />}
            </Field>
            <Field label="Terms & conditions" full hint="Defaults from Settings → Business profile">
              {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} />}
            </Field>
          </FormGrid>
        </Card>

        <div className="ims-sticky-actions">
          <span className="bos-spacer ims-muted" style={{ alignSelf: "center" }}>
            Total <b className="ims-strong">{inrExact(totals.grandTotal)}</b>
            {touched && hasErrors ? <span style={{ color: "var(--bos-coral-600)", marginLeft: 10 }}>Fix the highlighted fields</span> : null}
          </span>
          <Button variant="ghost" onClick={onCancel} disabled={anyBusy}>
            Cancel
          </Button>
          <Button onClick={() => save("draft")} disabled={anyBusy}>
            {busy === "po-draft" ? "Saving…" : "Save draft"}
          </Button>
          {needsApproval ? (
            <Button variant="primary" icon="check" onClick={() => save("submit")} disabled={anyBusy}>
              {busy === "po-submit" ? "Submitting…" : "Submit for approval"}
            </Button>
          ) : (
            <>
              <Button onClick={() => save("submit")} disabled={anyBusy}>
                {busy === "po-submit" ? "Saving…" : "Save & approve"}
              </Button>
              <Button variant="primary" icon="check" onClick={() => save("send")} disabled={anyBusy}>
                {busy === "po-send" ? "Saving…" : "Save & send"}
              </Button>
            </>
          )}
        </div>
      </Stack>

      <PartyDialog
        open={addingSupplier}
        party={null}
        defaultKind="supplier"
        lockKind
        onClose={() => setAddingSupplier(false)}
        onSaved={(p) => {
          setSupplier({ id: p.id, name: p.name });
          if (p.paymentTermsDays != null) setPaymentTerms(String(p.paymentTermsDays));
        }}
      />
    </div>
  );
}
