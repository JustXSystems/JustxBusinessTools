/**
 * Client helpers for the inventory screens (dashboard, items, full stock,
 * restock list, scanner): the extended dashboard payload, EAN-13 codes for
 * labels, spreadsheet import mapping and camera-scanner utilities.
 */
import { get, type ImsDashboard, type ImsItem, type Period } from "./api";
import type { ExportColumn } from "./format";

/* ---------- Dashboard ---------- */

export type DashboardInsights = {
  totalUnits: number;
  potentialMargin: number;
  marginPct: number;
  deadStock: { items: number; value: number };
  slowMovers: { items: number; value: number };
  missingHsn: number;
  missingPrice: number;
  period: { invoices: number; invoiced: number; purchasedValue: number; returnsIn: number; damagedValue: number; entries: number };
};

export type ImsDashboardPlus = ImsDashboard & { insights?: DashboardInsights };

export const invA = {
  dashboard: (params: { period?: Period; from?: string; to?: string } = {}) => get<ImsDashboardPlus>("/dashboard", params),
};

/* ---------- Velocity (30-day outward movement) ---------- */

export type Velocity = "BEST" | "AVERAGE" | "SLOW" | "DEAD";

export const VELOCITY_LABEL: Record<Velocity, string> = { BEST: "Best selling", AVERAGE: "Average", SLOW: "Slow moving", DEAD: "Dead stock" };

/** Top 20% of moving items are best sellers, bottom 20% slow; in-stock items that didn't move in 30 days are dead. */
export function velocityTiers(items: ReadonlyArray<ImsItem>): Map<string, Velocity> {
  const out = new Map<string, Velocity>();
  const moving = items.filter((i) => i.movement30d > 0).sort((a, b) => b.movement30d - a.movement30d);
  const n = moving.length;
  const top = n <= 2 ? n : Math.max(1, Math.round(n * 0.2));
  const lowStart = n <= 2 ? n : Math.max(top, n - Math.max(1, Math.round(n * 0.2)));
  moving.forEach((i, idx) => out.set(i.id, idx < top ? "BEST" : idx >= lowStart ? "SLOW" : "AVERAGE"));
  for (const i of items) if (!out.has(i.id) && i.currentStock > 0) out.set(i.id, "DEAD");
  return out;
}

/** The code a label encodes and the scanner looks up (barcode → SKU → id). */
export const scanCodeOf = (item: Pick<ImsItem, "barcode" | "sku" | "id">): string => item.barcode || item.sku || item.id;

/* ---------- EAN-13 ---------- */

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isEan13(code: string | null | undefined): code is string {
  return Boolean(code && /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]));
}

/**
 * In-store EAN-13 (GS1 prefix 2x is reserved for restricted circulation, so
 * it never collides with manufacturer barcodes). Seeded by SKU digits + time.
 */
export function generateEan13(seed?: string | null): string {
  const seedDigits = String(seed ?? "").replace(/\D/g, "").slice(-4);
  const time = String(Date.now()).slice(-6);
  const rand = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  const body = `2${(seedDigits || rand).padStart(4, "0").slice(-3)}${time}${rand}`.slice(0, 12).padEnd(12, "0");
  return `${body}${ean13CheckDigit(body)}`;
}

/** 95-module bit string (1 = bar) for a valid EAN-13. */
export function ean13Modules(code: string): string {
  const parity = EAN_PARITY[Number(code[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? EAN_L : EAN_G)[Number(code[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(code[i])];
  return `${bits}101`;
}

/** SKU suggestion from a name: `Kingfisher Premium 650ml` → `KIN-PRE-650`. */
export function suggestSku(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.slice(0, 3));
  const base = words.join("-") || "ITEM";
  return `${base}-${String(Date.now()).slice(-3)}`;
}

/* ---------- Spreadsheet import ---------- */

export type ImportField = {
  key: string;
  label: string;
  aliases: ReadonlyArray<string>;
  numeric?: boolean;
  required?: boolean;
  sample: string | number;
};

export const IMPORT_FIELDS: ReadonlyArray<ImportField> = [
  { key: "name", label: "Item name", aliases: ["name", "item", "itemname", "product", "productname", "description"], required: true, sample: "Kingfisher Premium 650ml" },
  { key: "sku", label: "SKU / code", aliases: ["sku", "code", "itemcode", "productcode", "partno", "partnumber"], sample: "KF-650" },
  { key: "barcode", label: "Barcode", aliases: ["barcode", "ean", "upc", "gtin", "qr"], sample: "8901234567890" },
  { key: "category", label: "Category", aliases: ["category", "group", "itemgroup", "type"], sample: "Beer" },
  { key: "brand", label: "Brand", aliases: ["brand", "make", "manufacturer", "company"], sample: "Kingfisher" },
  { key: "unit", label: "Unit", aliases: ["unit", "uom", "units", "measure"], sample: "btl" },
  { key: "hsn", label: "HSN / SAC", aliases: ["hsn", "hsncode", "sac", "hsnsac"], sample: "2203" },
  { key: "gstRate", label: "GST %", aliases: ["gst", "gstrate", "gstpercent", "tax", "taxrate", "gst%"], numeric: true, sample: 18 },
  { key: "purchasePrice", label: "Purchase price", aliases: ["purchaseprice", "buyprice", "cost", "costprice", "purchaserate", "buyingprice"], numeric: true, sample: 120 },
  { key: "sellingPrice", label: "Selling price", aliases: ["sellingprice", "saleprice", "price", "rate", "salesrate", "sellprice"], numeric: true, sample: 160 },
  { key: "mrp", label: "MRP", aliases: ["mrp", "maxretailprice", "listprice"], numeric: true, sample: 180 },
  { key: "minStock", label: "Min stock", aliases: ["minstock", "min", "minimum", "reorderlevel", "minqty"], numeric: true, sample: 24 },
  { key: "maxStock", label: "Max stock", aliases: ["maxstock", "max", "maximum", "maxqty"], numeric: true, sample: 240 },
  { key: "location", label: "Location", aliases: ["location", "rack", "bin", "shelf", "godown", "warehouse"], sample: "Rack A1" },
  { key: "openingStock", label: "Opening stock", aliases: ["openingstock", "opening", "stock", "qty", "quantity", "currentstock", "onhand"], numeric: true, sample: 48 },
];

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9%]/g, "");

/** Best-guess source column for each field from the sheet headers. */
export function autoMap(headers: ReadonlyArray<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of IMPORT_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && (normHeader(h) === normHeader(f.key) || normHeader(h) === normHeader(f.label) || f.aliases.includes(normHeader(h))));
    if (hit) {
      out[f.key] = hit;
      used.add(hit);
    }
  }
  return out;
}

const parseNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[₹,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

export type MappedRow = { index: number; record: Record<string, string | number>; issues: string[] };

/** Applies the column mapping; blanks are dropped so server defaults apply. */
export function mapRows(rows: ReadonlyArray<Record<string, unknown>>, mapping: Record<string, string>): MappedRow[] {
  return rows.map((raw, index) => {
    const record: Record<string, string | number> = {};
    const issues: string[] = [];
    for (const f of IMPORT_FIELDS) {
      const col = mapping[f.key];
      if (!col) continue;
      const value = raw[col];
      if (f.numeric) {
        const n = parseNumber(value);
        if (n === null) continue;
        if (Number.isNaN(n) || n < 0) issues.push(`${f.label} “${String(value)}” isn't a valid number`);
        else record[f.key] = n;
      } else {
        const s = String(value ?? "").trim();
        if (s) record[f.key] = s;
      }
    }
    if (!record.name) issues.push("Item name is missing");
    if (typeof record.gstRate === "number" && record.gstRate > 100) issues.push("GST % must be 0–100");
    return { index, record, issues };
  });
}

/** Skip fully blank spreadsheet rows (trailing formatting in Excel). */
export const nonBlankRows = (rows: ReadonlyArray<Record<string, unknown>>) => rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));

/** Columns for item exports (also the import template headings). */
export function itemExportColumns(withCost: boolean): ReadonlyArray<ExportColumn<ImsItem>> {
  const cols: Array<ExportColumn<ImsItem> | null> = [
    { header: "Item name", value: (i) => i.name },
    { header: "SKU / code", value: (i) => i.sku },
    { header: "Barcode", value: (i) => i.barcode },
    { header: "Category", value: (i) => i.category },
    { header: "Brand", value: (i) => i.brand },
    { header: "Unit", value: (i) => i.unit },
    { header: "HSN / SAC", value: (i) => i.hsn },
    { header: "GST %", value: (i) => i.gstRate },
    withCost ? { header: "Purchase price", value: (i) => i.purchasePrice } : null,
    { header: "Selling price", value: (i) => i.sellingPrice },
    { header: "MRP", value: (i) => i.mrp },
    { header: "Min stock", value: (i) => i.minStock },
    { header: "Max stock", value: (i) => i.maxStock },
    { header: "Location", value: (i) => i.location },
    { header: "Supplier", value: (i) => i.supplierName },
    { header: "Current stock", value: (i) => i.currentStock },
    { header: "Damaged", value: (i) => i.damagedStock },
    { header: "Status", value: (i) => i.status },
    withCost ? { header: "Stock value", value: (i) => i.stockValue } : null,
    { header: "Idle days", value: (i) => i.idleDays },
    { header: "Out (30 days)", value: (i) => i.movement30d },
  ];
  return cols.filter((c): c is ExportColumn<ImsItem> => c !== null);
}

/* ---------- Scanner ---------- */

type DetectedBarcode = { rawValue: string; format: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

const WANTED_FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "data_matrix"];

/** Native barcode detector (Chrome / Android / Safari 17+) for 1D codes; null when unsupported. */
export async function createBarcodeDetector(): Promise<BarcodeDetectorLike | null> {
  if (typeof window === "undefined") return null;
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = Ctor.getSupportedFormats ? await Ctor.getSupportedFormats() : WANTED_FORMATS;
    const formats = WANTED_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new Ctor({ formats }) : null;
  } catch {
    return null;
  }
}

let audioCtx: AudioContext | null = null;

/** Short beep + vibration: high tone for a hit, low double buzz for an unknown code. */
export function scanFeedback(ok = true): void {
  try {
    navigator.vibrate?.(ok ? 60 : [40, 60, 40]);
  } catch {
    /* vibration unsupported */
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = ok ? 1320 : 330;
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.14);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } catch {
    /* audio blocked until a user gesture */
  }
}

/** Torch support lives outside the DOM lib types. */
export type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
export type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean };
