import {
  buildQrPayload,
  getQrTypeDef,
  slugify,
  type QrFields,
  type QrPayloadResult,
  type QrType,
} from "@/lib/qr-generator/payloads";

/** Optional columns every batch accepts in addition to the type's own fields. */
export const BATCH_EXTRA_COLUMNS = ["filename", "caption"] as const;

/**
 * RFC 4180-ish parser. Auto-detects tab-separated input so rows pasted straight
 * from Excel / Google Sheets work without saving as CSV first.
 */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function normHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Header row (field keys) plus one example row built from the field placeholders. */
export function batchTemplateCsv(type: QrType): string {
  const def = getQrTypeDef(type);
  const keys = [...def.fields.map((f) => f.key), ...BATCH_EXTRA_COLUMNS];
  const example = keys.map((k) => {
    const field = def.fields.find((f) => f.key === k);
    if (field?.type === "select") return def.defaults?.[k] ?? field.options?.[0]?.value ?? "";
    if (field?.type === "checkbox") return "";
    if (k === "filename") return "example-1";
    if (k === "caption") return "";
    return (field?.placeholder ?? "").replace(/^e\.g\.\s*/i, "").replace(/…/g, "");
  });
  return `${keys.map(csvCell).join(",")}\r\n${example.map(csvCell).join(",")}\r\n`;
}

export type BatchItem = {
  /** 1-based data row number (excluding the header) for error messages. */
  row: number;
  name: string;
  caption: string;
  fields: QrFields;
  result: QrPayloadResult;
};

export type BatchParseResult = {
  items: BatchItem[];
  unknownColumns: string[];
  missingRequired: string[];
  truncated: boolean;
};

/**
 * Maps a pasted table to QR items. Headers can be field keys ("pa") or labels
 * ("UPI ID (VPA)"), case- and punctuation-insensitive.
 */
export function parseBatch(
  type: QrType,
  text: string,
  options: { maxRows: number; defaults?: QrFields; filenamePrefix?: string },
): BatchParseResult {
  const def = getQrTypeDef(type);
  const rows = parseDelimited(text);
  const empty: BatchParseResult = { items: [], unknownColumns: [], missingRequired: [], truncated: false };
  if (rows.length === 0) return empty;

  const lookup = new Map<string, string>();
  for (const f of def.fields) {
    lookup.set(normHeader(f.key), f.key);
    lookup.set(normHeader(f.label), f.key);
  }
  for (const extra of BATCH_EXTRA_COLUMNS) lookup.set(extra, extra);

  const header = rows[0].map((h) => lookup.get(normHeader(h)) ?? null);
  const unknownColumns = rows[0].filter((_, i) => header[i] == null).map((h) => h.trim()).filter(Boolean);
  const mapped = new Set(header.filter(Boolean));
  const missingRequired = def.fields.filter((f) => f.required && !mapped.has(f.key)).map((f) => f.label);

  const body = rows.slice(1);
  const truncated = body.length > options.maxRows;
  const prefix = options.filenamePrefix || "qr";
  const seen = new Map<string, number>();

  const items = body.slice(0, options.maxRows).map((cells, idx) => {
    const fields: QrFields = { ...(def.defaults ?? {}), ...(options.defaults ?? {}) };
    let filename = "";
    let caption = "";
    header.forEach((key, i) => {
      if (!key) return;
      const value = (cells[i] ?? "").trim();
      if (key === "filename") filename = value;
      else if (key === "caption") caption = value;
      else if (value !== "") {
        const field = def.fields.find((f) => f.key === key);
        fields[key] = field?.type === "checkbox" ? (/^(1|true|yes|y)$/i.test(value) ? "1" : "") : value;
      }
    });

    let name = slugify(filename) || `${prefix}-${type}-${String(idx + 1).padStart(3, "0")}`;
    const dup = seen.get(name) ?? 0;
    seen.set(name, dup + 1);
    if (dup) name = `${name}-${dup + 1}`;

    const result = buildQrPayload(type, fields);
    return {
      row: idx + 1,
      name,
      caption,
      fields,
      result: result.ok || result.error ? result : { ok: false as const, error: "Missing required values." },
    };
  });

  return { items, unknownColumns, missingRequired, truncated };
}
