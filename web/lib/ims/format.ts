/**
 * IMS display vocabulary: money, quantities, status badges and the GST maths the
 * forms preview with. `computeTotals` mirrors server/src/ims/logic.ts exactly so
 * what users see is what the API stores.
 */
import type { BosBadgeTone } from "@/components/bos";
import type { AgingKey, MovementType, Period, StockStatus } from "./api";

export {
  addDaysISO,
  dateLabel,
  dateRange,
  dayMonth,
  greetingFor,
  initialsOf,
  inr,
  inrCompact,
  inrExact,
  monthLabel,
  rupeesInWords,
  timeAgo,
  todayLocal,
  toneFor,
  type BadgeView,
} from "@/lib/bos-app/format";
import { inrExact } from "@/lib/bos-app/format";
import type { BadgeView } from "@/lib/bos-app/format";

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Document money: INR keeps the rupee formatter (`inrExact`); any other currency shows its ISO code
 * (`USD 1,234.50`) so a foreign document is never mistaken for rupees.
 */
export function moneyFmt(amount: number, code?: string | null): string {
  const c = String(code ?? "INR").trim().toUpperCase() || "INR";
  if (c === "INR") return inrExact(amount);
  const n = Number.isFinite(amount) ? amount : 0;
  return `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** `1,250` / `12.5` — quantities keep up to 3 decimals, Indian grouping. */
export function qtyText(n: number, unit?: string | null): string {
  const v = Number.isFinite(n) ? n : 0;
  const text = v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return unit ? `${text} ${unit}` : text;
}

export const pct = (n: number, digits = 0): string => `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;

/** Server timestamp (`YYYY-MM-DD HH:MM:SS`) → `14 Aug, 3:42 pm`. */
export function stampLabel(stamp: string | null | undefined): string {
  if (!stamp) return "—";
  const d = new Date(String(stamp).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(stamp);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/* ---------- Periods ---------- */

export const PERIOD_OPTIONS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "mtd", label: "This month" },
  { value: "lastmonth", label: "Last month" },
  { value: "qtd", label: "Quarter" },
  { value: "fytd", label: "FY to date" },
];

/* ---------- Stock ---------- */

export const STOCK_STATUS_BADGE: Record<StockStatus, BadgeView> = {
  GOOD: { text: "IN STOCK", tone: "emerald" },
  LOW: { text: "LOW", tone: "amber" },
  OUT_OF_STOCK: { text: "OUT OF STOCK", tone: "coral" },
  OVERSTOCK: { text: "OVERSTOCK", tone: "lavender" },
};
export const stockBadge = (s: StockStatus): BadgeView => STOCK_STATUS_BADGE[s] ?? STOCK_STATUS_BADGE.GOOD;

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = { GOOD: "In stock", LOW: "Low stock", OUT_OF_STOCK: "Out of stock", OVERSTOCK: "Overstock" };

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  OPENING: "Opening stock",
  IN: "Stock in",
  OUT: "Stock out",
  DAMAGE: "Damage",
  ADJUSTMENT: "Adjustment",
  RETURN_IN: "Customer return",
  RETURN_OUT: "Supplier return",
  WRITE_OFF: "Write-off",
};

/** Prefer when refType is known — DC unused returns are not customer returns. */
export function movementTypeLabel(type: MovementType, refType?: string | null): string {
  if (type === "RETURN_IN" && refType === "dc") return "DC unused return";
  if (type === "OUT" && refType === "dc") return "DC stock out";
  return MOVEMENT_LABEL[type] ?? type;
}

const MOVEMENT_TONE: Record<MovementType, BosBadgeTone> = {
  OPENING: "blue",
  IN: "emerald",
  OUT: "blue",
  DAMAGE: "coral",
  ADJUSTMENT: "lavender",
  RETURN_IN: "amber",
  RETURN_OUT: "amber",
  WRITE_OFF: "coral",
};
export const movementBadge = (t: MovementType): BadgeView => ({ text: MOVEMENT_LABEL[t]?.toUpperCase() ?? t, tone: MOVEMENT_TONE[t] ?? "neutral" });

/** Signed quantity for a ledger row: `+12` / `−4`. */
export function signedQty(delta: number): string {
  if (!delta) return "0";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("en-IN", { maximumFractionDigits: 3 })}`;
}

export const DEFAULT_AGING_BREAKS = [15, 30, 60, 90] as const;
export const AGING_BUCKET_COLORS = ["#1FA679", "#3A80EE", "#D98A1F", "#F2711C", "#E1483F"] as const;

export function buildAgingBuckets(breaks: ReadonlyArray<number> = DEFAULT_AGING_BREAKS): ReadonlyArray<{ key: AgingKey; label: string; color: string; min: number; max: number }> {
  const caps = breaks.length === 4 ? breaks.map((n) => Math.floor(Number(n))) : [...DEFAULT_AGING_BREAKS];
  const out: Array<{ key: AgingKey; label: string; color: string; min: number; max: number }> = [];
  let prev = -1;
  for (let i = 0; i < caps.length; i++) {
    const max = caps[i]!;
    const min = prev + 1;
    out.push({ key: `${min}-${max}`, label: `${min}–${max} days`, color: AGING_BUCKET_COLORS[i]!, min, max });
    prev = max;
  }
  out.push({ key: `${prev}+`, label: `${prev}+ days`, color: AGING_BUCKET_COLORS[4], min: prev + 1, max: Number.POSITIVE_INFINITY });
  return out;
}

/** Default buckets — prefer `buildAgingBuckets(session.settings.agingBreaks)`. */
export const AGING_BUCKETS = buildAgingBuckets();

/* ---------- Roles ---------- */

export const ROLE_LABEL = {
  owner: "Owner",
  manager: "Manager",
  incharge: "Store incharge",
  staff: "Staff",
  accountant: "Accountant",
  auditor: "CA / Auditor",
  field: "Field / Technician",
  viewer: "Viewer",
} as const;

/* ---------- GST documents (mirrors server computeTotals) ---------- */

export type ImsLineInput = {
  itemId?: string | null;
  name: string;
  sku?: string | null;
  hsn?: string | null;
  unit?: string | null;
  qty: number;
  rate: number;
  discountPct?: number;
  gstRate: number;
  receivedQty?: number;
};

export type ImsLine = ImsLineInput & { discountPct: number; gross: number; discount: number; taxable: number; tax: number; amount: number };

export type ImsTotals = { lines: ImsLine[]; subtotal: number; discountTotal: number; taxable: number; taxTotal: number; cgst: number; sgst: number; igst: number; roundOff: number; grandTotal: number };

export function isIntraState(sellerState?: string | null, placeOfSupply?: string | null): boolean {
  const a = String(sellerState ?? "").trim().toLowerCase();
  const b = String(placeOfSupply ?? "").trim().toLowerCase();
  if (!a || !b) return true;
  return a === b;
}

export function computeTotals(input: ReadonlyArray<ImsLineInput>, intraState: boolean, roundToRupee = false): ImsTotals {
  const lines = input.map<ImsLine>((l) => {
    const qty = round3(Math.max(0, num(l.qty)));
    const rate = round2(num(l.rate));
    const discountPct = clamp(num(l.discountPct), 0, 100);
    const gstRate = clamp(num(l.gstRate), 0, 100);
    const gross = round2(qty * rate);
    const discount = round2((gross * discountPct) / 100);
    const taxable = round2(gross - discount);
    const tax = round2((taxable * gstRate) / 100);
    return { ...l, name: String(l.name ?? "").trim() || "Item", qty, rate, discountPct, gstRate, gross, discount, taxable, tax, amount: round2(taxable + tax) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.gross, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discount, 0));
  const taxable = round2(subtotal - discountTotal);
  const taxTotal = round2(lines.reduce((s, l) => s + l.tax, 0));
  const cgst = intraState ? round2(taxTotal / 2) : 0;
  const sgst = intraState ? round2(taxTotal - cgst) : 0;
  const igst = intraState ? 0 : taxTotal;
  const exact = round2(taxable + taxTotal);
  const grandTotal = roundToRupee ? Math.round(exact) : exact;
  return { lines, subtotal, discountTotal, taxable, taxTotal, cgst, sgst, igst, roundOff: round2(grandTotal - exact), grandTotal };
}

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;

/* ---------- Export ---------- */

export type ExportColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv<T>(rows: ReadonlyArray<T>, columns: ReadonlyArray<ExportColumn<T>>): string {
  return [columns.map((c) => csvCell(c.header)).join(","), ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(","))].join("\r\n");
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv<T>(filename: string, rows: ReadonlyArray<T>, columns: ReadonlyArray<ExportColumn<T>>): void {
  saveBlob(new Blob(["\uFEFF", toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }), filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export async function downloadXlsx<T>(filename: string, sheet: string, rows: ReadonlyArray<T>, columns: ReadonlyArray<ExportColumn<T>>): Promise<void> {
  const XLSX = await import("xlsx");
  const data = [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.value(r) ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  saveBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/** Reads the first sheet of a CSV / Excel file into row objects keyed by header. */
export async function readSheet(file: File): Promise<Array<Record<string, unknown>>> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[first], { defval: "" });
}
