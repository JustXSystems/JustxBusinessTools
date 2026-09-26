import QRCode from "qrcode";

export type QrEcl = "M" | "Q" | "H";
export type QrModuleStyle = "square" | "rounded" | "dots";
export type QrEyeStyle = "square" | "rounded" | "circle";

export type QrDesign = {
  fg: string;
  bg: string;
  /** Finder-pattern ("eye") colour; empty = same as fg. */
  eyeColor: string;
  ecl: QrEcl;
  /** Quiet zone in modules. Spec asks for 4; 2 is the practical minimum. */
  margin: number;
  moduleStyle: QrModuleStyle;
  eyeStyle: QrEyeStyle;
  caption: string;
  logoDataUrl: string | null;
  /** Logo width as a fraction of the symbol width (without quiet zone). */
  logoScale: number;
};

export const DEFAULT_QR_DESIGN: QrDesign = {
  fg: "#000000",
  bg: "#ffffff",
  eyeColor: "",
  ecl: "H",
  margin: 4,
  moduleStyle: "square",
  eyeStyle: "square",
  caption: "",
  logoDataUrl: null,
  logoScale: 0.22,
};

export const LOGO_SCALE_MIN = 0.14;
export const LOGO_SCALE_MAX = 0.28;
export const CAPTION_MAX = 40;

export type QrMatrix = {
  size: number;
  version: number;
  ecl: QrEcl;
  isDark: (row: number, col: number) => boolean;
};

export class QrCapacityError extends Error {
  constructor() {
    super("Too much content for one QR code.");
    this.name = "QrCapacityError";
  }
}

export function createQrMatrix(payload: string, ecl: QrEcl): QrMatrix {
  try {
    const qr = QRCode.create(payload, { errorCorrectionLevel: ecl });
    const { size, data } = qr.modules;
    return {
      size,
      version: qr.version,
      ecl,
      isDark: (row, col) => data[row * size + col] === 1,
    };
  } catch (err) {
    if (err instanceof Error && /too big|amount of data/i.test(err.message)) {
      throw new QrCapacityError();
    }
    throw err;
  }
}

type Fill = "fg" | "bg" | "eye";

type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; r: number; fill: Fill }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: Fill };

export type QrLayout = {
  /** All geometry is in module units. */
  width: number;
  height: number;
  shapes: Shape[];
  logo: { x: number; y: number; size: number } | null;
  caption: { text: string; x: number; y: number; fontSize: number } | null;
};

const EYE_SIZE = 7;

function eyeOrigins(size: number, margin: number): Array<[number, number]> {
  const far = margin + size - EYE_SIZE;
  return [
    [margin, margin],
    [far, margin],
    [margin, far],
  ];
}

function inEye(row: number, col: number, size: number): boolean {
  const far = size - EYE_SIZE;
  return (
    (row < EYE_SIZE && col < EYE_SIZE) ||
    (row < EYE_SIZE && col >= far) ||
    (row >= far && col < EYE_SIZE)
  );
}

function eyeShapes(x: number, y: number, style: QrEyeStyle): Shape[] {
  if (style === "circle") {
    const c = EYE_SIZE / 2;
    return [
      { kind: "circle", cx: x + c, cy: y + c, r: 3.5, fill: "eye" },
      { kind: "circle", cx: x + c, cy: y + c, r: 2.5, fill: "bg" },
      { kind: "circle", cx: x + c, cy: y + c, r: 1.5, fill: "eye" },
    ];
  }
  const [r1, r2, r3] = style === "rounded" ? [2, 1.3, 0.9] : [0, 0, 0];
  return [
    { kind: "rect", x, y, w: 7, h: 7, r: r1, fill: "eye" },
    { kind: "rect", x: x + 1, y: y + 1, w: 5, h: 5, r: r2, fill: "bg" },
    { kind: "rect", x: x + 2, y: y + 2, w: 3, h: 3, r: r3, fill: "eye" },
  ];
}

export function layoutQr(matrix: QrMatrix, design: QrDesign): QrLayout {
  const { size } = matrix;
  const margin = Math.max(0, Math.round(design.margin));
  const width = size + margin * 2;

  let logo: QrLayout["logo"] = null;
  let clear: { x0: number; y0: number; x1: number; y1: number } | null = null;
  if (design.logoDataUrl) {
    const scale = Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, design.logoScale));
    const logoSize = size * scale;
    const center = margin + size / 2;
    logo = { x: center - logoSize / 2, y: center - logoSize / 2, size: logoSize };
    const pad = 0.6;
    clear = {
      x0: logo.x - pad,
      y0: logo.y - pad,
      x1: logo.x + logoSize + pad,
      y1: logo.y + logoSize + pad,
    };
  }
  const cleared = (row: number, col: number) =>
    clear != null &&
    margin + col + 1 > clear.x0 &&
    margin + col < clear.x1 &&
    margin + row + 1 > clear.y0 &&
    margin + row < clear.y1;

  const text = design.caption.trim().slice(0, CAPTION_MAX);
  let caption: QrLayout["caption"] = null;
  let height = width;
  if (text) {
    const fontSize = Math.max(1.6, Math.min(width * 0.075, (width * 0.9) / (text.length * 0.6)));
    const gap = margin > 0 ? Math.max(0.5, margin * 0.4) : 1;
    const top = margin + size + gap;
    caption = { text, x: width / 2, y: top + fontSize * 0.8, fontSize };
    height = top + fontSize * 1.6 + Math.max(1, margin * 0.5);
  }

  const shapes: Shape[] = [{ kind: "rect", x: 0, y: 0, w: width, h: height, r: 0, fill: "bg" }];

  for (let row = 0; row < size; row++) {
    if (design.moduleStyle === "square") {
      let col = 0;
      while (col < size) {
        if (!matrix.isDark(row, col) || inEye(row, col, size) || cleared(row, col)) {
          col++;
          continue;
        }
        const start = col;
        while (col < size && matrix.isDark(row, col) && !inEye(row, col, size) && !cleared(row, col)) col++;
        shapes.push({ kind: "rect", x: margin + start, y: margin + row, w: col - start, h: 1, r: 0, fill: "fg" });
      }
      continue;
    }
    for (let col = 0; col < size; col++) {
      if (!matrix.isDark(row, col) || inEye(row, col, size) || cleared(row, col)) continue;
      const x = margin + col;
      const y = margin + row;
      shapes.push(
        design.moduleStyle === "dots"
          ? { kind: "circle", cx: x + 0.5, cy: y + 0.5, r: 0.45, fill: "fg" }
          : { kind: "rect", x: x + 0.04, y: y + 0.04, w: 0.92, h: 0.92, r: 0.32, fill: "fg" },
      );
    }
  }

  for (const [x, y] of eyeOrigins(size, margin)) {
    shapes.push(...eyeShapes(x, y, design.eyeStyle));
  }

  if (logo) {
    shapes.push({ kind: "rect", x: logo.x - 0.5, y: logo.y - 0.5, w: logo.size + 1, h: logo.size + 1, r: 1, fill: "bg" });
  }

  return { width, height, shapes, logo, caption };
}

function fillColor(fill: Fill, design: QrDesign): string {
  if (fill === "bg") return design.bg;
  if (fill === "eye") return design.eyeColor || design.fg;
  return design.fg;
}

const CAPTION_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Draws onto `canvas`, sized so the longer edge is ~`pixelWidth`.
 * `logo` must already be loaded when `design.logoDataUrl` is set.
 */
export function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  matrix: QrMatrix,
  design: QrDesign,
  pixelWidth: number,
  logo?: HTMLImageElement | null,
): void {
  const layout = layoutQr(matrix, design);
  const unit = pixelWidth / layout.width;
  canvas.width = Math.round(layout.width * unit);
  canvas.height = Math.round(layout.height * unit);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const px = (v: number) => Math.round(v * unit);

  for (const s of layout.shapes) {
    ctx.fillStyle = fillColor(s.fill, design);
    if (s.kind === "circle") {
      ctx.beginPath();
      ctx.arc(s.cx * unit, s.cy * unit, s.r * unit, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.r > 0 && typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(s.x * unit, s.y * unit, s.w * unit, s.h * unit, s.r * unit);
      ctx.fill();
    } else {
      // Snap to whole pixels so adjacent rows don't show hairline seams.
      const x0 = px(s.x);
      const y0 = px(s.y);
      ctx.fillRect(x0, y0, px(s.x + s.w) - x0, px(s.y + s.h) - y0);
    }
  }

  if (layout.logo && logo && logo.naturalWidth > 0) {
    const { x, y, size } = layout.logo;
    const ratio = logo.naturalWidth / logo.naturalHeight;
    const w = ratio >= 1 ? size : size * ratio;
    const h = ratio >= 1 ? size / ratio : size;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logo, (x + (size - w) / 2) * unit, (y + (size - h) / 2) * unit, w * unit, h * unit);
  }

  if (layout.caption) {
    const { text, x, y, fontSize } = layout.caption;
    ctx.fillStyle = design.eyeColor || design.fg;
    ctx.font = `700 ${fontSize * unit}px ${CAPTION_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x * unit, y * unit + (fontSize * unit) * 0.2, layout.width * 0.94 * unit);
  }
}

function num(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderQrSvg(matrix: QrMatrix, design: QrDesign, pixelWidth: number): string {
  const layout = layoutQr(matrix, design);
  const scale = pixelWidth / layout.width;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(layout.width * scale)}" height="${Math.round(layout.height * scale)}" viewBox="0 0 ${num(layout.width)} ${num(layout.height)}">`,
  ];

  const runs: string[] = [];
  for (const s of layout.shapes) {
    const fill = escapeXml(fillColor(s.fill, design));
    if (s.kind === "circle") {
      out.push(`<circle cx="${num(s.cx)}" cy="${num(s.cy)}" r="${num(s.r)}" fill="${fill}"/>`);
    } else if (s.r > 0 || s.fill !== "fg") {
      const rx = s.r > 0 ? ` rx="${num(s.r)}"` : "";
      out.push(`<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}"${rx} fill="${fill}"/>`);
    } else {
      runs.push(`M${num(s.x)} ${num(s.y)}h${num(s.w)}v${num(s.h)}h-${num(s.w)}z`);
    }
  }
  if (runs.length) {
    // Square modules merged into one path; inserted right after the background.
    out.splice(2, 0, `<path fill="${escapeXml(design.fg)}" shape-rendering="crispEdges" d="${runs.join("")}"/>`);
  }

  if (layout.logo && design.logoDataUrl) {
    const { x, y, size } = layout.logo;
    const href = escapeXml(design.logoDataUrl);
    out.push(
      `<image x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" preserveAspectRatio="xMidYMid meet" href="${href}" xlink:href="${href}"/>`,
    );
  }

  if (layout.caption) {
    const { text, x, y, fontSize } = layout.caption;
    out.push(
      `<text x="${num(x)}" y="${num(y + fontSize * 0.2)}" text-anchor="middle" font-family="${escapeXml(CAPTION_FONT)}" font-size="${num(fontSize)}" font-weight="700" fill="${escapeXml(design.eyeColor || design.fg)}">${escapeXml(text)}</text>`,
    );
  }

  out.push("</svg>");
  return out.join("");
}

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

export function relativeLuminance(hex: string): number {
  const h = normalizeHex(hex) ?? "#000000";
  return 0.2126 * channel(h, 0) + 0.7152 * channel(h, 1) + 0.0722 * channel(h, 2);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Human-readable scan-risk warnings for a colour combination. */
export function designWarnings(design: QrDesign): string[] {
  const warnings: string[] = [];
  const dark = [design.fg, design.eyeColor || design.fg];
  if (dark.some((c) => relativeLuminance(c) > relativeLuminance(design.bg))) {
    warnings.push("Light code on a dark background (inverted) — many scanner apps can't read these.");
  }
  const worst = Math.min(...dark.map((c) => contrastRatio(c, design.bg)));
  if (worst < 4) {
    warnings.push("Low contrast between code and background — use a darker code colour.");
  }
  if (design.margin < 2) {
    warnings.push("Quiet zone is very small — leave at least 2 modules of blank border.");
  }
  return warnings;
}
