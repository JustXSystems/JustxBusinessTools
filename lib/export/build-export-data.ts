import type { TrackerConfig } from "@/config/tools.config";
import type { TrackerRow } from "@/lib/types/tool-record";

export type ExportDataset = {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  filenameBase: string;
};

export function buildTrackerExport(
  toolId: string,
  config: TrackerConfig,
  rows: TrackerRow[],
): ExportDataset {
  const headers = ["id", ...config.fields.map((f) => f.key)];
  const data = rows.map((row) => {
    const out: Record<string, unknown> = { id: row.id };
    for (const field of config.fields) {
      out[field.key] = row[field.key] ?? "";
    }
    return out;
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return { headers, rows: data, filenameBase: `${toolId}-${stamp}` };
}

export function buildDocumentExport(
  toolId: string,
  headers: string[],
  documentRows: Array<Record<string, unknown>>,
): ExportDataset {
  const stamp = new Date().toISOString().slice(0, 10);
  return { headers, rows: documentRows, filenameBase: `${toolId}-${stamp}` };
}
