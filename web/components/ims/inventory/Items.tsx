"use client";

import "./inventory-a.css";

import { useMemo, useState, type DragEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  FilterChip,
  Pagination,
  SearchInput,
  Segmented,
  Select,
  Switch,
  useToast,
  type BosColumn,
} from "@/components/bos";
import { errorText, ims, type ImsItem, type StockStatus } from "@/lib/ims/api";
import { downloadCsv, downloadXlsx, inr, inrExact, qtyText, readSheet, stockBadge, todayLocal, type ExportColumn } from "@/lib/ims/format";
import {
  IMPORT_FIELDS,
  autoMap,
  detectSerializedImport,
  groupSerializedPreview,
  itemExportColumns,
  mapRows,
  nonBlankRows,
  type ImportMode,
  type MappedRow,
  type SerializedPreviewGroup,
} from "@/lib/ims/inventory-a";
import { Loaded, PageHeader, Stack, StatusBadge, useIms, useImsAction, useImsData } from "../core";
import { ItemDialog, type ItemEditorState } from "./ItemDialog";
import { ItemCell, ItemDetailDialog, useInventoryMeta } from "./ItemDetail";
import { LabelsPanel } from "./labels";

type StatusFilter = "ALL" | StockStatus;
type SortKey = "name" | "stockAsc" | "stockDesc" | "value" | "price" | "recent" | "idle";

const SORTS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "name", label: "Name A–Z" },
  { value: "stockAsc", label: "Stock: low → high" },
  { value: "stockDesc", label: "Stock: high → low" },
  { value: "value", label: "Stock value" },
  { value: "price", label: "Selling price" },
  { value: "recent", label: "Recently updated" },
  { value: "idle", label: "Longest idle" },
];

const STATUS_CHIPS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "GOOD", label: "In stock" },
  { value: "LOW", label: "Low" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
  { value: "OVERSTOCK", label: "Overstock" },
];

const PAGE_SIZE = 25;

function sortItems(list: ImsItem[], key: SortKey): ImsItem[] {
  const out = [...list];
  const by: Record<SortKey, (a: ImsItem, b: ImsItem) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    stockAsc: (a, b) => a.currentStock - b.currentStock,
    stockDesc: (a, b) => b.currentStock - a.currentStock,
    value: (a, b) => b.stockValue - a.stockValue,
    price: (a, b) => b.sellingPrice - a.sellingPrice,
    recent: (a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
    idle: (a, b) => b.idleDays - a.idleDays,
  };
  return out.sort(by[key]);
}

const matches = (i: ImsItem, q: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [i.name, i.sku, i.barcode, i.brand, i.category, i.hsn, i.location, i.supplierName].some((v) => v && v.toLowerCase().includes(t));
};

/* ---------- Import ---------- */

type ImportResult = { created: number; updated: number; serialsAdded: number; errors: string[] };

function downloadTemplate() {
  const sample: Record<string, string | number> = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, f.sample]));
  const columns: ReadonlyArray<ExportColumn<Record<string, string | number>>> = IMPORT_FIELDS.map((f) => ({ header: f.label, value: (r) => r[f.key] }));
  void downloadXlsx("ims-items-import-template", "Items", [sample], columns);
}

function downloadSerializedTemplate() {
  const rows: Array<Record<string, string | number>> = [
    { name: "Hikvision 2MP Dome Camera", serialNo: "HK-2MP-0001", category: "CCTV", brand: "Hikvision", unit: "pcs", hsn: "8525", gstRate: 18, purchasePrice: 1200, sellingPrice: 1800, mrp: 2200, location: "Rack A1" },
    { name: "Hikvision 2MP Dome Camera", serialNo: "HK-2MP-0002", category: "CCTV", brand: "Hikvision", unit: "pcs", hsn: "8525", gstRate: 18, purchasePrice: 1200, sellingPrice: 1800, mrp: 2200, location: "Rack A1" },
    { name: "Hikvision 2MP Dome Camera", serialNo: "HK-2MP-0003", category: "CCTV", brand: "Hikvision", unit: "pcs", hsn: "8525", gstRate: 18, purchasePrice: 1350, sellingPrice: 1800, mrp: 2200, location: "Rack A1" },
  ];
  const cols: ReadonlyArray<ExportColumn<Record<string, string | number>>> = [
    { header: "Item name", value: (r) => r.name },
    { header: "Serial / Scan code", value: (r) => r.serialNo },
    { header: "Category", value: (r) => r.category },
    { header: "Brand", value: (r) => r.brand },
    { header: "Unit", value: (r) => r.unit },
    { header: "HSN / SAC", value: (r) => r.hsn },
    { header: "GST %", value: (r) => r.gstRate },
    { header: "Purchase price", value: (r) => r.purchasePrice },
    { header: "Selling price", value: (r) => r.sellingPrice },
    { header: "MRP", value: (r) => r.mrp },
    { header: "Location", value: (r) => r.location },
  ];
  void downloadXlsx("ims-serialized-units-template", "Units", rows, cols);
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, busy } = useImsAction();
  const [over, setOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ headers: string[]; rows: Array<Record<string, unknown>> } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<ImportMode>("sku");
  const [autoDetectedSerialized, setAutoDetectedSerialized] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const mapped: MappedRow[] = useMemo(() => (sheet ? mapRows(sheet.rows.slice(0, 5000), mapping, mode) : []), [sheet, mapping, mode]);
  const ready = mapped.filter((r) => !r.issues.length);
  const bad = mapped.filter((r) => r.issues.length);
  const serializedGroups: SerializedPreviewGroup[] = useMemo(() => (mode === "serialized" ? groupSerializedPreview(ready) : []), [mode, ready]);
  const hasCodeCol = Boolean(mapping.serialNo || mapping.barcode || mapping.sku);

  const reset = () => {
    setFileName(null);
    setSheet(null);
    setMapping({});
    setMode("sku");
    setAutoDetectedSerialized(false);
    setReadError(null);
    setResult(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    setResult(null);
    try {
      const rows = nonBlankRows(await readSheet(file));
      if (!rows.length) {
        setReadError("That sheet has no data rows. Put headings in the first row and one item per row below.");
        return;
      }
      const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((h) => !h.startsWith("__EMPTY"));
      const auto = autoMap(headers);
      const isSerialized = detectSerializedImport(rows, auto);
      setFileName(file.name);
      setSheet({ headers, rows });
      setMapping(auto);
      setMode(isSerialized ? "serialized" : "sku");
      setAutoDetectedSerialized(isSerialized);
    } catch (err) {
      setReadError(`Couldn't read that file — ${errorText(err)}. Use .xlsx, .xls or .csv.`);
    }
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    void load(e.dataTransfer.files?.[0]);
  };

  const submit = async () => {
    if (!ready.length) return;
    const out = await run(
      "import",
      async () => {
        const total: ImportResult = { created: 0, updated: 0, serialsAdded: 0, errors: [] };
        for (let start = 0; start < ready.length; start += 1000) {
          const chunk = ready.slice(start, start + 1000);
          const r = await ims.importItems(
            chunk.map((c) => c.record),
            mode,
          );
          total.created += r.created;
          total.updated += r.updated;
          total.serialsAdded += r.serialsAdded ?? 0;
          total.errors.push(
            ...r.errors.map((e) =>
              e.replace(/^Row (\d+)/, (_, n: string) => {
                const src = chunk[Number(n) - 1];
                return src ? `Sheet row ${src.index + 2}` : `Row ${n}`;
              }),
            ),
          );
        }
        return total;
      },
      { success: "Import finished" },
    );
    if (out) setResult(out);
  };

  const previewCols: BosColumn<MappedRow>[] = [
    { key: "row", header: "Row", mono: true, cell: (r) => r.index + 2 },
    { key: "name", header: "Name", cell: (r) => (r.record.name ? String(r.record.name) : <span className="ims-neg">Missing</span>) },
    { key: "sku", header: "SKU", cell: (r) => String(r.record.sku ?? "—") },
    { key: "category", header: "Category", cell: (r) => String(r.record.category ?? "—") },
    { key: "unit", header: "Unit", cell: (r) => String(r.record.unit ?? "pcs") },
    { key: "price", header: "Sell", align: "right", cell: (r) => (typeof r.record.sellingPrice === "number" ? inrExact(r.record.sellingPrice) : "—") },
    { key: "open", header: "Opening", align: "right", cell: (r) => (typeof r.record.openingStock === "number" ? qtyText(r.record.openingStock) : "—") },
    { key: "ok", header: "", cell: (r) => (r.issues.length ? <Badge tone="coral">CHECK</Badge> : <Badge tone="emerald">READY</Badge>) },
  ];

  const serializedPreviewCols: BosColumn<SerializedPreviewGroup>[] = [
    { key: "name", header: "Product", cell: (g) => <span className="ims-strong">{g.name}</span> },
    { key: "category", header: "Category", cell: (g) => g.category ?? "—" },
    { key: "brand", header: "Brand", cell: (g) => g.brand ?? "—" },
    { key: "units", header: "Stock qty", align: "right", cell: (g) => <span className="ims-strong">{qtyText(g.units, g.unit)}</span> },
    { key: "buy", header: "Avg buy", align: "right", cell: (g) => (g.avgPurchasePrice != null ? inrExact(g.avgPurchasePrice) : "—") },
    { key: "sell", header: "Sell", align: "right", cell: (g) => (g.sellingPrice != null ? inrExact(g.sellingPrice) : "—") },
    {
      key: "codes",
      header: "Scan codes",
      cell: (g) => (
        <span className="bos-code" style={{ fontSize: 11 }}>
          {g.sampleCodes.join(", ")}
          {g.units > g.sampleCodes.length ? ` +${g.units - g.sampleCodes.length} more` : ""}
        </span>
      ),
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={false}
      title="Import items from Excel / CSV"
      description={
        mode === "serialized"
          ? "Each row is one physical unit with a unique scan code. Rows with the same Item name, Category & Brand are grouped into one product and counted automatically."
          : "Rows whose SKU already exists update that item; new rows are created (opening stock applies to new items only)."
      }
      icon={{ tone: "blue", name: "file" }}
      actionsNote={
        sheet && !result
          ? mode === "serialized"
            ? `${ready.length} unit${ready.length === 1 ? "" : "s"} → ${serializedGroups.length} product${serializedGroups.length === 1 ? "" : "s"} · ${bad.length} need fixing`
            : `${ready.length} ready · ${bad.length} need fixing`
          : undefined
      }
      actions={
        result ? (
          <>
            <Button variant="ghost" onClick={reset}>
              Import another file
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            {sheet ? (
              <Button variant="primary" onClick={submit} disabled={!ready.length || busy === "import" || !mapping.name || (mode === "serialized" && !hasCodeCol)}>
                {busy === "import"
                  ? "Importing…"
                  : mode === "serialized"
                    ? `Import ${ready.length} unit${ready.length === 1 ? "" : "s"} (${serializedGroups.length} product${serializedGroups.length === 1 ? "" : "s"})`
                    : `Import ${ready.length} item${ready.length === 1 ? "" : "s"}`}
              </Button>
            ) : null}
          </>
        )
      }
    >
      <div className="ims-inv-xl">
        {result ? (
          <Stack gap={12}>
            <div className="ims-inv-tiles">
              <div className="ims-inv-tile">
                <small>{mode === "serialized" ? "Products created" : "Created"}</small>
                <b className="ims-pos">{result.created}</b>
              </div>
              <div className="ims-inv-tile">
                <small>{mode === "serialized" ? "Products updated" : "Updated"}</small>
                <b>{result.updated}</b>
              </div>
              {mode === "serialized" || result.serialsAdded > 0 ? (
                <div className="ims-inv-tile">
                  <small>Units / scan codes added</small>
                  <b className="ims-pos">{result.serialsAdded}</b>
                </div>
              ) : null}
              <div className="ims-inv-tile">
                <small>Skipped</small>
                <b className={result.errors.length + bad.length ? "ims-neg" : undefined}>{result.errors.length + bad.length}</b>
              </div>
            </div>
            {result.errors.length || bad.length ? (
              <Alert tone="amber" title="Some rows weren't imported">
                <ul className="ims-inv-errors">
                  {bad.slice(0, 20).map((r) => (
                    <li key={`c${r.index}`}>
                      Sheet row {r.index + 2}: {r.issues.join("; ")}
                    </li>
                  ))}
                  {result.errors.map((e, i) => (
                    <li key={`s${i}`}>{e}</li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <Alert tone="emerald" title="Everything imported cleanly" />
            )}
          </Stack>
        ) : !sheet ? (
          <Stack gap={12}>
            <label
              className={`ims-inv-drop${over ? " is-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <span style={{ fontSize: 28 }} aria-hidden="true">
                📄
              </span>
              <b>Drop a spreadsheet here, or click to choose</b>
              <span className="ims-faint">.xlsx, .xls or .csv · supports both product-per-row and unique-scan-code unit-per-row sheets</span>
              <input type="file" accept=".xlsx,.xls,.csv,text/csv" hidden onChange={(e) => void load(e.target.files?.[0])} />
            </label>
            {readError ? <Alert tone="coral" title="Couldn't use that file">{readError}</Alert> : null}
            <div className="ims-between">
              <span className="ims-faint">Not sure about the format? Download a template — columns are matched automatically.</span>
              <span className="ims-row" style={{ gap: 8 }}>
                <Button size="sm" icon="download" onClick={downloadTemplate}>
                  Product template
                </Button>
                <Button size="sm" icon="download" onClick={downloadSerializedTemplate}>
                  Unit / serial template
                </Button>
              </span>
            </div>
          </Stack>
        ) : (
          <Stack gap={14}>
            <div className="ims-between">
              <span className="ims-muted">
                <b>{fileName}</b> · {sheet.rows.length} row{sheet.rows.length === 1 ? "" : "s"} · {sheet.headers.length} columns
              </span>
              <Button size="sm" variant="ghost" onClick={reset}>
                Choose another file
              </Button>
            </div>
            <div className="ims-between" style={{ gap: 10 }}>
              <span className="ims-faint">How is your sheet structured?</span>
              <Segmented
                size="sm"
                aria-label="Import mode"
                value={mode}
                onChange={(v) => setMode(v as ImportMode)}
                options={[
                  { value: "sku", label: "One row per product" },
                  { value: "serialized", label: "One row per physical unit (unique scan code)" },
                ]}
              />
            </div>
            {autoDetectedSerialized && mode === "serialized" ? (
              <Alert tone="blue" title="Grouped by product with unique scan codes">
                Detected repeated product names with unique scan codes — {ready.length} unit{ready.length === 1 ? "" : "s"} will be grouped into{" "}
                {serializedGroups.length} product{serializedGroups.length === 1 ? "" : "s"} (weighted average purchase price, duplicate scan codes blocked).
              </Alert>
            ) : null}
            {sheet.rows.length > 5000 ? <Alert tone="amber" title="Large file">Only the first 5,000 rows can be imported at once; split the rest into another file.</Alert> : null}
            <div>
              <div className="ims-inv-subhead" style={{ marginTop: 0 }}>
                Match your columns
              </div>
              <div className="ims-inv-map">
                {IMPORT_FIELDS.map((f) => (
                  <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                    {({ id }) => (
                      <Select id={id} size="sm" value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                        <option value="">— Skip —</option>
                        {sheet.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ))}
              </div>
            </div>
            {!mapping.name ? <Alert tone="coral" title="Pick the column that holds the item name" /> : null}
            {mode === "serialized" && !hasCodeCol ? <Alert tone="coral" title="Pick the column that holds the unique Serial / Scan code (or Barcode / SKU)" /> : null}
            <div>
              <div className="ims-inv-subhead" style={{ marginTop: 0 }}>
                {mode === "serialized" ? `Grouped product preview (${serializedGroups.length} products from ${ready.length} units)` : "Preview"}
              </div>
              {mode === "serialized" ? (
                <DataTable compact columns={serializedPreviewCols} rows={serializedGroups.slice(0, 12)} rowKey={(g) => g.key} caption="Grouped serialized import preview" />
              ) : (
                <DataTable compact columns={previewCols} rows={[...bad.slice(0, 3), ...ready].slice(0, 8)} rowKey={(r) => String(r.index)} caption="Import preview" />
              )}
              {bad.length ? (
                <ul className="ims-inv-errors">
                  {bad.slice(0, 6).map((r) => (
                    <li key={r.index}>
                      Sheet row {r.index + 2}: {r.issues.join("; ")}
                    </li>
                  ))}
                  {bad.length > 6 ? <li>…and {bad.length - 6} more</li> : null}
                </ul>
              ) : null}
            </div>
          </Stack>
        )}
      </div>
    </Dialog>
  );
}

/* ---------- Module ---------- */

export function ItemsModule() {
  const { can, takeIntent } = useIms();
  const canEdit = can("items");
  const { run } = useImsAction();
  const { show } = useToast();
  const [intent] = useState(() => takeIntent("items"));

  const [showArchived, setShowArchived] = useState(false);
  const list = useImsData(() => ims.items({ includeInactive: showArchived }), [showArchived]);
  const meta = useInventoryMeta();
  const canSeeCost = meta.data?.canSeeCost ?? true;

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [sort, setSort] = useState<SortKey>("name");
  const [view, setView] = useState<"table" | "cards">("table");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const [detailId, setDetailId] = useState<string | null>(() => (intent?.startsWith("open:") ? intent.slice(5) : null));
  const [editor, setEditor] = useState<ItemEditorState>(() =>
    canEdit && intent === "new" ? { item: null, seq: 1 } : canEdit && intent?.startsWith("new:") ? { item: null, barcode: intent.slice(4), seq: 1 } : null,
  );
  const [importOpen, setImportOpen] = useState(() => canEdit && intent === "import");
  const [labelItems, setLabelItems] = useState<ImsItem[] | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const all = useMemo(() => list.data?.items ?? [], [list.data]);
  const baseFiltered = useMemo(
    () => all.filter((i) => matches(i, q) && (!category || (i.category ?? "") === category) && (!brand || (i.brand ?? "") === brand)),
    [all, q, category, brand],
  );
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: baseFiltered.length, GOOD: 0, LOW: 0, OUT_OF_STOCK: 0, OVERSTOCK: 0 };
    for (const i of baseFiltered) {
      if (i.active) c[i.status] += 1;
    }
    return c;
  }, [baseFiltered]);
  const filtered = useMemo(
    () => sortItems(baseFiltered.filter((i) => status === "ALL" || (i.active && i.status === status)), sort),
    [baseFiltered, status, sort],
  );
  const liveSummary = useMemo(() => {
    const active = filtered.filter((i) => i.active);
    const activeBase = baseFiltered.filter((i) => i.active);
    return {
      count: filtered.length,
      units: active.reduce((s, i) => s + Math.max(0, i.currentStock), 0),
      value: active.reduce((s, i) => s + i.stockValue, 0),
      low: activeBase.filter((i) => i.status === "LOW").length,
      out: activeBase.filter((i) => i.status === "OUT_OF_STOCK").length,
      over: activeBase.filter((i) => i.status === "OVERSTOCK").length,
      damaged: active.reduce((s, i) => s + i.damagedStock, 0),
    };
  }, [filtered, baseFiltered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const selectedItems = all.filter((i) => selected.has(i.id));
  const filtersOn = Boolean(q || category || brand || status !== "ALL");

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };
  const clearFilters = () => {
    setQ("");
    setCategory("");
    setBrand("");
    setStatus("ALL");
    setPage(0);
  };

  const exportRows = (rows: ReadonlyArray<ImsItem>, kind: "csv" | "xlsx") => {
    const name = `ims-items-${todayLocal()}`;
    if (kind === "csv") downloadCsv(name, rows, itemExportColumns(canSeeCost));
    else void downloadXlsx(name, "Items", rows, itemExportColumns(canSeeCost));
  };

  const bulkArchive = async () => {
    const ids = [...selected];
    const out = await run("bulk-archive", async () => {
      let archived = 0;
      let deleted = 0;
      for (const id of ids) {
        const r = await ims.deleteItem(id);
        if (r?.archived) archived += 1;
        else deleted += 1;
      }
      return { archived, deleted };
    });
    setConfirmBulk(false);
    if (!out) return;
    setSelected(new Set());
    show({ tone: "emerald", title: `${out.archived + out.deleted} item${out.archived + out.deleted === 1 ? "" : "s"} removed`, description: `${out.archived} archived (have history) · ${out.deleted} deleted` });
  };

  const columns: BosColumn<ImsItem>[] = [
    { key: "name", header: "Item", cell: (i) => <ItemCell item={i} />, width: "26%" },
    { key: "category", header: "Category", cell: (i) => i.category ?? <span className="ims-faint">—</span> },
    { key: "brand", header: "Brand", cell: (i) => i.brand ?? <span className="ims-faint">—</span> },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      cell: (i) => {
        const hints = [
          i.reservedStock ? `${qtyText(i.reservedStock)} res.` : null,
          i.onOrderStock ? `${qtyText(i.onOrderStock)} on order` : null,
          i.damagedStock ? `${qtyText(i.damagedStock)} dmg` : null,
          i.serialMismatch ? `⚠ ${i.serialCount ?? 0} codes` : i.trackSerials && (i.serialCount ?? 0) > 0 ? `${i.serialCount} codes` : null,
        ].filter(Boolean);
        return (
          <span className="ims-cell-stack" style={{ alignItems: "flex-end" }}>
            <span className="ims-inv-stock">
              <span className="ims-strong">{qtyText(i.currentStock, i.unit)}</span>
              {i.active ? <StatusBadge view={stockBadge(i.status)} /> : <Badge tone="neutral">Archived</Badge>}
            </span>
            {hints.length ? <small className={i.serialMismatch ? "ims-neg" : "ims-faint"}>{hints.join(" · ")}</small> : null}
          </span>
        );
      },
    },
    { key: "minmax", header: "Min / Max", align: "right", cell: (i) => <span className="ims-muted">{`${qtyText(i.minStock)} / ${i.maxStock != null ? qtyText(i.maxStock) : "—"}`}</span> },
    ...(canSeeCost ? [{ key: "buy", header: "Buy", align: "right" as const, cell: (i: ImsItem) => inrExact(i.purchasePrice) }] : []),
    { key: "sell", header: "Sell", align: "right", cell: (i) => inrExact(i.sellingPrice) },
    { key: "mrp", header: "MRP", align: "right", cell: (i) => (i.mrp != null ? inrExact(i.mrp) : "—") },
    { key: "gst", header: "GST", align: "right", cell: (i) => `${i.gstRate}%` },
    { key: "location", header: "Location", cell: (i) => i.location ?? <span className="ims-faint">—</span> },
    ...(canSeeCost ? [{ key: "value", header: "Value", align: "right" as const, cell: (i: ImsItem) => <span className="ims-strong">{inr(i.stockValue)}</span> }] : []),
  ];

  if (labelItems) return <LabelsPanel items={labelItems} onBack={() => setLabelItems(null)} />;

  return (
    <Stack>
      <PageHeader
        title="Items"
        sub="Your product master — prices, GST, stock levels, barcodes and labels."
        actions={
          <>
            <Button size="sm" variant="ghost" icon="download" onClick={() => exportRows(filtered, "csv")} disabled={!filtered.length}>
              CSV
            </Button>
            <Button size="sm" variant="ghost" icon="download" onClick={() => exportRows(filtered, "xlsx")} disabled={!filtered.length}>
              Excel
            </Button>
            {canEdit ? (
              <Button size="sm" icon="file" onClick={() => setImportOpen(true)}>
                Import
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="primary" icon="plus" onClick={() => setEditor({ item: null, seq: Date.now() })}>
                Add item
              </Button>
            ) : null}
          </>
        }
      />

      <Loaded state={list} rows={3}>
        {(data) =>
          (data.summary?.count ?? all.length) === 0 && !showArchived ? (
            <Card interactive={false}>
              <EmptyState
                glyph="📦"
                title="No items yet"
                actions={
                  canEdit ? (
                    <>
                      <Button variant="primary" icon="plus" onClick={() => setEditor({ item: null, seq: Date.now() })}>
                        Add your first item
                      </Button>
                      <Button icon="file" onClick={() => setImportOpen(true)}>
                        Import from Excel
                      </Button>
                    </>
                  ) : undefined
                }
              >
                {canEdit ? "Add products one by one, or import your whole catalogue from a spreadsheet." : "Your team hasn't added any products yet."}
              </EmptyState>
            </Card>
          ) : (
            <Stack gap={14}>
              <div className="ims-inv-strip" aria-label="Catalogue summary">
                <span className="ims-inv-pill">
                  Items <b>{liveSummary.count.toLocaleString("en-IN")}</b>
                </span>
                <span className="ims-inv-pill">
                  Units <b>{qtyText(liveSummary.units)}</b>
                </span>
                {canSeeCost ? (
                  <span className="ims-inv-pill">
                    Value <b>{inr(liveSummary.value)}</b>
                  </span>
                ) : null}
                <span className="ims-inv-pill">
                  Low <b style={{ color: "var(--bos-amber-600)" }}>{liveSummary.low}</b>
                </span>
                <span className="ims-inv-pill">
                  Out <b style={{ color: "var(--bos-coral-600)" }}>{liveSummary.out}</b>
                </span>
                <span className="ims-inv-pill">
                  Overstock <b>{liveSummary.over}</b>
                </span>
                {liveSummary.damaged ? (
                  <span className="ims-inv-pill">
                    Damaged <b>{qtyText(liveSummary.damaged)}</b>
                  </span>
                ) : null}
              </div>

              <div className="ims-toolbar" style={{ marginBottom: 0 }}>
                <SearchInput
                  wrapperClassName="ims-grow"
                  placeholder="Search name, SKU, barcode, brand, HSN, location…"
                  aria-label="Search items"
                  value={q}
                  onChange={(e) => resetPage(setQ)(e.target.value)}
                />
                <Select size="sm" aria-label="Category" value={category} onChange={(e) => resetPage(setCategory)(e.target.value)} style={{ width: "auto" }}>
                  <option value="">All categories</option>
                  {(data.facets?.categories ?? []).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Select size="sm" aria-label="Brand" value={brand} onChange={(e) => resetPage(setBrand)(e.target.value)} style={{ width: "auto" }}>
                  <option value="">All brands</option>
                  {(data.facets?.brands ?? []).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Select size="sm" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: "auto" }}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <Segmented
                  size="sm"
                  role="radio"
                  aria-label="View"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "table", label: "☰", ariaLabel: "Table view" },
                    { value: "cards", label: "▦", ariaLabel: "Card view" },
                  ]}
                />
              </div>

              <div className="ims-between">
                <div className="ims-row" role="group" aria-label="Stock status">
                  {STATUS_CHIPS.map((s) => (
                    <FilterChip key={s.value} active={status === s.value} onClick={() => resetPage(setStatus)(s.value)}>
                      {s.label} <span className="ims-faint">{counts[s.value]}</span>
                    </FilterChip>
                  ))}
                  {filtersOn ? (
                    <Button size="sm" variant="ghost" icon="x" onClick={clearFilters}>
                      Clear
                    </Button>
                  ) : null}
                </div>
                <span className="ims-row ims-faint" style={{ gap: 8 }}>
                  <Switch checked={showArchived} onChange={resetPage(setShowArchived)} aria-label="Include archived items" />
                  Include archived
                </span>
              </div>

              {view === "table" ? (
                <DataTable
                  columns={columns}
                  rows={pageRows}
                  rowKey={(i) => i.id}
                  onRowClick={(i) => setDetailId(i.id)}
                  selection={{ selected, onChange: setSelected }}
                  bulkActions={() => (
                    <>
                      <Button size="sm" icon="printer" onClick={() => setLabelItems(selectedItems)}>
                        Print labels
                      </Button>
                      <Button size="sm" icon="download" onClick={() => exportRows(selectedItems, "csv")}>
                        Export
                      </Button>
                      {canEdit ? (
                        <Button size="sm" variant="destructive" onClick={() => setConfirmBulk(true)}>
                          Archive / delete
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                        Clear
                      </Button>
                    </>
                  )}
                  caption="Items"
                  chevron
                  empty={
                    <span>
                      No items match these filters.{" "}
                      <Button size="sm" variant="ghost" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </span>
                  }
                />
              ) : pageRows.length ? (
                <div className="ims-inv-cards">
                  {pageRows.map((i) => (
                    <button key={i.id} type="button" className="ims-inv-card" onClick={() => setDetailId(i.id)}>
                      <span className="ims-between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                        <ItemCell item={i} />
                        <StatusBadge view={stockBadge(i.status)} />
                      </span>
                      <span className="ims-inv-card-facts">
                        <span>
                          Stock <b>{qtyText(i.currentStock, i.unit)}</b>
                        </span>
                        <span>
                          Sell <b>{inr(i.sellingPrice)}</b>
                        </span>
                        <span>
                          Category <b>{i.category ?? "—"}</b>
                        </span>
                        {canSeeCost ? (
                          <span>
                            Value <b>{inr(i.stockValue)}</b>
                          </span>
                        ) : (
                          <span>
                            MRP <b>{i.mrp != null ? inr(i.mrp) : "—"}</b>
                          </span>
                        )}
                        <span>
                          Brand <b>{i.brand ?? "—"}</b>
                        </span>
                        <span>
                          Rack <b>{i.location ?? "—"}</b>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <Card interactive={false}>
                  <EmptyState
                    icon="search"
                    title="No items match"
                    actions={
                      <Button size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                </Card>
              )}

              {filtered.length > PAGE_SIZE ? (
                <Pagination
                  actions={
                    <>
                      <Button size="sm" variant="ghost" icon="chevronLeft" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page" />
                      <span className="ims-faint">
                        {current + 1} / {pageCount}
                      </span>
                      <Button size="sm" variant="ghost" icon="chevronRight" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} aria-label="Next page" />
                    </>
                  }
                >
                  Showing {current * PAGE_SIZE + 1}–{Math.min(filtered.length, (current + 1) * PAGE_SIZE)} of {filtered.length}
                </Pagination>
              ) : (
                <p className="ims-faint">
                  {filtered.length} of {all.length} item{all.length === 1 ? "" : "s"}
                </p>
              )}
            </Stack>
          )
        }
      </Loaded>

      <ItemDetailDialog
        itemId={detailId}
        canSeeCost={canSeeCost}
        onClose={() => setDetailId(null)}
        onEdit={(item) => {
          setDetailId(null);
          setEditor({ item, seq: Date.now() });
        }}
        onPrintLabel={(item) => {
          setDetailId(null);
          setLabelItems([item]);
        }}
      />
      <ItemDialog editor={editor} meta={meta.data} facets={list.data?.facets} onClose={() => setEditor(null)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <Dialog
        open={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        title={`Remove ${selected.size} item${selected.size === 1 ? "" : "s"}?`}
        description="Items with stock or history are archived (kept for reports and restorable). Unused items are deleted permanently."
        icon={{ tone: "coral", name: "warning" }}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmBulk(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={bulkArchive}>
              Remove
            </Button>
          </>
        }
      />
    </Stack>
  );
}

export default ItemsModule;
