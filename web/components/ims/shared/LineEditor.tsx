"use client";

import { useMemo, useState } from "react";
import { BosIcon, Button, Input, Select } from "@/components/bos";
import type { ImsItem } from "@/lib/ims/api";
import { computeTotals, GST_RATES, inrExact, num, type ImsLineInput, type ImsTotals } from "@/lib/ims/format";
import { ItemPickerDialog } from "./pickers";

/** An editable document line; `key` keeps React rows stable while editing. */
export type EditableLine = ImsLineInput & { key: string };

let seq = 0;
export const lineKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function lineFromItem(item: ImsItem, price: "selling" | "purchase", qty = 1): EditableLine {
  return {
    key: lineKey(),
    itemId: item.id,
    name: item.name,
    sku: item.sku,
    hsn: item.hsn,
    unit: item.unit,
    qty,
    rate: price === "purchase" ? item.purchasePrice : item.sellingPrice,
    discountPct: 0,
    gstRate: item.gstRate,
  };
}

export const blankLine = (gstRate = 18): EditableLine => ({ key: lineKey(), itemId: null, name: "", qty: 1, rate: 0, discountPct: 0, gstRate });

/** Strip the editor key before sending lines to the API. */
export const toLineInputs = (lines: ReadonlyArray<EditableLine>): ImsLineInput[] =>
  lines
    .filter((l) => l.name.trim() && num(l.qty) > 0)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drops the editor-only key
    .map(({ key, ...rest }) => ({ ...rest, qty: num(rest.qty), rate: num(rest.rate), discountPct: num(rest.discountPct), gstRate: num(rest.gstRate) }));

/**
 * GST line editor: item · qty · rate · disc% · GST% · amount. Lines linked to an item move stock;
 * free-text lines (services, freight) don't. Totals mirror the server's computeTotals.
 */
export function LineEditor({
  lines,
  onChange,
  intraState,
  price,
  allowFreeText = true,
  roundToRupee = false,
  readOnly = false,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  intraState: boolean;
  price: "selling" | "purchase";
  allowFreeText?: boolean;
  roundToRupee?: boolean;
  readOnly?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const totals = useMemo(() => computeTotals(lines, intraState, roundToRupee), [lines, intraState, roundToRupee]);
  const update = (key: string, patch: Partial<EditableLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key));
  const addItem = (item: ImsItem) => {
    const existing = lines.find((l) => l.itemId === item.id);
    if (existing) update(existing.key, { qty: num(existing.qty) + 1 });
    else onChange([...lines.filter((l) => l.name.trim() || l.itemId), lineFromItem(item, price)]);
  };

  return (
    <div>
      <div className="ims-line-head" aria-hidden="true">
        <span>Item / description</span>
        <span>Qty</span>
        <span>Rate ₹</span>
        <span>Disc %</span>
        <span>GST %</span>
        <span style={{ textAlign: "right" }}>Amount</span>
        <span />
      </div>
      <div role="list" aria-label="Line items">
        {lines.map((l, i) => (
          <div key={l.key} className="ims-line" role="listitem">
            <div className="ims-cell-stack">
              {l.itemId || !allowFreeText || readOnly ? (
                <>
                  <span className="ims-strong">{l.name || "—"}</span>
                  <small>{[l.sku, l.hsn ? `HSN ${l.hsn}` : null, l.unit].filter(Boolean).join(" · ")}</small>
                </>
              ) : (
                <Input size="sm" placeholder="Description (service, freight…)" value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} aria-label={`Line ${i + 1} description`} />
              )}
            </div>
            <Input size="sm" type="number" min={0} step="any" inputMode="decimal" value={String(l.qty)} disabled={readOnly} onChange={(e) => update(l.key, { qty: e.target.value === "" ? 0 : Number(e.target.value) })} aria-label={`Line ${i + 1} quantity`} />
            <Input size="sm" type="number" min={0} step="any" inputMode="decimal" value={String(l.rate)} disabled={readOnly} onChange={(e) => update(l.key, { rate: e.target.value === "" ? 0 : Number(e.target.value) })} aria-label={`Line ${i + 1} rate`} />
            <Input size="sm" type="number" min={0} max={100} step="any" inputMode="decimal" value={String(l.discountPct ?? 0)} disabled={readOnly} onChange={(e) => update(l.key, { discountPct: e.target.value === "" ? 0 : Number(e.target.value) })} aria-label={`Line ${i + 1} discount percent`} />
            <Select size="sm" value={String(l.gstRate)} disabled={readOnly} onChange={(e) => update(l.key, { gstRate: Number(e.target.value) })} aria-label={`Line ${i + 1} GST rate`}>
              {[...new Set([...GST_RATES, num(l.gstRate)])].sort((a, b) => a - b).map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
            <div className="ims-line-amount">
              {inrExact(totals.lines[i]?.amount ?? 0)}
              {totals.lines[i]?.tax ? <small>incl. GST {inrExact(totals.lines[i].tax)}</small> : null}
            </div>
            {readOnly ? (
              <span />
            ) : (
              <button type="button" className="bos-inv-remove" aria-label={`Remove line ${i + 1}`} title="Remove" onClick={() => remove(l.key)}>
                <BosIcon name="x" />
              </button>
            )}
          </div>
        ))}
      </div>
      {readOnly ? null : (
        <div className="ims-row" style={{ marginTop: 6 }}>
          <Button size="sm" icon="plus" onClick={() => setPicking(true)}>
            Add items
          </Button>
          {allowFreeText ? (
            <Button size="sm" variant="ghost" onClick={() => onChange([...lines, blankLine()])}>
              Add free-text line
            </Button>
          ) : null}
        </div>
      )}
      <TotalsBlock totals={totals} intraState={intraState} />
      <ItemPickerDialog open={picking} onClose={() => setPicking(false)} onPick={addItem} price={price} />
    </div>
  );
}

export function TotalsBlock({ totals, intraState }: { totals: ImsTotals; intraState: boolean }) {
  return (
    <dl className="ims-totals">
      <dt>Subtotal</dt>
      <dd>{inrExact(totals.subtotal)}</dd>
      {totals.discountTotal ? (
        <>
          <dt>Discount</dt>
          <dd>−{inrExact(totals.discountTotal)}</dd>
        </>
      ) : null}
      <dt>Taxable value</dt>
      <dd>{inrExact(totals.taxable)}</dd>
      {intraState ? (
        <>
          <dt>CGST</dt>
          <dd>{inrExact(totals.cgst)}</dd>
          <dt>SGST</dt>
          <dd>{inrExact(totals.sgst)}</dd>
        </>
      ) : (
        <>
          <dt>IGST</dt>
          <dd>{inrExact(totals.igst)}</dd>
        </>
      )}
      {totals.roundOff ? (
        <>
          <dt>Round off</dt>
          <dd>{inrExact(totals.roundOff)}</dd>
        </>
      ) : null}
      <dt className="is-grand">Total</dt>
      <dd className="is-grand">{inrExact(totals.grandTotal)}</dd>
    </dl>
  );
}
