"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Dialog, Input, Select } from "@/components/bos";
import { ims, type ImsItem, type PartyOption } from "@/lib/ims/api";
import { inr, qtyText, stockBadge } from "@/lib/ims/format";
import { useImsData } from "../core";

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
}: {
  onPick: (item: ImsItem) => void;
  price?: "selling" | "purchase";
  placeholder?: string;
  exclude?: ReadonlySet<string>;
  autoFocus?: boolean;
}) {
  const catalog = useItemCatalog();
  const [q, setQ] = useState("");
  const hits = useMemo(() => (catalog.data ?? []).filter((i) => !exclude?.has(i.id) && matchItem(i, q)).slice(0, 30), [catalog.data, q, exclude]);
  const pick = (item: ImsItem) => {
    onPick(item);
    setQ("");
  };
  return (
    <div>
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
          <p className="ims-faint">{q ? `No items match “${q}”.` : "No items yet — add them in Items."}</p>
        )}
      </div>
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
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: ImsItem) => void;
  price?: "selling" | "purchase";
  title?: string;
  exclude?: ReadonlySet<string>;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description="Pick as many as you need — press Enter to add the first match."
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {open ? <ItemSearch onPick={onPick} price={price} exclude={exclude} autoFocus /> : null}
    </Dialog>
  );
}

/** Active parties of a kind, for selects. */
export function usePartyOptions(kind?: "supplier" | "customer") {
  return useImsData(() => ims.partyOptions(kind).then((r) => r.parties), [kind]);
}

/**
 * Party select with a free-text fallback (walk-in customer, one-off supplier).
 * `value` carries both the linked id (or null) and the display name.
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
  onChange: (v: { id: string | null; name: string; party: PartyOption | null }) => void;
  id?: string;
  allowFreeText?: boolean;
  placeholder?: string;
}) {
  const parties = usePartyOptions(kind);
  const list = parties.data ?? [];
  const [typing, setTyping] = useState(Boolean(value.name && !value.id));

  if (typing && allowFreeText) {
    return (
      <div className="ims-row" style={{ flexWrap: "nowrap" }}>
        <Input id={id} placeholder={placeholder ?? (kind === "supplier" ? "Supplier name" : "Customer name (e.g. Walk-in)")} value={value.name} onChange={(e) => onChange({ id: null, name: e.target.value, party: null })} style={{ flex: 1 }} />
        {list.length ? (
          <Button size="sm" variant="ghost" onClick={() => setTyping(false)}>
            Pick saved
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <Select
      id={id}
      value={value.id ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__new") {
          setTyping(true);
          onChange({ id: null, name: "", party: null });
          return;
        }
        const party = list.find((p) => p.id === v) ?? null;
        onChange({ id: party?.id ?? null, name: party?.name ?? "", party });
      }}
    >
      <option value="">{parties.data === null ? "Loading…" : `Select ${kind}…`}</option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.city ? ` — ${p.city}` : ""}
        </option>
      ))}
      {allowFreeText ? <option value="__new">✎ Type a name instead…</option> : null}
    </Select>
  );
}
