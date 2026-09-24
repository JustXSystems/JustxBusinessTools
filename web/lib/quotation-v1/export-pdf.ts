import type { CompanyProfileV1, QuotationV1 } from "./types";
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

/** Prefer page breaks after these blocks (never mid-row / mid-section). */
const SAFE_BREAK_SELECTOR = [
  ".qgv1-qs-table tr",
  ".qgv1-qs-totals tr",
  ".qgv1-qs-head",
  ".qgv1-qs-parties",
  ".qgv1-qs-party",
  ".qgv1-qs-totals-wrap",
  ".qgv1-qs-words",
  ".qgv1-qs-notes",
  ".qgv1-qs-callback",
  ".qgv1-qs-bank",
  ".qgv1-sun-rule",
  ".qgv1-qs-foot",
  ".qgv1-qs-gst-note li",
  ".qgv1-qs-notes br",
].join(", ");

/**
 * JPEG keeps print-sharp look at far smaller size than PNG page rasters.
 * Quality 0.92 is visually identical to the preview for document pages.
 */
const PDF_PAGE_JPEG_QUALITY = 0.92;

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
  const textRuns = collectTextRuns(node);
  // CSS-px safe breaks (scale=1) so preview guides match PDF slice logic.
  const safeBreaksCss = collectSafeBreakCanvasYs(node, 1, totalPx, textRuns);

  const positions: number[] = [];
  let used = 0;
  let pageCap = geo.pageHeightPx;
  while (used + pageCap < totalPx) {
    const sliceEnd = pickSliceEnd(safeBreaksCss, used, pageCap, totalPx, textRuns, 1);
    if (sliceEnd <= used + 1) break;
    positions.push(sliceEnd);
    used = sliceEnd;
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

/**
 * Helvetica / WinAnsi cannot encode ₹ (U+20B9) — it becomes superscript ¹.
 * Map other common Unicode to safe equivalents for the selectable text layer.
 * The visible page is still the html2canvas image (exact preview, including ₹).
 */
function pdfSafeText(raw: string): string {
  return String(raw || "")
    .replace(/\u20B9/g, "Rs.")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2022/g, "*")
    .replace(/\u00A0/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

type TextRun = {
  text: string;
  /** Y of text top relative to sheet, in CSS px. */
  topCss: number;
  /** Y of text bottom relative to sheet, in CSS px. */
  bottomCss: number;
  /** X of text left relative to sheet, in CSS px. */
  leftCss: number;
  fontSizePx: number;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  widthCss: number;
};

function collectTextRuns(node: HTMLElement): TextRun[] {
  const sheetRect = node.getBoundingClientRect();
  const runs: TextRun[] = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const parent = current.parentElement;
    if (!parent) continue;
    if (parent.closest(".page-break-marker")) continue;
    const style = window.getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (Number.parseFloat(style.opacity || "1") === 0) continue;

    const range = document.createRange();
    range.selectNodeContents(current);
    const rects = Array.from(range.getClientRects());
    if (!rects.length) continue;

    const weight = style.fontWeight;
    const bold =
      weight === "bold" || weight === "bolder" || Number.parseInt(weight, 10) >= 600;
    const italic = style.fontStyle === "italic" || style.fontStyle === "oblique";
    const fontSizePx = Number.parseFloat(style.fontSize) || 12;
    const alignRaw = style.textAlign;
    const align: TextRun["align"] =
      alignRaw === "center" || alignRaw === "right" ? alignRaw : "left";

    const full = String(current.textContent || "").replace(/\r\n/g, "\n");
    if (!full.replace(/\s+/g, "")) continue;

    if (rects.length === 1) {
      const r = rects[0]!;
      const text = pdfSafeText(full.replace(/\s+/g, " ").trim());
      if (!text) continue;
      runs.push({
        text,
        topCss: r.top - sheetRect.top,
        bottomCss: r.bottom - sheetRect.top,
        leftCss: r.left - sheetRect.left,
        fontSizePx,
        bold,
        italic,
        align,
        widthCss: r.width,
      });
      continue;
    }

    const lines = full.split("\n").flatMap((ln) => {
      const t = ln.replace(/\s+/g, " ").trim();
      return t ? [t] : [];
    });
    const usableRects = rects.filter((r) => r.width > 0.5 && r.height > 0.5);
    const count = Math.min(lines.length, usableRects.length) || usableRects.length;
    for (let i = 0; i < count; i++) {
      const r = usableRects[i]!;
      const text = pdfSafeText(lines[i] ?? lines[lines.length - 1] ?? "");
      if (!text) continue;
      runs.push({
        text,
        topCss: r.top - sheetRect.top,
        bottomCss: r.bottom - sheetRect.top,
        leftCss: r.left - sheetRect.left,
        fontSizePx,
        bold,
        italic,
        align,
        widthCss: r.width,
      });
    }
  }
  return runs;
}

/**
 * Collect Y positions (canvas px) where a page break is safe — after a row/section,
 * never through the middle of a line of text.
 */
function collectSafeBreakCanvasYs(
  node: HTMLElement,
  canvasScale: number,
  canvasHeight: number,
  textRuns: TextRun[],
): number[] {
  const nodeTop = node.getBoundingClientRect().top;
  const breaks = new Set<number>([0, canvasHeight]);

  node.querySelectorAll(SAFE_BREAK_SELECTOR).forEach((elm) => {
    const r = elm.getBoundingClientRect();
    if (r.height < 1) return;
    // Break after the block (preferred).
    breaks.add(Math.round((r.bottom - nodeTop) * canvasScale));
    // Also allow break just before the next block starts.
    breaks.add(Math.round((r.top - nodeTop) * canvasScale));
  });

  // After every painted text line — never slice through a glyph row.
  for (const run of textRuns) {
    breaks.add(Math.round(run.bottomCss * canvasScale));
    breaks.add(Math.max(0, Math.round(run.topCss * canvasScale) - 1));
  }

  return Array.from(breaks)
    .filter((y) => y >= 0 && y <= canvasHeight)
    .sort((a, b) => a - b);
}

/**
 * Pick a slice end that fits the page capacity without a horizontal "scissors"
 * cut through a text line or table row.
 */
function pickSliceEnd(
  safeBreaks: number[],
  afterY: number,
  capacity: number,
  canvasHeight: number,
  textRuns: TextRun[],
  canvasScale: number,
): number {
  const rawTarget = Math.min(canvasHeight, afterY + capacity);
  if (rawTarget >= canvasHeight - 1) return canvasHeight;

  const minAdvance = Math.max(24, Math.round(capacity * 0.35));
  const earliest = afterY + minAdvance;
  const maxNudge = Math.round(capacity * 0.45);

  // 1) Prefer the latest safe break at or before rawTarget within the nudge window.
  let best: number | null = null;
  for (const b of safeBreaks) {
    if (b <= afterY + 1) continue;
    if (b > rawTarget) break;
    if (b < rawTarget - maxNudge && b < earliest) continue;
    if (b >= earliest && b <= rawTarget) best = b;
  }
  if (best != null) return best;

  // 2) If rawTarget would cut through a text run, snap to just before that run.
  let sliceEnd = rawTarget;
  for (const run of textRuns) {
    const top = run.topCss * canvasScale;
    const bottom = run.bottomCss * canvasScale;
    if (top >= sliceEnd || bottom <= afterY + 1) continue;
    if (top < sliceEnd && bottom > sliceEnd) {
      // Mid-line cut — move break to before this line (if we still advance enough).
      const candidate = Math.floor(top) - 1;
      if (candidate > afterY + minAdvance * 0.5) {
        sliceEnd = candidate;
      }
    }
  }

  // 3) Fall back to nearest safe break at or before sliceEnd.
  let nearest: number | null = null;
  for (const b of safeBreaks) {
    if (b > afterY + 1 && b <= sliceEnd) nearest = b;
  }
  if (nearest != null && nearest >= afterY + minAdvance * 0.5) return nearest;

  return Math.max(afterY + 1, Math.min(canvasHeight, sliceEnd));
}

function beginInvisibleText(pdf: JsPdf, GStateCtor?: new (opts: { opacity: number }) => unknown) {
  const anyPdf = pdf as JsPdf & {
    setTextRenderingMode?: (mode: number) => void;
    setGState?: (state: unknown) => void;
    internal?: { write: (s: string) => void };
  };
  if (GStateCtor && typeof anyPdf.setGState === "function") {
    try {
      anyPdf.setGState(new GStateCtor({ opacity: 0 }));
    } catch {
      /* ignore */
    }
  }
  if (typeof anyPdf.setTextRenderingMode === "function") {
    anyPdf.setTextRenderingMode(3);
  } else {
    try {
      anyPdf.internal?.write("3 Tr");
    } catch {
      /* ignore */
    }
  }
}

function endInvisibleText(pdf: JsPdf, GStateCtor?: new (opts: { opacity: number }) => unknown) {
  const anyPdf = pdf as JsPdf & {
    setTextRenderingMode?: (mode: number) => void;
    setGState?: (state: unknown) => void;
    internal?: { write: (s: string) => void };
  };
  if (typeof anyPdf.setTextRenderingMode === "function") {
    anyPdf.setTextRenderingMode(0);
  } else {
    try {
      anyPdf.internal?.write("0 Tr");
    } catch {
      /* ignore */
    }
  }
  if (GStateCtor && typeof anyPdf.setGState === "function") {
    try {
      anyPdf.setGState(new GStateCtor({ opacity: 1 }));
    } catch {
      /* ignore */
    }
  }
}

function drawSelectableTextLayer(
  pdf: JsPdf,
  runs: TextRun[],
  opts: {
    sliceTopCss: number;
    sliceBottomCss: number;
    contentTopY: number;
    marginX: number;
    cssPxPerPt: number;
    GStateCtor?: new (opts: { opacity: number }) => unknown;
  },
) {
  const { sliceTopCss, sliceBottomCss, contentTopY, marginX, cssPxPerPt, GStateCtor } = opts;
  beginInvisibleText(pdf, GStateCtor);
  pdf.setTextColor(0, 0, 0);
  for (const run of runs) {
    if (run.bottomCss <= sliceTopCss + 0.5 || run.topCss >= sliceBottomCss - 0.5) continue;
    // Skip runs that would be clipped mid-glyph on this slice (defensive).
    if (run.topCss < sliceTopCss - 0.5 && run.bottomCss > sliceTopCss + 0.5) continue;
    if (run.topCss < sliceBottomCss - 0.5 && run.bottomCss > sliceBottomCss + 0.5) continue;

    const fontPt = Math.max(5, run.fontSizePx / cssPxPerPt);
    const style =
      run.bold && run.italic
        ? "bolditalic"
        : run.bold
          ? "bold"
          : run.italic
            ? "italic"
            : "normal";
    pdf.setFont("helvetica", style);
    pdf.setFontSize(fontPt);
    const baselineCss = run.topCss + run.fontSizePx * 0.8;
    const yPt = contentTopY + (baselineCss - sliceTopCss) / cssPxPerPt;
    const xLeft = marginX + run.leftCss / cssPxPerPt;
    if (run.align === "center") {
      pdf.text(run.text, xLeft + run.widthCss / cssPxPerPt / 2, yPt, { align: "center" });
    } else if (run.align === "right") {
      pdf.text(run.text, xLeft + run.widthCss / cssPxPerPt, yPt, { align: "right" });
    } else {
      pdf.text(run.text, xLeft, yPt);
    }
  }
  endInvisibleText(pdf, GStateCtor);
}

/**
 * Capture #quote-sheet for a pixel-perfect visual match to the preview, then
 * overlay an invisible text layer so content stays selectable / searchable.
 * Page slices snap to row/section and text-line boundaries (no mid-line cuts).
 */
export async function buildQuotationPdf(
  q: QuotationV1,
  _company?: CompanyProfileV1 | null,
): Promise<{
  pdf: JsPdf;
  filename: string;
}> {
  const node = document.getElementById("quote-sheet");
  if (!node) throw new Error("Preview not ready");

  const html2canvas = (await import("html2canvas")).default;
  const jspdfMod = await import("jspdf");
  const { jsPDF } = jspdfMod;
  const GStateCtor = (jspdfMod as { GState?: new (opts: { opacity: number }) => unknown }).GState;

  const textRuns = collectTextRuns(node);

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
    cssPxPerPt,
  } = geo;

  const imgW = contentWidth;
  const ptToCanvasPx = canvas.width / imgW;
  const pxPerPage = Math.floor(usablePageHeight * ptToCanvasPx);
  const pxPerPageCont = Math.floor(usablePageHeightCont * ptToCanvasPx);

  const canvasScale = canvas.width / node.offsetWidth;
  const safeBreaks = collectSafeBreakCanvasYs(node, canvasScale, canvas.height, textRuns);

  const slices: Array<{ dataUrl: string; heightPx: number; sy: number }> = [];
  let sy = 0;
  let pageIdx = 0;
  while (sy < canvas.height - 1) {
    const capacity = pageIdx === 0 ? pxPerPage : pxPerPageCont;
    const sliceEnd = pickSliceEnd(safeBreaks, sy, capacity, canvas.height, textRuns, canvasScale);
    const sliceH = Math.max(1, Math.round(sliceEnd - sy));
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceH;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, sy, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    slices.push({
      dataUrl: pageCanvas.toDataURL("image/jpeg", PDF_PAGE_JPEG_QUALITY),
      heightPx: sliceH,
      sy,
    });
    sy = sliceEnd;
    pageIdx++;
    // Guard against pathological zero-advance loops.
    if (sliceH < 2 && sy < canvas.height - 1) {
      sy = Math.min(canvas.height, sy + Math.max(1, Math.floor(capacity * 0.5)));
    }
  }
  if (slices.length === 0) {
    slices.push({
      dataUrl: canvas.toDataURL("image/jpeg", PDF_PAGE_JPEG_QUALITY),
      heightPx: canvas.height,
      sy: 0,
    });
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
      pdf.text(pdfSafeText(headerLine), pageWidth / 2, marginTop + 22, { align: "center" });
    }

    const sliceHPt = slice.heightPx / ptToCanvasPx;
    pdf.addImage(slice.dataUrl, "JPEG", marginX, contentTopY, imgW, sliceHPt, undefined, "MEDIUM");

    // Invisible selectable text on top — look stays the screenshot (exact preview).
    const sliceTopCss = slice.sy / canvasScale;
    const sliceBottomCss = (slice.sy + slice.heightPx) / canvasScale;
    drawSelectableTextLayer(pdf, textRuns, {
      sliceTopCss,
      sliceBottomCss,
      contentTopY,
      marginX,
      cssPxPerPt,
      GStateCtor,
    });
  });

  if (pagesNeeded > 1) {
    const label = pdfSafeText(
      `${q.quoteNo || "Unsaved Quotation"}  •  ${fmtDate(q.date)}  •  ${forLabel}`,
    );
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
