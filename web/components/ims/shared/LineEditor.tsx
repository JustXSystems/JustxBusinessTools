"use client";

import { useMemo, useState } from "react";
import { BosIcon, Button, Input, Select, Segmented } from "@/components/bos";
import type { ImsItem } from "@/lib/ims/api";
import { computeTotals, gstRatesFor, moneyFmt, num, type ImsLineInput, type ImsTotals } from "@/lib/ims/format";
import { useIms } from "../core";
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
 * Ultra-compact GST line editor for 100+ rows — table headings, sticky header, dense cells.
 */
export function LineEditor({
  lines,
  onChange,
  intraState,
  price,
  allowFreeText = true,
  roundToRupee = false,
  readOnly = false,
  currencyCode,
  baseEquivalent,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  intraState: boolean;
  price: "selling" | "purchase";
  allowFreeText?: boolean;
  roundToRupee?: boolean;
  readOnly?: boolean;
  /** Document currency; amounts show the ISO code when it is not INR. */
  currencyCode?: string;
  /** Base-currency equivalent of the grand total (foreign documents). */
  baseEquivalent?: { code: string; amount: number } | null;
}) {
  const money = (n: number) => moneyFmt(n, currencyCode);
  const { session } = useIms();
  const gstOptions = useMemo(() => gstRatesFor(session.settings), [session.settings]);
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
                {gstOptions.map((r) => (
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
        {!lines.length ? (
          <p className="ims-line-editor-empty">No lines yet — add catalogue items or a free-text line.</p>
        ) : !visible.length ? (
          <p className="ims-line-editor-empty">No lines match the current filter.</p>
        ) : (
          <div className="ims-line-editor-body">
            <table className="ims-line-table" aria-label="Line items">
              <thead>
                <tr>
                  <th className="is-idx" scope="col">
                    #
                  </th>
                  <th className="is-item" scope="col">
                    Item / description
                  </th>
                  <th className="is-qty" scope="col">
                    Qty
                  </th>
                  <th className="is-rate" scope="col">
                    Rate ₹
                  </th>
                  <th className="is-disc" scope="col">
                    Disc %
                  </th>
                  <th className="is-gst" scope="col">
                    GST %
                  </th>
                  <th className="is-amt" scope="col">
                    Amount
                  </th>
                  <th className="is-act" scope="col">
                    <span className="bos-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ line: l, index: i }) => (
                  <tr key={l.key} className={l.itemId ? "is-catalog" : undefined}>
                    <td className="is-idx">{i + 1}</td>
                    <td className="is-item" data-label="Item">
                      <div className="ims-cell-stack">
                        {l.itemId || !allowFreeText || readOnly ? (
                          <>
                            <span className="ims-strong">{l.name || "—"}</span>
                            <small>{[l.sku, l.hsn ? `HSN ${l.hsn}` : null, l.unit].filter(Boolean).join(" · ")}</small>
                          </>
                        ) : (
                          <Input
                            size="sm"
                            placeholder="Service, freight…"
                            value={l.name}
                            onChange={(e) => update(l.key, { name: e.target.value })}
                            aria-label={`Line ${i + 1} description`}
                          />
                        )}
                      </div>
                    </td>
                    <td className="is-qty" data-label="Qty">
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
                    </td>
                    <td className="is-rate" data-label="Rate ₹">
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
                    </td>
                    <td className="is-disc" data-label="Disc %">
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
                    </td>
                    <td className="is-gst" data-label="GST %">
                      <Select
                        size="sm"
                        value={String(l.gstRate)}
                        disabled={readOnly}
                        onChange={(e) => update(l.key, { gstRate: Number(e.target.value) })}
                        aria-label={`Line ${i + 1} GST rate`}
                      >
                        {gstRatesFor(session.settings, [num(l.gstRate)]).map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="is-amt" data-label="Amount">
                      <div className="ims-line-amount">
                        {money(totals.lines[i]?.amount ?? 0)}
                        {totals.lines[i]?.tax ? <small>+{money(totals.lines[i].tax)}</small> : null}
                      </div>
                    </td>
                    <td className="is-act">
                      {readOnly ? null : (
                        <button type="button" className="bos-inv-remove" aria-label={`Remove line ${i + 1}`} title="Remove" onClick={() => remove(l.key)}>
                          <BosIcon name="x" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
      <TotalsBlock totals={totals} intraState={intraState} currencyCode={currencyCode} baseEquivalent={baseEquivalent} />
      <ItemPickerDialog open={picking} onClose={() => setPicking(false)} onPick={addItem} price={price} />
    </div>
  );
}

export function TotalsBlock({
  totals,
  intraState,
  currencyCode,
  baseEquivalent,
}: {
  totals: ImsTotals;
  intraState: boolean;
  currencyCode?: string;
  baseEquivalent?: { code: string; amount: number } | null;
}) {
  const money = (n: number) => moneyFmt(n, currencyCode);
  return (
    <dl className="ims-totals">
      <dt>Subtotal</dt>
      <dd>{money(totals.subtotal)}</dd>
      {totals.discountTotal ? (
        <>
          <dt>Discount</dt>
          <dd>−{money(totals.discountTotal)}</dd>
        </>
      ) : null}
      <dt>Taxable</dt>
      <dd>{money(totals.taxable)}</dd>
      {intraState ? (
        <>
          <dt>CGST</dt>
          <dd>{money(totals.cgst)}</dd>
          <dt>SGST</dt>
          <dd>{money(totals.sgst)}</dd>
        </>
      ) : (
        <>
          <dt>IGST</dt>
          <dd>{money(totals.igst)}</dd>
        </>
      )}
      {totals.roundOff ? (
        <>
          <dt>Round off</dt>
          <dd>{money(totals.roundOff)}</dd>
        </>
      ) : null}
      <dt className="is-grand">Total</dt>
      <dd className="is-grand">{money(totals.grandTotal)}</dd>
      {baseEquivalent ? (
        <>
          <dt>Base equivalent ({baseEquivalent.code})</dt>
          <dd>{moneyFmt(baseEquivalent.amount, baseEquivalent.code)}</dd>
        </>
      ) : null}
    </dl>
  );
}
