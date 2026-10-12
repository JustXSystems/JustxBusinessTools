"use client";

import "./inventory-a.css";

import { useId, useMemo, useState } from "react";
import { Button, Dialog, Field, FormGrid, Input, Select, Switch, Textarea } from "@/components/bos";
import { ims, type ImsItem, type ItemInput, type ItemList } from "@/lib/ims/api";
import { GST_RATES, inrExact, num, pct } from "@/lib/ims/format";
import { generateEan13, isEan13, suggestSku } from "@/lib/ims/inventory-a";
import { useIms, useImsAction } from "../core";
import type { InventoryMeta } from "./ItemDetail";

type Form = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  brand: string;
  unit: string;
  hsn: string;
  gstRate: string;
  supplierId: string;
  purchasePrice: string;
  sellingPrice: string;
  mrp: string;
  openingStock: string;
  minStock: string;
  maxStock: string;
  reorderQty: string;
  location: string;
  volumeMl: string;
  exciseCategory: string;
  notes: string;
  active: boolean;
};

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

function formOf(item: ImsItem | null, defaults: { gstRate: number; barcode?: string }): Form {
  return {
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    barcode: item?.barcode ?? defaults.barcode ?? "",
    category: item?.category ?? "",
    brand: item?.brand ?? "",
    unit: item?.unit ?? "pcs",
    hsn: item?.hsn ?? "",
    gstRate: str(item ? item.gstRate : defaults.gstRate),
    supplierId: item?.supplierId ?? "",
    purchasePrice: item ? str(item.purchasePrice) : "",
    sellingPrice: item ? str(item.sellingPrice) : "",
    mrp: str(item?.mrp),
    openingStock: "",
    minStock: item ? str(item.minStock) : "",
    maxStock: str(item?.maxStock),
    reorderQty: str(item?.reorderQty),
    location: item?.location ?? "",
    volumeMl: str(item?.volumeMl),
    exciseCategory: item?.exciseCategory ?? "",
    notes: item?.notes ?? "",
    active: item?.active ?? true,
  };
}

const isNum = (s: string) => s.trim() === "" || (Number.isFinite(Number(s)) && Number(s) >= 0);

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!f.name.trim()) e.name = "Give the item a name";
  else if (f.name.trim().length > 200) e.name = "Keep it under 200 characters";
  if (f.sku.length > 64) e.sku = "Max 64 characters";
  if (f.barcode.length > 64) e.barcode = "Max 64 characters";
  if (!f.unit.trim()) e.unit = "Unit is required";
  for (const k of ["purchasePrice", "sellingPrice", "mrp", "openingStock", "minStock", "maxStock", "reorderQty", "volumeMl"] as const) {
    if (!isNum(f[k])) e[k] = "Enter a number ≥ 0";
  }
  const gst = Number(f.gstRate);
  if (!Number.isFinite(gst) || gst < 0 || gst > 100) e.gstRate = "0–100";
  if (!e.mrp && !e.sellingPrice && f.mrp.trim() && num(f.sellingPrice) > num(f.mrp)) e.sellingPrice = "Selling price can't exceed MRP";
  if (!e.maxStock && f.maxStock.trim() && num(f.maxStock) < num(f.minStock)) e.maxStock = "Max must be ≥ min stock";
  return e;
}

const nullable = (s: string) => (s.trim() ? s.trim() : null);
const optNum = (s: string) => (s.trim() ? num(s) : null);

function inputOf(f: Form, excise: boolean): ItemInput {
  return {
    name: f.name.trim(),
    sku: nullable(f.sku),
    barcode: nullable(f.barcode),
    category: nullable(f.category),
    brand: nullable(f.brand),
    unit: f.unit.trim() || "pcs",
    hsn: nullable(f.hsn),
    gstRate: num(f.gstRate),
    supplierId: f.supplierId || null,
    purchasePrice: num(f.purchasePrice),
    sellingPrice: num(f.sellingPrice),
    mrp: optNum(f.mrp),
    minStock: num(f.minStock),
    maxStock: optNum(f.maxStock),
    reorderQty: optNum(f.reorderQty),
    location: nullable(f.location),
    notes: nullable(f.notes),
    ...(excise ? { volumeMl: f.volumeMl.trim() ? Math.round(num(f.volumeMl)) : null, exciseCategory: nullable(f.exciseCategory) } : {}),
    active: f.active,
  };
}

/** Sticky fields kept by "Save & add another" so batches of similar items are quick to enter. */
const STICKY: ReadonlyArray<keyof Form> = ["category", "brand", "unit", "hsn", "gstRate", "supplierId", "location"];

function ItemForm({
  item,
  initialBarcode,
  meta,
  facets,
  onClose,
  onSaved,
}: {
  item: ImsItem | null;
  initialBarcode?: string;
  meta: InventoryMeta | null;
  facets?: ItemList["facets"];
  onClose: () => void;
  onSaved?: (item: ImsItem) => void;
}) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const listId = useId().replace(/:/g, "");
  const [f, setF] = useState<Form>(() => formOf(item, { gstRate: session.settings.defaultGstRate, barcode: initialBarcode }));
  const [touched, setTouched] = useState(false);
  const [catHint, setCatHint] = useState<string | null>(null);
  const excise = session.settings.exciseActive;
  const taxonomy = meta?.taxonomy ?? session.settings.taxonomy;
  const canSeeCost = meta?.canSeeCost ?? true;

  const errors = useMemo(() => validate(f), [f]);
  const shown = touched ? errors : {};
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  const uniq = (list: ReadonlyArray<string | null | undefined>) => [...new Set(list.filter((x): x is string => Boolean(x && x.trim())))].sort((a, b) => a.localeCompare(b));
  const categories = uniq([...taxonomy.categories.map((c) => c.name), ...(facets?.categories ?? [])]);
  const brands = uniq([...taxonomy.brands, ...(facets?.brands ?? [])]);
  const units = uniq([...taxonomy.units, ...(facets?.units ?? []), "pcs"]);
  const locations = uniq(taxonomy.locations);
  const suppliers = meta?.suppliers ?? [];

  const onCategory = (value: string) => {
    const hit = taxonomy.categories.find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
    setF((s) => ({
      ...s,
      category: value,
      ...(hit?.hsn ? { hsn: hit.hsn } : {}),
      ...(hit && hit.gstRate !== null && hit.gstRate !== undefined ? { gstRate: String(hit.gstRate) } : {}),
    }));
    setCatHint(hit && (hit.hsn || hit.gstRate != null) ? `Defaults from ${hit.name}: HSN ${hit.hsn ?? "—"} · GST ${hit.gstRate ?? "—"}%` : null);
  };

  const margin = num(f.sellingPrice) > 0 ? ((num(f.sellingPrice) - num(f.purchasePrice)) / num(f.sellingPrice)) * 100 : null;
  const barcodeWarn = /^\d{13}$/.test(f.barcode) && !isEan13(f.barcode) ? "13 digits but the EAN check digit doesn't match — double-check it" : undefined;

  const save = async (again: boolean) => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    const input = inputOf(f, excise);
    const out = item
      ? await run("save-item", () => ims.updateItem(item.id, input), { success: `${input.name} saved` })
      : await run("save-item", () => ims.createItem({ ...input, openingStock: num(f.openingStock) }), {
          success: `${input.name} added`,
          description: num(f.openingStock) > 0 ? `Opening stock ${f.openingStock} ${input.unit}` : undefined,
        });
    if (!out) return;
    onSaved?.(out.item);
    if (again && !item) {
      const fresh = formOf(null, { gstRate: session.settings.defaultGstRate });
      for (const k of STICKY) (fresh as Record<keyof Form, unknown>)[k] = f[k];
      setF(fresh);
      setTouched(false);
      return;
    }
    onClose();
  };

  return (
    <form
      className="ims-inv-lg"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <FormGrid>
        <div className="ims-inv-formhead">Basics</div>
        <Field label="Item name *" full error={shown.name}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Kingfisher Premium 650ml" maxLength={200} />
          )}
        </Field>
        <Field label="SKU / item code" error={shown.sku} hint="Unique code; import updates match on it">
          {({ id, describedBy }) => (
            <div className="ims-inv-inline">
              <Input id={id} aria-describedby={describedBy} value={f.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} placeholder="KF-650" maxLength={64} />
              <Button size="sm" variant="ghost" onClick={() => set("sku", suggestSku(f.name))} disabled={!f.name.trim()} aria-label="Suggest SKU from name">
                Auto
              </Button>
            </div>
          )}
        </Field>
        <Field label="Barcode" error={shown.barcode} hint={barcodeWarn ?? "Scan it in, type it, or generate an in-store EAN-13"}>
          {({ id, describedBy }) => (
            <div className="ims-inv-inline">
              <Input id={id} aria-describedby={describedBy} value={f.barcode} onChange={(e) => set("barcode", e.target.value.trim())} placeholder="8901234567890" maxLength={64} inputMode="text" />
              <Button size="sm" variant="ghost" onClick={() => set("barcode", generateEan13(f.sku))} aria-label="Generate barcode">
                Generate
              </Button>
            </div>
          )}
        </Field>
        <Field label="Category" hint={catHint ?? undefined}>
          {({ id, describedBy }) => (
            <>
              <Input id={id} aria-describedby={describedBy} list={`${listId}-cat`} value={f.category} onChange={(e) => onCategory(e.target.value)} placeholder="Pick or type" maxLength={80} />
              <datalist id={`${listId}-cat`}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Brand">
          {({ id }) => (
            <>
              <Input id={id} list={`${listId}-brand`} value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Pick or type" maxLength={80} />
              <datalist id={`${listId}-brand`}>
                {brands.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Unit *" error={shown.unit}>
          {({ id, describedBy, invalid }) => (
            <>
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} list={`${listId}-unit`} value={f.unit} onChange={(e) => set("unit", e.target.value)} maxLength={20} />
              <datalist id={`${listId}-unit`}>
                {units.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Preferred supplier" hint={suppliers.length ? undefined : "Add suppliers in Suppliers & Customers"}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
              <option value="">No preferred supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="ims-inv-formhead">Pricing &amp; GST</div>
        {canSeeCost ? (
          <Field label="Purchase price (₹)" error={shown.purchasePrice}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" value={f.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} placeholder="0.00" />}
          </Field>
        ) : null}
        <Field
          label="Selling price (₹)"
          error={shown.sellingPrice}
          hint={canSeeCost && margin !== null ? (margin < 0 ? `Below cost — margin ${pct(margin, 1)}` : `Margin ${pct(margin, 1)} · ${inrExact(num(f.sellingPrice) - num(f.purchasePrice))} per unit`) : undefined}
        >
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" value={f.sellingPrice} onChange={(e) => set("sellingPrice", e.target.value)} placeholder="0.00" />}
        </Field>
        <Field label="MRP (₹)" error={shown.mrp}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" value={f.mrp} onChange={(e) => set("mrp", e.target.value)} placeholder="Optional" />}
        </Field>
        <Field label="HSN / SAC">
          {({ id }) => <Input id={id} value={f.hsn} onChange={(e) => set("hsn", e.target.value.replace(/\s/g, ""))} placeholder="e.g. 2203" maxLength={20} inputMode="numeric" />}
        </Field>
        <Field label="GST rate" error={shown.gstRate}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={f.gstRate} onChange={(e) => set("gstRate", e.target.value)}>
              {[...new Set([...GST_RATES.map(String), f.gstRate])].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="ims-inv-formhead">Stock levels</div>
        {!item ? (
          <Field label="Opening stock" error={shown.openingStock} hint="Posted as an opening-stock entry">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" value={f.openingStock} onChange={(e) => set("openingStock", e.target.value)} placeholder="0" />}
          </Field>
        ) : null}
        <Field label="Minimum stock" error={shown.minStock} hint="Alerts and restock list below this">
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" value={f.minStock} onChange={(e) => set("minStock", e.target.value)} placeholder="0" />}
        </Field>
        <Field label="Maximum stock" error={shown.maxStock} hint="Optional — flags overstock">
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" value={f.maxStock} onChange={(e) => set("maxStock", e.target.value)} placeholder="Optional" />}
        </Field>
        <Field label="Reorder quantity" error={shown.reorderQty} hint="Fixed lot; blank = top up to max">
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" value={f.reorderQty} onChange={(e) => set("reorderQty", e.target.value)} placeholder="Auto" />}
        </Field>
        <Field label="Location / rack">
          {({ id }) => (
            <>
              <Input id={id} list={`${listId}-loc`} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Rack A1" maxLength={80} />
              <datalist id={`${listId}-loc`}>
                {locations.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        {excise ? (
          <>
            <div className="ims-inv-formhead">Excise</div>
            <Field label="Volume (ml)" error={shown.volumeMl}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="numeric" value={f.volumeMl} onChange={(e) => set("volumeMl", e.target.value)} placeholder="e.g. 650" />}
            </Field>
            <Field label="Excise category">
              {({ id }) => <Input id={id} value={f.exciseCategory} onChange={(e) => set("exciseCategory", e.target.value)} placeholder="e.g. Beer / IMFL" maxLength={40} />}
            </Field>
          </>
        ) : null}

        <Field label="Notes" full>
          {({ id }) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} placeholder="Pack size, storage, anything the team should know" />}
        </Field>
        {item ? (
          <div className="ims-row bos-form-grid-full">
            <Switch checked={f.active} onChange={(v) => set("active", v)} aria-label="Item is active" />
            <span className="ims-muted">{f.active ? "Active — shows in pickers and stock lists" : "Archived — hidden from pickers"}</span>
          </div>
        ) : null}
      </FormGrid>

      <div className="bos-dialog-actions">
        {touched && Object.keys(errors).length ? <span className="bos-dialog-actions-note ims-neg">Fix the highlighted fields</span> : null}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {!item ? (
          <Button variant="secondary" onClick={() => void save(true)} disabled={busy === "save-item"}>
            Save &amp; add another
          </Button>
        ) : null}
        <Button variant="primary" type="submit" disabled={busy === "save-item"}>
          {busy === "save-item" ? "Saving…" : item ? "Save changes" : "Add item"}
        </Button>
      </div>
    </form>
  );
}

export type ItemEditorState = { item: ImsItem | null; barcode?: string; seq: number } | null;

/** Add / edit item. Remounts the form for every open so it always starts from the record. */
export function ItemDialog({
  editor,
  meta,
  facets,
  onClose,
  onSaved,
}: {
  editor: ItemEditorState;
  meta: InventoryMeta | null;
  facets?: ItemList["facets"];
  onClose: () => void;
  onSaved?: (item: ImsItem) => void;
}) {
  return (
    <Dialog
      open={editor !== null}
      onClose={onClose}
      dismissible={false}
      title={editor?.item ? `Edit ${editor.item.name}` : "Add item"}
      description={editor?.item ? "Changes apply everywhere the item is used. Stock is changed only through stock entries." : "Category fills HSN and GST from your settings. Only the name is required."}
    >
      {editor ? <ItemForm key={editor.seq} item={editor.item} initialBarcode={editor.barcode} meta={meta} facets={facets} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}
