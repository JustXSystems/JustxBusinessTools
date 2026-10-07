import { pool } from "../db.js";

/** Quotation V1 "For" (engagement) keys; mirrors ENGAGEMENTS in web/lib/quotation-v1/catalog.ts. */
export const QUOTE_TERMS_KEYS = ["epc", "amc", "srv", "setup", "sale", "pm", "stin", "gsr", "misc"] as const;

export type QuoteTermsKey = (typeof QUOTE_TERMS_KEYS)[number];
export type QuoteTerms = Partial<Record<QuoteTermsKey, string>>;

const MAX_TERMS_CHARS = 20_000;

let ready: Promise<void> | null = null;

async function addColumnIfMissing(sql: string): Promise<void> {
  try {
    await pool.query(sql);
  } catch (err) {
    const e = err as { code?: string; errno?: number };
    if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
  }
}

/** Ensures `business_profiles.quote_terms` (and the legacy AMC-only `amc_terms`). */
export function ensureQuoteTermsColumns(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await addColumnIfMissing(`ALTER TABLE business_profiles ADD COLUMN amc_terms TEXT NULL`);
      await addColumnIfMissing(`ALTER TABLE business_profiles ADD COLUMN quote_terms JSON NULL`);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Keeps known "For" keys with non-blank text; accepts a JSON string or object. */
export function normalizeQuoteTerms(raw: unknown): QuoteTerms {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const src = obj as Record<string, unknown>;
  const out: QuoteTerms = {};
  for (const key of QUOTE_TERMS_KEYS) {
    const value = src[key];
    if (typeof value !== "string" || !value.trim()) continue;
    out[key] = value.slice(0, MAX_TERMS_CHARS);
  }
  return out;
}

/** Column value for `quote_terms`: JSON text, or null when nothing is customised. */
export function serializeQuoteTerms(raw: unknown): string | null {
  const terms = normalizeQuoteTerms(raw);
  return Object.keys(terms).length ? JSON.stringify(terms) : null;
}
