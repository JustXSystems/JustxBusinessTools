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

function customerDedupeKey(c: QuoteCustomer): string | null {
  const phone = digitsOnly(c.phone);
  if (phone.length >= 8) return `p:${phone}`;
  const name = String(c.name ?? "").trim().toLowerCase();
  if (!name) return null;
  const gstin = String(c.gstin ?? "").trim().toUpperCase();
  return `n:${name}|g:${gstin}`;
}

function quoteRecency(q: QuotationV1): number {
  const raw = q.updatedAt || q.createdAt || "";
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/** Unique customers from saved quotations (most recent fields win). */
export function uniqueCustomersFromQuotations(list: QuotationV1[]): SuggestedCustomer[] {
  type Row = SuggestedCustomer & { ts: number };
  const byKey = new Map<string, Row>();

  for (const q of list) {
    const c = q.customer;
    if (!c) continue;
    const name = String(c.name ?? "").trim();
    if (!name) continue;
    const key = customerDedupeKey(c);
    if (!key) continue;
    const ts = quoteRecency(q);
    const prev = byKey.get(key);
    if (prev && prev.ts >= ts) continue;
    byKey.set(key, {
      key,
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
    });
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
