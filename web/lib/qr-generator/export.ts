import { publicAssetUrl } from "@/lib/base-path";
import { JBT_QR_LOGO_URL } from "@/lib/qr-generator/config";
import { renderQrSvg, renderQrToCanvas, type QrDesign, type QrMatrix } from "@/lib/qr-generator/render";

export const LOGO_MAX_PX = 512;
const JBT_LOGO_PX = 256;

let jbtLogo: Promise<string> | null = null;

/** The JBT mark as a PNG data URL (cached; SVG exports and drafts need an inline image). */
export function loadJbtQrLogo(): Promise<string> {
  jbtLogo ??= fetch(publicAssetUrl(JBT_QR_LOGO_URL))
    .then((res) => {
      if (!res.ok) throw new Error("JBT logo unavailable");
      return res.blob();
    })
    .then((blob) => blobToPngDataUrl(blob, JBT_LOGO_PX))
    .catch((err: unknown) => {
      jbtLogo = null;
      throw err;
    });
  return jbtLogo;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downscales any image blob to a PNG data URL (keeps logos small enough for SVG embeds and config JSON). */
export async function blobToPngDataUrl(blob: Blob, maxPx = LOGO_MAX_PX): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || maxPx;
    const h = img.naturalHeight || maxPx;
    const scale = Math.min(1, maxPx / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("unreadable image"));
    img.src = src;
  });
}

export async function renderPngBlob(
  matrix: QrMatrix,
  design: QrDesign,
  size: number,
  logo: HTMLImageElement | null,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  renderQrToCanvas(canvas, matrix, design, size, logo);
  return canvasToBlob(canvas);
}

export function renderPngDataUrl(
  matrix: QrMatrix,
  design: QrDesign,
  size: number,
  logo: HTMLImageElement | null,
): { dataUrl: string; aspect: number } {
  const canvas = document.createElement("canvas");
  renderQrToCanvas(canvas, matrix, design, size, logo);
  return { dataUrl: canvas.toDataURL("image/png"), aspect: canvas.height / canvas.width };
}

export function svgBlob(matrix: QrMatrix, design: QrDesign, size: number): Blob {
  return new Blob([renderQrSvg(matrix, design, size)], { type: "image/svg+xml" });
}

export async function zipFiles(files: Array<{ name: string; data: Uint8Array }>): Promise<Blob> {
  const { zipSync } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = f.data;
  const zipped = zipSync(entries, { level: 0 });
  return new Blob([zipped.slice().buffer], { type: "application/zip" });
}

export type PdfQrItem = { dataUrl: string; aspect: number; label?: string };

/** A4 poster: optional heading, centred code (≈12 cm), optional footer line. */
export async function buildPosterPdf(item: PdfQrItem, heading: string, footer: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const w = 120;
  const h = w * item.aspect;
  const top = Math.max(40, (pageH - h) / 2 - 10);
  if (heading) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.text(heading, pageW / 2, top - 14, { align: "center", maxWidth: pageW - 30 });
  }
  doc.addImage(item.dataUrl, "PNG", (pageW - w) / 2, top, w, h);
  if (footer) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(110);
    doc.text(footer, pageW / 2, Math.min(pageH - 14, top + h + 14), { align: "center", maxWidth: pageW - 30 });
  }
  return doc.output("blob");
}

/** A4 label sheet (3 × 4 per page) with each item's label under its code. */
export async function buildLabelSheetPdf(items: PdfQrItem[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cols = 3;
  const rows = 4;
  const margin = 10;
  const cellW = (pageW - margin * 2) / cols;
  const cellH = (pageH - margin * 2) / rows;
  const qr = Math.min(cellW - 10, cellH - 16);

  items.forEach((item, i) => {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) doc.addPage();
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = margin + col * cellW;
    const y = margin + row * cellH;
    const h = Math.min(qr * item.aspect, cellH - 12);
    const w = h / item.aspect;
    doc.setDrawColor(220);
    doc.setLineDashPattern([1, 1.5], 0);
    doc.rect(x + 1, y + 1, cellW - 2, cellH - 2);
    doc.addImage(item.dataUrl, "PNG", x + (cellW - w) / 2, y + 4, w, h);
    if (item.label) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(60);
      doc.text(item.label, x + cellW / 2, y + 4 + h + 5, { align: "center", maxWidth: cellW - 6 });
    }
  });
  return doc.output("blob");
}

/** Decodes the rendered canvas with jsQR — proves the styled code is actually scannable. */
export async function verifyCanvasDecodes(canvas: HTMLCanvasElement, expected: string): Promise<boolean> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width === 0) return false;
  const jsQR = (await import("jsqr")).default;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
  if (!code) return false;
  // jsQR's byte-mode text decoding can differ from UTF-8 for non-ASCII content; a decode is enough there.
  return code.data === expected || /[^\x00-\x7f]/.test(expected);
}
