import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { applianceSummaryLine, computeLoadSummary } from "./appliances";
import { ALL_FIELDS, flowForType } from "./catalog";
import { fmtRs, val, withFreshEstimate } from "./compute";
import type { SiteSurveyV1, SurveyCompanySnapshot, SurveyPhoto } from "./types";

type PdfDoc = jsPDF & { lastAutoTable?: { finalY: number } };

/** Corporate report palette (aligned with Quotation / brand teal). */
const C = {
  ink: [15, 23, 42] as [number, number, number],
  teal: [0, 120, 140] as [number, number, number],
  tealDeep: [0, 95, 112] as [number, number, number],
  tealHead: [0, 140, 158] as [number, number, number],
  slate: [30, 41, 59] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  line: [203, 213, 225] as [number, number, number],
  zebra: [248, 250, 252] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  softTeal: [236, 250, 252] as [number, number, number],
};

const MARGIN_L = 14;
const MARGIN_R = 196;
const PAGE_BOTTOM = 278;

export function sanitizePdfFilename(str: string) {
  return (
    String(str || "Customer")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "Customer"
  );
}

type SectionRow = {
  title: string;
  rows: string[][];
  table?: boolean;
  columns?: string[];
  accent?: "primary" | "estimate" | "neutral";
};

function collectSections(survey: SiteSurveyV1): SectionRow[] {
  const flow = flowForType(survey.installationType);
  const itype = survey.installationType;
  const order: string[] = [];
  const map = new Map<string, string[][]>();

  for (const f of ALL_FIELDS) {
    if (f.kind === "file") continue;
    if (f.flow === "common" || f.flow === flow) {
      if (f.itype && f.itype !== itype) continue;
    } else continue;

    const raw = survey.values[f.key];
    const display = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");
    const sec = f.section || "Details";
    if (!map.has(sec)) {
      map.set(sec, []);
      order.push(sec);
    }
    map.get(sec)!.push([f.label, display || "—"]);
  }

  const sections: SectionRow[] = order.map((title) => ({
    title,
    rows: map.get(title)!,
    accent: "neutral",
  }));

  const estimate = survey.estimate;
  if (flow === "residential") {
    const apps = survey.appliances.filter((a) => a.on && a.qty > 0);
    sections.push({
      title: "Appliance Load Schedule",
      table: true,
      columns: ["Appliance", "Qty", "Watts", "Hrs/Day", "Daily Units"],
      rows: apps.length
        ? apps.map((a) => [
            a.name,
            String(a.qty),
            `${a.watt} W`,
            String(a.hours),
            `${((a.qty * a.watt * a.hours) / 1000).toFixed(2)} kWh`,
          ])
        : [["No appliances selected", "—", "—", "—", "—"]],
      accent: "neutral",
    });
    const load = computeLoadSummary(survey.appliances);
    sections.push({
      title: "Load Summary",
      rows: [
        ["Connected Load", `${load.connLoad.toFixed(2)} kW`],
        ["Daily Consumption", `${load.dailyUnits.toFixed(1)} kWh`],
        ["Monthly Consumption", `${Math.round(load.monthlyUnits)} kWh`],
        ["Load Profile", applianceSummaryLine(survey.appliances) || "—"],
      ],
      accent: "primary",
    });
    if (estimate) {
      sections.push({
        title: "Overall Solar System Estimate",
        rows: [
          ["System Type", estimate.sysType || "—"],
          ["Recommended Size", estimate.genLabel],
          ["Panels Required", String(estimate.panels)],
          ["Roof Area Needed", estimate.roofSqft ? `${estimate.roofSqft} sq.ft` : "—"],
          ["Battery Storage", estimate.batteryKWh ? `${estimate.batteryKWh} kWh` : "Not required"],
          ["Estimated Total Cost", fmtRs(estimate.totalCost)],
          ["Monthly Generation", `${estimate.monthlyGenUnits} kWh`],
          ["Annual Generation", `${estimate.annualGenUnits.toLocaleString("en-IN")} kWh`],
          ["Load Reduction", estimate.loadReduction != null ? `${estimate.loadReduction}%` : "—"],
          ["Est. Monthly Savings", estimate.monthlySavings ? fmtRs(estimate.monthlySavings) : "—"],
        ],
        accent: "estimate",
      });
    }
  } else if (estimate) {
    sections.push({
      title: "Overall Project Estimate",
      rows: [
        ["Installation Type", estimate.type],
        ["Proposed Capacity", estimate.genLabel],
        ["Panels Required", estimate.panels.toLocaleString("en-IN")],
        ["Area Required", estimate.areaLabel || "—"],
        ["Estimated Project Cost", fmtRs(estimate.totalCost)],
        ["Cost per kW (Indicative)", `${fmtRs(estimate.costPerKW)}/kW`],
        ["Monthly Generation", `${estimate.monthlyGenUnits.toLocaleString("en-IN")} kWh`],
        ["Annual Generation", `${estimate.annualGenUnits.toLocaleString("en-IN")} kWh`],
      ],
      accent: "estimate",
    });
  }

  const notes = val(survey.values, "f_notes");
  if (notes.trim()) {
    sections.push({ title: "Additional Notes", rows: [["Notes", notes]], accent: "neutral" });
  }
  return sections;
}

function absoluteLogoUrl(logo: string): string {
  const raw = logo.trim();
  if (raw.startsWith("data:") || /^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}${raw}`;
    }
    return raw;
  }
  return raw;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    if (/^https?:\/\//i.test(src) && typeof window !== "undefined") {
      try {
        const u = new URL(src, window.location.href);
        if (u.origin !== window.location.origin) el.crossOrigin = "anonymous";
      } catch {
        /* ignore */
      }
    }
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("logo image load failed"));
    el.src = src;
  });
}

type ResolvedLogo = { dataUrl: string; widthPx: number; heightPx: number };

function rasterizeImageToPng(img: HTMLImageElement, maxPx = 320): ResolvedLogo | null {
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (w < 1 || h < 1) return null;
  const scale = Math.min(1, maxPx / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthPx: canvas.width,
    heightPx: canvas.height,
  };
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: "include", cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream") {
      return null;
    }
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function resolveLogo(logo: string | null | undefined): Promise<ResolvedLogo | null> {
  const raw = String(logo ?? "").trim();
  if (!raw) return null;

  const candidates: string[] = [];
  if (raw.startsWith("data:image/") || raw.startsWith("data:application/octet-stream")) {
    candidates.push(raw);
  } else {
    const abs = absoluteLogoUrl(raw);
    candidates.push(abs);
    if (abs !== raw) candidates.push(raw);
  }

  for (const src of candidates) {
    try {
      const img = await loadImageElement(src);
      const png = rasterizeImageToPng(img);
      if (png) return png;
    } catch {
      /* next */
    }
  }

  for (const src of candidates) {
    if (src.startsWith("data:")) continue;
    const dataUrl = await fetchAsDataUrl(src);
    if (!dataUrl) continue;
    try {
      const img = await loadImageElement(dataUrl);
      const png = rasterizeImageToPng(img);
      if (png) return png;
    } catch {
      /* next */
    }
  }

  return null;
}

function pngPayloadForJsPdf(dataUrl: string): { format: "PNG"; data: string } {
  const comma = dataUrl.indexOf(",");
  const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return { format: "PNG", data };
}

function fitLogoBox(
  widthPx: number,
  heightPx: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  const aspect = widthPx / Math.max(1, heightPx);
  let h = maxH;
  let w = h * aspect;
  if (w > maxW) {
    w = maxW;
    h = w / aspect;
  }
  return { w, h };
}

function ensureSpace(doc: PdfDoc, y: number, need: number): number {
  if (y + need <= PAGE_BOTTOM) return y;
  doc.addPage();
  return 18;
}

function drawCorporateHeader(
  doc: jsPDF,
  opts: {
    businessName: string;
    tagline?: string;
    address?: string;
    productTitle: string;
    reportNo: string;
    generatedLabel: string;
    logo: ResolvedLogo | null;
  },
): number {
  const y = 12;
  const tagline = String(opts.tagline ?? "").trim();
  const address = String(opts.address ?? "")
    .trim()
    .replace(/\n+/g, ", ");

  const maxLogoW = 36;
  const maxLogoH = 18;
  let logoW = 0;
  let logoH = 0;
  if (opts.logo) {
    const fitted = fitLogoBox(opts.logo.widthPx, opts.logo.heightPx, maxLogoW, maxLogoH);
    logoW = fitted.w;
    logoH = fitted.h;
  }

  const gap = logoW > 0 ? 7 : 0;
  const textX = MARGIN_L + (logoW > 0 ? logoW + gap : 0);
  const nameMaxW = Math.max(58, MARGIN_R - textX - 60);

  const nameLineH = 5;
  const productLineH = 4.2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.5);
  const nameLines = (doc.splitTextToSize(opts.businessName, nameMaxW) as string[]).slice(0, 2);
  const nameBlockH = nameLines.length * nameLineH;
  const extraH = (tagline ? 3.6 : 0) + (address ? 3.4 : 0);
  const textBlockH = nameBlockH + productLineH + extraH;
  const brandH = Math.max(logoH, textBlockH);

  const logoY = y + (brandH - logoH) / 2;
  const textTop = y + (brandH - textBlockH) / 2;

  if (opts.logo && logoW > 0) {
    try {
      const { format, data } = pngPayloadForJsPdf(opts.logo.dataUrl);
      doc.addImage(data, format, MARGIN_L, logoY, logoW, logoH, undefined, "FAST");
    } catch {
      try {
        doc.addImage(opts.logo.dataUrl, "PNG", MARGIN_L, logoY, logoW, logoH, undefined, "FAST");
      } catch {
        /* name-only */
      }
    }
  }

  let ty = textTop + nameLineH * 0.82;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.5);
  doc.setTextColor(...C.ink);
  doc.text(nameLines, textX, ty);
  ty += nameBlockH - nameLineH * 0.1;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...C.teal);
  doc.text(opts.productTitle.toUpperCase(), textX, ty);
  ty += productLineH;

  if (tagline) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text((doc.splitTextToSize(tagline, nameMaxW) as string[]).slice(0, 1), textX, ty);
    ty += 3.6;
  }
  if (address) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(...C.muted);
    doc.text((doc.splitTextToSize(address, nameMaxW) as string[]).slice(0, 1), textX, ty);
  }

  // Meta panel (right)
  const metaX = MARGIN_R - 52;
  doc.setFillColor(...C.softTeal);
  doc.roundedRect(metaX, y - 1, 52, 16, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...C.tealDeep);
  doc.text("REPORT ID", MARGIN_R - 3, y + 3.2, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...C.ink);
  doc.text(opts.reportNo, MARGIN_R - 3, y + 7.4, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.muted);
  doc.text(opts.generatedLabel, MARGIN_R - 3, y + 11.8, { align: "right" });

  let nextY = y + brandH + 5;
  doc.setDrawColor(...C.teal);
  doc.setLineWidth(1.1);
  doc.line(MARGIN_L, nextY, MARGIN_R, nextY);
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_L, nextY + 1.4, MARGIN_R, nextY + 1.4);
  doc.setLineWidth(0.2);
  return nextY + 5;
}

function drawContactStrip(doc: jsPDF, company: SurveyCompanySnapshot, y: number): number {
  const bits = [
    company.phone ? `Phone: ${company.phone}` : "",
    company.email ? `Email: ${company.email}` : "",
    company.website ? `Web: ${company.website}` : "",
  ].filter(Boolean);
  if (!bits.length) return y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text(bits.join("   ·   "), 105, y, { align: "center" });
  return y + 5;
}

function drawControlStrip(
  doc: jsPDF,
  y: number,
  cells: Array<{ label: string; value: string }>,
): number {
  const usable = MARGIN_R - MARGIN_L;
  const n = cells.length;
  const w = usable / n;
  const h = 12;
  doc.setFillColor(...C.slate);
  doc.roundedRect(MARGIN_L, y, usable, h, 1.2, 1.2, "F");
  cells.forEach((cell, i) => {
    const x = MARGIN_L + i * w;
    if (i > 0) {
      doc.setDrawColor(70, 85, 105);
      doc.setLineWidth(0.2);
      doc.line(x, y + 2, x, y + h - 2);
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(160, 175, 195);
    doc.text(cell.label.toUpperCase(), x + w / 2, y + 3.8, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.white);
    const v = (doc.splitTextToSize(cell.value || "—", w - 4) as string[])[0] || "—";
    doc.text(v, x + w / 2, y + 8.6, { align: "center" });
  });
  return y + h + 6;
}

function drawHighlightMetrics(
  doc: jsPDF,
  y: number,
  metrics: Array<{ label: string; value: string }>,
): number {
  if (!metrics.length) return y;
  const usable = MARGIN_R - MARGIN_L;
  const n = Math.min(4, metrics.length);
  const gap = 3;
  const w = (usable - gap * (n - 1)) / n;
  const h = 16;
  for (let i = 0; i < n; i++) {
    const m = metrics[i]!;
    const x = MARGIN_L + i * (w + gap);
    doc.setFillColor(...C.softTeal);
    doc.setDrawColor(...C.tealHead);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...C.tealDeep);
    doc.text(m.label.toUpperCase(), x + w / 2, y + 4.2, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...C.ink);
    const v = (doc.splitTextToSize(m.value || "—", w - 4) as string[])[0] || "—";
    doc.text(v, x + w / 2, y + 11.2, { align: "center" });
  }
  return y + h + 7;
}

function kvTableStyles(accent: SectionRow["accent"]) {
  const headFill =
    accent === "estimate" ? C.tealDeep : accent === "primary" ? C.tealHead : C.slate;
  return {
    theme: "grid" as const,
    margin: { left: MARGIN_L, right: 14 },
    columnStyles: {
      0: { cellWidth: 62, fontStyle: "bold" as const, textColor: C.ink, fillColor: C.zebra },
      1: { cellWidth: "auto" as const, textColor: C.slate },
    },
    headStyles: {
      fillColor: headFill,
      textColor: C.white,
      fontSize: 9.5,
      fontStyle: "bold" as const,
      halign: "left" as const,
      cellPadding: { top: 3.2, bottom: 3.2, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 8.6,
      textColor: C.slate,
      cellPadding: { top: 2.4, bottom: 2.4, left: 4, right: 4 },
      lineColor: C.line,
      lineWidth: 0.2,
    },
    alternateRowStyles: { fillColor: [255, 255, 255] as [number, number, number] },
    styles: { overflow: "linebreak" as const, valign: "middle" as const },
  };
}

function drawClosingBlock(
  doc: PdfDoc,
  y: number,
  businessName: string,
  surveyor: string,
): number {
  y = ensureSpace(doc, y, 42);
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_L, y, MARGIN_R, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.ink);
  doc.text("Thank you for choosing us", 105, y, { align: "center" });
  y += 5;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(...C.teal);
  doc.text("Powering a brighter, cleaner tomorrow.", 105, y, { align: "center" });
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  const disclaimer = doc.splitTextToSize(
    "This site survey report is indicative and based on information collected during the survey. Final system design, costing, and commercial terms are subject to detailed technical assessment and quotation approval.",
    MARGIN_R - MARGIN_L,
  ) as string[];
  doc.text(disclaimer, 105, y, { align: "center" });
  y += disclaimer.length * 3.4 + 8;

  // Signature lanes
  y = ensureSpace(doc, y, 28);
  const colW = (MARGIN_R - MARGIN_L - 16) / 2;
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.35);
  doc.line(MARGIN_L, y + 14, MARGIN_L + colW, y + 14);
  doc.line(MARGIN_R - colW, y + 14, MARGIN_R, y + 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...C.ink);
  doc.text(surveyor || "Survey Engineer", MARGIN_L, y + 19);
  doc.text(businessName, MARGIN_R - colW, y + 19);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text("Prepared by", MARGIN_L, y + 23.5);
  doc.text("Authorized Signatory", MARGIN_R - colW, y + 23.5);
  return y + 28;
}

function applyPageChrome(
  doc: PdfDoc,
  businessName: string,
  reportNo: string,
  productTitle: string,
) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    // Footer rule
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.35);
    doc.line(MARGIN_L, 285, MARGIN_R, 285);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(`${businessName}  ·  ${productTitle}`, MARGIN_L, 289.5);
    doc.text(`Report ID ${reportNo}`, 105, 289.5, { align: "center" });
    doc.text(`Page ${i} of ${pageCount}`, MARGIN_R, 289.5, { align: "right" });
  }
}

export async function buildSurveyPdf(
  surveyIn: SiteSurveyV1,
  company: SurveyCompanySnapshot,
): Promise<{ filename: string; pdfBase64: string; blob: Blob }> {
  const survey = withFreshEstimate(surveyIn);
  const brand: SurveyCompanySnapshot = survey.companySnapshot
    ? {
        ...survey.companySnapshot,
        ...company,
        name: company.name || survey.companySnapshot.name || "Site Survey Report",
        logo: company.logo || survey.companySnapshot.logo || null,
      }
    : company;

  const doc = new jsPDF() as PdfDoc;
  const reportNo = survey.reportNo || "DRAFT";
  const flow = flowForType(survey.installationType);
  const estimate = survey.estimate;
  const businessName = (brand.name || "Site Survey Report").trim();
  const productTitle = "Solar Site Survey Report";
  const surveyor =
    val(survey.values, "sv_name") || val(survey.values, "sv2_name") || "—";
  const surveyDate =
    val(survey.values, "sv_date") ||
    val(survey.values, "sv2_date") ||
    new Date().toLocaleDateString("en-IN");

  const logo = await resolveLogo(brand.logo);
  let y = drawCorporateHeader(doc, {
    businessName,
    tagline: brand.tagline,
    address: brand.address,
    productTitle,
    reportNo,
    generatedLabel: new Date().toLocaleString("en-IN"),
    logo,
  });
  y = drawContactStrip(doc, brand, y);

  y = drawControlStrip(doc, y, [
    { label: "Installation", value: survey.installationType || "—" },
    { label: "Flow", value: flow === "residential" ? "Residential" : "EPC / Commercial" },
    { label: "Status", value: (survey.status || "draft").toUpperCase() },
    { label: "Survey Date", value: surveyDate },
    { label: "Surveyor", value: surveyor },
  ]);

  const highlights: Array<{ label: string; value: string }> = [];
  if (estimate?.genLabel) highlights.push({ label: "Proposed Capacity", value: estimate.genLabel });
  if (estimate?.totalCost)
    highlights.push({
      label: flow === "residential" ? "Est. System Cost" : "Est. Project Cost",
      value: fmtRs(estimate.totalCost),
    });
  if (estimate?.monthlyGenUnits)
    highlights.push({
      label: "Monthly Generation",
      value: `${Number(estimate.monthlyGenUnits).toLocaleString("en-IN")} kWh`,
    });
  if (flow === "residential" && estimate?.monthlySavings)
    highlights.push({ label: "Est. Monthly Savings", value: fmtRs(estimate.monthlySavings) });
  else if (val(survey.values, "f_budget"))
    highlights.push({ label: "Customer Budget", value: fmtRs(val(survey.values, "f_budget")) });
  if (highlights.length) y = drawHighlightMetrics(doc, y, highlights);

  const custBody =
    flow === "residential"
      ? [
          ["Customer Name", val(survey.values, "f_name") || "—"],
          ["Customer Phone", val(survey.values, "f_phone") || "—"],
          ["Customer Email", val(survey.values, "f_email") || "—"],
          ["Report ID", reportNo],
          ["Estimated Budget", fmtRs(val(survey.values, "f_budget"))],
          ["Required System Capacity", estimate?.genLabel || "—"],
          [
            "Installation Area",
            val(survey.values, "f_area") && val(survey.values, "f_areaunit")
              ? `${val(survey.values, "f_area")} ${val(survey.values, "f_areaunit")}`
              : "—",
          ],
          ["Monthly Electricity Bill", fmtRs(val(survey.values, "f_bill"))],
        ]
      : [
          ["Company / Owner Name", val(survey.values, "f_name") || "—"],
          ["Contact Phone", val(survey.values, "f_phone") || "—"],
          ["Contact Email", val(survey.values, "f_email") || "—"],
          ["Report ID", reportNo],
          ["Installation Type", survey.installationType],
          ["Proposed Capacity", estimate?.genLabel || "—"],
          ["Estimated Project Cost", estimate ? fmtRs(estimate.totalCost) : "—"],
        ];

  autoTable(doc, {
    startY: y,
    head: [["1.  Customer Information", ""]],
    body: custBody,
    ...kvTableStyles("primary"),
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 8;

  let sectionNo = 2;
  for (const sec of collectSections(survey)) {
    y = ensureSpace(doc, y, 32);
    const heading = `${sectionNo}.  ${sec.title}`;
    sectionNo += 1;

    if (sec.table && sec.columns) {
      // Section caption bar
      doc.setFillColor(...(sec.accent === "estimate" ? C.tealDeep : C.slate));
      doc.roundedRect(MARGIN_L, y, MARGIN_R - MARGIN_L, 8, 1, 1, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...C.white);
      doc.text(heading, MARGIN_L + 3.5, y + 5.4);
      y += 9;

      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN_L, right: 14 },
        head: [sec.columns],
        body: sec.rows,
        theme: "grid",
        headStyles: {
          fillColor: C.tealHead,
          textColor: C.white,
          fontSize: 8.5,
          fontStyle: "bold",
          cellPadding: 2.6,
        },
        bodyStyles: {
          fontSize: 8,
          textColor: C.slate,
          cellPadding: 2.2,
          lineColor: C.line,
          lineWidth: 0.2,
        },
        alternateRowStyles: { fillColor: C.zebra },
      });
    } else {
      autoTable(doc, {
        startY: y,
        head: [[heading, ""]],
        body: sec.rows,
        ...kvTableStyles(sec.accent),
      });
    }
    y = (doc.lastAutoTable?.finalY ?? y) + 7;
  }

  y = drawClosingBlock(doc, y, businessName, surveyor);

  await addPhotosAppendix(doc, survey.photos, businessName);

  applyPageChrome(doc, businessName, reportNo, productTitle);

  const seq = (reportNo.split(":").pop() || "00000").replace(/\D/g, "").slice(-5) || "00000";
  const filename = `SiteSurvey_ID-${seq}_${sanitizePdfFilename(val(survey.values, "f_name"))}.pdf`;
  const dataUri = doc.output("datauristring");
  const pdfBase64 = dataUri.includes(",") ? dataUri.split(",")[1]! : dataUri;
  const blob = doc.output("blob");
  return { filename, pdfBase64, blob };
}

async function addPhotosAppendix(
  doc: PdfDoc,
  photos: Record<string, SurveyPhoto[]>,
  businessName: string,
) {
  const entries = Object.entries(photos).filter(([, list]) => list?.some((p) => p.dataUrl));
  if (!entries.length) return;

  doc.addPage();
  let y = 16;
  doc.setFillColor(...C.slate);
  doc.roundedRect(MARGIN_L, y, MARGIN_R - MARGIN_L, 10, 1.2, 1.2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.white);
  doc.text("Photo Appendix", MARGIN_L + 4, y + 6.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(180, 190, 205);
  doc.text(businessName, MARGIN_R - 4, y + 6.5, { align: "right" });
  y += 16;

  for (const [key, list] of entries) {
    for (const photo of list) {
      if (!photo.dataUrl?.startsWith("data:image")) continue;
      y = ensureSpace(doc, y, 72);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.tealDeep);
      doc.text(String(key).replace(/_/g, " "), MARGIN_L, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      doc.text(photo.name || "", MARGIN_R, y, { align: "right" });
      y += 3;
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.3);
      doc.line(MARGIN_L, y, MARGIN_R, y);
      y += 3;
      try {
        const fmt = photo.dataUrl.includes("image/png") ? "PNG" : "JPEG";
        doc.setDrawColor(...C.line);
        doc.roundedRect(MARGIN_L, y, 82, 62, 1, 1, "S");
        doc.addImage(photo.dataUrl, fmt, MARGIN_L + 1, y + 1, 80, 60);
        y += 68;
      } catch {
        doc.setTextColor(...C.muted);
        doc.text("(image could not be embedded)", MARGIN_L, y + 6);
        y += 14;
      }
    }
  }
}

export async function surveyPdfToBase64(
  survey: SiteSurveyV1,
  company: SurveyCompanySnapshot,
): Promise<{ filename: string; pdfBase64: string }> {
  const { filename, pdfBase64 } = await buildSurveyPdf(survey, company);
  return { filename, pdfBase64 };
}
