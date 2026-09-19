import autoTable from "jspdf-autotable";
import type { CompanyProfileV1, QuotationV1 } from "./types";
import {
  computeTotals,
  fmtDate,
  fmtDateSlash,
  money,
  numToWordsIndian,
} from "./compute";
import { DEFAULT_COMPANY, typeLabel } from "./catalog";
import { documentAccentPdfPalette } from "@/lib/document-accent";
import { publicAssetUrl } from "@/lib/base-path";

/** A4 geometry shared by preview guides (DOM) and PDF margins. */
export function pdfPageGeometry(node: HTMLElement) {
  const pageWidthPt = 595.28;
  const pageHeightPt = 841.89;
  const marginX = 28;
  const marginTop = 28;
  const marginBottom = 36;
  const contentBottomBuffer = 8;
  const continuationLabelBand = 27;
  const contentWidthPt = pageWidthPt - marginX * 2;
  const usablePageHeightPt = pageHeightPt - marginTop - marginBottom - contentBottomBuffer;
  const usablePageHeightContPt = usablePageHeightPt - continuationLabelBand;
  const cssPxPerPt = node.offsetWidth / contentWidthPt;
  const pageHeightPx = usablePageHeightPt * cssPxPerPt;
  const pageHeightContPx = usablePageHeightContPt * cssPxPerPt;
  return {
    pageWidthPt,
    pageHeightPt,
    marginX,
    marginTop,
    marginBottom,
    contentBottomBuffer,
    continuationLabelBand,
    contentWidthPt,
    usablePageHeightPt,
    usablePageHeightContPt,
    cssPxPerPt,
    pageHeightPx,
    pageHeightContPx,
  };
}

export function sanitizePdfFilename(str: string) {
  return String(str || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Preview-only guides (DOM height estimate for the live sheet). */
export function renderPageBreakMarkers(node: HTMLElement, q: QuotationV1) {
  node.querySelectorAll(".page-break-marker").forEach((m) => m.remove());
  const geo = pdfPageGeometry(node);
  const totalPx = node.scrollHeight;
  const positions: number[] = [];
  let used = 0;
  let pageCap = geo.pageHeightPx;
  while (used + pageCap < totalPx) {
    used += pageCap;
    positions.push(used);
    pageCap = geo.pageHeightContPx;
  }
  const numPages = positions.length + 1;
  if (numPages <= 1) return;

  positions.forEach((top, idx) => {
    const i = idx + 1;
    const marker = document.createElement("div");
    marker.className = "page-break-marker";
    marker.style.top = `${Math.round(top)}px`;
    marker.innerHTML = `
      <div class="pbm-line"><span class="pbm-label">Page ${i} ends · Page ${i + 1} starts →</span></div>
      <div class="pbm-continued-header">
        <b>Continued from page ${i}</b> — Quotation No: ${q.quoteNo || "(unsaved)"} · Date: ${fmtDate(q.date)} · Page ${i + 1} of ${numPages} · For: ${typeLabel(q)}
      </div>`;
    node.appendChild(marker);
  });
}

type JsPdf = import("jspdf").jsPDF;
type PdfDoc = JsPdf & { lastAutoTable?: { finalY: number } };
type PdfRgb = [number, number, number];

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MX = 28;
const MY_TOP = 28;
const MY_BOTTOM = 40;
const CONTENT_W = PAGE_W - MX * 2;
const PAPER: PdfRgb = [251, 249, 244];
const LINE: PdfRgb = [231, 225, 211];
const INK: PdfRgb = [27, 27, 27];
const SOFT: PdfRgb = [90, 87, 80];
const AMBER: PdfRgb = [242, 169, 59];
const GRAND_BG: PdfRgb = [252, 248, 237];
const FOOT_MUTED: PdfRgb = [163, 157, 140];
const STAMP_OK: PdfRgb = [46, 125, 91];
const STAMP_BAD: PdfRgb = [193, 68, 60];

type ResolvedLogo = { dataUrl: string; widthPx: number; heightPx: number };

function absoluteLogoUrl(logo: string): string {
  const raw = logo.trim();
  if (raw.startsWith("data:") || /^https?:\/\//i.test(raw)) return raw;
  const asset = publicAssetUrl(raw);
  if (asset.startsWith("data:") || /^https?:\/\//i.test(asset)) return asset;
  if (typeof window !== "undefined" && window.location?.origin) {
    const path = asset.startsWith("/") ? asset : `/${asset}`;
    return `${window.location.origin}${path}`;
  }
  return asset;
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

function resolveCompany(
  q: QuotationV1,
  company?: CompanyProfileV1 | null,
): CompanyProfileV1 {
  return {
    ...DEFAULT_COMPANY,
    ...(q.companySnapshot || {}),
    ...(company || {}),
    logo: company?.logo ?? q.companySnapshot?.logo ?? DEFAULT_COMPANY.logo,
    documentAccentColor:
      company?.documentAccentColor ??
      q.companySnapshot?.documentAccentColor ??
      DEFAULT_COMPANY.documentAccentColor,
  };
}

function ensureY(doc: PdfDoc, y: number, need: number): number {
  if (y + need <= PAGE_H - MY_BOTTOM) return y;
  doc.addPage();
  return MY_TOP + 18;
}

function drawWrapped(
  doc: PdfDoc,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
): number {
  const lines = doc.splitTextToSize(String(text || ""), maxW) as string[];
  doc.text(lines, x, y);
  return y + lines.length * lineH;
}

function drawDashedHLine(doc: PdfDoc, x1: number, x2: number, y: number, color: PdfRgb) {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.6);
  const dash = 3.5;
  const gap = 2.2;
  let x = x1;
  while (x < x2) {
    const end = Math.min(x + dash, x2);
    doc.line(x, y, end, y);
    x += dash + gap;
  }
}

function drawAmberRule(doc: PdfDoc, y: number) {
  doc.setFillColor(...AMBER);
  let x = MX;
  while (x < MX + CONTENT_W) {
    doc.rect(x, y, 7, 1.6, "F");
    x += 11;
  }
  return y + 10;
}

function drawStamp(doc: PdfDoc, q: QuotationV1) {
  if (q.status !== "approved" && q.status !== "rejected") return;
  const ok = q.status === "approved";
  const color = ok ? STAMP_OK : STAMP_BAD;
  const cx = PAGE_W - MX - 70;
  const cy = 175;
  const r = 42;
  doc.setDrawColor(...color);
  doc.setLineWidth(2.8);
  doc.circle(cx, cy, r, "S");
  doc.setTextColor(...color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(ok ? "APPROVED" : "REJECTED", cx, cy - 4, {
    align: "center",
    angle: 16,
  });
  const who = ok ? q.approvedBy : q.rejectedBy;
  const whenIso = ok ? q.approvedAt : q.rejectedAt;
  const when = whenIso
    ? new Date(whenIso).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : fmtDate(q.date);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  const sub = [who, when].filter(Boolean).join(" · ");
  if (sub) doc.text(sub, cx, cy + 8, { align: "center", angle: 16, maxWidth: 70 });
}

/**
 * Build an A4 quotation PDF with real selectable text (vector), matching the
 * QuoteSheet preview layout — not an html2canvas screenshot.
 */
export async function buildQuotationPdf(
  q: QuotationV1,
  companyIn?: CompanyProfileV1 | null,
): Promise<{
  pdf: JsPdf;
  filename: string;
}> {
  const { jsPDF } = await import("jspdf");
  const company = resolveCompany(q, companyIn);
  const t = computeTotals(q, company);
  const accent = documentAccentPdfPalette(company.documentAccentColor);
  const teal = accent.tealDeep as PdfRgb;
  const forLabel = typeLabel(q);
  const logo = await resolveLogo(company.logo);

  const pdf = new jsPDF("p", "pt", "a4") as PdfDoc;
  let y = MY_TOP;

  // —— Header: brand | meta ——
  const metaX = MX + CONTENT_W * 0.55;
  const brandW = CONTENT_W * 0.52;
  let brandY = y;

  if (logo) {
    const maxH = 36;
    const maxW = 130;
    const scale = Math.min(maxW / logo.widthPx, maxH / logo.heightPx);
    const w = logo.widthPx * scale;
    const h = logo.heightPx * scale;
    pdf.addImage(logo.dataUrl, "PNG", MX, brandY, w, h);
    brandY += h + 6;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(...teal);
  brandY = drawWrapped(pdf, company.name || "Company", MX, brandY + 10, brandW, 14);

  if (company.tagline) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...SOFT);
    brandY = drawWrapped(pdf, company.tagline, MX, brandY + 2, brandW, 10);
  }

  const addrLines = [
    ...(company.address || "").split("\n").map((l) => l.trim()).filter(Boolean),
    company.phone ? `Mobile: ${company.phone}` : "",
    company.gstin ? `GSTIN: ${company.gstin}` : "",
  ].filter(Boolean);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...SOFT);
  for (const line of addrLines) {
    brandY = drawWrapped(pdf, line, MX, brandY + 2, brandW, 11);
  }

  let metaY = y + 10;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(...teal);
  pdf.text("QUOTATION", PAGE_W - MX, metaY, { align: "right" });
  metaY += 14;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.5);
  pdf.setTextColor(...SOFT);
  pdf.text(forLabel, PAGE_W - MX, metaY, { align: "right" });
  metaY += 12;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  const metaRows = [
    `Date: ${fmtDate(q.date)}`,
    `Valid Till: ${fmtDate(q.validTill)}`,
    q.followUpDate ? `Follow-up: ${fmtDate(q.followUpDate)}` : "",
    `Q No: ${q.quoteNo || "(unsaved)"}`,
    `Prepared by : ${q.preparedBy || "_______________"}`,
  ].filter(Boolean);
  for (const row of metaRows) {
    pdf.text(row, PAGE_W - MX, metaY, { align: "right" });
    metaY += 12;
  }

  y = Math.max(brandY, metaY) + 8;
  pdf.setDrawColor(...teal);
  pdf.setLineWidth(1.4);
  pdf.line(MX, y, PAGE_W - MX, y);
  y += 12;

  drawStamp(pdf, q);

  // —— Parties ——
  y = ensureY(pdf, y, 72);
  const partyGap = 14;
  const partyW = (CONTENT_W - partyGap) / 2;
  const leftX = MX;
  const rightX = MX + partyW + partyGap;

  const cityState =
    [q.customer.city, q.customer.state].filter((x) => String(x ?? "").trim()).join(", ") ||
    (q.customer.state ? `State: ${q.customer.state}` : "");
  const custBody = [
    q.customer.company || "",
    q.customer.address || "",
    cityState,
    q.customer.gstin ? `GSTIN: ${q.customer.gstin}` : "",
  ].filter(Boolean);
  const contactBody = [
    `Phone: ${q.customer.phone || "—"}`,
    `Email: ${q.customer.email || "—"}`,
    `Tax treatment: ${t.interState ? "Inter-state (IGST)" : "Intra-state (CGST+SGST)"}`,
  ];

  const measureParty = (name: string | null, body: string[]) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    let h = 28;
    if (name) {
      h += (pdf.splitTextToSize(name, partyW - 20) as string[]).length * 12 + 2;
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    for (const line of body) {
      if (!line) continue;
      h += (pdf.splitTextToSize(line, partyW - 20) as string[]).length * 11;
    }
    return Math.max(56, h + 8);
  };

  const partyH = Math.max(
    measureParty(q.customer.name || "—", custBody),
    measureParty(null, contactBody),
  );

  const drawPartyBox = (
    x: number,
    title: string,
    name: string | null,
    body: string[],
  ) => {
    pdf.setFillColor(...PAPER);
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.6);
    pdf.roundedRect(x, y, partyW, partyH, 4, 4, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...teal);
    pdf.text(title.toUpperCase(), x + 10, y + 12);
    let py = y + 24;
    if (name) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(...INK);
      const nameLines = pdf.splitTextToSize(name, partyW - 20) as string[];
      pdf.text(nameLines, x + 10, py);
      py += nameLines.length * 12 + 2;
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...SOFT);
    for (const line of body) {
      if (!line) continue;
      const lines = pdf.splitTextToSize(line, partyW - 20) as string[];
      pdf.text(lines, x + 10, py);
      py += lines.length * 11;
    }
  };

  drawPartyBox(leftX, "Customer Details", q.customer.name || "—", custBody);
  drawPartyBox(rightX, "Customer Contact", null, contactBody);
  y += partyH + 12;

  // —— Line items ——
  const itemRows: string[][] = q.items.map((it, i) => {
    const base = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    const gstAmt = (base * (Number(it.gst) || 0)) / 100;
    return [
      String(i + 1),
      it.desc || "",
      String(it.qty ?? ""),
      `₹${money(Number(it.rate) || 0)}`,
      `${it.gst}%`,
      `₹${money(base)}`,
      `₹${money(gstAmt)}`,
      `₹${money(base + gstAmt)}`,
    ];
  });
  if (Number(q.extraCharge.amount)) {
    itemRows.push([
      String(q.items.length + 1),
      q.extraCharge.label || "Additional charge",
      "—",
      `₹${money(Number(q.extraCharge.amount) || 0)}`,
      `${q.extraCharge.gst}%`,
      "—",
      `₹${money(t.exGstAmt)}`,
      `₹${money(t.exTotal)}`,
    ]);
  }

  autoTable(pdf, {
    startY: y,
    head: [
      ["#", "Description", "Qty", "Unit Price", "GST%", "Base Total", "GST Amount", "Total Amount"],
    ],
    body: itemRows.length
      ? itemRows
      : [["—", "No line items", "—", "—", "—", "—", "—", "—"]],
    margin: { left: MX, right: MX, bottom: MY_BOTTOM },
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.3,
      valign: "middle",
    },
    headStyles: {
      fillColor: teal,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
      lineWidth: 0,
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 34, halign: "right" },
      3: { cellWidth: 58, halign: "right" },
      4: { cellWidth: 36, halign: "right" },
      5: { cellWidth: 58, halign: "right" },
      6: { cellWidth: 58, halign: "right" },
      7: { cellWidth: 62, halign: "right" },
    },
    didDrawPage: () => {
      /* footers applied after */
    },
  });
  y = (pdf.lastAutoTable?.finalY ?? y) + 10;

  // —— GST note + totals ——
  y = ensureY(pdf, y, 90);
  const noteW = CONTENT_W * 0.52;
  const totalsW = 200;
  const totalsX = PAGE_W - MX - totalsW;
  const noteH = 58;

  pdf.setFillColor(...PAPER);
  pdf.setDrawColor(...LINE);
  pdf.setLineWidth(0.6);
  pdf.setLineDashPattern([2, 1.5], 0);
  pdf.roundedRect(MX, y, noteW, noteH, 4, 4, "FD");
  pdf.setLineDashPattern([], 0);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...SOFT);
  const notes = [
    "Note: GST/CGST/SGST/IGST, as applicable, shall be charged extra as per prevailing Government regulations.",
    "All pricing are in Indian currency only.",
  ];
  let ny = y + 12;
  for (const n of notes) {
    const lines = pdf.splitTextToSize(`•  ${n}`, noteW - 16) as string[];
    pdf.text(lines, MX + 8, ny);
    ny += lines.length * 10 + 4;
  }

  const taxRows: Array<[string, string]> = [
    ["Subtotal", `₹${money(t.subtotal)}`],
    ["Taxable Value", `₹${money(t.taxable)}`],
    ["Additional Charges", `₹${money(t.exTotal)}`],
  ];
  if (t.interState) {
    taxRows.push([`IGST (${t.igstRate.toFixed(2)}%)`, `₹${money(t.igst)}`]);
  } else {
    taxRows.push(
      [`CGST (${t.cgstRate.toFixed(2)}%)`, `₹${money(t.cgst)}`],
      [`SGST (${t.sgstRate.toFixed(2)}%)`, `₹${money(t.sgst)}`],
    );
  }
  taxRows.push(["Round Off", `₹${money(t.roundOff)}`]);
  taxRows.push(["Grand Total", `₹${money(t.grand)}`]);

  autoTable(pdf, {
    startY: y,
    body: taxRows,
    margin: { left: totalsX, right: MX },
    tableWidth: totalsW,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 3, bottom: 3, left: 6, right: 6 },
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.4,
    },
    columnStyles: {
      0: { cellWidth: totalsW * 0.58 },
      1: { cellWidth: totalsW * 0.42, halign: "right" },
    },
    didParseCell: (data) => {
      if (data.row.index === taxRows.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 10;
        data.cell.styles.fillColor = GRAND_BG;
        data.cell.styles.textColor = teal;
        data.cell.styles.lineWidth = 0.8;
        data.cell.styles.lineColor = teal;
      }
    },
  });
  y = Math.max(y + noteH, pdf.lastAutoTable?.finalY ?? y) + 10;

  // —— Amount in words ——
  y = ensureY(pdf, y, 24);
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(9);
  pdf.setTextColor(...SOFT);
  y = drawWrapped(
    pdf,
    `Amount in words: ${numToWordsIndian(t.grand)}`,
    MX,
    y + 8,
    CONTENT_W,
    11,
  );
  y = drawAmberRule(pdf, y + 6);

  // —— Terms ——
  y = ensureY(pdf, y, 40);
  drawDashedHLine(pdf, MX, PAGE_W - MX, y, LINE);
  y += 12;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...SOFT);
  pdf.text("Terms & Conditions", MX, y);
  y += 12;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  const termLines = (q.notes || "").split("\n");
  for (const line of termLines) {
    y = ensureY(pdf, y, 14);
    y = drawWrapped(pdf, line || " ", MX, y, CONTENT_W, 11);
    y += 1;
  }
  y += 8;

  // —— Thank you / contact ——
  y = ensureY(pdf, y, 48);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.5);
  pdf.setTextColor(...teal);
  pdf.text(`Thank you for your business with ${company.name}!`, PAGE_W / 2, y, {
    align: "center",
  });
  y += 12;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("For any queries, please contact", PAGE_W / 2, y, { align: "center" });
  y += 11;
  if (company.phone) {
    pdf.text(`Phone: ${company.phone}`, PAGE_W / 2, y, { align: "center" });
    y += 11;
  }
  if (company.email) {
    pdf.text(`Email: ${company.email}`, PAGE_W / 2, y, { align: "center" });
    y += 11;
  }
  y += 6;

  // —— Signatory ——
  y = ensureY(pdf, y, 50);
  drawDashedHLine(pdf, MX, PAGE_W - MX, y, LINE);
  y += 14;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...SOFT);
  pdf.text(`Date : ${fmtDateSlash(q.date)}`, MX, y);
  pdf.setFont("helvetica", "bold");
  pdf.text(`For ${company.name}`, PAGE_W - MX, y, { align: "right" });
  y += 12;
  pdf.setFont("helvetica", "normal");
  pdf.text(`Place : ${company.place || "Bengaluru"}`, MX, y);
  y += 18;
  pdf.text("Authorized Signatory", PAGE_W - MX, y, { align: "right" });
  y += 16;

  // —— Footer line on content ——
  y = ensureY(pdf, y, 24);
  pdf.setDrawColor(...LINE);
  pdf.setLineWidth(0.5);
  pdf.line(MX, y, PAGE_W - MX, y);
  y += 12;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(...FOOT_MUTED);
  const foot = [company.name, company.website, "This is a system-generated quotation."]
    .filter(Boolean)
    .join(" · ");
  pdf.text(foot, PAGE_W / 2, y, { align: "center", maxWidth: CONTENT_W });

  // —— Page chrome (continuation + page numbers) ——
  const pagesNeeded = pdf.getNumberOfPages();
  const chromeLabel = `${q.quoteNo || "Unsaved Quotation"}  •  ${fmtDate(q.date)}  •  ${forLabel}`;
  for (let i = 1; i <= pagesNeeded; i++) {
    pdf.setPage(i);
    if (i > 1) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(120, 88, 28);
      pdf.text(`Continued from page ${i - 1}`, PAGE_W / 2, 16, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(110, 105, 95);
      pdf.text(
        `Quotation No: ${q.quoteNo || "(unsaved)"}   •   Date: ${fmtDate(q.date)}   •   Page ${i} of ${pagesNeeded}   •   For: ${forLabel}`,
        PAGE_W / 2,
        26,
        { align: "center", maxWidth: CONTENT_W },
      );
    }
    if (pagesNeeded > 1) {
      pdf.setDrawColor(220, 220, 220);
      pdf.setLineWidth(0.5);
      pdf.line(MX, PAGE_H - MY_BOTTOM + 4, PAGE_W - MX, PAGE_H - MY_BOTTOM + 4);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(90, 87, 80);
      pdf.text(chromeLabel, MX, PAGE_H - MY_BOTTOM + 12, { maxWidth: CONTENT_W * 0.7 });
      pdf.text(`Page ${i} of ${pagesNeeded}`, PAGE_W - MX, PAGE_H - MY_BOTTOM + 12, {
        align: "right",
      });
      if (i < pagesNeeded) {
        pdf.setFont("helvetica", "bolditalic");
        pdf.setFontSize(7);
        pdf.setTextColor(120, 88, 28);
        pdf.text("Continued on next page >>", PAGE_W / 2, PAGE_H - MY_BOTTOM + 19, {
          align: "center",
        });
      }
    }
  }

  const filename = `${sanitizePdfFilename(q.quoteNo || "Quotation")}.pdf`;
  try {
    pdf.setProperties({ title: filename.replace(/\.pdf$/i, "") });
  } catch {
    /* ignore */
  }

  return { pdf, filename };
}

export async function quotationPdfToBase64(
  q: QuotationV1,
  company?: CompanyProfileV1 | null,
): Promise<{
  filename: string;
  pdfBase64: string;
}> {
  const { pdf, filename } = await buildQuotationPdf(q, company);
  const dataUri = pdf.output("datauristring") as string;
  const pdfBase64 = dataUri.includes(",") ? dataUri.split(",")[1]! : dataUri;
  return { filename, pdfBase64 };
}
