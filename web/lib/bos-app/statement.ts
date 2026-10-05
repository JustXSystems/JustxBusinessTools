import type { StatementLineInput } from "./api";

/** Reads bank statement CSV exports (HDFC, SBI, ICICI, Axis, Kotak and generic layouts) into statement lines. */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const delimiter = [",", ";", "\t", "|"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",");
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c !== "")) out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}

export type StatementMapping = {
  date: number;
  description: number;
  reference: number;
  /** Separate withdrawal / deposit columns… */
  debit: number;
  credit: number;
  /** …or one signed amount column, optionally with a Dr/Cr indicator. */
  amount: number;
  drCr: number;
  balance: number;
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z/ ]+/g, " ").replace(/\s+/g, " ").trim();

const PATTERNS: Record<keyof StatementMapping, RegExp[]> = {
  date: [/^(txn|tran|transaction|posting) date$/, /^date$/, /^(txn|tran|transaction|posting) dt$/, /date/, /^value dt$/],
  description: [/narration|description|particulars|remarks|transaction details|details/],
  reference: [/ref|chq|cheque|utr|instrument/],
  debit: [/withdrawal|^debit|^dr$|^dr amount|debit amount|paid out|money out/],
  credit: [/deposit|^credit|^cr$|^cr amount|credit amount|paid in|money in/],
  amount: [/^(transaction )?amount( inr)?$/, /^amt$/],
  drCr: [/^(dr ?\/ ?cr|cr ?\/ ?dr|type|txn type|transaction type|debit ?\/ ?credit)$/],
  balance: [/balance|^bal$/],
};

/** Best guess at which column holds what, from the header row. */
export function guessMapping(header: ReadonlyArray<string>): StatementMapping {
  const cols = header.map(norm);
  const used = new Set<number>();
  const pick = (key: keyof StatementMapping): number => {
    for (const re of PATTERNS[key]) {
      const i = cols.findIndex((c, idx) => !used.has(idx) && c !== "" && re.test(c));
      if (i >= 0) {
        used.add(i);
        return i;
      }
    }
    return -1;
  };
  // Order matters: "Closing balance" isn't an amount, and a "Debit/Credit" indicator isn't the debit column.
  const date = pick("date");
  const balance = pick("balance");
  const drCr = pick("drCr");
  const debit = pick("debit");
  const credit = pick("credit");
  const amount = pick("amount");
  const description = pick("description");
  const reference = pick("reference");
  return { date, description, reference, debit, credit, amount, drCr, balance };
}

export const mappingReady = (m: StatementMapping) => m.date >= 0 && m.description >= 0 && ((m.debit >= 0 && m.credit >= 0) || m.amount >= 0);

/** The header is the first row (after any account preamble) that names a date and an amount column. */
export function findHeaderRow(rows: ReadonlyArray<ReadonlyArray<string>>): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (mappingReady(guessMapping(rows[i]))) return i;
  }
  return -1;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const month = (name: string): number | undefined => MONTHS[name.slice(0, 3).toLowerCase()];
export type DateOrder = "dmy" | "mdy";

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

/** `01/10/2026`, `01-10-26`, `2026-10-01`, `01-Oct-2026`, `1 Oct 2026`, `Oct 1, 2026` (a time after the date is ignored). */
export function parseStatementDate(raw: string, order: DateOrder = "dmy"): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return order === "dmy" ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  m = s.match(/^(\d{1,2})[-/. ]([a-z]{3,9})[-/., ]+(\d{2}|\d{4})$/i);
  if (m && month(m[2])) return iso(+m[3], month(m[2])!, +m[1]);
  m = s.match(/^([a-z]{3,9})[ -](\d{1,2}),?[ -](\d{2}|\d{4})$/i);
  if (m && month(m[1])) return iso(+m[3], month(m[1])!, +m[2]);
  return null;
}

/** Day-first unless a numeric date can only be month-first (e.g. 10/25/2026). */
export function detectDateOrder(values: ReadonlyArray<string>): DateOrder {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  return mdy && !dmy ? "mdy" : "dmy";
}

/** `₹1,18,000.00`, `(250.00)`, `1,234.50 Cr`, `-15`; blank, `-` and `0` mean no amount. */
export function parseStatementAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || s === "-") return null;
  let sign = 1;
  const suffix = s.match(/\s*(cr|dr)\.?$/i);
  if (suffix) {
    if (suffix[1].toLowerCase() === "dr") sign = -1;
    s = s.slice(0, suffix.index).trim();
  }
  if (/^\(.*\)$/.test(s)) {
    sign = -sign;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|inr|rs\.?|,|\s/gi, "");
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s) * sign;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export type ParsedStatement = { lines: StatementLineInput[]; skipped: number; dateOrder: DateOrder; reversed: boolean };

/** Rows below the header become lines in date order; totals, footers and zero rows are skipped. */
export function toStatementLines(rows: ReadonlyArray<ReadonlyArray<string>>, headerIndex: number, m: StatementMapping): ParsedStatement {
  const body = rows.slice(headerIndex + 1);
  const dateOrder = detectDateOrder(body.map((r) => r[m.date] ?? ""));
  const lines: StatementLineInput[] = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseStatementDate(r[m.date] ?? "", dateOrder);
    let amount: number | null = null;
    if (m.debit >= 0 && m.credit >= 0) {
      const out = parseStatementAmount(r[m.debit]);
      const inn = parseStatementAmount(r[m.credit]);
      amount = (inn ? Math.abs(inn) : 0) - (out ? Math.abs(out) : 0);
    } else if (m.amount >= 0) {
      amount = parseStatementAmount(r[m.amount]);
      const flag = m.drCr >= 0 ? (r[m.drCr] ?? "").trim().toLowerCase() : "";
      if (amount !== null && /^(dr|d|debit|withdrawal)$/.test(flag)) amount = -Math.abs(amount);
      if (amount !== null && /^(cr|c|credit|deposit)$/.test(flag)) amount = Math.abs(amount);
    }
    if (!date || !amount) {
      skipped++;
      continue;
    }
    const description = (r[m.description] ?? "").replace(/\s+/g, " ").trim();
    const reference = m.reference >= 0 ? (r[m.reference] ?? "").trim() : "";
    lines.push({
      date,
      description: (description || reference || "(no narration)").slice(0, 300),
      reference: reference && !/^0+$/.test(reference) ? reference.slice(0, 120) : null,
      amount: Math.round(amount * 100) / 100,
      balance: m.balance >= 0 ? parseStatementAmount(r[m.balance]) : null,
    });
  }
  const reversed = lines.length > 1 && lines[0].date > lines[lines.length - 1].date;
  if (reversed) lines.reverse();
  return { lines, skipped, dateOrder, reversed };
}
