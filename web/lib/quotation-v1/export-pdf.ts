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
const ATOMIC_BLOCK_SELECTOR = [
  ".qgv1-qs-table thead tr",
  ".qgv1-qs-table tbody tr",
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

type AtomicBlock = { top: number; bottom: number };

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

function measureScaleY(node: HTMLElement, canvasHeight: number): number {
  const h = Math.max(
    node.scrollHeight,
    node.offsetHeight,
    Math.ceil(node.getBoundingClientRect().height),
  );
  return canvasHeight / Math.max(1, h);
}

/** Unbreakable vertical ranges (table rows, sections) in the same Y space as the canvas. */
function collectAtomicBlocks(node: HTMLElement, scaleY: number): AtomicBlock[] {
  const sheetTop = node.getBoundingClientRect().top;
  const blocks: AtomicBlock[] = [];
  node.querySelectorAll(ATOMIC_BLOCK_SELECTOR).forEach((elm) => {
    const r = elm.getBoundingClientRect();
    if (r.height < 0.5) return;
    blocks.push({
      top: Math.round((r.top - sheetTop) * scaleY),
      bottom: Math.round((r.bottom - sheetTop) * scaleY),
    });
  });
  return blocks.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
}

/**
 * Pick a slice end that never scissors through a table row / section.
 * If the last line item would be clipped, the whole row moves to the next page.
 */
function pickSliceEnd(
  blocks: AtomicBlock[],
  afterY: number,
  capacity: number,
  canvasHeight: number,
): number {
  const rawTarget = Math.min(canvasHeight, afterY + capacity);
  if (rawTarget >= canvasHeight - 1) return canvasHeight;

  // Allow snapping back most of the page so a nearly-full page can drop one row.
  const minKeep = Math.max(8, Math.round(capacity * 0.12));

  let sliceEnd = rawTarget;

  // If capacity cuts through an atomic block, push that whole block to the next page.
  for (const block of blocks) {
    if (block.bottom <= afterY + 1) continue;
    if (block.top >= sliceEnd) continue;
    const cutsThrough = block.top < sliceEnd && block.bottom > sliceEnd;
    if (!cutsThrough) continue;

    if (block.top > afterY + minKeep) {
      // Row/section not yet started on this page — keep it intact on the next page.
      sliceEnd = block.top;
    }
    // else: block already began on this page and is taller than remaining space
    // (rare oversized row) — leave sliceEnd; unavoidable mid-block split.
  }

  // End exactly after the last fully included block (includes bottom border).
  let bestBottom: number | null = null;
  for (const block of blocks) {
    if (block.bottom > afterY + 1 && block.bottom <= sliceEnd + 1) {
      bestBottom = block.bottom;
    }
  }
  if (bestBottom != null && bestBottom > afterY + minKeep) {
    return Math.min(canvasHeight, bestBottom + 2);
  }

  if (sliceEnd > afterY + minKeep && sliceEnd < rawTarget) {
    return sliceEnd;
  }

  // Last resort: latest complete block bottom at or before rawTarget.
  let latest: number | null = null;
  for (const block of blocks) {
    if (block.bottom > afterY + 1 && block.bottom <= rawTarget) latest = block.bottom;
  }
  if (latest != null && latest > afterY + minKeep) {
    return Math.min(canvasHeight, latest + 2);
  }

  return rawTarget;
}

/** Preview-only guides (excluded from html2canvas via ignoreElements). */
export function renderPageBreakMarkers(node: HTMLElement, q: QuotationV1) {
  node.querySelectorAll(".page-break-marker").forEach((m) => m.remove());
  const geo = pdfPageGeometry(node);
  const totalPx = node.scrollHeight;
  const blocks = collectAtomicBlocks(node, 1);

  const positions: number[] = [];
  let used = 0;
  let pageCap = geo.pageHeightPx;
  while (used + pageCap < totalPx) {
    const sliceEnd = pickSliceEnd(blocks, used, pageCap, totalPx);
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

/** One visual line of one DOM text node, positioned in sheet CSS px. */
type TextRun = {
  text: string;
  topCss: number;
  bottomCss: number;
  leftCss: number;
  widthCss: number;
  fontSizePx: number;
  bold: boolean;
  italic: boolean;
};

/** Decorative overlays (rotated stamp) would cover real text and steal selection. */
const TEXT_LAYER_SKIP_SELECTOR = ".page-break-marker, .qgv1-stamp";

type MeasuredPiece = {
  text: string;
  spaceBefore: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * Measure every word of a text node where the browser actually laid it out.
 * Soft-wrapped paragraphs have no "\n", so lines must come from geometry, not the string.
 */
function measureTextPieces(textNode: Text, range: Range): MeasuredPiece[] {
  const full = textNode.data;
  const pieces: MeasuredPiece[] = [];
  const wordRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(full))) {
    const word = m[0];
    const start = m.index;
    const spaceBefore = start > 0 && /\s/.test(full[start - 1]!);
    range.setStart(textNode, start);
    range.setEnd(textNode, start + word.length);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.1 && r.height > 0.1);
    if (!rects.length) continue;
    if (rects.length === 1) {
      const r = rects[0]!;
      pieces.push({ text: word, spaceBefore, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      continue;
    }
    // Word broken across lines (overflow-wrap) — place each character separately.
    let offset = start;
    let first = true;
    for (const ch of word) {
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset + ch.length);
      offset += ch.length;
      const r = range.getBoundingClientRect();
      if (r.width <= 0.1 || r.height <= 0.1) continue;
      pieces.push({
        text: ch,
        spaceBefore: first && spaceBefore,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      });
      first = false;
    }
  }
  return pieces;
}

function applyTextTransform(text: string, transform: string): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return text;
}

function collectTextRuns(node: HTMLElement): TextRun[] {
  const sheetRect = node.getBoundingClientRect();
  const runs: TextRun[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const textNode = current as Text;
    const parent = textNode.parentElement;
    if (!parent) continue;
    if (!textNode.data.trim()) continue;
    if (parent.closest(TEXT_LAYER_SKIP_SELECTOR)) continue;
    const style = window.getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (Number.parseFloat(style.opacity || "1") === 0) continue;

    const weight = style.fontWeight;
    const bold =
      weight === "bold" || weight === "bolder" || Number.parseInt(weight, 10) >= 600;
    const italic = style.fontStyle === "italic" || style.fontStyle === "oblique";
    const fontSizePx = Number.parseFloat(style.fontSize) || 12;
    const lineTolerance = fontSizePx * 0.5;

    let line: MeasuredPiece | null = null;
    const flush = () => {
      if (!line) return;
      const text = pdfSafeText(applyTextTransform(line.text, style.textTransform));
      if (text.trim()) {
        runs.push({
          text,
          topCss: line.top - sheetRect.top,
          bottomCss: line.bottom - sheetRect.top,
          leftCss: line.left - sheetRect.left,
          widthCss: line.right - line.left,
          fontSizePx,
          bold,
          italic,
        });
      }
      line = null;
    };

    for (const piece of measureTextPieces(textNode, range)) {
      const sameLine: boolean =
        line !== null &&
        Math.abs(piece.top - line.top) < lineTolerance &&
        piece.left >= line.right - lineTolerance;
      if (line && sameLine) {
        line.text += (piece.spaceBefore ? " " : "") + piece.text;
        line.right = Math.max(line.right, piece.right);
        line.top = Math.min(line.top, piece.top);
        line.bottom = Math.max(line.bottom, piece.bottom);
      } else {
        flush();
        line = { ...piece };
      }
    }
    flush();
  }
  return runs;
}

/**
 * Invisible (render mode 3) text over the page image. Each line is stretched with
 * horizontal scaling to the exact on-screen width, so selecting a word highlights that
 * word in the image instead of drifting into its neighbours.
 */
function drawSelectableTextLayer(
  pdf: JsPdf,
  runs: TextRun[],
  opts: {
    sliceTopCss: number;
    sliceBottomCss: number;
    contentTopY: number;
    marginX: number;
    cssPxPerPt: number;
  },
) {
  const { sliceTopCss, sliceBottomCss, contentTopY, marginX, cssPxPerPt } = opts;
  // q/Q so Tz and Tr don't leak into the visible header/footer text drawn later.
  pdf.saveGraphicsState();
  pdf.setTextColor(0, 0, 0);
  for (const run of runs) {
    if (run.bottomCss <= sliceTopCss + 0.5 || run.topCss >= sliceBottomCss - 0.5) continue;
    if (run.topCss < sliceTopCss - 0.5 && run.bottomCss > sliceTopCss + 0.5) continue;
    if (run.topCss < sliceBottomCss - 0.5 && run.bottomCss > sliceBottomCss + 0.5) continue;

    const style =
      run.bold && run.italic
        ? "bolditalic"
        : run.bold
          ? "bold"
          : run.italic
            ? "italic"
            : "normal";
    pdf.setFont("helvetica", style);
    pdf.setFontSize(Math.max(1, run.fontSizePx / cssPxPerPt));

    const targetWidthPt = run.widthCss / cssPxPerPt;
    const naturalWidthPt = pdf.getTextWidth(run.text);
    const horizontalScale =
      naturalWidthPt > 0 && targetWidthPt > 0
        ? Math.min(10, Math.max(0.1, targetWidthPt / naturalWidthPt))
        : 1;

    // Range rects span the font's ascent+descent; the alphabetic baseline sits ~0.22em above the bottom.
    const baselineCss = run.bottomCss - run.fontSizePx * 0.22;
    const yPt = contentTopY + (baselineCss - sliceTopCss) / cssPxPerPt;
    const xPt = marginX + run.leftCss / cssPxPerPt;
    pdf.text(run.text, xPt, yPt, { renderingMode: "invisible", horizontalScale });
  }
  pdf.restoreGraphicsState();
}

/**
 * Capture #quote-sheet for a pixel-perfect visual match to the preview, then
 * overlay an invisible text layer so content stays selectable / searchable.
 * Page slices never cut through a table row — incomplete rows move to the next page.
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
  const { jsPDF } = await import("jspdf");

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

  // Match break Y coords to the actual captured canvas (not offsetWidth alone).
  const scaleY = measureScaleY(node, canvas.height);
  const blocks = collectAtomicBlocks(node, scaleY);

  const slices: Array<{ dataUrl: string; heightPx: number; sy: number }> = [];
  let sy = 0;
  let pageIdx = 0;
  while (sy < canvas.height - 1) {
    const capacity = pageIdx === 0 ? pxPerPage : pxPerPageCont;
    const sliceEnd = pickSliceEnd(blocks, sy, capacity, canvas.height);
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
    const sliceTopCss = slice.sy / scaleY;
    const sliceBottomCss = (slice.sy + slice.heightPx) / scaleY;
    drawSelectableTextLayer(pdf, textRuns, {
      sliceTopCss,
      sliceBottomCss,
      contentTopY,
      marginX,
      cssPxPerPt,
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
