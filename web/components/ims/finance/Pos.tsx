"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Alert, BosIcon, Button, Card, Dialog, Field, FormGrid, Input, Segmented, WidgetCard, WidgetRow } from "@/components/bos";
import type { ImsItem } from "@/lib/ims/api";
import { finance, gstStateName, intraStateFor, methodLabel, posChange, type InvoiceDetail } from "@/lib/ims/finance";
import { computeTotals, inr, inrExact, num, qtyText, round2, timeAgo, type ImsLineInput } from "@/lib/ims/format";
import { Loaded, useIms, useImsAction, useImsData } from "../core";
import { ItemSearch } from "../shared/pickers";
import { QuickChips } from "./shared";

type CartLine = { item: ImsItem; qty: number; rate: number };
type Method = "cash" | "upi" | "card";

/** Counter billing: scan or search items, take cash / UPI / card, issue a paid invoice in one step. */
export function PosCounter({ onOpen }: { onOpen: (id: string) => void }) {
  const { session } = useIms();
  const settings = session.settings;
  const { run, busy } = useImsAction();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<Method>("cash");
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [showCustomer, setShowCustomer] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [customerGstin, setCustomerGstin] = useState("");
  const [done, setDone] = useState<(InvoiceDetail & { change: number | null }) | null>(null);
  const today = useImsData(() => finance.posToday(), []);

  const intraState = intraStateFor(settings, gstStateName(customerGstin) || settings.state);
  const lines = useMemo<ImsLineInput[]>(
    () => cart.map((c) => ({ itemId: c.item.id, name: c.item.name, sku: c.item.sku, hsn: c.item.hsn, unit: c.item.unit, qty: c.qty, rate: c.rate, discountPct: 0, gstRate: c.item.gstRate })),
    [cart],
  );
  const totals = useMemo(() => computeTotals(lines, intraState, true), [lines, intraState]);
  const tenderedValue = tendered.trim() === "" ? null : num(tendered);
  const change = method === "cash" ? posChange(totals.grandTotal, tenderedValue) : null;
  const short = method === "cash" && tenderedValue !== null && change === null;
  const shortStock = cart.filter((c) => c.qty > c.item.currentStock);
  const blocked = shortStock.length > 0 && !settings.allowNegativeStock;

  const add = (item: ImsItem) =>
    setCart((prev) => {
      const hit = prev.find((c) => c.item.id === item.id);
      return hit ? prev.map((c) => (c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c)) : [...prev, { item, qty: 1, rate: item.sellingPrice }];
    });
  const setQty = (id: string, qty: number) => setCart((prev) => (qty <= 0 ? prev.filter((c) => c.item.id !== id) : prev.map((c) => (c.item.id === id ? { ...c, qty } : c))));
  const reset = () => {
    setCart([]);
    setTendered("");
    setReference("");
    setCustomerName("");
    setCustomerMobile("");
    setCustomerGstin("");
    setShowCustomer(false);
    setMethod("cash");
  };

  const charge = async () => {
    if (!cart.length || short || blocked) return;
    const out = await run(
      "charge",
      () =>
        finance.posSale({
          customerName: customerName.trim() || null,
          customerMobile: customerMobile.trim() || null,
          customerGstin: customerGstin.trim().toUpperCase() || null,
          lines,
          method,
          tendered: method === "cash" ? tenderedValue : null,
          reference: reference.trim() || null,
          roundToRupee: true,
        }),
      { success: "Sale complete" },
    );
    if (out) {
      setDone(out);
      reset();
    }
  };

  const nextNotes = [100, 200, 500, 2000].map((n) => Math.ceil(totals.grandTotal / n) * n).filter((v, i, a) => v > totals.grandTotal && a.indexOf(v) === i).slice(0, 3);

  return (
    <div className="fin-pos">
      <Card interactive={false}>
        <h2 className="fin-section-title">Scan or search</h2>
        <ItemSearch onPick={add} price="selling" autoFocus placeholder="Scan barcode or type item name / SKU — Enter adds the first match" />
      </Card>

      <div className="bos-stack" style={{ gap: 14, display: "flex", flexDirection: "column" }}>
        <Card interactive={false}>
          <div className="ims-between" style={{ marginBottom: 6 }}>
            <h2 className="fin-section-title" style={{ margin: 0 }}>
              Cart {cart.length ? `· ${cart.length} item${cart.length === 1 ? "" : "s"}` : ""}
            </h2>
            {cart.length ? (
              <Button size="sm" variant="ghost" onClick={reset}>
                Clear
              </Button>
            ) : null}
          </div>
          {cart.length ? (
            <div className="fin-cart" role="list" aria-label="Cart">
              {cart.map((c) => (
                <div key={c.item.id} className="fin-cart-row" role="listitem">
                  <span className="ims-cell-stack">
                    <span className="ims-strong">{c.item.name}</span>
                    <small className={c.qty > c.item.currentStock ? "ims-neg" : undefined}>
                      {inrExact(c.rate)} + {c.item.gstRate}% GST · {qtyText(c.item.currentStock, c.item.unit)} in stock
                    </small>
                  </span>
                  <span className="fin-qty">
                    <button type="button" aria-label={`One less ${c.item.name}`} onClick={() => setQty(c.item.id, c.qty - 1)}>
                      −
                    </button>
                    <Input size="sm" type="number" min={0} step="any" inputMode="decimal" value={String(c.qty)} onChange={(e) => setQty(c.item.id, num(e.target.value))} aria-label={`${c.item.name} quantity`} />
                    <button type="button" aria-label={`One more ${c.item.name}`} onClick={() => setQty(c.item.id, c.qty + 1)}>
                      +
                    </button>
                  </span>
                  <span className="ims-num ims-strong" style={{ textAlign: "right" }}>
                    {inrExact(round2(c.qty * c.rate * (1 + c.item.gstRate / 100)))}
                  </span>
                  <button type="button" className="fin-remove" aria-label={`Remove ${c.item.name}`} onClick={() => setQty(c.item.id, 0)}>
                    <BosIcon name="x" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="ims-faint" style={{ padding: "18px 0", textAlign: "center" }}>
              Scan a barcode or pick an item to start a bill.
            </p>
          )}

          {shortStock.length ? (
            <div style={{ marginTop: 10 }}>
              <Alert tone={blocked ? "coral" : "amber"} title={blocked ? "Not enough stock" : "Stock will go negative"}>
                {shortStock.map((c) => `${c.item.name} (have ${qtyText(c.item.currentStock, c.item.unit)})`).join(", ")}
              </Alert>
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            {showCustomer ? (
              <FormGrid columns="1fr 1fr">
                <Field label="Customer name">{({ id }) => <Input id={id} size="sm" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in customer" maxLength={200} />}</Field>
                <Field label="Mobile">{({ id }) => <Input id={id} size="sm" type="tel" value={customerMobile} onChange={(e) => setCustomerMobile(e.target.value)} maxLength={40} />}</Field>
                <Field label="GSTIN (B2B bill)" full>
                  {({ id }) => <Input id={id} size="sm" value={customerGstin} onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())} maxLength={15} />}
                </Field>
              </FormGrid>
            ) : (
              <Button size="sm" variant="ghost" icon="user" onClick={() => setShowCustomer(true)}>
                Add customer details
              </Button>
            )}
          </div>
        </Card>

        <Card interactive={false}>
          <div className="fin-pos-total" aria-live="polite">
            <span>
              Total
              <br />
              <small style={{ opacity: 0.85 }}>
                incl. GST {inrExact(totals.taxTotal)}
                {totals.roundOff ? ` · round off ${inrExact(totals.roundOff)}` : ""}
              </small>
            </span>
            <b>{inrExact(totals.grandTotal)}</b>
          </div>

          <div style={{ margin: "12px 0" }}>
            <Segmented
              block
              aria-label="Payment method"
              value={method}
              onChange={setMethod}
              options={[
                { value: "cash", label: "Cash" },
                { value: "upi", label: "UPI" },
                { value: "card", label: "Card" },
              ]}
            />
          </div>

          {method === "cash" ? (
            <Stack14>
              <Field label="Cash received (₹)">
                {({ id }) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(totals.grandTotal || "")} />}
              </Field>
              {totals.grandTotal > 0 ? (
                <QuickChips
                  label="Cash received"
                  options={[{ key: String(totals.grandTotal), label: "Exact" }, ...nextNotes.map((n) => ({ key: String(n), label: inr(n) }))]}
                  onPick={(k) => setTendered(k)}
                />
              ) : null}
              {tenderedValue !== null ? (
                <div className={`fin-change ${short ? "is-short" : "is-ok"}`} aria-live="polite">
                  <span>{short ? "Short by" : "Change to return"}</span>
                  <b>{inrExact(short ? round2(totals.grandTotal - (tenderedValue ?? 0)) : (change ?? 0))}</b>
                </div>
              ) : null}
            </Stack14>
          ) : (
            <Field label={method === "upi" ? "UPI reference (optional)" : "Card slip / last 4 digits (optional)"}>
              {({ id }) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />}
            </Field>
          )}

          <div style={{ marginTop: 14 }}>
            <Button variant="primary" block icon="check" disabled={!cart.length || short || blocked || busy === "charge"} onClick={charge}>
              {busy === "charge" ? "Completing sale…" : `Charge ${inrExact(totals.grandTotal)}`}
            </Button>
          </div>
        </Card>

        <Loaded state={today} rows={1}>
          {(t) => (
            <WidgetCard title="Today at the counter" note={`${t.count} bill${t.count === 1 ? "" : "s"} · ${inr(t.total)}`}>
              <WidgetRow label="Cash" value={inr(t.byMethod.cash ?? 0)} />
              <WidgetRow label="UPI" value={inr(t.byMethod.upi ?? 0)} />
              <WidgetRow label="Card" value={inr(t.byMethod.card ?? 0)} />
              {t.bills.slice(0, 6).map((b) => (
                <WidgetRow
                  key={b.id}
                  soft
                  chevron
                  onClick={() => onOpen(b.id)}
                  label={
                    <span className="ims-cell-stack">
                      <span>{b.invoiceNo}</span>
                      <small>
                        {b.customerName} · {methodLabel(b.payMode)} · {timeAgo(b.createdAt)}
                      </small>
                    </span>
                  }
                  value={b.status === "cancelled" ? "Cancelled" : inr(b.grandTotal)}
                />
              ))}
            </WidgetCard>
          )}
        </Loaded>
      </div>

      <Dialog
        open={done !== null}
        onClose={() => setDone(null)}
        title={done ? `Sale complete · ${done.invoice.invoiceNo}` : "Sale complete"}
        icon={{ tone: "emerald", name: "check" }}
        actions={
          <>
            <Button variant="ghost" onClick={() => done && onOpen(done.invoice.id)}>
              View / print bill
            </Button>
            <Button variant="primary" autoFocus onClick={() => setDone(null)}>
              Next customer
            </Button>
          </>
        }
      >
        {done ? (
          <div className="ims-cell-stack" style={{ gap: 6 }}>
            <span>
              {inrExact(done.invoice.grandTotal)} received by {methodLabel(done.invoice.payMode)}.
            </span>
            {done.change ? <span className="fin-amount">Return {inrExact(done.change)}</span> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function Stack14({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>;
}
