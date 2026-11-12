/**
 * BOM Excel export (customer-facing sheet) and package template import.
 * Layout mirrors typical dealer BOM sheets: header, sections, margin/tax footer.
 */
import type { BomBusiness, BomDoc, BomDocLineInput, BomPackageInput, BomPackageLineInput, BomLineKind } from "./bom";
import { saveBlob } from "./format";

export type CatalogMatchItem = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  unit: string;
  sellingPrice: number;
};

export type CatalogMatchConfidence = "exact" | "strong" | "ambiguous" | "none";

export type CatalogMatchSummary = { matched: number; ambiguous: number; unmatched: number; created?: number };

export function formatCatalogEnsureSummary(summary: CatalogMatchSummary): string {
  const parts = [
    `${summary.matched} linked`,
    `${summary.created ?? 0} created in inventory`,
  ];
  if (summary.ambiguous) parts.push(`${summary.ambiguous} need a pick`);
  if (summary.unmatched) parts.push(`${summary.unmatched} still open`);
  return parts.join(" · ");
}

type ParsedLine = BomPackageLineInput & { skuHint?: string | null };

function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Match one BOM line against the catalogue (SKU/barcode/name + optional make). */
export function matchCatalogItem(
  line: { description: string; makeText?: string | null; skuHint?: string | null },
  catalog: ReadonlyArray<CatalogMatchItem>,
): { item: CatalogMatchItem | null; confidence: CatalogMatchConfidence; candidates: CatalogMatchItem[] } {
  if (!catalog.length) return { item: null, confidence: "none", candidates: [] };
  const skuHint = norm(line.skuHint);
  const desc = norm(line.description);
  const make = norm(line.makeText);

  const byCode = catalog.filter((i) => {
    const sku = norm(i.sku);
    const barcode = norm(i.barcode);
    return (skuHint && (sku === skuHint || barcode === skuHint)) || (desc && (sku === desc || barcode === desc));
  });
  if (byCode.length === 1) return { item: byCode[0]!, confidence: "exact", candidates: byCode };
  if (byCode.length > 1) return { item: null, confidence: "ambiguous", candidates: byCode.slice(0, 6) };

  const exactName = catalog.filter((i) => norm(i.name) === desc);
  if (exactName.length === 1) {
    const item = exactName[0]!;
    if (!make || !item.brand || norm(item.brand) === make || desc.includes(norm(item.brand))) {
      return { item, confidence: "exact", candidates: exactName };
    }
  }
  if (exactName.length > 1) {
    const withMake = make ? exactName.filter((i) => norm(i.brand) === make) : exactName;
    if (withMake.length === 1) return { item: withMake[0]!, confidence: "strong", candidates: withMake };
    return { item: null, confidence: "ambiguous", candidates: (withMake.length ? withMake : exactName).slice(0, 6) };
  }

  const strong = catalog.filter((i) => {
    const name = norm(i.name);
    if (!name || !desc) return false;
    if (!(name.includes(desc) || desc.includes(name))) return false;
    if (make && i.brand && norm(i.brand) !== make && !desc.includes(norm(i.brand))) return false;
    return true;
  });
  if (strong.length === 1) return { item: strong[0]!, confidence: "strong", candidates: strong };
  if (strong.length > 1) return { item: null, confidence: "ambiguous", candidates: strong.slice(0, 6) };
  return { item: null, confidence: "none", candidates: [] };
}

/** Auto-link exact/strong matches; leave ambiguous/unmatched for manual linking. */
export function applyCatalogMatches(
  packages: BomPackageInput[],
  catalog: ReadonlyArray<CatalogMatchItem>,
): { packages: BomPackageInput[]; summary: CatalogMatchSummary } {
  const summary: CatalogMatchSummary = { matched: 0, ambiguous: 0, unmatched: 0 };
  const next = packages.map((pkg) => ({
    ...pkg,
    lines: (pkg.lines ?? []).map((raw) => {
      const line = raw as ParsedLine;
      if (line.itemId || line.lineKind !== "stock") return { ...line, skuHint: undefined };
      const hit = matchCatalogItem(line, catalog);
      if (hit.item && (hit.confidence === "exact" || hit.confidence === "strong")) {
        summary.matched += 1;
        return {
          ...line,
          skuHint: undefined,
          itemId: hit.item.id,
          unit: hit.item.unit || line.unit,
          defaultRate: line.defaultRate != null && line.defaultRate > 0 ? line.defaultRate : hit.item.sellingPrice,
          makeText: line.makeText || hit.item.brand || null,
        };
      }
      if (hit.confidence === "ambiguous") summary.ambiguous += 1;
      else summary.unmatched += 1;
      const { skuHint: _drop, ...rest } = line;
      return rest;
    }),
  }));
  return { packages: next, summary };
}

function sheetName(label: string, fallback: string): string {
  const raw = (label || fallback).replace(/[\\/?*[\]:]/g, " ").trim() || fallback;
  return raw.slice(0, 31);
}

/** Build a sample-style BOM workbook and download it. */
export async function exportBomExcel(doc: BomDoc, business: BomBusiness): Promise<void> {
  const XLSX = await import("xlsx");
  const lines = doc.lines ?? [];
  const rows: unknown[][] = [];
  rows.push([business.name || "Business"]);
  rows.push(["BILL OF MATERIALS", "", "", "CAPACITY / PACKAGE:", doc.capacityLabel || doc.title || ""]);
  rows.push([`Customer: ${doc.customerName || ""}`, "", "", `Location: ${doc.location || ""}`]);
  rows.push([`Document: ${doc.docNo}`, "", "", `Date: ${doc.docDate || ""}`]);
  rows.push([]);
  rows.push(["SL.NO", "ITEM DESCRIPTION", "Make", "QTY", "UNITS", "PRICE/UNIT", "TOTAL", "REMARKS"]);

  const sections: Array<{ name: string; lines: typeof lines }> = [];
  for (const line of lines) {
    const last = sections[sections.length - 1];
    if (!last || last.name !== line.section) sections.push({ name: line.section, lines: [line] });
    else last.lines.push(line);
  }

  sections.forEach((sec, sIdx) => {
    const roman = String.fromCharCode(65 + sIdx); // A, B, … (simple section mark)
    rows.push([roman, sec.name, "", "", "", "", "", ""]);
    sec.lines.forEach((l, i) => {
      rows.push([i + 1, l.description, l.makeText || "", l.qty, l.unit, l.rate, l.amount, l.remarks || ""]);
    });
  });

  rows.push([]);
  rows.push(["", "", "", "", "", "Materials total", doc.materialsTotal, ""]);
  rows.push(["", "", "", "", "", `Margin ${doc.marginPct}%`, doc.marginAmount, ""]);
  rows.push(["", "", "", "", "", "Subtotal", doc.materialsTotal + doc.marginAmount, ""]);
  rows.push(["", "", "", "", "", `Tax ${doc.taxPct}%`, doc.taxAmount, ""]);
  rows.push(["", "", "", "", "", "Grand total", doc.grandTotal, ""]);
  if (doc.notes) {
    rows.push([]);
    rows.push(["Notes", doc.notes]);
  }
  if (doc.preparedBy) rows.push(["Prepared by", doc.preparedBy]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 8 }, { wch: 48 }, { wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName(doc.capacityLabel || doc.docNo, "BOM"));
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const name = `${doc.docNo || "BOM"}-${(doc.customerName || "draft").replace(/[^\w\-]+/g, "_").slice(0, 40)}.xlsx`;
  saveBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
}

function cell(row: unknown[], idx: number): string {
  const v = row[idx];
  if (v == null) return "";
  return String(v).trim();
}

function num(row: unknown[], idx: number): number {
  const v = row[idx];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function looksLikeHeader(row: unknown[]): boolean {
  const joined = row.map((c) => String(c ?? "").toLowerCase()).join("|");
  return joined.includes("item") && (joined.includes("qty") || joined.includes("quantity"));
}

function detectKind(desc: string, unit: string): BomLineKind {
  const d = desc.toLowerCase();
  const u = unit.toLowerCase();
  if (u === "wp" || u === "kw" || d.includes("overhead") || d.includes("transport")) return u === "wp" || u === "kw" ? "scaled" : "overhead";
  if (d.includes("install") || d.includes("labour") || d.includes("labor") || d.includes("service") || d.includes("charges") || d.includes("work")) return "service";
  return "stock";
}

type ParsedGrid = {
  capacityLabel: string;
  customerName: string;
  location: string;
  docNo: string;
  notes: string;
  preparedBy: string;
  marginPct: number;
  taxPct: number;
  lines: ParsedLine[];
};

/** Find `Label: value` (value inline, or in the next non-label cell) within one row. */
function labelValue(row: unknown[], re: RegExp): string | null {
  for (let c = 0; c < row.length; c++) {
    const m = cell(row, c).match(re);
    if (!m) continue;
    const inline = (m[1] ?? "").trim();
    if (inline) return inline;
    for (let n = c + 1; n < row.length; n++) {
      const v = cell(row, n);
      if (!v) continue;
      return /:\s*$/.test(v) ? null : v;
    }
    return null;
  }
  return null;
}

/** Parse one sheet's grid into header fields + lines. Returns null when no BOM header row is found. */
function parseBomGrid(grid: unknown[][], sheetLabel: string): ParsedGrid | null {
  if (!grid.length) return null;

  let capacityLabel = sheetLabel;
  let customerName = "";
  let location = "";
  let docNo = "";
  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = grid[r] ?? [];
    const joined = row.map((c) => String(c ?? "")).join(" ");
    if (/capacity/i.test(joined)) {
      // Prefer value after "CAPACITY" label
      for (let c = 0; c < row.length; c++) {
        if (/capacity/i.test(String(row[c] ?? ""))) {
          const next = cell(row, c + 1) || cell(row, c + 2);
          if (next && !/^capacity/i.test(next)) capacityLabel = next;
        }
      }
    }
    if (looksLikeHeader(row)) {
      headerRow = r;
      break;
    }
    customerName = customerName || labelValue(row, /^customer(?:\s*name)?\s*:\s*(.*)$/i) || "";
    location = location || labelValue(row, /^location\s*:\s*(.*)$/i) || "";
    docNo = docNo || labelValue(row, /^document\s*(?:no)?\s*:\s*(.*)$/i) || "";
  }
  if (headerRow < 0) return null;

  // Map columns by header text
  const headers = (grid[headerRow] ?? []).map((h) => String(h ?? "").toLowerCase());
  // Inventory map: Item Description→name, Vendor/Make→brand, Unit→unit, Price/Unit→sellingPrice
  const idx = {
    desc: headers.findIndex((h) => h.includes("item") || h.includes("description")),
    make: (() => {
      const preferred = headers.findIndex((h) => h.includes("make") || h.includes("brand"));
      if (preferred >= 0) return preferred;
      return headers.findIndex((h) => h.includes("vendor") || h.includes("manufacturer"));
    })(),
    qty: headers.findIndex((h) => h === "qty" || h.includes("qty") || h.includes("quantity")),
    unit: headers.findIndex((h) => h.includes("unit") && !h.includes("price")),
    rate: headers.findIndex((h) => h.includes("price") || h.includes("rate") || h.includes("price/unit") || h.includes("price per")),
    remarks: headers.findIndex((h) => h.includes("remark")),
    sl: headers.findIndex((h) => h.includes("sl") || h === "#" || h.includes("sno")),
    sku: headers.findIndex((h) => h.includes("sku") || h.includes("item code") || h === "code" || h.includes("barcode")),
  };
  if (idx.desc < 0) idx.desc = 1;
  if (idx.qty < 0) idx.qty = 3;
  if (idx.unit < 0) idx.unit = 4;
  if (idx.make < 0) idx.make = 2;
  if (idx.rate < 0) idx.rate = 5;

  let section = "Main Items";
  const lines: ParsedLine[] = [];
  let marginPct = 0;
  let taxPct = 0;
  let notes = "";
  let preparedBy = "";

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const sl = cell(row, idx.sl >= 0 ? idx.sl : 0);
    const desc = cell(row, idx.desc);

    // Footer labels (e.g. "Margin 10%", "Tax 18%") live in the rate column with an empty description.
    if (!desc) {
      const label = `${cell(row, 5)} ${cell(row, idx.rate)}`.toLowerCase();
      const pct = label.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pct && /margin/.test(label)) marginPct = Number(pct[1]);
      else if (pct && /tax|gst/.test(label)) taxPct = Number(pct[1]);
      continue;
    }
    if (/^notes\s*:?$/i.test(sl)) {
      notes = desc;
      continue;
    }
    if (/^prepared\s*by\s*:?$/i.test(sl)) {
      preparedBy = desc;
      continue;
    }

    if (/^materials total|^subtotal|^grand total|^total$/i.test(desc) || /margin|tax/i.test(sl) || /margin|tax/i.test(cell(row, 5))) {
      const label = `${sl} ${desc} ${cell(row, 5)}`.toLowerCase();
      const pctMatch = label.match(/(\d+(?:\.\d+)?)\s*%/);
      if (/margin/i.test(label) && pctMatch) marginPct = Number(pctMatch[1]);
      if (/tax/i.test(label) && pctMatch) taxPct = Number(pctMatch[1]);
      continue;
    }

    // Section header: roman / letter in SL and no qty, or bold-ish short title spanning
    const qty = num(row, idx.qty);
    const unit = cell(row, idx.unit) || "nos";
    const rate = num(row, idx.rate);
    const isSection =
      (!qty && !rate && (/^[IVXLC]+$/i.test(sl) || /^[A-Z]$/i.test(sl) || /main items|accessor|services|consumable/i.test(desc))) ||
      (/main items|accessor|services/i.test(desc) && !qty);

    if (isSection) {
      section = desc;
      continue;
    }
    if (!qty && !rate && desc.length < 40 && !cell(row, idx.make)) {
      section = desc;
      continue;
    }

    const kind = detectKind(desc, unit);
    lines.push({
      section,
      lineKind: kind,
      description: desc,
      makeText: cell(row, idx.make) || null,
      qty: qty || 1,
      unit: unit || "nos",
      defaultRate: rate,
      scaleByCapacity: kind === "scaled",
      remarks: idx.remarks >= 0 ? cell(row, idx.remarks) || null : null,
      skuHint: idx.sku >= 0 ? cell(row, idx.sku) || null : null,
    });
  }

  return { capacityLabel, customerName, location, docNo, notes, preparedBy, marginPct, taxPct, lines };
}

async function readGrids(file: File): Promise<Array<{ name: string; grid: unknown[][] }>> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const out: Array<{ name: string; grid: unknown[][] }> = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    out.push({ name, grid: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) as unknown[][] });
  }
  return out;
}

/** Parse a multi-sheet workbook into package create payloads (one package per sheet). */
export async function parseBomPackageWorkbook(file: File): Promise<BomPackageInput[]> {
  const out: BomPackageInput[] = [];
  for (const { name, grid } of await readGrids(file)) {
    const parsed = parseBomGrid(grid, name);
    if (!parsed || !parsed.lines.length) continue;
    out.push({
      code: null,
      name: parsed.capacityLabel || name,
      capacityLabel: parsed.capacityLabel || name,
      description: `Imported from sheet “${name}”`,
      defaultMarginPct: parsed.marginPct,
      defaultTaxPct: parsed.taxPct,
      active: true,
      lines: parsed.lines,
    });
  }
  return out;
}

/* ---------- Bidirectional: packages → Excel, customer BOM Excel → draft ---------- */

export type PackageExportSource = {
  code?: string | null;
  name: string;
  capacityLabel?: string | null;
  description?: string | null;
  defaultMarginPct?: number;
  defaultTaxPct?: number;
  lines?: ReadonlyArray<BomPackageLineInput & { itemSku?: string | null; itemName?: string | null }>;
};

const round2n = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function uniqueSheetName(label: string, fallback: string, used: Set<string>): string {
  const base = sheetName(label, fallback);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * Sheet rows for one package, in the same layout `parseBomPackageWorkbook` reads
 * (header, lettered sections, SKU column, margin/tax footer) so export → import round-trips.
 */
export function packageSheetRows(pkg: PackageExportSource): unknown[][] {
  const rows: unknown[][] = [];
  const lines = (pkg.lines ?? []).filter((l) => l.active !== false);
  rows.push([pkg.name || "Package"]);
  rows.push(["BILL OF MATERIALS", "", "", "CAPACITY / PACKAGE:", pkg.capacityLabel || pkg.name || ""]);
  rows.push([pkg.code ? `Package code: ${pkg.code}` : ""]);
  rows.push([]);
  rows.push(["SL.NO", "ITEM DESCRIPTION", "Make", "QTY", "UNITS", "PRICE/UNIT", "TOTAL", "REMARKS", "SKU"]);

  const sections: Array<{ name: string; lines: typeof lines }> = [];
  for (const line of lines) {
    const name = line.section || "Main Items";
    const last = sections[sections.length - 1];
    if (!last || last.name !== name) sections.push({ name, lines: [line] });
    else last.lines.push(line);
  }
  let materials = 0;
  sections.forEach((sec, sIdx) => {
    rows.push([String.fromCharCode(65 + (sIdx % 26)), sec.name, "", "", "", "", "", "", ""]);
    sec.lines.forEach((l, i) => {
      const rate = Number(l.defaultRate ?? 0);
      const amount = round2n(Number(l.qty || 0) * rate);
      materials += amount;
      rows.push([i + 1, l.description, l.makeText || "", l.qty, l.unit, rate, amount, l.remarks || "", l.itemSku || ""]);
    });
  });

  const margin = round2n((materials * (Number(pkg.defaultMarginPct) || 0)) / 100);
  rows.push([]);
  rows.push(["", "", "", "", "", "Materials total", round2n(materials), "", ""]);
  rows.push(["", "", "", "", "", `Margin ${Number(pkg.defaultMarginPct) || 0}%`, margin, "", ""]);
  rows.push(["", "", "", "", "", `Tax ${Number(pkg.defaultTaxPct) || 0}%`, round2n(((materials + margin) * (Number(pkg.defaultTaxPct) || 0)) / 100), "", ""]);
  return rows;
}

/** Build a multi-sheet workbook (one sheet per package) and return the xlsx bytes. */
export async function buildPackagesWorkbook(packages: ReadonlyArray<PackageExportSource>): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const list = packages.length ? packages : [];
  list.forEach((pkg, i) => {
    const ws = XLSX.utils.aoa_to_sheet(packageSheetRows(pkg));
    ws["!cols"] = [{ wch: 8 }, { wch: 48 }, { wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(pkg.capacityLabel || pkg.name, `Package ${i + 1}`, used));
  });
  if (!list.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["No packages"]]), "Packages");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Export package templates (one sheet each) and download. Re-importable via `parseBomPackageWorkbook`. */
export async function exportPackagesExcel(packages: ReadonlyArray<PackageExportSource>, filename = "bom-packages.xlsx"): Promise<void> {
  const out = await buildPackagesWorkbook(packages);
  saveBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export type CustomerBomImportLine = BomDocLineInput & { skuHint?: string | null };

export type CustomerBomImportDraft = {
  docNo: string | null;
  customerName: string;
  location: string | null;
  capacityLabel: string | null;
  title: string | null;
  marginPct: number;
  taxPct: number;
  notes: string | null;
  preparedBy: string | null;
  sheetName: string;
  /** Draft lines ready for `bom.createDoc` / `bom.saveDoc` (link to catalogue via `skuHint` + `applyCatalogMatches`-style matching). */
  lines: CustomerBomImportLine[];
};

/** Convert a parsed grid into a customer BOM draft (qty is taken as final, so lines are not capacity-scaled again). */
export function customerBomFromGrid(grid: unknown[][], sheetLabel: string): CustomerBomImportDraft | null {
  const parsed = parseBomGrid(grid, sheetLabel);
  if (!parsed || !parsed.lines.length) return null;
  return {
    docNo: parsed.docNo || null,
    customerName: parsed.customerName,
    location: parsed.location || null,
    capacityLabel: parsed.capacityLabel || null,
    title: null,
    marginPct: parsed.marginPct,
    taxPct: parsed.taxPct,
    notes: parsed.notes || null,
    preparedBy: parsed.preparedBy || null,
    sheetName: sheetLabel,
    lines: parsed.lines.map((l) => ({
      section: l.section,
      lineKind: l.lineKind,
      itemId: null,
      description: l.description,
      makeText: l.makeText ?? null,
      qty: l.qty,
      unit: l.unit,
      scaleByCapacity: false,
      rate: l.defaultRate ?? 0,
      remarks: l.remarks ?? null,
      skuHint: l.skuHint ?? null,
    })),
  };
}

/** Parse a customer-facing BOM workbook (as written by `exportBomExcel`) into a draft doc payload. Uses the first sheet with a BOM header. */
export async function importCustomerBomExcel(file: File): Promise<CustomerBomImportDraft> {
  for (const { name, grid } of await readGrids(file)) {
    const draft = customerBomFromGrid(grid, name);
    if (draft) return draft;
  }
  throw new Error("No BOM sheet found — expected a header row with ITEM DESCRIPTION and QTY columns.");
}
