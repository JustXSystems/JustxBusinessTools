import { createHash } from "node:crypto";
import { daysBetween } from "./logic.js";

/** Labels for statement lines that aren't an invoice, bill, claim or payroll (bank charges, transfers…). */
export const BANK_CATEGORIES = [
  "Bank charges",
  "Interest received",
  "Transfer between accounts",
  "Owner's contribution",
  "Owner's drawings",
  "GST payment",
  "TDS / PF / ESI payment",
  "Loan",
  "Other income",
  "Other expense",
] as const;

export type StatementLine = { date: string; description: string; reference: string | null; amount: number };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A stable identity for each statement line, so importing the same (or an overlapping) statement
 * twice doesn't duplicate lines. Identical lines in one file (two equal UPI payments on the same day)
 * stay distinct through their occurrence number.
 */
export function fingerprintLines(lines: ReadonlyArray<StatementLine>): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = `${l.date}|${l.amount.toFixed(2)}|${norm(l.description)}|${norm(l.reference)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return createHash("sha1").update(`${base}|${n}`).digest("hex");
  });
}

/* ---------- Reconciliation suggestions ---------- */

/**
 * `match` links a record that already reflects the money (a recorded payment, a paid bill…).
 * `settle` records it now (pays the open invoice, bill, claim or payroll run) and links it.
 */
export type MatchAction = "match" | "settle";
export type MatchTarget = "payment" | "invoice" | "bill" | "expense" | "payroll";

export type MatchCandidate = {
  type: MatchTarget;
  id: string;
  action: MatchAction;
  label: string;
  detail: string;
  /** The document's date: payment / paid-on date for `match`, document date for `settle`. */
  date: string;
  /** Exact amount for `match`; the balance still open for `settle`. */
  amount: number;
  /** Party names, document numbers and references to look for in the narration. */
  keywords: ReadonlyArray<string>;
};

export type ScoredCandidate = Omit<MatchCandidate, "keywords"> & { score: number; exact: boolean };

const CREDIT_TYPES: ReadonlySet<MatchTarget> = new Set(["payment", "invoice"]);
const MATCH_WINDOW_DAYS = 10;
/** Claims are reimbursed some time after the spend. */
const EXPENSE_WINDOW = { before: 3, after: 60 };
/** A settlement can't predate its document by more than this. */
const SETTLE_LEAD_DAYS = 7;

function keywordHits(text: string, keywords: ReadonlyArray<string>): number {
  let best = 0;
  for (const k of keywords) {
    const key = norm(k);
    if (key.length < 4) continue;
    if (text.includes(key)) {
      best = Math.max(best, /\d/.test(key) ? 25 : 15);
      continue;
    }
    if (key.split(" ").some((token) => token.length >= 4 && !/^(the|and|pvt|ltd|private|limited|india|enterprises|traders)$/.test(token) && text.includes(token))) best = Math.max(best, 10);
  }
  return best;
}

/** Plausible records for one statement line, best first. Amounts must agree (a part-payment may settle an invoice). */
export function scoreCandidates(line: StatementLine, pool: ReadonlyArray<MatchCandidate>, limit = 8): ScoredCandidate[] {
  const credit = line.amount > 0;
  const abs = Math.abs(line.amount);
  const text = `${norm(line.description)} ${norm(line.reference)}`;
  const out: ScoredCandidate[] = [];
  for (const c of pool) {
    if (CREDIT_TYPES.has(c.type) !== credit) continue;
    const exact = Math.abs(c.amount - abs) <= 0.5;
    const diff = daysBetween(c.date, line.date);
    if (c.action === "match") {
      if (!exact) continue;
      if (c.type === "expense" ? diff < -EXPENSE_WINDOW.before || diff > EXPENSE_WINDOW.after : Math.abs(diff) > MATCH_WINDOW_DAYS) continue;
    } else {
      if (diff < -SETTLE_LEAD_DAYS) continue;
      if (c.type === "invoice" ? abs > c.amount + 0.5 : !exact) continue;
    }
    const proximity = c.action === "match" ? Math.max(0, 15 - Math.abs(diff)) : Math.max(0, 10 - Math.floor(Math.max(0, diff) / 10));
    // Prefer records that already show the money, so nothing is recorded twice.
    const score = 50 + (exact ? 20 : 0) + (c.action === "match" ? 15 : 0) + proximity + keywordHits(text, c.keywords);
    const { keywords: _keywords, ...rest } = c;
    out.push({ ...rest, score, exact });
  }
  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
}

/** The one candidate worth proposing: exact amount and clearly ahead of the next. */
export function bestSuggestion(scored: ReadonlyArray<ScoredCandidate>): ScoredCandidate | null {
  const [top, next] = scored;
  if (!top || !top.exact) return null;
  if (next && next.exact && top.score - next.score < 10) return null;
  return top;
}
