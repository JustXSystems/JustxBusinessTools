import type { QuoteCustomer, QuotationV1 } from "./types";
import { blankCustomer } from "./draft";

export const CUSTOMER_SUGGEST_MIN_CHARS = 3;
export const CUSTOMER_SUGGEST_LIMIT = 12;

export type SuggestedCustomer = QuoteCustomer & {
  /** Stable key for list rendering / dedupe. */
  key: string;
  /** Most recent quotation id this customer was taken from. */
  sourceQuoteId: string;
};

function digitsOnly(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Collapse Indian / intl formatting so 91XXXXXXXXXX and 0XXXXXXXXXX match. */
function normalizePhone(raw: string): string {
  let d = digitsOnly(raw);
  if (!d) return "";
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length > 10) d = d.slice(-10);
  return d.length >= 8 ? d : "";
}

function normalizeName(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function customerIdentityKeys(c: QuoteCustomer): string[] {
  const keys: string[] = [];
  const phone = normalizePhone(c.phone);
  if (phone) keys.push(`p:${phone}`);
  const name = normalizeName(c.name);
  if (name) keys.push(`n:${name}`);
  const gstin = String(c.gstin ?? "").trim().toUpperCase();
  if (gstin.length >= 10) keys.push(`g:${gstin}`);
  const email = String(c.email ?? "").trim().toLowerCase();
  if (email.includes("@")) keys.push(`e:${email}`);
  return keys;
}

function quoteRecency(q: QuotationV1): number {
  const raw = q.updatedAt || q.createdAt || "";
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Unique customers from saved quotations (most recent fields win).
 * Merges rows that share phone, normalized name, GSTIN, or email so the
 * suggest list never shows the same party twice.
 */
export function uniqueCustomersFromQuotations(list: QuotationV1[]): SuggestedCustomer[] {
  type Row = SuggestedCustomer & { ts: number };
  const byKey = new Map<string, Row>();
  /** Maps any identity key → canonical row key currently stored in byKey. */
  const aliasToCanonical = new Map<string, string>();

  function resolveCanonical(keys: string[]): string | null {
    for (const k of keys) {
      const c = aliasToCanonical.get(k);
      if (c) return c;
    }
    return null;
  }

  for (const q of list) {
    const c = q.customer;
    if (!c) continue;
    const name = String(c.name ?? "").trim();
    if (!name) continue;
    const keys = customerIdentityKeys(c);
    if (!keys.length) continue;

    const ts = quoteRecency(q);
    const existingCanonical = resolveCanonical(keys);

    const row: Row = {
      key: existingCanonical ?? keys[0],
      sourceQuoteId: q.id,
      name,
      company: String(c.company ?? "").trim(),
      address: String(c.address ?? "").trim(),
      city: String(c.city ?? "").trim(),
      state: String(c.state ?? "").trim() || blankCustomer().state,
      gstin: String(c.gstin ?? "").trim(),
      phone: String(c.phone ?? "").trim(),
      email: String(c.email ?? "").trim(),
      ts,
    };

    if (existingCanonical) {
      const prev = byKey.get(existingCanonical);
      if (prev && prev.ts >= ts) {
        // Older row — still register any new identity aliases onto the winner.
        for (const k of keys) aliasToCanonical.set(k, existingCanonical);
        continue;
      }
      byKey.delete(existingCanonical);
      row.key = existingCanonical;
      byKey.set(existingCanonical, row);
      for (const k of keys) aliasToCanonical.set(k, existingCanonical);
    } else {
      const canonical = keys[0];
      row.key = canonical;
      byKey.set(canonical, row);
      for (const k of keys) aliasToCanonical.set(k, canonical);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.company.localeCompare(b.company))
    .map(({ ts: _ts, ...rest }) => rest);
}

/** Match name (and company) when query has at least {@link CUSTOMER_SUGGEST_MIN_CHARS}. */
export function matchCustomersByName(
  customers: SuggestedCustomer[],
  query: string,
  limit = CUSTOMER_SUGGEST_LIMIT,
): SuggestedCustomer[] {
  const q = String(query ?? "").trim().toLowerCase();
  if (q.length < CUSTOMER_SUGGEST_MIN_CHARS) return [];
  const out: SuggestedCustomer[] = [];
  for (const c of customers) {
    const name = c.name.toLowerCase();
    const company = c.company.toLowerCase();
    if (name.includes(q) || (company && company.includes(q))) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function suggestCustomersFromQuotations(
  list: QuotationV1[],
  query: string,
  limit = CUSTOMER_SUGGEST_LIMIT,
): SuggestedCustomer[] {
  return matchCustomersByName(uniqueCustomersFromQuotations(list), query, limit);
}

/** Fields applied when picking an existing customer in Compose. */
export function customerFromSuggestion(s: SuggestedCustomer): QuoteCustomer {
  return {
    name: s.name,
    company: s.company,
    address: s.address,
    city: s.city,
    state: s.state || blankCustomer().state,
    gstin: s.gstin,
    phone: s.phone,
    email: s.email,
  };
}
