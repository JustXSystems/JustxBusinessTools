"use client";

import { useEffect, useRef, useState } from "react";
import { BlockLabel, BosIcon, Button, Field, FormGrid, Input, Textarea } from "@/components/bos";
import { addDays, computeInvoice, formatINR, formatInvoiceDate, toISODate, type InvoiceLineItem } from "@/lib/bos/invoice";
import { INVOICE_DEFAULTS } from "../data/common";

type InvoiceForm = {
  from: string;
  to: string;
  number: string;
  taxRate: string;
  date: string;
  due: string;
  notes: string;
};

/** Line items keep raw input strings so partially typed numbers ("1.", "") survive re-renders. */
type DraftItem = { id: string; description: string; quantity: string; rate: string };

function initialState(): { form: InvoiceForm; items: DraftItem[] } {
  const today = new Date();
  return {
    form: {
      from: INVOICE_DEFAULTS.from,
      to: INVOICE_DEFAULTS.to,
      number: INVOICE_DEFAULTS.number,
      taxRate: INVOICE_DEFAULTS.taxRate,
      date: toISODate(today),
      due: toISODate(addDays(today, INVOICE_DEFAULTS.dueInDays)),
      notes: INVOICE_DEFAULTS.notes,
    },
    items: INVOICE_DEFAULTS.items.map((it, i) => ({
      id: `item-${i + 1}`,
      description: it.description,
      quantity: String(it.quantity),
      rate: String(it.rate),
    })),
  };
}

export function InvoiceView() {
  const [{ form, items }, setState] = useState(initialState);
  const seq = useRef(INVOICE_DEFAULTS.items.length);

  useEffect(() => {
    const clear = () => document.body.classList.remove("bos-printing");
    window.addEventListener("afterprint", clear);
    return () => {
      window.removeEventListener("afterprint", clear);
      clear();
    };
  }, []);

  const setField = (key: keyof InvoiceForm, value: string) => setState((s) => ({ ...s, form: { ...s.form, [key]: value } }));
  const setItem = (id: string, patch: Partial<DraftItem>) =>
    setState((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  const addItem = () => {
    seq.current += 1;
    const id = `item-${seq.current}`;
    setState((s) => ({ ...s, items: [...s.items, { id, description: "", quantity: "1", rate: "0" }] }));
  };
  const removeItem = (id: string) => setState((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));
  const reset = () =>
    setState((s) => {
      const fresh = initialState();
      return { form: s.form, items: fresh.items };
    });

  const print = () => {
    document.body.classList.add("bos-printing");
    window.print();
  };

  const totals = computeInvoice(
    items.map<InvoiceLineItem>((it) => ({ id: it.id, description: it.description, quantity: Number(it.quantity), rate: Number(it.rate) })),
    form.taxRate,
  );

  const fields: Array<[keyof InvoiceForm, string, string]> = [
    ["from", "From", "text"],
    ["to", "Bill To", "text"],
    ["number", "Invoice Number", "text"],
    ["taxRate", "Tax Rate (%)", "number"],
    ["date", "Invoice Date", "date"],
    ["due", "Due Date", "date"],
  ];

  return (
    <div className="bos-inv-layout">
      <div className="bos-inv-form">
        <FormGrid>
          {fields.map(([key, label, type]) => (
            <Field key={key} label={label}>
              {({ id }) => (
                <Input
                  id={id}
                  type={type}
                  min={type === "number" ? 0 : undefined}
                  value={form[key]}
                  onChange={(e) => setField(key, e.target.value)}
                />
              )}
            </Field>
          ))}
        </FormGrid>

        <div style={{ marginTop: 22 }}>
          <BlockLabel>Line Items</BlockLabel>
        </div>
        <div className="bos-inv-items-head" aria-hidden="true">
          <span>Description</span>
          <span>Qty</span>
          <span>Rate (₹)</span>
          <span style={{ textAlign: "right" }}>Amount</span>
          <span />
        </div>
        <div role="list" aria-label="Line items">
          {items.map((it, i) => (
            <div key={it.id} className="bos-inv-item" role="listitem">
              <Input size="sm" aria-label={`Item ${i + 1} description`} placeholder="Item description" value={it.description} onChange={(e) => setItem(it.id, { description: e.target.value })} />
              <Input size="sm" aria-label={`Item ${i + 1} quantity`} placeholder="Qty" type="number" inputMode="decimal" min={0} value={it.quantity} onChange={(e) => setItem(it.id, { quantity: e.target.value })} />
              <Input size="sm" aria-label={`Item ${i + 1} rate`} placeholder="Rate (₹)" type="number" inputMode="decimal" min={0} value={it.rate} onChange={(e) => setItem(it.id, { rate: e.target.value })} />
              <div className="bos-inv-amount">{formatINR(totals.lines[i]?.amount ?? 0)}</div>
              <button type="button" className="bos-inv-remove" aria-label={`Remove item ${i + 1}`} title="Remove item" onClick={() => removeItem(it.id)}>
                <BosIcon name="x" />
              </button>
            </div>
          ))}
        </div>
        <Button size="sm" icon="plus" onClick={addItem} style={{ marginTop: 4 }}>
          Add item
        </Button>

        <div style={{ marginTop: 20 }}>
          <Field label="Notes">{({ id }) => <Textarea id={id} rows={3} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />}</Field>
        </div>

        <div className="bos-row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
          <Button size="sm" icon="refresh" onClick={reset}>
            Reset
          </Button>
          <Button size="sm" variant="primary" icon="printer" onClick={print}>
            Print / Save as PDF
          </Button>
        </div>
      </div>

      <article className="bos-inv-paper" aria-label="Invoice preview">
        <div className="bos-inv-paper-top">
          <div>
            <div className="bos-inv-paper-brand">{form.from || "Your Company"}</div>
            <div className="bos-inv-paper-powered">Powered by Justx BOS</div>
          </div>
          <div className="bos-inv-paper-title">INVOICE</div>
        </div>
        <div className="bos-inv-paper-meta">
          {[
            ["Bill To", form.to || "Client name"],
            ["Invoice Number", form.number || "—"],
            ["Invoice Date", formatInvoiceDate(form.date)],
            ["Due Date", formatInvoiceDate(form.due)],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="bos-inv-paper-label">{label}</div>
              <div className="bos-inv-paper-value">{value}</div>
            </div>
          ))}
        </div>
        <table className="bos-inv-paper-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.length ? (
              totals.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.description || "Untitled item"}</td>
                  <td>{line.quantity}</td>
                  <td>{formatINR(line.rate)}</td>
                  <td>{formatINR(line.amount)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="bos-inv-paper-empty">
                  No items added yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="bos-inv-totals">
          <div className="bos-inv-totals-row">
            <span>Subtotal</span>
            <span>{formatINR(totals.subtotal)}</span>
          </div>
          <div className="bos-inv-totals-row">
            <span>Tax ({totals.taxRate}%)</span>
            <span>{formatINR(totals.taxAmount)}</span>
          </div>
          <div className="bos-inv-totals-row is-total">
            <span>Total</span>
            <span>{formatINR(totals.total)}</span>
          </div>
        </div>
        {form.notes ? <div className="bos-inv-notes">{form.notes}</div> : null}
      </article>
    </div>
  );
}
