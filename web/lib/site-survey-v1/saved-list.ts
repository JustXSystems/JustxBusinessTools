import { fmtRs, todayISO, val } from "./compute";
import type { InstallationType, SiteSurveyV1, SurveyStatus } from "./types";

export type SavedSurveyListRow = {
  id: string;
  reportNo: string;
  surveyDate: string;
  surveyDateRaw: string;
  submittedDate: string;
  submittedDateRaw: string;
  companyName: string;
  city: string;
  installationType: InstallationType;
  description: string;
  capacityLabel: string;
  estimatedCost: number;
  estimatedCostLabel: string;
  status: SurveyStatus;
  followUpDate: string;
  followUpDateRaw: string;
};

export type SurveyFollowUpFilter = "all" | "overdue" | "upcoming" | "none" | "set";

export type SavedSurveyFilters = {
  query: string;
  statuses: SurveyStatus[];
  installationTypes: InstallationType[];
  city: string;
  surveyFrom: string;
  surveyTo: string;
  followUp: SurveyFollowUpFilter;
  followUpFrom: string;
  followUpTo: string;
  costMin: string;
  costMax: string;
};

export const EMPTY_SAVED_SURVEY_FILTERS: SavedSurveyFilters = {
  query: "",
  statuses: [],
  installationTypes: [],
  city: "",
  surveyFrom: "",
  surveyTo: "",
  followUp: "all",
  followUpFrom: "",
  followUpTo: "",
  costMin: "",
  costMax: "",
};

export const SAVED_SURVEY_STATUS_OPTIONS: SurveyStatus[] = ["draft", "saved", "submitted"];

function fmtDisplayDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function surveyCityDisplay(s: SiteSurveyV1): string {
  return val(s.values, "f_city").trim() || "—";
}

export function surveyCompanyDisplay(s: SiteSurveyV1): string {
  return val(s.values, "f_name").trim() || "Unnamed";
}

/** Compact summary: capacity + system type / notes. */
export function surveyDescriptionSummary(s: SiteSurveyV1): string {
  const parts: string[] = [];
  const capacity = s.estimate?.genLabel?.trim();
  if (capacity) parts.push(capacity);
  const sys = val(s.values, "systemtype").trim();
  if (sys) parts.push(sys);
  const notes = val(s.values, "f_notes").trim().replace(/\s+/g, " ");
  if (notes && parts.length < 2) {
    parts.push(notes.length > 48 ? `${notes.slice(0, 46)}…` : notes);
  }
  if (!parts.length) parts.push(s.installationType || "Survey");
  return parts.join(" · ");
}

export function surveySubmittedDateIso(s: SiteSurveyV1): string {
  const hist = Array.isArray(s.history) ? s.history : [];
  for (const h of hist) {
    if (/submit/i.test(String(h.event ?? ""))) {
      const ts = String(h.ts ?? "");
      if (ts) return ts.slice(0, 10);
    }
  }
  if (s.status === "submitted") {
    const surveyDate = val(s.values, "f_date").trim();
    if (surveyDate) return surveyDate.slice(0, 10);
    if (s.updatedAt) return s.updatedAt.slice(0, 10);
  }
  return "";
}

export function buildSavedSurveyListRow(s: SiteSurveyV1): SavedSurveyListRow {
  const surveyRaw = val(s.values, "f_date").trim().slice(0, 10);
  const followRaw = val(s.values, "f_followup").trim().slice(0, 10);
  const submittedRaw = surveySubmittedDateIso(s);
  const cost = Number(s.estimate?.totalCost ?? 0);

  return {
    id: s.id,
    reportNo: s.reportNo || "(draft)",
    surveyDate: surveyRaw ? fmtDisplayDate(surveyRaw) : "—",
    surveyDateRaw: surveyRaw,
    submittedDate: submittedRaw ? fmtDisplayDate(submittedRaw) : "—",
    submittedDateRaw: submittedRaw,
    companyName: surveyCompanyDisplay(s),
    city: surveyCityDisplay(s),
    installationType: s.installationType,
    description: surveyDescriptionSummary(s),
    capacityLabel: s.estimate?.genLabel?.trim() || "—",
    estimatedCost: cost,
    estimatedCostLabel: fmtRs(cost),
    status: s.status,
    followUpDate: followRaw ? fmtDisplayDate(followRaw) : "—",
    followUpDateRaw: followRaw,
  };
}

export function uniqueSurveyCities(list: SiteSurveyV1[]): string[] {
  const set = new Set<string>();
  for (const s of list) {
    const city = surveyCityDisplay(s);
    if (city && city !== "—") set.add(city);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function countActiveSurveyFilters(f: SavedSurveyFilters): number {
  let n = 0;
  if (f.query.trim()) n += 1;
  if (f.statuses.length) n += 1;
  if (f.installationTypes.length) n += 1;
  if (f.city) n += 1;
  if (f.surveyFrom || f.surveyTo) n += 1;
  if (f.followUp !== "all") n += 1;
  if (f.followUpFrom || f.followUpTo) n += 1;
  if (f.costMin.trim() || f.costMax.trim()) n += 1;
  return n;
}

function inDateRange(iso: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export function filterSavedSurveys(
  list: SiteSurveyV1[],
  filters: SavedSurveyFilters,
  today = todayISO(),
): SiteSurveyV1[] {
  const qText = filters.query.trim().toLowerCase();
  const min = filters.costMin.trim() === "" ? null : Number(filters.costMin);
  const max = filters.costMax.trim() === "" ? null : Number(filters.costMax);
  const statusSet = filters.statuses.length ? new Set(filters.statuses) : null;
  const typeSet = filters.installationTypes.length ? new Set(filters.installationTypes) : null;

  return list.filter((s) => {
    const row = buildSavedSurveyListRow(s);

    if (statusSet && !statusSet.has(row.status)) return false;
    if (typeSet && !typeSet.has(row.installationType)) return false;
    if (filters.city && row.city !== filters.city) return false;

    if (qText) {
      const hay = [
        row.reportNo,
        row.companyName,
        row.city,
        row.description,
        row.installationType,
        row.capacityLabel,
        row.status,
        val(s.values, "f_phone"),
        val(s.values, "f_address"),
      ]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      if (!hay.includes(qText)) return false;
    }

    if (!inDateRange(row.surveyDateRaw, filters.surveyFrom, filters.surveyTo)) return false;

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

    if (min != null && Number.isFinite(min) && row.estimatedCost < min) return false;
    if (max != null && Number.isFinite(max) && row.estimatedCost > max) return false;

    return true;
  });
}

export const SAVED_SURVEY_EXPORT_HEADERS = [
  "Report Number",
  "Survey Date",
  "Submitted Date",
  "Customer / Company",
  "City",
  "Installation Type",
  "Description",
  "Estimated Capacity",
  "Estimated Cost",
  "Status",
  "Follow-up Date",
] as const;

export function savedSurveyExportRows(
  list: SiteSurveyV1[],
): Array<Record<string, string | number>> {
  return list.map((s) => {
    const row = buildSavedSurveyListRow(s);
    return {
      "Report Number": row.reportNo,
      "Survey Date": row.surveyDateRaw || "",
      "Submitted Date": row.submittedDateRaw || "",
      "Customer / Company": row.companyName,
      City: row.city === "—" ? "" : row.city,
      "Installation Type": row.installationType,
      Description: row.description,
      "Estimated Capacity": row.capacityLabel === "—" ? "" : row.capacityLabel,
      "Estimated Cost": Number(row.estimatedCost.toFixed(2)),
      Status: row.status,
      "Follow-up Date": row.followUpDateRaw || "",
    };
  });
}

export async function exportSavedSurveysExcel(
  list: SiteSurveyV1[],
  filename = "saved-surveys.xlsx",
) {
  const XLSX = await import("xlsx");
  const rows = savedSurveyExportRows(list);
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}], {
    header: [...SAVED_SURVEY_EXPORT_HEADERS],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Saved surveys");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export async function exportSavedSurveysPdf(
  list: SiteSurveyV1[],
  companyName = "",
  filename = "saved-surveys.pdf",
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const title = "Saved site surveys";
  const subtitle = companyName
    ? `${companyName} · ${list.length} record${list.length === 1 ? "" : "s"}`
    : `${list.length} records`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(subtitle, 14, 20);

  const body = list.map((s) => {
    const row = buildSavedSurveyListRow(s);
    return [
      row.reportNo,
      row.surveyDate,
      row.companyName,
      row.city,
      row.installationType,
      row.description,
      row.capacityLabel,
      row.estimatedCostLabel,
      row.status,
      row.followUpDate,
    ];
  });

  autoTable(doc, {
    startY: 24,
    head: [
      [
        "Report No.",
        "Survey Date",
        "Customer",
        "City",
        "Type",
        "Description",
        "Capacity",
        "Est. Cost",
        "Status",
        "Follow-up",
      ],
    ],
    body: body.length ? body : [["—", "—", "—", "—", "—", "No surveys", "—", "—", "—", "—"]],
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
      0: { cellWidth: 26, fontStyle: "bold" },
      1: { cellWidth: 22 },
      2: { cellWidth: 30 },
      3: { cellWidth: 20 },
      4: { cellWidth: 28 },
      5: { cellWidth: 42 },
      6: { cellWidth: 22 },
      7: { cellWidth: 24, halign: "right" },
      8: { cellWidth: 18 },
      9: { cellWidth: 22 },
    },
    margin: { left: 14, right: 14 },
  });

  const safe = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  doc.save(safe);
}
