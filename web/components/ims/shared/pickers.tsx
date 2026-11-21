"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Dialog, Input, Select, Switch } from "@/components/bos";
import { ims, type ImsItem, type PartyOption } from "@/lib/ims/api";
import { bom, type BomApprovedQuotation } from "@/lib/ims/bom";
import { dateLabel, inr, inrExact, qtyText, stockBadge } from "@/lib/ims/format";
import { useImsAction, useImsData } from "../core";

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
                Create “{createLabel.slice(0, 48)}{createLabel.length > 48 ? "…" : ""}” in inventory
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {allowCreate && hits.length > 0 && createLabel && !hits.some((h) => h.name.toLowerCase() === createLabel.toLowerCase()) ? (
        <div className="ims-item-search-create">
          <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void createAndLink()}>
            Or create “{createLabel.slice(0, 40)}{createLabel.length > 40 ? "…" : ""}” as new inventory item
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

/**
 * Advanced picker for approved quotations (Quotation V1 → BOM link).
 * Stores the quotation document number as the BOM `quotationRef`.
 */
export function QuotationSelect({
  value,
  onChange,
  id,
  required,
  placeholder = "Select approved quotation…",
}: {
  value: string;
  onChange: (next: { quotationRef: string; quotation: BomApprovedQuotation | null; applyCustomer: boolean }) => void;
  id?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [applyCustomer, setApplyCustomer] = useState(true);
  const state = useImsData(() => bom.quotationRefs(qDebounced || undefined), [qDebounced]);
  const quotations = state.data?.quotations ?? [];

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setQDebounced("");
    }
  }, [open]);

  const selected = useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (!needle) return null;
    return quotations.find((row) => row.docNo.toLowerCase() === needle) ?? null;
  }, [quotations, value]);

  const pick = (row: BomApprovedQuotation) => {
    onChange({ quotationRef: row.docNo, quotation: row, applyCustomer });
    setOpen(false);
  };

  const clear = () => {
    onChange({ quotationRef: "", quotation: null, applyCustomer: false });
  };

  return (
    <div className="ims-quote-select">
      <div className="ims-quote-select-trigger">
        <button
          type="button"
          id={id}
          className="ims-quote-select-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-required={required || undefined}
          onClick={() => setOpen(true)}
        >
          {value.trim() ? (
            <span className="ims-cell-stack">
              <span className="ims-strong">{value.trim()}</span>
              <small className="ims-faint">
                {selected
                  ? [selected.partyName, selected.title, selected.amount ? inr(selected.amount) : null].filter(Boolean).join(" · ")
                  : "Approved quotation linked"}
              </small>
            </span>
          ) : (
            <span className="ims-quote-select-placeholder">{placeholder}</span>
          )}
          <span className="ims-quote-select-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {value.trim() ? (
          <Button type="button" size="sm" variant="ghost" onClick={clear} aria-label="Clear quotation reference">
            Clear
          </Button>
        ) : null}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Approved quotations"
        description="Pick a customer-approved Quotation V1 document. Its number is stored as the BOM quotation reference."
        wide
        actions={
          <Button variant="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        {open ? (
          <div className="ims-quote-picker">
            <div className="ims-quote-picker-toolbar">
              <Input
                autoFocus
                size="sm"
                className="ims-quote-picker-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search quote no, customer, title…"
                aria-label="Search approved quotations"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && quotations[0]) {
                    e.preventDefault();
                    pick(quotations[0]);
                  }
                }}
              />
              <label className="ims-quote-picker-apply">
                <Switch checked={applyCustomer} onChange={setApplyCustomer} aria-label="Also set customer from quotation" />
                Set customer from quote
              </label>
            </div>
            <div className="ims-quote-picker-meta" aria-live="polite">
              {state.loading && !state.data ? "Loading…" : null}
              {state.error ? (
                <button type="button" className="bos-back-link" onClick={() => state.reload()}>
                  Retry load
                </button>
              ) : null}
              {!state.loading && state.data ? (
                <span>
                  <b>{quotations.length}</b> approved
                  {qDebounced ? ` matching “${qDebounced}”` : ""}
                </span>
              ) : null}
            </div>
            <div className="ims-pick ims-quote-picker-list" role="listbox" aria-label="Approved quotations">
              {!state.loading && !quotations.length ? (
                <p className="ims-faint" style={{ margin: "8px 2px" }}>
                  {qDebounced
                    ? `No approved quotations match “${qDebounced}”.`
                    : "No approved quotations yet. Approve a quote in Quotation V1 first."}
                </p>
              ) : null}
              {quotations.map((row) => {
                const active = value.trim().toLowerCase() === row.docNo.toLowerCase();
                return (
                  <button
                    key={row.ref}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`ims-pick-row ims-quote-picker-row${active ? " is-active" : ""}`}
                    onClick={() => pick(row)}
                  >
                    <span className="ims-cell-stack">
                      <span className="ims-strong">
                        {row.docNo}{" "}
                        {active ? (
                          <Badge tone="emerald" auto>
                            Selected
                          </Badge>
                        ) : null}
                      </span>
                      <small>
                        {[row.partyName, row.title].filter(Boolean).join(" · ")}
                        {row.partyGstin ? ` · ${row.partyGstin}` : ""}
                      </small>
                    </span>
                    <span className="ims-cell-stack" style={{ textAlign: "right" }}>
                      <span className="ims-num ims-strong">{inrExact(row.amount)}</span>
                      <small className="ims-faint">{row.date ? dateLabel(row.date) : "—"}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
