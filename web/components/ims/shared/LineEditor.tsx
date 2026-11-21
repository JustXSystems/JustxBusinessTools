"use client";

import { useMemo, useState } from "react";
import { BosIcon, Button, Input, Select, Segmented } from "@/components/bos";
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

type Scope = "all" | "catalog" | "freetext";

/**
 * Ultra-compact GST line editor for 100+ rows — advanced filter, bulk GST/disc, sticky grid.
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
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [bulkGst, setBulkGst] = useState("");
  const totals = useMemo(() => computeTotals(lines, intraState, roundToRupee), [lines, intraState, roundToRupee]);
  const update = (key: string, patch: Partial<EditableLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key));
  const addItem = (item: ImsItem) => {
    const existing = lines.find((l) => l.itemId === item.id);
    if (existing) update(existing.key, { qty: num(existing.qty) + 1 });
    else onChange([...lines.filter((l) => l.name.trim() || l.itemId), lineFromItem(item, price)]);
  };

  const query = q.trim().toLowerCase();
  const showTools = lines.length >= 4;
  const catalogCount = lines.filter((l) => l.itemId).length;
  const freeCount = lines.length - catalogCount;

  const visible = useMemo(() => {
    return lines
      .map((l, i) => ({ line: l, index: i }))
      .filter(({ line: l }) => {
        if (scope === "catalog" && !l.itemId) return false;
        if (scope === "freetext" && l.itemId) return false;
        if (!query) return true;
        return `${l.name} ${l.sku ?? ""} ${l.hsn ?? ""}`.toLowerCase().includes(query);
      });
  }, [lines, query, scope]);

  const applyBulkGst = () => {
    if (readOnly || bulkGst === "") return;
    const rate = Number(bulkGst);
    if (!Number.isFinite(rate)) return;
    const keys = new Set(visible.map((v) => v.line.key));
    onChange(lines.map((l) => (keys.has(l.key) ? { ...l, gstRate: rate } : l)));
  };

  const clearDiscounts = () => {
    if (readOnly) return;
    const keys = new Set(visible.map((v) => v.line.key));
    onChange(lines.map((l) => (keys.has(l.key) ? { ...l, discountPct: 0 } : l)));
  };

  return (
    <div className="ims-line-editor">
      <div className="ims-compose-cmd">
        <div className="ims-compose-cmd-left">
          <span className="ims-line-editor-count" aria-live="polite">
            <b>{lines.length}</b>
            <span className="ims-faint"> lines</span>
            {query || scope !== "all" ? <span className="ims-faint"> · {visible.length} shown</span> : null}
          </span>
          {showTools ? (
            <Segmented
              size="sm"
              role="radio"
              aria-label="Line type"
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: "All" },
                { value: "catalog", label: `Stock · ${catalogCount}` },
                { value: "freetext", label: `Text · ${freeCount}` },
              ]}
            />
          ) : null}
        </div>
        <div className="ims-compose-cmd-right">
          {showTools || lines.length >= 8 ? (
            <Input
              size="sm"
              className="ims-line-editor-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter line items"
            />
          ) : null}
          {!readOnly && showTools ? (
            <>
              <Select
                size="sm"
                className="ims-line-bulk-gst"
                value={bulkGst}
                onChange={(e) => setBulkGst(e.target.value)}
                aria-label="Bulk GST rate"
              >
                <option value="">GST…</option>
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" disabled={bulkGst === ""} onClick={applyBulkGst} title="Apply GST to visible lines">
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={clearDiscounts} title="Clear discount on visible lines">
                Clear disc
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="ims-line-editor-frame">
        <div className="ims-line-head" aria-hidden="true">
          <span className="ims-line-idx">#</span>
          <span>Item / description</span>
          <span>Qty</span>
          <span>Rate ₹</span>
          <span>Disc %</span>
          <span>GST %</span>
          <span style={{ textAlign: "right" }}>Amount</span>
          <span />
        </div>
        <div className="ims-line-editor-body" role="list" aria-label="Line items">
          {!lines.length ? (
            <p className="ims-line-editor-empty">No lines yet — add catalogue items or a free-text line.</p>
          ) : !visible.length ? (
            <p className="ims-line-editor-empty">No lines match the current filter.</p>
          ) : (
            visible.map(({ line: l, index: i }) => (
              <div key={l.key} className={`ims-line${l.itemId ? " is-catalog" : ""}`} role="listitem">
                <span className="ims-line-idx">{i + 1}</span>
                <div className="ims-cell-stack">
                  {l.itemId || !allowFreeText || readOnly ? (
                    <>
                      <span className="ims-strong">{l.name || "—"}</span>
                      <small>{[l.sku, l.hsn ? `HSN ${l.hsn}` : null, l.unit].filter(Boolean).join(" · ")}</small>
                    </>
                  ) : (
                    <Input
                      size="sm"
                      placeholder="Description (service, freight…)"
                      value={l.name}
                      onChange={(e) => update(l.key, { name: e.target.value })}
                      aria-label={`Line ${i + 1} description`}
                    />
                  )}
                </div>
                <Input
                  size="sm"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={String(l.qty)}
                  disabled={readOnly}
                  onChange={(e) => update(l.key, { qty: e.target.value === "" ? 0 : Number(e.target.value) })}
                  aria-label={`Line ${i + 1} quantity`}
                />
                <Input
                  size="sm"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={String(l.rate)}
                  disabled={readOnly}
                  onChange={(e) => update(l.key, { rate: e.target.value === "" ? 0 : Number(e.target.value) })}
                  aria-label={`Line ${i + 1} rate`}
                />
                <Input
                  size="sm"
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  inputMode="decimal"
                  value={String(l.discountPct ?? 0)}
                  disabled={readOnly}
                  onChange={(e) => update(l.key, { discountPct: e.target.value === "" ? 0 : Number(e.target.value) })}
                  aria-label={`Line ${i + 1} discount percent`}
                />
                <Select
                  size="sm"
                  value={String(l.gstRate)}
                  disabled={readOnly}
                  onChange={(e) => update(l.key, { gstRate: Number(e.target.value) })}
                  aria-label={`Line ${i + 1} GST rate`}
                >
                  {[...new Set([...GST_RATES, num(l.gstRate)])].sort((a, b) => a - b).map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </Select>
                <div className="ims-line-amount">
                  {inrExact(totals.lines[i]?.amount ?? 0)}
                  {totals.lines[i]?.tax ? <small>+{inrExact(totals.lines[i].tax)}</small> : null}
                </div>
                {readOnly ? (
                  <span />
                ) : (
                  <button type="button" className="bos-inv-remove" aria-label={`Remove line ${i + 1}`} title="Remove" onClick={() => remove(l.key)}>
                    <BosIcon name="x" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {readOnly ? null : (
        <div className="ims-line-editor-add">
          <Button size="sm" icon="plus" onClick={() => setPicking(true)}>
            Add items
          </Button>
          {allowFreeText ? (
            <Button size="sm" variant="ghost" onClick={() => onChange([...lines, blankLine()])}>
              Free-text
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
      <dt>Taxable</dt>
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
