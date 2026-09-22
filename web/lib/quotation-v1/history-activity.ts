import type { QuoteHistoryRow, QuotationV1 } from "./types";

export type QuoteActivityRow = QuoteHistoryRow & {
  actionLabel: string;
  actionKind: "create" | "update" | "status" | "amount";
  amountDelta: number | null;
  savedAtLabel: string;
  quoteExists: boolean;
  isLatestForQuote: boolean;
};

function fmtWhen(iso: string) {
  const raw = String(iso ?? "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16).replace("T", " ");
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionFromServer(raw: string | undefined): { label: string; kind: QuoteActivityRow["actionKind"] } | null {
  const a = String(raw ?? "").trim();
  if (!a) return null;
  if (a === "create") return { label: "Created", kind: "create" };
  if (a === "update") return { label: "Saved", kind: "update" };
  if (a.startsWith("status:")) {
    const st = a.slice("status:".length);
    const labels: Record<string, string> = {
      draft: "Back to draft",
      submitted: "Submitted",
      sent: "Marked sent",
      approved: "Approved",
      rejected: "Rejected",
    };
    return { label: labels[st] ?? `Status → ${st}`, kind: "status" };
  }
  return { label: a, kind: "update" };
}

function inferAction(
  row: QuoteHistoryRow,
  prev: QuoteHistoryRow | null,
): { label: string; kind: QuoteActivityRow["actionKind"] } {
  const fromServer = actionFromServer(row.action);
  if (fromServer) return fromServer;

  if (!prev) return { label: "Created", kind: "create" };
  if (row.status !== prev.status) {
    const labels: Record<string, string> = {
      draft: "Back to draft",
      submitted: "Submitted",
      sent: "Marked sent",
      approved: "Approved",
      rejected: "Rejected",
    };
    return {
      label: labels[row.status] ?? `Status → ${row.status}`,
      kind: "status",
    };
  }
  if (Number(row.grand) !== Number(prev.grand)) {
    return { label: "Amount updated", kind: "amount" };
  }
  return { label: "Saved", kind: "update" };
}

function previousSave(history: QuoteHistoryRow[], index: number, quotationId: string) {
  for (let i = index + 1; i < history.length; i++) {
    if (history[i].quotationId === quotationId) return history[i];
  }
  return null;
}

function latestIndexByQuote(history: QuoteHistoryRow[]) {
  const map = new Map<string, number>();
  history.forEach((h, i) => {
    if (!map.has(h.quotationId)) map.set(h.quotationId, i);
  });
  return map;
}

/** Newest-first save log → actionable activity rows. */
export function buildQuoteActivityTimeline(
  history: QuoteHistoryRow[],
  quotations: QuotationV1[],
): QuoteActivityRow[] {
  const exists = new Set(quotations.map((q) => q.id));
  const latestIdx = latestIndexByQuote(history);

  return history.map((h, index) => {
    const prev = previousSave(history, index, h.quotationId);
    const { label, kind } = inferAction(h, prev);
    let amountDelta: number | null = null;
    if (prev && Number.isFinite(Number(h.grand)) && Number.isFinite(Number(prev.grand))) {
      const d = Number(h.grand) - Number(prev.grand);
      if (Math.abs(d) >= 0.01) amountDelta = d;
    }

    return {
      ...h,
      actionLabel: label,
      actionKind: kind,
      amountDelta,
      savedAtLabel: fmtWhen(h.savedAt),
      quoteExists: exists.has(h.quotationId),
      isLatestForQuote: latestIdx.get(h.quotationId) === index,
    };
  });
}

export function filterQuoteActivity(rows: QuoteActivityRow[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = [
      r.quoteNo,
      r.customerName,
      r.typeLabel,
      r.status,
      r.actionLabel,
      r.preparedBy,
    ]
      .map((x) => String(x ?? "").toLowerCase())
      .join(" ");
    return hay.includes(q);
  });
}

export function quoteActivityStats(rows: QuoteActivityRow[]) {
  const uniqueQuotes = new Set(rows.map((r) => r.quotationId)).size;
  return { events: rows.length, uniqueQuotes };
}
