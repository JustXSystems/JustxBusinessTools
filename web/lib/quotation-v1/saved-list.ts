import { computeTotals, fmtDate, money, todayISO } from "./compute";
import type { CompanyProfileV1, QuotationV1, QuoteStatus } from "./types";

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
  preparedBy: string;
};

export type FollowUpFilter = "all" | "overdue" | "upcoming" | "none" | "set";

export type SavedQuoteFilters = {
  query: string;
  statuses: QuoteStatus[];
  city: string;
  preparedBy: string;
  submittedFrom: string;
  submittedTo: string;
  followUp: FollowUpFilter;
  followUpFrom: string;
  followUpTo: string;
  valueMin: string;
  valueMax: string;
};

export const EMPTY_SAVED_FILTERS: SavedQuoteFilters = {
  query: "",
  statuses: [],
  city: "",
  preparedBy: "",
  submittedFrom: "",
  submittedTo: "",
  followUp: "all",
  followUpFrom: "",
  followUpTo: "",
  valueMin: "",
  valueMax: "",
};

export const SAVED_STATUS_OPTIONS: QuoteStatus[] = [
  "draft",
  "submitted",
  "sent",
  "approved",
  "rejected",
];

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

export function preparedByDisplay(q: QuotationV1): string {
  return String(q.preparedBy ?? "").trim() || "—";
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
    preparedBy: preparedByDisplay(q),
  };
}

export function uniqueSavedCities(list: QuotationV1[]): string[] {
  const set = new Set<string>();
  for (const q of list) {
    const city = customerCityDisplay(q);
    if (city && city !== "—") set.add(city);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function uniqueSavedPreparedBy(list: QuotationV1[]): string[] {
  const set = new Set<string>();
  for (const q of list) {
    const name = preparedByDisplay(q);
    if (name && name !== "—") set.add(name);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function countActiveSavedFilters(f: SavedQuoteFilters): number {
  let n = 0;
  if (f.query.trim()) n += 1;
  if (f.statuses.length) n += 1;
  if (f.city) n += 1;
  if (f.preparedBy) n += 1;
  if (f.submittedFrom || f.submittedTo) n += 1;
  if (f.followUp !== "all") n += 1;
  if (f.followUpFrom || f.followUpTo) n += 1;
  if (f.valueMin.trim() || f.valueMax.trim()) n += 1;
  return n;
}

function inDateRange(iso: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export function filterSavedQuotations(
  list: QuotationV1[],
  company: CompanyProfileV1,
  filters: SavedQuoteFilters,
  today = todayISO(),
): QuotationV1[] {
  const qText = filters.query.trim().toLowerCase();
  const min = filters.valueMin.trim() === "" ? null : Number(filters.valueMin);
  const max = filters.valueMax.trim() === "" ? null : Number(filters.valueMax);
  const statusSet = filters.statuses.length ? new Set(filters.statuses) : null;

  return list.filter((q) => {
    const row = buildSavedQuoteListRow(q, company);

    if (statusSet && !statusSet.has(row.status)) return false;

    if (filters.city && row.companyCity !== filters.city) return false;
    if (filters.preparedBy && row.preparedBy !== filters.preparedBy) return false;

    if (qText) {
      const hay = [
        row.quoteNo,
        row.companyName,
        row.companyCity,
        row.description,
        row.status,
        row.preparedBy,
        q.customer?.name,
        q.customer?.phone,
        q.preparedBy,
      ]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      if (!hay.includes(qText)) return false;
    }

    if (!inDateRange(row.submittedDateRaw, filters.submittedFrom, filters.submittedTo)) {
      return false;
    }

    const follow = row.followUpDateRaw;
    switch (filters.followUp) {
      case "none":
        if (follow) return false;
        break;
      case "set":
        if (!follow) return false;
        break;
      case "overdue":
        if (!follow || follow >= today) return false;
        break;
      case "upcoming":
        if (!follow || follow < today) return false;
        break;
      default:
        break;
    }

    if (!inDateRange(follow, filters.followUpFrom, filters.followUpTo)) return false;

    if (min != null && Number.isFinite(min) && row.grandTotal < min) return false;
    if (max != null && Number.isFinite(max) && row.grandTotal > max) return false;

    return true;
  });
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
  "Prepared By",
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
      "Prepared By": row.preparedBy === "—" ? "" : row.preparedBy,
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
  const subtitle = company.name
    ? `${company.name} · ${list.length} record${list.length === 1 ? "" : "s"}`
    : `${list.length} records`;

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
      row.preparedBy,
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
        "Prepared By",
      ],
    ],
    body: body.length
      ? body
      : [["—", "—", "—", "—", "No quotations", "—", "—", "—", "—", "—", "—"]],
    styles: {
      fontSize: 7,
      cellPadding: 2,
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
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 24, fontStyle: "bold" },
      1: { cellWidth: 20 },
      2: { cellWidth: 28 },
      3: { cellWidth: 18 },
      4: { cellWidth: 40 },
      5: { cellWidth: 18, halign: "right" },
      6: { cellWidth: 18, halign: "right" },
      7: { cellWidth: 18, halign: "right" },
      8: { cellWidth: 18 },
      9: { cellWidth: 20 },
      10: { cellWidth: 24 },
    },
    margin: { left: 14, right: 14 },
  });

  const safe = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  doc.save(safe);
}
