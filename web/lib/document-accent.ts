/** Document / PDF letterhead accent — Business Profile setting for all tools. */

export const DEFAULT_DOCUMENT_ACCENT_COLOR = "#0f3d3e";

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalize to `#rrggbb` or fall back to the quotation default teal. */
export function normalizeDocumentAccentColor(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const m = s.match(HEX_RE);
  if (!m) return DEFAULT_DOCUMENT_ACCENT_COLOR;
  const body = m[1];
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return `#${full.toLowerCase()}`;
}

export function hexToRgbTuple(hex: string): [number, number, number] | null {
  const normalized = normalizeDocumentAccentColor(hex);
  const n = Number.parseInt(normalized.slice(1), 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function mixToward(
  rgb: [number, number, number],
  target: [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    clampByte(rgb[0] + (target[0] - rgb[0]) * amount),
    clampByte(rgb[1] + (target[1] - rgb[1]) * amount),
    clampByte(rgb[2] + (target[2] - rgb[2]) * amount),
  ];
}

/** CSS vars for quote-sheet (`--q-teal-800`) and generic document previews. */
export function documentAccentCssVars(raw: unknown): Record<string, string> {
  const accent = normalizeDocumentAccentColor(raw);
  const rgb = hexToRgbTuple(accent) ?? [15, 61, 62];
  const soft = mixToward(rgb, [255, 255, 255], 0.92);
  return {
    "--q-teal-800": accent,
    "--doc-accent": accent,
    "--doc-accent-rgb": `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`,
    "--doc-accent-soft": `rgb(${soft[0]}, ${soft[1]}, ${soft[2]})`,
  };
}

/** jsPDF palette derived from the Business Profile document accent. */
export function documentAccentPdfPalette(raw: unknown) {
  const accent = normalizeDocumentAccentColor(raw);
  const deep = hexToRgbTuple(accent) ?? [15, 61, 62];
  const head = mixToward(deep, [255, 255, 255], 0.22);
  const mid = mixToward(deep, [255, 255, 255], 0.12);
  const soft = mixToward(deep, [255, 255, 255], 0.92);
  return {
    accent,
    teal: mid,
    tealDeep: deep,
    tealHead: head,
    softTeal: soft,
  };
}
