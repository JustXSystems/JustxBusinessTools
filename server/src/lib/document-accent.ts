import { pool } from "../db.js";

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

let ready: Promise<void> | null = null;

export async function ensureDocumentAccentColorColumn(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      try {
        await pool.query(
          `ALTER TABLE business_profiles ADD COLUMN document_accent_color VARCHAR(7) NULL`,
        );
      } catch (err) {
        const e = err as { code?: string; errno?: number };
        if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  await ready;
}
