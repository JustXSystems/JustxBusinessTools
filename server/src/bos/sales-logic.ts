import { round2, type BosLineInput } from "./logic.js";

export const SALES_KINDS = ["quotation", "order", "challan"] as const;
export type SalesKind = (typeof SALES_KINDS)[number];

export const DOC_PREFIX: Record<SalesKind, string> = { quotation: "QT", order: "SO", challan: "DC" };

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "declined"] as const;
export const ORDER_STATUSES = ["confirmed", "cancelled"] as const;
export const CHALLAN_STATUSES = ["draft", "dispatched", "delivered", "cancelled"] as const;
export type SalesStatus = (typeof QUOTATION_STATUSES)[number] | (typeof ORDER_STATUSES)[number] | (typeof CHALLAN_STATUSES)[number];

/** Why goods leave on a challan: a sale, job work, on approval, or anything else (samples, transfers). */
export const CHALLAN_REASONS = ["supply", "job_work", "approval", "other"] as const;
export type ChallanReason = (typeof CHALLAN_REASONS)[number];

export const ITEM_KINDS = ["goods", "service"] as const;
export const POS_METHODS = ["cash", "upi", "card"] as const;
export type PosMethod = (typeof POS_METHODS)[number];

export const QUOTE_VALID_DAYS = 15;

/** What a document shows as its badge. Stored statuses stay small; the rest is derived. */
export type SalesStage =
  | "draft"
  | "sent"
  | "expired"
  | "accepted"
  | "declined"
  | "converted"
  | "confirmed"
  | "in_transit"
  | "part_delivered"
  | "delivered"
  | "invoiced"
  | "cancelled";

type ChallanLike = { status: string; lines: ReadonlyArray<BosLineInput> };

/** Lines match across documents by description, HSN and unit — challans copy their order's lines. */
export const lineKey = (l: Pick<BosLineInput, "description" | "hsn" | "unit">): string =>
  [l.description, l.hsn, l.unit].map((v) => String(v ?? "").trim().toLowerCase()).join("|");

/** Quantity still to deliver on each order line, after every challan that isn't cancelled. */
export function remainingLines<L extends BosLineInput>(orderLines: ReadonlyArray<L>, challans: ReadonlyArray<ChallanLike>): L[] {
  const shipped = new Map<string, number>();
  for (const c of challans) {
    if (c.status === "cancelled") continue;
    for (const l of c.lines) shipped.set(lineKey(l), (shipped.get(lineKey(l)) ?? 0) + Math.max(0, Number(l.quantity) || 0));
  }
  return orderLines.map((l) => {
    const key = lineKey(l);
    const left = shipped.get(key) ?? 0;
    const qty = Math.max(0, Number(l.quantity) || 0);
    const take = Math.min(qty, left);
    shipped.set(key, left - take);
    return { ...l, quantity: round2(qty - take) };
  });
}

/** Share of ordered quantity already on a delivered challan (0–100). Orders with no quantity count as delivered. */
export function deliveredPct(orderLines: ReadonlyArray<BosLineInput>, challans: ReadonlyArray<ChallanLike>): number {
  const ordered = orderLines.reduce((s, l) => s + Math.max(0, Number(l.quantity) || 0), 0);
  if (ordered <= 0) return 100;
  const left = remainingLines(orderLines, challans.filter((c) => c.status === "delivered")).reduce((s, l) => s + l.quantity, 0);
  return Math.round(((ordered - left) / ordered) * 100);
}

export type StageInput = {
  kind: SalesKind;
  status: string;
  validUntil?: string | null;
  /** Converted into an invoice that still exists and isn't void. */
  invoiced: boolean;
  /** Quotation: a sales order was made from it. */
  hasOrder?: boolean;
  /** Order: its challans. */
  challans?: ReadonlyArray<ChallanLike>;
  /** Order: its lines, to tell partly from fully delivered. */
  lines?: ReadonlyArray<BosLineInput>;
};

export function salesStage(d: StageInput, today: string): SalesStage {
  if (d.status === "cancelled") return "cancelled";
  if (d.kind === "quotation") {
    if (d.invoiced || d.hasOrder) return "converted";
    if (d.status === "accepted" || d.status === "declined" || d.status === "draft") return d.status;
    return d.validUntil && d.validUntil < today ? "expired" : "sent";
  }
  if (d.invoiced) return "invoiced";
  if (d.kind === "challan") {
    if (d.status === "dispatched") return "in_transit";
    return d.status === "delivered" ? "delivered" : "draft";
  }
  const live = (d.challans ?? []).filter((c) => c.status !== "cancelled");
  if (live.some((c) => c.status === "dispatched")) return "in_transit";
  if (!live.some((c) => c.status === "delivered")) return "confirmed";
  return deliveredPct(d.lines ?? [], live) >= 100 ? "delivered" : "part_delivered";
}

/** Why a document can't become an invoice yet, or `null` when it can. */
export function invoiceBlock(d: {
  kind: SalesKind;
  status: string;
  invoiceNo?: string | null;
  hasOrder?: boolean;
  /** Challan: its order is invoiced. Order: one of its challans is invoiced. */
  linkedInvoiced?: boolean;
}): string | null {
  if (d.invoiceNo) return `Already invoiced as ${d.invoiceNo}`;
  if (d.status === "cancelled") return "Cancelled documents can't be invoiced";
  if (d.kind === "quotation") {
    if (d.status === "declined") return "The customer declined this quotation";
    if (d.hasOrder) return "Invoice the sales order made from this quotation instead";
    return null;
  }
  if (d.kind === "order") return d.linkedInvoiced ? "Its delivery challans are being invoiced one by one" : null;
  if (d.status === "draft") return "Dispatch the challan before invoicing it";
  return d.linkedInvoiced ? "The sales order is already invoiced" : null;
}

/** Why a quotation can't become a sales order, or `null`. */
export function orderBlock(q: { status: string; invoiced: boolean; hasOrder: boolean }): string | null {
  if (q.status === "declined") return "The customer declined this quotation";
  if (q.hasOrder) return "A sales order was already made from this quotation";
  if (q.invoiced) return "This quotation was invoiced directly";
  return null;
}

/** Why an order can't ship another challan, or `null`. */
export function challanBlock(o: { status: string }, remaining: ReadonlyArray<BosLineInput>): string | null {
  if (o.status === "cancelled") return "The sales order is cancelled";
  if (!remaining.some((l) => l.quantity > 0)) return "Everything on this order is already on a challan";
  return null;
}

/** Edits are allowed until a document moves on: quotes until decided, orders until shipped or invoiced, challans until dispatched. */
export function editBlock(d: { kind: SalesKind; status: string; invoiced: boolean; hasChildren: boolean }): string | null {
  if (d.invoiced) return "Invoiced documents can't be edited — edit the draft invoice instead";
  if (d.status === "cancelled") return "Cancelled documents can't be edited";
  if (d.kind === "quotation") return d.status === "draft" || d.status === "sent" ? null : "Decided quotations can't be edited";
  if (d.kind === "order") return d.hasChildren ? "Orders with delivery challans can't be edited" : null;
  return d.status === "draft" ? null : "Dispatched challans can't be edited";
}

/** Counts cancelled children too, so nothing is left pointing at a missing source. */
export function deleteBlock(d: { kind: SalesKind; status: string; invoiceNo: string | null; children: number }): string | null {
  if (d.kind === "challan" && d.status !== "draft") return "Only draft challans can be deleted — cancel dispatched ones instead";
  if (d.invoiceNo) return `Delete or void invoice ${d.invoiceNo} first`;
  if (d.children > 0) return d.kind === "order" ? "Orders with delivery challans can't be deleted — cancel instead" : "A sales order was made from this quotation";
  return null;
}

export type TotalsDoc = {
  kind: SalesKind;
  stage: SalesStage;
  docDate: string;
  grandTotal: number;
  /** Order made from a quotation, or challan made from an order. */
  sourceId: string | null;
  canInvoice: boolean;
};

export function salesTotals(docs: ReadonlyArray<TotalsDoc>, today: string) {
  const month = today.slice(0, 7);
  const sum = (list: ReadonlyArray<TotalsDoc>) => round2(list.reduce((s, d) => s + d.grandTotal, 0));
  const orders = docs.filter((d) => d.kind === "order" && d.stage !== "cancelled" && d.docDate.startsWith(month));
  const quotes = docs.filter((d) => d.kind === "quotation" && (d.stage === "draft" || d.stage === "sent"));
  const challans = docs.filter((d) => d.kind === "challan" && d.stage !== "cancelled");
  const ready = docs.filter(
    (d) =>
      d.canInvoice &&
      ((d.kind === "quotation" && d.stage === "accepted") ||
        (d.kind === "order" && (d.stage === "delivered" || d.stage === "part_delivered")) ||
        (d.kind === "challan" && d.stage === "delivered" && !d.sourceId)),
  );
  return {
    ordersMonth: { count: orders.length, value: sum(orders) },
    quotesOpen: { count: quotes.length, value: sum(quotes) },
    challans: {
      month: challans.filter((d) => d.docDate.startsWith(month)).length,
      pendingDispatch: challans.filter((d) => d.stage === "draft").length,
      inTransit: challans.filter((d) => d.stage === "in_transit").length,
    },
    toInvoice: { count: ready.length, value: sum(ready) },
  };
}

export type PosBill = { grandTotal: number; method: string | null };

export function posSummary(bills: ReadonlyArray<PosBill>) {
  const byMethod: Record<PosMethod, number> = { cash: 0, upi: 0, card: 0 };
  for (const b of bills) {
    if ((POS_METHODS as readonly string[]).includes(b.method ?? "")) byMethod[b.method as PosMethod] = round2(byMethod[b.method as PosMethod] + b.grandTotal);
  }
  return { count: bills.length, total: round2(bills.reduce((s, b) => s + b.grandTotal, 0)), byMethod };
}
