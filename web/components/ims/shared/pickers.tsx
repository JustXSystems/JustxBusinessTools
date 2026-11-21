"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Dialog, Input, Switch } from "@/components/bos";
import { ims, type ImsItem, type PartyOption } from "@/lib/ims/api";
import {
  bom,
  type BomApprovedQuotation,
  type BomDcSuggestField,
  type BomSuggestField,
} from "@/lib/ims/bom";
import { dateLabel, inr, inrExact, qtyText, stockBadge } from "@/lib/ims/format";
import { useImsAction, useImsData } from "../core";
import { SuggestInput, type SuggestOption } from "./SuggestInput";

/**
 * Apply a related composer field from a picked party/quote.
 * Default: only when current is blank. `force` overwrites even when filled.
 * Never clears a field when the source value is empty (both modes).
 */
export function fillRelated(
  current: string,
  next: string | null | undefined,
  set: (value: string) => void,
  force = false,
) {
  const v = String(next ?? "").trim();
  if (!v) return;
  if (!force) {
    if (current.trim()) return;
    set(v);
    return;
  }
  if (current === v) return;
  set(v);
}

/** @deprecated use fillRelated — kept for call-site clarity aliases */
export const fillIfEmpty = (current: string, next: string | null | undefined, set: (value: string) => void) =>
  fillRelated(current, next, set, false);

/** Compact toggle: when on, picking a party/quote overwrites related fields. */
export function ForceRelatedToggle({
  checked,
  onChange,
  label = "Force fill related",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label
      className={`ims-force-related${checked ? " is-on" : ""}`}
      title="When on, picking a party or quotation overwrites related fields even if they already have values"
    >
      <Switch checked={checked} onChange={onChange} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}

/** All active items, loaded once per mount (and after mutations). Filter client-side for instant search. */
export function useItemCatalog() {
  return useImsData(() => ims.items().then((r) => r.items), []);
}

export function matchItem(item: ImsItem, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  return [item.name, item.sku, item.barcode, item.brand, item.category, item.hsn].some((v) => v && v.toLowerCase().includes(term));
}

/**
 * Search-as-you-type item list. `price` picks which rate is shown (buying vs selling).
 * Enter picks the first hit, so a barcode scanner (keyboard wedge) adds items instantly.
 */
export function ItemSearch({
  onPick,
  price = "selling",
  placeholder = "Search name, SKU or scan barcode…",
  exclude,
  autoFocus,
  allowCreate = false,
  createHint,
}: {
  onPick: (item: ImsItem) => void;
  price?: "selling" | "purchase";
  placeholder?: string;
  exclude?: ReadonlySet<string>;
  autoFocus?: boolean;
  /** When search misses, offer create-and-link into Inventory Items. */
  allowCreate?: boolean;
  createHint?: string;
}) {
  const catalog = useItemCatalog();
  const { run, busy } = useImsAction();
  const [q, setQ] = useState(createHint?.trim() || "");
  const hits = useMemo(() => (catalog.data ?? []).filter((i) => !exclude?.has(i.id) && matchItem(i, q)).slice(0, 30), [catalog.data, q, exclude]);
  const pick = (item: ImsItem) => {
    onPick(item);
    setQ("");
  };
  const createLabel = q.trim() || createHint?.trim() || "";
  const createAndLink = async () => {
    if (!createLabel || busy) return;
    const out = await run(
      "ensure-item",
      async () => {
        const ensured = await ims.ensureItems({
          source: "Item picker",
          items: [{ name: createLabel, unit: "nos", sellingPrice: 0 }],
        });
        const id = ensured.results[0]?.id;
        if (!id) throw new Error("Could not create inventory item");
        const fresh = await ims.item(id);
        catalog.reload();
        return fresh.item;
      },
      { success: "Inventory item ready", refresh: false },
    );
    if (out) pick(out);
  };

  return (
    <div className="ims-item-search">
      <Input
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            pick(hits[0]);
          }
        }}
        aria-label="Search items"
      />
      <div className="ims-pick" style={{ marginTop: 8 }} role="listbox" aria-label="Items">
        {catalog.data === null ? (
          <p className="ims-faint">Loading items…</p>
        ) : hits.length ? (
          hits.map((i) => (
            <button key={i.id} type="button" role="option" aria-selected={false} className="ims-pick-row" onClick={() => pick(i)}>
              <span className="ims-cell-stack">
                <span className="ims-strong">{i.name}</span>
                <small>
                  {[i.sku, i.category, i.brand].filter(Boolean).join(" · ") || "—"} · {qtyText(i.currentStock, i.unit)} in stock
                </small>
              </span>
              <span className="ims-row" style={{ gap: 6 }}>
                {i.status !== "GOOD" ? <Badge tone={stockBadge(i.status).tone}>{stockBadge(i.status).text}</Badge> : null}
                <span className="ims-num ims-strong">{inr(price === "purchase" ? i.purchasePrice : i.sellingPrice)}</span>
              </span>
            </button>
          ))
        ) : (
          <div className="ims-item-search-empty">
            <p className="ims-faint">{q ? `No items match “${q}”.` : "No items yet — create the first from here or Items."}</p>
            {allowCreate && createLabel ? (
              <Button size="sm" disabled={Boolean(busy)} onClick={() => void createAndLink()}>
                Create “{createLabel.slice(0, 48)}
                {createLabel.length > 48 ? "…" : ""}” in inventory
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {allowCreate && hits.length > 0 && createLabel && !hits.some((h) => h.name.toLowerCase() === createLabel.toLowerCase()) ? (
        <div className="ims-item-search-create">
          <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void createAndLink()}>
            Or create “{createLabel.slice(0, 40)}
            {createLabel.length > 40 ? "…" : ""}” as new inventory item
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Dialog wrapper around ItemSearch; stays open so several items can be added in a row. */
export function ItemPickerDialog({
  open,
  onClose,
  onPick,
  price,
  title = "Add items",
  exclude,
  allowCreate = false,
  createHint,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: ImsItem) => void;
  price?: "selling" | "purchase";
  title?: string;
  exclude?: ReadonlySet<string>;
  allowCreate?: boolean;
  createHint?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={
        allowCreate
          ? "Search the inventory catalogue, or create a missing item and link it in one step."
          : "Pick as many as you need — press Enter to add the first match."
      }
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {open ? (
        <ItemSearch onPick={onPick} price={price} exclude={exclude} autoFocus allowCreate={allowCreate} createHint={createHint} />
      ) : null}
    </Dialog>
  );
}

/** Active parties of a kind, for selects. */
export function usePartyOptions(kind?: "supplier" | "customer") {
  return useImsData(() => ims.partyOptions(kind).then((r) => r.parties), [kind]);
}

export type PartySelectValue = { id: string | null; name: string; party: PartyOption | null };
export type PartySelectMeta = { picked?: boolean };

/**
 * Free-text cum select for customers/suppliers.
 * Type to filter the book; pick a row to link the party id; keep free text for walk-ins.
 * `meta.picked` is true only when choosing from the suggestion list (for force-fill).
 */
export function PartySelect({
  kind,
  value,
  onChange,
  id,
  allowFreeText = true,
  placeholder,
}: {
  kind: "supplier" | "customer";
  value: { id: string | null; name: string };
  onChange: (v: PartySelectValue, meta?: PartySelectMeta) => void;
  id?: string;
  allowFreeText?: boolean;
  placeholder?: string;
}) {
  const parties = usePartyOptions(kind);
  const list = parties.data ?? [];

  const options = useMemo<SuggestOption<PartyOption>[]>(
    () =>
      list.map((p) => ({
        id: p.id,
        value: p.name,
        label: p.name,
        meta: [p.city, p.state, p.gstin, p.mobile].filter(Boolean).join(" · ") || undefined,
        searchText: [p.city, p.state, p.gstin, p.mobile, p.contactPerson].filter(Boolean).join(" "),
        data: p,
      })),
    [list],
  );

  return (
    <SuggestInput
      id={id}
      value={value.name}
      loading={parties.data === null}
      allowFreeText={allowFreeText}
      placeholder={placeholder ?? (kind === "supplier" ? "Supplier name or pick…" : "Customer name or pick…")}
      emptyLabel={allowFreeText ? "No saved match — keep typing" : `No ${kind}s found`}
      options={options}
      onChange={(name) => {
        const exact = list.find((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
        onChange({ id: exact?.id ?? null, name, party: exact }, { picked: false });
      }}
      onPick={(opt) => {
        const party = opt.data ?? null;
        onChange({ id: party?.id ?? null, name: opt.value, party }, { picked: true });
      }}
    />
  );
}

/**
 * Approved quotation free-text cum select (BOM quotation reference).
 * Type a legacy ref freely, or pick an approved Quotation V1 document.
 */
export function QuotationSelect({
  value,
  onChange,
  onPick,
  id,
  required,
  placeholder = "Quote no. or pick approved…",
}: {
  value: string;
  onChange: (quotationRef: string) => void;
  onPick?: (quotation: BomApprovedQuotation) => void;
  id?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(value.trim()), 200);
    return () => window.clearTimeout(t);
  }, [value]);

  const state = useImsData(() => bom.quotationRefs(qDebounced || undefined), [qDebounced]);
  const quotations = state.data?.quotations ?? [];

  const options = useMemo<SuggestOption<BomApprovedQuotation>[]>(
    () =>
      quotations.map((row) => ({
        id: row.ref,
        value: row.docNo,
        label: row.docNo,
        meta: [row.partyName, row.title, row.partyGstin].filter(Boolean).join(" · "),
        searchText: [row.partyName, row.title, row.partyGstin, row.partyPhone, row.partyCity, row.partyState]
          .filter(Boolean)
          .join(" "),
        trailing: (
          <>
            {inrExact(row.amount)}
            <span className="ims-faint" style={{ display: "block", fontSize: 10 }}>
              {row.date ? dateLabel(row.date) : "—"}
            </span>
          </>
        ),
        data: row,
      })),
    [quotations],
  );

  return (
    <div>
      <SuggestInput
        id={id}
        value={value}
        required={required}
        loading={state.loading && !state.data}
        filterLocal={false}
        allowFreeText
        placeholder={placeholder}
        emptyLabel="No approved quotes — type a reference"
        options={options}
        onChange={onChange}
        onPick={(opt) => {
          if (opt.data) onPick?.(opt.data);
        }}
      />
      <p className="ims-suggest-hint">Approved Quotation V1 suggestions · free text still allowed</p>
    </div>
  );
}

/** Historical string suggestions for BOM/DC composer reference fields. */
export function HistorySuggestInput({
  scope,
  field,
  value,
  onChange,
  id,
  placeholder,
  required,
}: {
  scope: "bom" | "dc";
  field: BomSuggestField | BomDcSuggestField;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(value.trim()), 220);
    return () => window.clearTimeout(t);
  }, [value]);

  const state = useImsData(
    () =>
      scope === "bom"
        ? bom.suggest(field as BomSuggestField, qDebounced || undefined)
        : bom.dcSuggest(field as BomDcSuggestField, qDebounced || undefined),
    [scope, field, qDebounced],
  );
  const suggestions = state.data?.suggestions ?? [];

  const options = useMemo<SuggestOption[]>(
    () =>
      suggestions.map((s) => ({
        id: s,
        value: s,
        label: s,
      })),
    [suggestions],
  );

  return (
    <SuggestInput
      id={id}
      value={value}
      required={required}
      loading={state.loading && !state.data}
      filterLocal={false}
      allowFreeText
      placeholder={placeholder}
      emptyLabel="No prior values — type freely"
      options={options}
      onChange={onChange}
    />
  );
}
