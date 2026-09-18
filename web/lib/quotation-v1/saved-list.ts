import { computeTotals, fmtDate, money } from "./compute";
import type { CompanyProfileV1, QuotationV1 } from "./types";

export type SavedQuoteListRow = {
  id: string;
  quoteNo: string;
  submittedDate: string;
  submittedDateRaw: string;
  companyName: string;
  companyCity: string;
  description: string;
  basicTotal: number;
  grandTotal: number;
  totalQuotationValue: number;
  basicTotalLabel: string;
  grandTotalLabel: string;
  totalValueLabel: string;
  status: QuotationV1["status"];
  followUpDate: string;
  followUpDateRaw: string;
  validTill: string;
};

/** City for list/export; falls back to state when city is blank. */
export function customerCityDisplay(q: QuotationV1): string {
  const city = String(q.customer?.city ?? "").trim();
  if (city) return city;
  return String(q.customer?.state ?? "").trim() || "—";
}

/** Prefer company name; fall back to site-owner name. */
export function customerCompanyDisplay(q: QuotationV1): string {
  const company = String(q.customer?.company ?? "").trim();
  if (company) return company;
  return String(q.customer?.name ?? "").trim() || "—";
}

/** Compact line-item description for list rows. */
export function lineItemsSummary(q: QuotationV1, limit = 2): string {
  const descs = (Array.isArray(q.items) ? q.items : [])
    .map((it) => String(it.desc ?? "").trim())
    .filter(Boolean);
  if (!descs.length) return "—";
  const head = descs.slice(0, Math.max(1, limit));
  const more = descs.length - head.length;
  return more > 0 ? `${head.join(" · ")} · +${more} more` : head.join(" · ");
}

/**
 * Quotation submitted date: first history event mentioning submit,
 * else quotation date when no longer draft, else empty.
 */
export function quotationSubmittedDateIso(q: QuotationV1): string {
  const hist = Array.isArray(q.history) ? q.history : [];
  for (const h of hist) {
    if (/submit/i.test(String(h.event ?? ""))) {
      const ts = String(h.ts ?? "");
      if (ts) return ts.slice(0, 10);
    }
  }
  if (q.status && q.status !== "draft" && q.date) return q.date;
  return "";
}

export function buildSavedQuoteListRow(
  q: QuotationV1,
  company: CompanyProfileV1,
): SavedQuoteListRow {
  const t = computeTotals(q, company);
  const storedGrand = Number((q as { _grandTotal?: number })._grandTotal);
  const grand = Number.isFinite(storedGrand) && storedGrand > 0 ? storedGrand : t.grand;
  const submittedRaw = quotationSubmittedDateIso(q);
  const followRaw = String(q.followUpDate ?? "").trim();

  return {
    id: q.id,
    quoteNo: q.quoteNo || "(unsaved)",
    submittedDate: submittedRaw ? fmtDate(submittedRaw) : "—",
    submittedDateRaw: submittedRaw,
    companyName: customerCompanyDisplay(q),
    companyCity: customerCityDisplay(q),
    description: lineItemsSummary(q),
    basicTotal: t.taxable,
    grandTotal: grand,
    totalQuotationValue: grand,
    basicTotalLabel: money(t.taxable),
    grandTotalLabel: money(grand),
    totalValueLabel: money(grand),
    status: q.status,
    followUpDate: followRaw ? fmtDate(followRaw) : "—",
    followUpDateRaw: followRaw,
    validTill: q.validTill ? fmtDate(q.validTill) : "—",
  };
}

export const SAVED_QUOTE_EXPORT_HEADERS = [
  "Quotation Number",
  "Quotation Submitted Date",
  "Company Name",
  "Company City",
  "Description",
  "Basic Total",
  "Grand Total",
  "Total Quotation Value",
  "Quotation Status",
  "Follow-up Date",
  "Valid Till",
] as const;

export function savedQuoteExportRows(
  list: QuotationV1[],
  company: CompanyProfileV1,
): Array<Record<string, string | number>> {
  return list.map((q) => {
    const row = buildSavedQuoteListRow(q, company);
    return {
      "Quotation Number": row.quoteNo,
      "Quotation Submitted Date": row.submittedDateRaw || "",
      "Company Name": row.companyName,
      "Company City": row.companyCity,
      Description: row.description,
      "Basic Total": Number(row.basicTotal.toFixed(2)),
      "Grand Total": Number(row.grandTotal.toFixed(2)),
      "Total Quotation Value": Number(row.totalQuotationValue.toFixed(2)),
      "Quotation Status": row.status,
      "Follow-up Date": row.followUpDateRaw || "",
      "Valid Till": q.validTill || "",
    };
  });
}

export async function exportSavedQuotationsExcel(
  list: QuotationV1[],
  company: CompanyProfileV1,
  filename = "saved-quotations.xlsx",
) {
  const XLSX = await import("xlsx");
  const rows = savedQuoteExportRows(list, company);
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}], {
    header: [...SAVED_QUOTE_EXPORT_HEADERS],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Saved quotations");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export async function exportSavedQuotationsPdf(
  list: QuotationV1[],
  company: CompanyProfileV1,
  filename = "saved-quotations.pdf",
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const title = "Saved quotations";
  const subtitle = company.name ? `${company.name} · ${list.length} record${list.length === 1 ? "" : "s"}` : `${list.length} records`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(subtitle, 14, 20);

  const body = list.map((q) => {
    const row = buildSavedQuoteListRow(q, company);
    return [
      row.quoteNo,
      row.submittedDate,
      row.companyName,
      row.companyCity,
      row.description,
      row.basicTotalLabel,
      row.grandTotalLabel,
      row.totalValueLabel,
      row.status,
      row.followUpDate,
    ];
  });

  autoTable(doc, {
    startY: 24,
    head: [
      [
        "Q No.",
        "Submitted",
        "Company",
        "City",
        "Description",
        "Basic",
        "Grand",
        "Value",
        "Status",
        "Follow-up",
      ],
    ],
    body: body.length ? body : [["—", "—", "—", "—", "No quotations", "—", "—", "—", "—", "—"]],
    styles: {
      fontSize: 7.5,
      cellPadding: 2.2,
      overflow: "linebreak",
      valign: "middle",
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: "bold" },
      1: { cellWidth: 22 },
      2: { cellWidth: 32 },
      3: { cellWidth: 22 },
      4: { cellWidth: 48 },
      5: { cellWidth: 22, halign: "right" },
      6: { cellWidth: 22, halign: "right" },
      7: { cellWidth: 22, halign: "right" },
      8: { cellWidth: 20 },
      9: { cellWidth: 22 },
    },
    margin: { left: 14, right: 14 },
  });

  const safe = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  doc.save(safe);
}
