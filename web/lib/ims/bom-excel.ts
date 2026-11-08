/**
 * BOM Excel export (customer-facing sheet) and package template import.
 * Layout mirrors typical dealer BOM sheets: header, sections, margin/tax footer.
 */
import type { BomBusiness, BomDoc, BomPackageInput, BomPackageLineInput, BomLineKind } from "./bom";
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

export type CatalogMatchSummary = { matched: number; ambiguous: number; unmatched: number };

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
          defaultRate: line.defaultRate > 0 ? line.defaultRate : hit.item.sellingPrice,
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

/** Parse a multi-sheet workbook into package create payloads (one package per sheet). */
export async function parseBomPackageWorkbook(file: File): Promise<BomPackageInput[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const out: BomPackageInput[] = [];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];
    if (!grid.length) continue;

    let capacityLabel = name;
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
    }
    if (headerRow < 0) continue;

    // Map columns by header text
    const headers = (grid[headerRow] ?? []).map((h) => String(h ?? "").toLowerCase());
    const idx = {
      desc: headers.findIndex((h) => h.includes("item") || h.includes("description")),
      make: headers.findIndex((h) => h.includes("make") || h.includes("brand")),
      qty: headers.findIndex((h) => h === "qty" || h.includes("qty") || h.includes("quantity")),
      unit: headers.findIndex((h) => h.includes("unit")),
      rate: headers.findIndex((h) => h.includes("price") || h.includes("rate")),
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

    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const sl = cell(row, idx.sl >= 0 ? idx.sl : 0);
      const desc = cell(row, idx.desc);
      if (!desc) continue;

      const lower = desc.toLowerCase();
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

    if (!lines.length) continue;
    out.push({
      code: null,
      name: capacityLabel || name,
      capacityLabel: capacityLabel || name,
      description: `Imported from sheet “${name}”`,
      defaultMarginPct: marginPct,
      defaultTaxPct: taxPct,
      active: true,
      lines,
    });
  }

  return out;
}
