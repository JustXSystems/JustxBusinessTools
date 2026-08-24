import type { QuotationV1 } from "./types";
import { fmtDate } from "./compute";
import { typeLabel } from "./catalog";

/** A4 geometry shared by preview guides and PDF slicing. */
export function pdfPageGeometry(node: HTMLElement) {
  const pageWidthPt = 595.28;
  const pageHeightPt = 841.89;
  const marginX = 22;
  const marginTop = 24;
  const marginBottom = 24;
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

const SAFE_BREAK_SELECTOR = [
  ".qgv1-qs-table tr",
  ".qgv1-qs-totals tr",
  ".qgv1-qs-head",
  ".qgv1-qs-parties",
  ".qgv1-qs-totals-wrap",
  ".qgv1-qs-words",
  ".qgv1-qs-notes",
  ".qgv1-qs-callback",
  ".qgv1-qs-bank",
  ".qgv1-sun-rule",
  ".qgv1-qs-foot",
].join(", ");

export function sanitizePdfFilename(str: string) {
  return String(str || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Preview-only guides (excluded from html2canvas via ignoreElements). */
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

function snapToSafeBreak(
  safeBreaks: number[],
  afterY: number,
  rawTarget: number,
  capacity: number,
  canvasHeight: number,
) {
  if (rawTarget >= canvasHeight) return canvasHeight;
  const maxNudge = Math.round(capacity * 0.35);
  let best: number | null = null;
  for (const b of safeBreaks) {
    if (b > afterY && b <= rawTarget && b >= rawTarget - maxNudge) best = b;
  }
  return best ?? rawTarget;
}

/**
 * Capture #quote-sheet and write an A4 PDF with page breaks snapped to block
 * boundaries (table rows / sections) so text and rows are never cut mid-line.
 */
export async function buildQuotationPdf(q: QuotationV1): Promise<{
  pdf: JsPdf;
  filename: string;
}> {
  const node = document.getElementById("quote-sheet");
  if (!node) throw new Error("Preview not ready");

  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  const canvas = await html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    ignoreElements: (el) => Boolean(el.classList?.contains("page-break-marker")),
  });

  const pdf = new jsPDF("p", "pt", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const geo = pdfPageGeometry(node);
  const {
    marginX,
    marginTop,
    marginBottom,
    contentWidthPt: contentWidth,
    usablePageHeightPt: usablePageHeight,
    usablePageHeightContPt: usablePageHeightCont,
    continuationLabelBand,
  } = geo;

  const imgW = contentWidth;
  const ptToCanvasPx = canvas.width / imgW;
  const pxPerPage = Math.floor(usablePageHeight * ptToCanvasPx);
  const pxPerPageCont = Math.floor(usablePageHeightCont * ptToCanvasPx);

  const scale = canvas.width / node.offsetWidth;
  const nodeTop = node.getBoundingClientRect().top;
  const safeBreaks = [0, canvas.height];
  node.querySelectorAll(SAFE_BREAK_SELECTOR).forEach((elm) => {
    const r = elm.getBoundingClientRect();
    safeBreaks.push(Math.round((r.bottom - nodeTop) * scale));
  });
  safeBreaks.sort((a, b) => a - b);

  const slices: Array<{ dataUrl: string; heightPx: number }> = [];
  let sy = 0;
  let pageIdx = 0;
  while (sy < canvas.height - 1) {
    const capacity = pageIdx === 0 ? pxPerPage : pxPerPageCont;
    const rawTarget = Math.min(canvas.height, sy + capacity);
    const sliceEnd = snapToSafeBreak(safeBreaks, sy, rawTarget, capacity, canvas.height);
    const sliceH = Math.max(1, Math.round(sliceEnd - sy));
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceH;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, sy, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    slices.push({ dataUrl: pageCanvas.toDataURL("image/png"), heightPx: sliceH });
    sy = sliceEnd;
    pageIdx++;
  }
  if (slices.length === 0) {
    slices.push({ dataUrl: canvas.toDataURL("image/png"), heightPx: canvas.height });
  }
  const pagesNeeded = slices.length;
  const forLabel = typeLabel(q);

  slices.forEach((slice, i) => {
    if (i > 0) pdf.addPage();

    const contentTopY = i === 0 ? marginTop : marginTop + continuationLabelBand;
    if (i > 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(120, 88, 28);
      pdf.text(`Continued from page ${i}`, pageWidth / 2, marginTop + 11, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(110, 105, 95);
      const headerLine = `Quotation No: ${q.quoteNo || "(unsaved)"}   •   Date: ${fmtDate(q.date)}   •   Page ${i + 1} of ${pagesNeeded}   •   For: ${forLabel}`;
      pdf.text(headerLine, pageWidth / 2, marginTop + 22, { align: "center" });
    }

    const sliceHPt = slice.heightPx / ptToCanvasPx;
    pdf.addImage(slice.dataUrl, "PNG", marginX, contentTopY, imgW, sliceHPt);
  });

  if (pagesNeeded > 1) {
    const label = `${q.quoteNo || "Unsaved Quotation"}  •  ${fmtDate(q.date)}  •  ${forLabel}`;
    for (let i = 1; i <= pagesNeeded; i++) {
      pdf.setPage(i);
      pdf.setDrawColor(220, 220, 220);
      pdf.setLineWidth(0.5);
      pdf.line(marginX, pageHeight - marginBottom + 4, pageWidth - marginX, pageHeight - marginBottom + 4);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(90, 87, 80);
      pdf.text(label, marginX, pageHeight - marginBottom + 12);
      pdf.text(`Page ${i} of ${pagesNeeded}`, pageWidth - marginX, pageHeight - marginBottom + 12, {
        align: "right",
      });
      if (i < pagesNeeded) {
        pdf.setFont("helvetica", "bolditalic");
        pdf.setFontSize(7);
        pdf.setTextColor(120, 88, 28);
        pdf.text("Continued on next page >>", pageWidth / 2, pageHeight - marginBottom + 19, {
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

export async function quotationPdfToBase64(q: QuotationV1): Promise<{
  filename: string;
  pdfBase64: string;
}> {
  const { pdf, filename } = await buildQuotationPdf(q);
  const dataUri = pdf.output("datauristring") as string;
  const pdfBase64 = dataUri.includes(",") ? dataUri.split(",")[1]! : dataUri;
  return { filename, pdfBase64 };
}
