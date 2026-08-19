import * as XLSX from "xlsx";
import { downloadTextFile, rowsToCsv } from "@/lib/export/csv";

export function downloadXlsx(
  filename: string,
  headers: string[],
  rows: Array<Record<string, unknown>>,
) {
  const data = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const h of headers) {
      out[h] = row[h] ?? "";
    }
    return out;
  });

  const sheet = XLSX.utils.json_to_sheet(data, { header: headers });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Export");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsvExport(
  filename: string,
  headers: string[],
  rows: Array<Record<string, unknown>>,
) {
  downloadTextFile(filename, rowsToCsv(headers, rows));
}
