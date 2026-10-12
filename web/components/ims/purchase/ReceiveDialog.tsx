"use client";

import "./purchase.css";
import { useMemo, useState } from "react";
import { Alert, Button, Dialog, Field, FormGrid, Input, Switch, Textarea } from "@/components/bos";
import { computeTotals, dateLabel, inrExact, num, qtyText, round2, round3, todayLocal } from "@/lib/ims/format";
import { purchase, type PoBill, type PurchaseOrder } from "@/lib/ims/purchase";
import { useIms, useImsAction } from "../core";

type Draft = { qty: string; cost: string };

const remainingOf = (l: { qty: number; receivedQty: number }) => round3(Math.max(0, l.qty - l.receivedQty));
const netCost = (l: { rate: number; discountPct: number }) => round2(l.rate * (1 - (l.discountPct || 0) / 100));

/**
 * Goods receipt against a PO: per-line quantities and unit cost. Posting moves stock in,
 * updates the PO and raises an approved supplier bill for what arrived.
 */
export function ReceiveDialog({ order, open, onClose }: { order: PurchaseOrder | null; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open && order !== null} onClose={onClose} wide dismissible={false} title={order ? `Receive goods — ${order.poNo}` : ""} description={order ? `From ${order.supplierName}. Stock is added for linked items; a supplier bill is raised for the received value.` : undefined}>
      {open && order ? <ReceiveBody key={order.id + order.updatedAt} order={order} onClose={onClose} /> : null}
    </Dialog>
  );
}

function ReceiveBody({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const { navigate, can } = useIms();
  const { run, busy } = useImsAction();
  const today = todayLocal();
  const [drafts, setDrafts] = useState<Draft[]>(() => order.lines.map((l) => ({ qty: String(remainingOf(l) || ""), cost: String(netCost(l)) })));
  const [date, setDate] = useState(today);
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [notes, setNotes] = useState("");
  const [createBill, setCreateBill] = useState(true);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<{ bill: PoBill | null; order: PurchaseOrder } | null>(null);

  const errors = order.lines.map((l, i) => {
    const q = num(drafts[i]?.qty);
    if (drafts[i]?.qty.trim() && (!(q >= 0) || Number.isNaN(Number(drafts[i].qty)))) return "Enter a number";
    if (q > remainingOf(l) + 0.0005) return `Max ${qtyText(remainingOf(l))}`;
    if (drafts[i]?.cost.trim() && !(num(drafts[i].cost) >= 0)) return "Invalid cost";
    return null;
  });
  const receiving = order.lines.map((l, i) => ({ l, i, qty: round3(num(drafts[i]?.qty)), cost: drafts[i]?.cost.trim() ? round2(num(drafts[i].cost)) : netCost(l) })).filter((r) => r.qty > 0);
  const dateError = date > today ? "Can't be in the future" : !date ? "Pick a date" : null;
  const billTotal = useMemo(
    () => computeTotals(receiving.map((r) => ({ name: r.l.name, qty: r.qty, rate: r.cost, gstRate: r.l.gstRate })), order.intraState).grandTotal,
    [receiving, order.intraState],
  );
  const canSubmit = receiving.length > 0 && errors.every((e) => !e) && !dateError;
  const setRow = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  if (done) {
    return (
      <div className="ims-lg bos-stack" style={{ gap: 14 }}>
        <Alert tone="emerald" title={done.order.status === "received" ? "Order fully received" : "Partial receipt recorded"}>
          Stock has been updated. {done.order.status === "received" ? "Every line has arrived." : `${done.order.receivedPct}% of the ordered quantity has arrived so far.`}
        </Alert>
        {done.bill ? (
          <div className="ims-doc-box">
            <div className="ims-doc-box-label">Supplier bill created</div>
            <div className="ims-between">
              <span className="ims-cell-stack">
                <span className="ims-strong">{done.bill.billNo}</span>
                <small>
                  {done.bill.supplierBillNo ? `Their bill #${done.bill.supplierBillNo} · ` : ""}
                  Dated {dateLabel(done.bill.billDate)} · due {dateLabel(done.bill.dueDate)} · approved
                </small>
              </span>
              <span className="ims-num ims-strong">{inrExact(done.bill.grandTotal)}</span>
            </div>
          </div>
        ) : null}
        <div className="bos-dialog-actions">
          {done.bill && can("payables") ? (
            <Button
              onClick={() => {
                onClose();
                navigate("payables", `open:${done.bill?.id}`);
              }}
            >
              Open in Payables
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    const out = await run(
      "receive",
      () =>
        purchase.receiveOrder(order.id, {
          lines: receiving.map((r) => ({ lineIndex: r.i, qty: r.qty, unitCost: r.cost === netCost(r.l) ? null : r.cost })),
          date,
          supplierBillNo: billNo.trim() || null,
          supplierBillDate: billDate || null,
          notes: notes.trim() || null,
          createBill,
        }),
      { success: "Goods received", description: `${receiving.length} line${receiving.length === 1 ? "" : "s"} into stock` },
    );
    if (out) setDone(out);
  };

  return (
    <div className="ims-xl">
      <div className="ims-row" style={{ marginBottom: 10 }}>
        <Button size="sm" onClick={() => setDrafts(order.lines.map((l) => ({ qty: String(remainingOf(l) || ""), cost: String(netCost(l)) })))}>
          Fill remaining
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDrafts((d) => d.map((x) => ({ ...x, qty: "" })))}>
          Clear quantities
        </Button>
      </div>
      <div className="ims-recv-wrap">
        <table className="ims-recv">
          <thead>
            <tr>
              <th>Item</th>
              <th className="is-num">Ordered</th>
              <th className="is-num">Received</th>
              <th className="is-num">Remaining</th>
              <th>Receive now</th>
              <th>Unit cost ₹</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l, i) => {
              const left = remainingOf(l);
              return (
                <tr key={`${l.itemId ?? l.name}-${i}`}>
                  <td>
                    <span className="ims-cell-stack">
                      <span className="ims-strong">{l.name}</span>
                      <small>{l.itemId ? [l.sku, l.unit].filter(Boolean).join(" · ") || "Stock item" : "Not a stock item — billed only"}</small>
                    </span>
                  </td>
                  <td className="is-num">{qtyText(l.qty, l.unit)}</td>
                  <td className="is-num">{qtyText(l.receivedQty)}</td>
                  <td className="is-num">{left > 0 ? qtyText(left) : <span className="ims-pos">Done</span>}</td>
                  <td>
                    <Input
                      size="sm"
                      type="number"
                      min={0}
                      max={left}
                      step="any"
                      inputMode="decimal"
                      value={drafts[i]?.qty ?? ""}
                      disabled={left <= 0}
                      onChange={(e) => setRow(i, { qty: e.target.value })}
                      aria-label={`Quantity received for ${l.name}`}
                      aria-invalid={Boolean(errors[i])}
                    />
                    {errors[i] ? <div className="bos-field-error">{errors[i]}</div> : null}
                  </td>
                  <td>
                    <Input size="sm" type="number" min={0} step="any" inputMode="decimal" value={drafts[i]?.cost ?? ""} disabled={left <= 0} onChange={(e) => setRow(i, { cost: e.target.value })} aria-label={`Unit cost for ${l.name}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <FormGrid>
          <Field label="Received on *" error={touched ? dateError : null}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Supplier bill / invoice no.">
            {({ id }) => <Input id={id} value={billNo} onChange={(e) => setBillNo(e.target.value)} maxLength={64} placeholder="e.g. HVL/2345" />}
          </Field>
          <Field label="Supplier bill date" hint="Due date is counted from this date">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="date" max={today} value={billDate} onChange={(e) => setBillDate(e.target.value)} />}
          </Field>
          <Field label="Raise supplier bill" hint={createBill ? "Approved bill for the received value" : "Record stock only — add the bill later in Payables"}>
            {({ id }) => <Switch id={id} checked={createBill} onChange={setCreateBill} aria-label="Raise supplier bill" />}
          </Field>
          <Field label="Notes" full>
            {({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Vehicle no., condition on arrival, short supply…" />}
          </Field>
        </FormGrid>
      </div>

      {touched && !receiving.length ? (
        <Alert tone="amber" title="Nothing to receive">
          Enter the quantity that arrived for at least one line.
        </Alert>
      ) : null}

      <div className="bos-dialog-actions" style={{ marginTop: 14 }}>
        <span className="bos-dialog-actions-note">
          {receiving.length ? (
            <>
              {receiving.length} line{receiving.length === 1 ? "" : "s"} · bill value <b>{inrExact(billTotal)}</b> incl. GST
            </>
          ) : (
            "No quantities entered"
          )}
        </span>
        <Button variant="ghost" onClick={onClose} disabled={busy === "receive"}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy === "receive"}>
          {busy === "receive" ? "Posting…" : "Receive into stock"}
        </Button>
      </div>
    </div>
  );
}
