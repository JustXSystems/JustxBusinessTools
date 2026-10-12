/**
 * Reads a GSTR-2B download (the GST portal's JSON, its Excel "B2B" sheet, or a simple CSV) into one row per
 * supplier invoice. Parsing happens in the browser; only the invoice rows are sent for matching.
 */
import type { Gstr2bRow } from "./system";

const GSTIN_LIKE = /^\d{2}[A-Z0-9]{13}$/;

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd or an Excel serial → yyyy-mm-dd. */
export function isoDateOf(v: unknown): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function merge(list: Gstr2bRow[]): Gstr2bRow[] {
  const m = new Map<string, Gstr2bRow>();
  for (const r of list) {
    const k = `${r.gstin}|${r.invoiceNo.toUpperCase()}`;
    const prev = m.get(k);
    if (!prev) m.set(k, { ...r });
    else {
      prev.taxable = r2(prev.taxable + r.taxable);
      prev.igst = r2(prev.igst + r.igst);
      prev.cgst = r2(prev.cgst + r.cgst);
      prev.sgst = r2(prev.sgst + r.sgst);
      prev.value = Math.max(prev.value, r.value);
      if (r.itcAvailable === false || (prev.itcAvailable === undefined && r.itcAvailable !== undefined)) prev.itcAvailable = r.itcAvailable;
    }
  }
  return [...m.values()];
}

/** "Yes"/"Y" → true, "No"/"N" → false, anything else (blank, "Temporary") → unknown. */
function itcFlag(v: unknown): { itcAvailable?: boolean } {
  const s = String(v ?? "").trim();
  if (/^y/i.test(s)) return { itcAvailable: true };
  if (/^n/i.test(s)) return { itcAvailable: false };
  return {};
}

type JsonInv = { inum?: unknown; dt?: unknown; val?: unknown; txval?: unknown; igst?: unknown; cgst?: unknown; sgst?: unknown; itcavl?: unknown; items?: Array<Record<string, unknown>> };
type JsonSupplier = { ctin?: unknown; trdnm?: unknown; inv?: JsonInv[] };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The return period of a GSTR-2B download as yyyy-mm, from the JSON `rtnprd` (MMYYYY). */
export function gstr2bJsonPeriod(data: unknown): string | null {
  const d = data as { data?: { rtnprd?: unknown }; rtnprd?: unknown } | null;
  const m = String(d?.data?.rtnprd ?? d?.rtnprd ?? "").match(/^(0[1-9]|1[0-2])(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : null;
}

/** The portal Excel's "Tax period" (a month name) and "Financial year" (2026-27) cells → yyyy-mm. */
export function gstr2bSheetPeriod(tables: ReadonlyArray<ReadonlyArray<ReadonlyArray<unknown>>>): string | null {
  const after = (re: RegExp) => {
    for (const t of tables)
      for (const row of t.slice(0, 15)) {
        const i = row.findIndex((c) => re.test(String(c ?? "")));
        const v = i >= 0 ? row.slice(i + 1).find((c) => String(c ?? "").trim()) : undefined;
        if (v !== undefined) return String(v).trim();
      }
    return "";
  };
  const period = after(/tax\s*period/i);
  const coded = gstr2bJsonPeriod({ rtnprd: period });
  if (coded) return coded;
  const month = MONTHS.indexOf(period.slice(0, 3).toLowerCase());
  const fy = after(/financial\s*year/i).match(/^(\d{4})/);
  if (month < 0 || !fy) return null;
  const year = Number(fy[1]) + (month < 3 ? 1 : 0);
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** The portal's GSTR-2B JSON (`data.docdata.b2b[].inv[]`). Amendments and credit notes are left out. */
export function parseGstr2bJson(data: unknown): Gstr2bRow[] {
  const d = data as { data?: { docdata?: { b2b?: JsonSupplier[] } }; docdata?: { b2b?: JsonSupplier[] }; b2b?: JsonSupplier[] } | null;
  const b2b = d?.data?.docdata?.b2b ?? d?.docdata?.b2b ?? d?.b2b ?? [];
  const out: Gstr2bRow[] = [];
  for (const s of Array.isArray(b2b) ? b2b : []) {
    const gstin = String(s.ctin ?? "")
      .trim()
      .toUpperCase();
    if (!GSTIN_LIKE.test(gstin)) continue;
    for (const inv of s.inv ?? []) {
      const items = inv.items?.length ? inv.items : [inv as Record<string, unknown>];
      out.push({
        gstin,
        supplier: String(s.trdnm ?? "").trim(),
        invoiceNo: String(inv.inum ?? "").trim(),
        date: isoDateOf(inv.dt),
        value: num(inv.val),
        taxable: r2(items.reduce((t, i) => t + num(i.txval), 0)),
        igst: r2(items.reduce((t, i) => t + num(i.igst), 0)),
        cgst: r2(items.reduce((t, i) => t + num(i.cgst), 0)),
        sgst: r2(items.reduce((t, i) => t + num(i.sgst), 0)),
        ...itcFlag(inv.itcavl),
      });
    }
  }
  return merge(out.filter((r) => r.invoiceNo));
}

const COLS: Array<[keyof Gstr2bRow, RegExp, RegExp?]> = [
  ["gstin", /gstin/i],
  ["invoiceNo", /invoice\s*(no|number|#)|inum|document\s*(no|number)|bill\s*no/i],
  ["date", /date|\bdt\b/i],
  ["value", /invoice\s*value|\bval\b|value.*invoice|total\s*value/i],
  ["taxable", /taxable/i],
  ["igst", /integrated|igst/i],
  ["cgst", /central|cgst/i],
  ["sgst", /state\s*\/?\s*ut\s*tax|sgst|state\s*tax/i],
  ["itcAvailable", /itc\s*availab/i],
  ["supplier", /trade|legal|supplier\s*name|party|name/i, /gstin/i],
];

/** A sheet as rows of cells. Finds the header (one or two rows, as in the portal's Excel), then one row per invoice. */
export function parseGstr2bTable(table: ReadonlyArray<ReadonlyArray<unknown>>): Gstr2bRow[] {
  const text = (v: unknown) => String(v ?? "").trim();
  const h = table.findIndex((row) => row.some((c) => /gstin/i.test(text(c))) && table.slice(table.indexOf(row), table.indexOf(row) + 2).some((r) => r.some((c) => COLS[1][1].test(text(c)))));
  if (h < 0) return [];
  const next = table[h + 1] ?? [];
  const twoRows = !next.some((c) => GSTIN_LIKE.test(text(c).toUpperCase())) && next.some((c) => /[a-z]/i.test(text(c)));
  const width = Math.max(table[h].length, next.length);
  const labels = Array.from({ length: width }, (_, c) => `${text(table[h][c])} ${twoRows ? text(next[c]) : ""}`.trim());
  const idx = {} as Record<keyof Gstr2bRow, number>;
  for (const [key, re, not] of COLS) idx[key] = labels.findIndex((l, c) => re.test(l) && !(not && not.test(l)) && !Object.values(idx).includes(c));
  if (idx.gstin < 0 || idx.invoiceNo < 0) return [];
  const out: Gstr2bRow[] = [];
  for (const row of table.slice(h + (twoRows ? 2 : 1))) {
    const gstin = text(row[idx.gstin]).toUpperCase();
    const invoiceNo = text(row[idx.invoiceNo]);
    if (!GSTIN_LIKE.test(gstin) || !invoiceNo) continue;
    const at = (k: keyof Gstr2bRow) => (idx[k] >= 0 ? row[idx[k]] : undefined);
    out.push({
      gstin,
      supplier: text(at("supplier")),
      invoiceNo,
      date: isoDateOf(at("date")),
      value: num(at("value")),
      taxable: num(at("taxable")),
      igst: num(at("igst")),
      cgst: num(at("cgst")),
      sgst: num(at("sgst")),
      ...itcFlag(at("itcAvailable")),
    });
  }
  return merge(out);
}

/** Invoice rows plus the return month (yyyy-mm) when the file states it. */
export type Gstr2bFile = { rows: Gstr2bRow[]; period: string | null };

export async function readGstr2bFile(file: File): Promise<Gstr2bFile> {
  if (/\.json$/i.test(file.name)) {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error("That JSON file couldn't be read. Download GSTR-2B again from the GST portal.");
    }
    return { rows: parseGstr2bJson(data), period: gstr2bJsonPeriod(data) };
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const name = wb.SheetNames.find((n) => /^b2b$/i.test(n.trim())) ?? wb.SheetNames.find((n) => /b2b(?!a)/i.test(n)) ?? wb.SheetNames[0];
  if (!name) return { rows: [], period: null };
  const sheet = (n: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: "" });
  const others = wb.SheetNames.filter((n) => n !== name && /read\s*me|summary|itc/i.test(n)).slice(0, 3);
  return { rows: parseGstr2bTable(sheet(name)), period: gstr2bSheetPeriod([...others.map(sheet), sheet(name)]) };
}
