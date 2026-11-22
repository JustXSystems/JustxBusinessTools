/**
 * Sales-order quantity logic (pure — no database). Shared by `sales-orders.ts` and unit tests.
 *
 * Every ordered unit is covered in exactly one way:
 *  - **delivery challan** (draft DC reserves it, approved DC ships it and posts stock OUT), later billed by an
 *    invoice that links the DC (the invoice then skips stock), or
 *  - **direct invoice** (no DC) — the invoice itself posts stock OUT when issued.
 * `remaining` is what can still be put on a new DC or a new direct invoice.
 */
import { round3 } from "./logic.js";

export const SO_STATUSES = ["draft", "confirmed", "partial", "fulfilled", "cancelled"] as const;
export type SoStatus = (typeof SO_STATUSES)[number];

export const SO_DC_STATUSES = ["draft", "approved", "cancelled"] as const;
export type SoDcStatus = (typeof SO_DC_STATUSES)[number];

/** Statuses that accept deliveries and invoices. */
export const SO_OPEN_STATUSES: ReadonlyArray<SoStatus> = ["confirmed", "partial"];

export type SoLineRef = { itemId?: string | null; name: string; sku?: string | null; qty: number };
export type SoQty = { lineIndex: number; qty: number };
export type SoDcQtys = { status: string; /** Linked to a live (non-cancelled) invoice. */ invoiced?: boolean; lines: ReadonlyArray<SoQty> };
export type SoInvoiceQtys = { status: string; lines: ReadonlyArray<{ itemId?: string | null; name: string; sku?: string | null; qty: number }> };

export type SoLineProgress = {
  lineIndex: number;
  ordered: number;
  /** On approved DCs (stock already out). */
  delivered: number;
  /** On draft DCs (held, stock not out yet). */
  reserved: number;
  /** Billed on live direct invoices (no DC). */
  invoicedDirect: number;
  /** Billed on issued direct invoices. */
  invoicedIssued: number;
  /** Approved DC qty not yet linked to an invoice. */
  deliveredUnbilled: number;
  /** Still available for a new DC / direct invoice. */
  remaining: number;
};

const EPS = 1e-6;
const live = (status: string) => status !== "cancelled";

/** Matches an invoice line back to an order line (catalog item, else name + sku). */
export function soLineKey(l: { itemId?: string | null; name: string; sku?: string | null }): string {
  return l.itemId ? `i:${l.itemId}` : `n:${l.name.trim().toLowerCase()}|${(l.sku ?? "").trim().toLowerCase()}`;
}

/** Spreads direct-invoice qty over order lines sharing a key, in line order, capped by each line's capacity. */
function allocateDirect(lines: ReadonlyArray<SoLineRef>, capacity: ReadonlyArray<number>, invoices: ReadonlyArray<SoInvoiceQtys>): number[] {
  const billed = new Map<string, number>();
  for (const inv of invoices) {
    for (const l of inv.lines) billed.set(soLineKey(l), (billed.get(soLineKey(l)) ?? 0) + (Number(l.qty) || 0));
  }
  const out = lines.map(() => 0);
  lines.forEach((line, i) => {
    const key = soLineKey(line);
    const left = billed.get(key) ?? 0;
    if (left <= EPS) return;
    const take = Math.min(left, Math.max(0, capacity[i]));
    out[i] = take;
    billed.set(key, left - take);
  });
  return out.map(round3);
}

export function soProgress(lines: ReadonlyArray<SoLineRef>, dcs: ReadonlyArray<SoDcQtys>, directInvoices: ReadonlyArray<SoInvoiceQtys>): SoLineProgress[] {
  const n = lines.length;
  const delivered = new Array<number>(n).fill(0);
  const reserved = new Array<number>(n).fill(0);
  const unbilled = new Array<number>(n).fill(0);
  for (const dc of dcs) {
    if (dc.status !== "approved" && dc.status !== "draft") continue;
    for (const l of dc.lines) {
      if (l.lineIndex < 0 || l.lineIndex >= n) continue;
      const q = Number(l.qty) || 0;
      if (dc.status === "approved") {
        delivered[l.lineIndex] += q;
        if (!dc.invoiced) unbilled[l.lineIndex] += q;
      } else reserved[l.lineIndex] += q;
    }
  }
  const liveCap = lines.map((l, i) => Math.max(0, (Number(l.qty) || 0) - delivered[i] - reserved[i]));
  const issuedCap = lines.map((l, i) => Math.max(0, (Number(l.qty) || 0) - delivered[i]));
  const direct = allocateDirect(lines, liveCap, directInvoices.filter((i) => live(i.status)));
  const issued = allocateDirect(lines, issuedCap, directInvoices.filter((i) => i.status === "issued"));
  return lines.map((l, i) => {
    const ordered = round3(Number(l.qty) || 0);
    return {
      lineIndex: i,
      ordered,
      delivered: round3(delivered[i]),
      reserved: round3(reserved[i]),
      invoicedDirect: direct[i],
      invoicedIssued: issued[i],
      deliveredUnbilled: round3(unbilled[i]),
      remaining: round3(Math.max(0, ordered - delivered[i] - reserved[i] - direct[i])),
    };
  });
}

/**
 * Stored status after confirm: `confirmed` (nothing shipped/billed yet), `partial`, or `fulfilled`
 * (every line shipped on approved DCs or billed on issued direct invoices). Draft/cancelled never change.
 */
export function soDerivedStatus(base: string, progress: ReadonlyArray<SoLineProgress>): SoStatus {
  if (base === "draft" || base === "cancelled") return base;
  if (!progress.length) return "confirmed";
  let any = false;
  let all = true;
  for (const p of progress) {
    const done = Math.min(p.ordered, p.delivered + p.invoicedIssued);
    if (done > EPS) any = true;
    if (done + EPS < p.ordered) all = false;
  }
  return all ? "fulfilled" : any ? "partial" : "confirmed";
}

export function soSummary(progress: ReadonlyArray<SoLineProgress>) {
  const ordered = round3(progress.reduce((s, p) => s + p.ordered, 0));
  const delivered = round3(progress.reduce((s, p) => s + Math.min(p.ordered, p.delivered + p.invoicedIssued), 0));
  const remaining = round3(progress.reduce((s, p) => s + p.remaining, 0));
  const deliveredUnbilled = round3(progress.reduce((s, p) => s + p.deliveredUnbilled, 0));
  return { orderedQty: ordered, deliveredQty: delivered, remainingQty: remaining, deliveredUnbilledQty: deliveredUnbilled, deliveredPct: ordered > 0 ? Math.round((delivered / ordered) * 100) : 0 };
}

/** Sums quantities per order line across several documents. */
export function mergeQtys(groups: ReadonlyArray<ReadonlyArray<SoQty>>): SoQty[] {
  const m = new Map<number, number>();
  for (const g of groups) for (const l of g) m.set(l.lineIndex, (m.get(l.lineIndex) ?? 0) + (Number(l.qty) || 0));
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([lineIndex, qty]) => ({ lineIndex, qty: round3(qty) }));
}

/**
 * Turns an optional subset ({ lineIndex, qty }) into validated quantities against `remaining`.
 * No picks = everything still remaining.
 */
export function planFromRemaining(
  progress: ReadonlyArray<SoLineProgress>,
  picks: ReadonlyArray<SoQty> | undefined,
  nothingMessage: string,
): { lines: SoQty[]; error: string | null } {
  if (!picks || picks.length === 0) {
    const lines = progress.filter((p) => p.remaining > EPS).map((p) => ({ lineIndex: p.lineIndex, qty: p.remaining }));
    return lines.length ? { lines, error: null } : { lines: [], error: nothingMessage };
  }
  const merged = mergeQtys([picks]).filter((p) => p.qty > EPS);
  if (!merged.length) return { lines: [], error: "Enter a quantity above zero for at least one line" };
  for (const p of merged) {
    const prog = progress[p.lineIndex];
    if (!prog) return { lines: [], error: `Line ${p.lineIndex + 1} is not on this order` };
    if (p.qty > prog.remaining + EPS) return { lines: [], error: `Line ${p.lineIndex + 1}: only ${prog.remaining} left to deliver or bill (asked for ${p.qty})` };
  }
  return { lines: merged, error: null };
}
