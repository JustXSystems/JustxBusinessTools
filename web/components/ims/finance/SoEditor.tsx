"use client";

import "../purchase/purchase.css";
import { useMemo, useState } from "react";
import { Alert, Button, Card, Field, FormGrid, Input, Textarea } from "@/components/bos";
import type { PartyOption } from "@/lib/ims/api";
import { gstStateName, intraStateFor } from "@/lib/ims/finance";
import { addDaysISO, computeTotals, inrExact, num } from "@/lib/ims/format";
import { salesOrders, type SalesOrder, type SoDetail } from "@/lib/ims/sales-orders";
import { PageHeader, Stack, useIms, useImsAction } from "../core";
import { LineEditor, lineKey, toLineInputs, type EditableLine } from "../shared/LineEditor";
import { fillRelated, ForceRelatedToggle, PartySelect, usePartyOptions } from "../shared/pickers";

export type SoPrefill = { customerId: string | null; customerName?: string; lines: EditableLine[]; note?: string };

const fromOrderLines = (o: SalesOrder): EditableLine[] =>
  o.lines.map((l) => ({ key: lineKey(), itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate }));

/**
 * Full-page sales order editor: customer, dates, customer PO ref, ship-to, GST lines, notes.
 * Exits: save draft, or save & confirm (a confirmed order can be delivered and invoiced).
 */
export function SoEditor({ order, prefill, onSaved, onCancel }: { order?: SalesOrder | null; prefill?: SoPrefill | null; onSaved: (detail: SoDetail) => void; onCancel: () => void }) {
  const { session } = useIms();
  const settings = session.settings;
  const { run, busy } = useImsAction();
  const today = session.today;
  const customers = usePartyOptions("customer");

  const [customer, setCustomer] = useState<{ id: string | null; name: string }>(() =>
    order ? { id: order.customerId, name: order.customerName } : { id: prefill?.customerId ?? null, name: prefill?.customerName ?? "" },
  );
  const [party, setParty] = useState<PartyOption | null>(null);
  const [gstin, setGstin] = useState(order?.customerGstin ?? "");
  const [mobile, setMobile] = useState(order?.customerMobile ?? "");
  const [email, setEmail] = useState(order?.customerEmail ?? "");
  const [billTo, setBillTo] = useState(order?.billToAddress ?? "");
  const [shipTo, setShipTo] = useState(order?.shipToAddress ?? "");
  const [customerPoRef, setCustomerPoRef] = useState(order?.customerPoRef ?? "");
  const [orderDate, setOrderDate] = useState(order?.orderDate ?? today);
  const [deliveryDate, setDeliveryDate] = useState(order?.deliveryDate ?? addDaysISO(today, 7));
  const [lines, setLines] = useState<EditableLine[]>(() => (order ? fromOrderLines(order) : (prefill?.lines ?? [])));
  const [notes, setNotes] = useState(order?.notes ?? prefill?.note ?? "");
  const [terms, setTerms] = useState(order ? (order.terms ?? "") : (settings.terms ?? ""));
  const [touched, setTouched] = useState(false);
  const [forceRelatedFill, setForceRelatedFill] = useState(false);

  // Editing an order for a saved customer: resolve the party once so GST place-of-supply matches the server.
  const resolved = party ?? (customer.id ? ((customers.data ?? []).find((p) => p.id === customer.id) ?? null) : null);
  const customerName = customer.name || resolved?.name || "";
  const place = resolved?.state || gstStateName(gstin) || settings.state || "";
  const intraState = intraStateFor(settings, place);
  const totals = useMemo(() => computeTotals(lines, intraState), [lines, intraState]);
  const valid = toLineInputs(lines);

  const errors = {
    customer: !customerName.trim() ? "Pick a customer or type a name" : null,
    lines: valid.length === 0 ? "Add at least one item with a quantity" : lines.some((l) => l.name.trim() && num(l.qty) <= 0) ? "Every line needs a quantity above zero" : null,
    delivery: deliveryDate && deliveryDate < orderDate ? "Must be on or after the order date" : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const shown = touched ? errors : { customer: null, lines: null, delivery: null };

  const pickCustomer = (v: { id: string | null; name: string; party: PartyOption | null }, meta?: { picked?: boolean }) => {
    setCustomer({ id: v.id, name: v.name });
    setParty(v.party);
    if (!v.party) return;
    const force = Boolean(meta?.picked && forceRelatedFill);
    fillRelated(gstin, v.party.gstin, setGstin, force);
    fillRelated(mobile, v.party.mobile, setMobile, force);
    fillRelated(email, v.party.email, setEmail, force);
    fillRelated(billTo, [v.party.address, v.party.city].filter(Boolean).join(", "), setBillTo, force);
  };

  const save = async (confirm: boolean) => {
    setTouched(true);
    if (hasErrors) return;
    const input = {
      customerId: customer.id,
      customerName: customerName.trim(),
      customerGstin: gstin.trim().toUpperCase() || null,
      customerEmail: email.trim() || null,
      customerMobile: mobile.trim() || null,
      billToAddress: billTo.trim() || null,
      shipToAddress: shipTo.trim() || null,
      customerPoRef: customerPoRef.trim() || null,
      orderDate,
      deliveryDate: deliveryDate || null,
      lines: valid,
      notes: notes.trim() || null,
      terms: terms.trim() || null,
    };
    const out = await run(
      confirm ? "so-confirm" : "so-draft",
      async () => {
        const saved = order ? await salesOrders.update(order.id, input) : await salesOrders.create(input);
        return confirm ? salesOrders.confirm(saved.order.id) : saved;
      },
      { success: confirm ? "Order confirmed" : "Draft saved" },
    );
    if (out) onSaved(out);
  };

  const anyBusy = busy?.startsWith("so-") ?? false;
  return (
    <div>
      <PageHeader
        title={order ? `Edit ${order.soNo}` : "New sales order"}
        sub="Capture what the customer ordered. Confirm it, then deliver (challan) and bill it from the order."
        actions={
          <Button size="sm" icon="chevronLeft" onClick={onCancel}>
            Back
          </Button>
        }
      />
      <Stack gap={16}>
        {prefill?.note && !order ? (
          <Alert tone="emerald" title="Prefilled">
            {prefill.note}
          </Alert>
        ) : null}

        <div className="ims-doc-grid">
          <div className="ims-doc-box">
            <div className="ims-doc-box-label">From (your business)</div>
            <div className="ims-strong">{settings.businessName || session.brand?.name || "Your business"}</div>
            <div className="ims-muted">{settings.address || "Add your address in Settings → Business profile"}</div>
            <div className="ims-muted">{[settings.state, settings.gstin ? `GSTIN ${settings.gstin}` : "GSTIN not set", settings.phone].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="ims-doc-box">
            <div className="ims-doc-box-label">
              <span>Customer *</span>
              <ForceRelatedToggle checked={forceRelatedFill} onChange={setForceRelatedFill} />
            </div>
            <PartySelect kind="customer" value={{ id: customer.id, name: customerName }} onChange={pickCustomer} />
            {shown.customer ? <div className="bos-field-error">{shown.customer}</div> : null}
            <div className="ims-faint" style={{ marginTop: 6 }}>
              GST: {intraState ? "CGST + SGST (intra-state)" : "IGST (inter-state)"}
              {customerName && !customer.id ? " · One-off customer — not saved to your parties." : ""}
            </div>
          </div>
        </div>

        <Card interactive={false}>
          <FormGrid>
            <Field label="Order date">
              {({ id }) => <Input id={id} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value || today)} />}
            </Field>
            <Field label="Delivery by" error={shown.delivery}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="date" min={orderDate} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />}
            </Field>
            <Field label="Customer PO ref">
              {({ id }) => <Input id={id} value={customerPoRef} onChange={(e) => setCustomerPoRef(e.target.value)} maxLength={80} placeholder="Their purchase order number" />}
            </Field>
            <Field label="GSTIN" hint={gstin ? undefined : "Leave blank for unregistered (B2C)"}>
              {({ id }) => <Input id={id} value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" />}
            </Field>
            <Field label="Mobile">
              {({ id }) => <Input id={id} value={mobile} maxLength={20} onChange={(e) => setMobile(e.target.value)} />}
            </Field>
            <Field label="Email">
              {({ id }) => <Input id={id} type="email" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label="Bill to address" full>
              {({ id }) => <Textarea id={id} rows={2} value={billTo} onChange={(e) => setBillTo(e.target.value)} maxLength={500} />}
            </Field>
            <Field label="Ship to address" full hint="Leave blank to deliver to the bill-to address">
              {({ id }) => <Textarea id={id} rows={2} value={shipTo} onChange={(e) => setShipTo(e.target.value)} maxLength={500} placeholder="Site / godown address" />}
            </Field>
          </FormGrid>
        </Card>

        <Card interactive={false}>
          <div className="ims-between" style={{ marginBottom: 10 }}>
            <span className="ims-strong">Items</span>
            <span className="ims-faint">
              {valid.length} line{valid.length === 1 ? "" : "s"}
            </span>
          </div>
          <LineEditor lines={lines} onChange={setLines} intraState={intraState} price="selling" />
          {shown.lines ? <div className="bos-field-error">{shown.lines}</div> : null}
        </Card>

        <Card interactive={false}>
          <FormGrid>
            <Field label="Notes" full>
              {({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Delivery window, packing, special instructions…" />}
            </Field>
            <Field label="Terms & conditions" full hint="Defaults from Settings → Business profile">
              {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} />}
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
          <Button onClick={() => save(false)} disabled={anyBusy}>
            {busy === "so-draft" ? "Saving…" : "Save draft"}
          </Button>
          <Button variant="primary" icon="check" onClick={() => save(true)} disabled={anyBusy}>
            {busy === "so-confirm" ? "Confirming…" : "Save & confirm"}
          </Button>
        </div>
      </Stack>
    </div>
  );
}
