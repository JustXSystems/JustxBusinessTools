/**
 * Wave 6 pure logic: document currency + locked FX rate, installment schedules,
 * dunning level sequences and the customer-portal token. No I/O — everything here is unit-tested
 * (see wave6-logic.test.ts) and mirrored by web/lib/ims/finance.ts where the browser previews it.
 */
import { randomBytes } from "node:crypto";
import { round2 } from "./logic.js";

/* ---------- Multi-currency ---------- */

export const DEFAULT_BASE_CURRENCY = "INR";
export const CURRENCY_RE = /^[A-Z]{3}$/;

/** Strict ISO-4217 shape (3 letters, upper-cased) or null. */
export function parseCurrencyCode(v: unknown): string | null {
  const s = String(v ?? "")
    .trim()
    .toUpperCase();
  return CURRENCY_RE.test(s) ? s : null;
}

/** Valid code or the fallback (INR unless told otherwise). */
export function normalizeCurrencyCode(v: unknown, fallback: string = DEFAULT_BASE_CURRENCY): string {
  return parseCurrencyCode(v) ?? parseCurrencyCode(fallback) ?? DEFAULT_BASE_CURRENCY;
}

export type FxResolved = {
  currencyCode: string;
  fxRate: number;
  /** Grand total in the base currency. `null` is never returned — equal to grandTotal when not foreign. */
  fxBaseTotal: number;
  foreign: boolean;
};

/**
 * Locks the document currency and rate at save time.
 * - Currency equals base → rate is forced to 1 and the base total is the grand total.
 * - Foreign currency → rate defaults to 1 when missing, base total = round2(grandTotal × rate).
 */
export function resolveFx(opts: { currencyCode?: unknown; fxRate?: unknown; baseCurrency?: unknown; grandTotal: number }): FxResolved {
  const base = normalizeCurrencyCode(opts.baseCurrency);
  const currencyCode = normalizeCurrencyCode(opts.currencyCode, base);
  const grandTotal = round2(Number(opts.grandTotal) || 0);
  if (currencyCode === base) return { currencyCode, fxRate: 1, fxBaseTotal: grandTotal, foreign: false };
  const raw = Number(opts.fxRate);
  const fxRate = Number.isFinite(raw) && raw > 0 ? Math.round(raw * 1e8) / 1e8 : 1;
  return { currencyCode, fxRate, fxBaseTotal: round2(grandTotal * fxRate), foreign: true };
}

/* ---------- Installment plans ---------- */

export const MAX_INSTALLMENTS = 60;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type InstallmentDraft = { dueOn: string; amount: number; label?: string | null };
export type InstallmentChecked = { dueOn: string; amount: number; label: string | null };

/**
 * Validates a proposed plan against the invoice balance. Amounts must be positive and sum to the
 * balance (within one paisa-rounding step); the schedule is returned sorted by due date.
 */
export function validateInstallments(
  items: ReadonlyArray<InstallmentDraft>,
  balance: number,
  /** Tenant `maxInstallments`; never above the hard `MAX_INSTALLMENTS` ceiling. */
  maxInstallments: number = MAX_INSTALLMENTS,
): { ok: true; items: InstallmentChecked[]; total: number } | { ok: false; error: string } {
  const cap = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(maxInstallments)) || MAX_INSTALLMENTS));
  if (!items.length) return { ok: false, error: "Add at least one installment" };
  if (items.length > cap) return { ok: false, error: `A plan can have at most ${cap} installments` };
  const checked: InstallmentChecked[] = [];
  for (const [i, it] of items.entries()) {
    if (!ISO_DATE_RE.test(String(it.dueOn ?? ""))) return { ok: false, error: `Installment ${i + 1} needs a valid due date` };
    const amount = round2(Number(it.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: `Installment ${i + 1} needs an amount more than zero` };
    checked.push({ dueOn: it.dueOn, amount, label: it.label?.trim().slice(0, 80) || null });
  }
  const total = round2(checked.reduce((s, x) => s + x.amount, 0));
  const target = round2(balance);
  if (target <= 0.005) return { ok: false, error: "This invoice has no balance to schedule" };
  if (Math.abs(total - target) > 0.01) {
    return { ok: false, error: `Installments total ${total.toFixed(2)} but the balance due is ${target.toFixed(2)} — they must match` };
  }
  checked.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
  return { ok: true, items: checked, total };
}

export type InstallmentStatus = "pending" | "partial" | "paid";
export type InstallmentRow = { id: string; amount: number; amountPaid: number };
export type InstallmentChange = { id: string; amountPaid: number; status: InstallmentStatus };

export const installmentStatusOf = (amount: number, amountPaid: number): InstallmentStatus =>
  amountPaid + 0.005 >= amount ? "paid" : amountPaid > 0.005 ? "partial" : "pending";

/** Spreads a payment over the earliest unpaid installments (rows must already be in schedule order). */
export function allocateToInstallments(rows: ReadonlyArray<InstallmentRow>, payment: number): { changes: InstallmentChange[]; remainder: number } {
  let left = round2(payment);
  const changes: InstallmentChange[] = [];
  for (const r of rows) {
    if (left <= 0.005) break;
    const open = round2(r.amount - r.amountPaid);
    if (open <= 0.005) continue;
    const take = round2(Math.min(open, left));
    const amountPaid = round2(r.amountPaid + take);
    changes.push({ id: r.id, amountPaid, status: installmentStatusOf(r.amount, amountPaid) });
    left = round2(left - take);
  }
  return { changes, remainder: left > 0.005 ? left : 0 };
}

/** Reverses a voided payment: takes it back from the latest paid installments first. */
export function deallocateFromInstallments(rows: ReadonlyArray<InstallmentRow>, amount: number): { changes: InstallmentChange[]; remainder: number } {
  let left = round2(amount);
  const changes: InstallmentChange[] = [];
  for (const r of [...rows].reverse()) {
    if (left <= 0.005) break;
    if (r.amountPaid <= 0.005) continue;
    const take = round2(Math.min(r.amountPaid, left));
    const amountPaid = round2(r.amountPaid - take);
    changes.push({ id: r.id, amountPaid, status: installmentStatusOf(r.amount, amountPaid) });
    left = round2(left - take);
  }
  return { changes, remainder: left > 0.005 ? left : 0 };
}

/* ---------- Dunning sequences ---------- */

export const DUNNING_TONES = ["friendly", "firm", "final"] as const;
export type DunningTone = (typeof DUNNING_TONES)[number];
export type DunningLevel = { key: string; label: string; minDaysOverdue: number; tone: DunningTone };

export const DEFAULT_DUNNING_SEQUENCES: ReadonlyArray<DunningLevel> = [
  { key: "L1", label: "Friendly reminder", minDaysOverdue: 1, tone: "friendly" },
  { key: "L2", label: "Firm reminder", minDaysOverdue: 15, tone: "firm" },
  { key: "L3", label: "Final notice", minDaysOverdue: 30, tone: "final" },
];

export const MAX_DUNNING_LEVELS = 8;
const LEVEL_KEY_RE = /^[A-Za-z0-9_-]{1,24}$/;

/** Parses stored / submitted levels: drops junk, dedupes keys, sorts by days overdue. Empty → defaults. */
export function normalizeDunningSequences(v: unknown): DunningLevel[] {
  let raw: unknown = v;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const seen = new Set<string>();
  const out: DunningLevel[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const key = String(o.key ?? "")
        .trim()
        .toUpperCase();
      if (!LEVEL_KEY_RE.test(key) || seen.has(key)) continue;
      const label = String(o.label ?? "")
        .trim()
        .slice(0, 80);
      const days = Math.round(Number(o.minDaysOverdue));
      const tone = String(o.tone ?? "").toLowerCase();
      seen.add(key);
      out.push({
        key,
        label: label || key,
        minDaysOverdue: Number.isFinite(days) ? Math.min(3650, Math.max(0, days)) : 0,
        tone: (DUNNING_TONES as readonly string[]).includes(tone) ? (tone as DunningTone) : "friendly",
      });
      if (out.length >= MAX_DUNNING_LEVELS) break;
    }
  }
  if (!out.length) return DEFAULT_DUNNING_SEQUENCES.map((l) => ({ ...l }));
  return out.sort((a, b) => a.minDaysOverdue - b.minDaysOverdue || a.key.localeCompare(b.key));
}

/** The strictest level whose threshold the oldest overdue invoice has reached; null while nothing qualifies. */
export function pickDunningLevel(levels: ReadonlyArray<DunningLevel>, daysOverdue: number): DunningLevel | null {
  let picked: DunningLevel | null = null;
  for (const l of [...levels].sort((a, b) => a.minDaysOverdue - b.minDaysOverdue)) {
    if (daysOverdue >= l.minDaysOverdue) picked = l;
  }
  return picked;
}

export const findDunningLevel = (levels: ReadonlyArray<DunningLevel>, key: string | null | undefined): DunningLevel | null =>
  levels.find((l) => l.key === String(key ?? "").trim().toUpperCase()) ?? null;

export type DunningCopy = { subject: string; intro: string; closing: string };

/** Tone-specific wording shared by the API payload (and mirrored in the web letter dialog). */
export function dunningCopy(tone: DunningTone, v: { customer: string; total: string; asOf: string; count: number; business: string }): DunningCopy {
  const plural = v.count === 1 ? "invoice is" : "invoices are";
  if (tone === "final") {
    return {
      subject: "FINAL NOTICE — immediate payment required",
      intro: `Despite our earlier reminders, the following ${plural} still unpaid as of ${v.asOf}. Please clear ${v.total} immediately. Failing this, we may have to suspend supplies and take recovery action without further notice.`,
      closing: "If payment has just been made, please share the transfer details so we can update our books at once.",
    };
  }
  if (tone === "firm") {
    return {
      subject: "Second reminder — overdue payment",
      intro: `We have not yet received payment for the following ${plural} overdue as of ${v.asOf}. Kindly arrange ${v.total} within the next 7 days.`,
      closing: "Please reply with the payment date if it has already been released, or call us if there is any dispute.",
    };
  }
  return {
    subject: "Outstanding dues — friendly payment reminder",
    intro: `This is a gentle reminder that the following ${plural} outstanding as of ${v.asOf}. Kindly arrange payment of ${v.total} at your earliest convenience.`,
    closing: "Please ignore this note if payment has already been made. Thank you for your business.",
  };
}

/* ---------- Customer portal ---------- */

/** 192-bit URL-safe token for the public invoice portal link. */
export function newPortalToken(): string {
  return randomBytes(24).toString("base64url");
}

export const isPortalToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);

/** NPCI UPI intent (INR only). Mirrors `upiPayIntent` in web/lib/ims/finance.ts. */
export function upiIntent(opts: { vpa: string | null | undefined; payeeName?: string | null; amount?: number | null; note?: string | null }): string | null {
  const pa = String(opts.vpa ?? "").trim();
  if (!pa || !pa.includes("@")) return null;
  const q = new URLSearchParams();
  q.set("pa", pa);
  q.set("pn", String(opts.payeeName ?? "Payee").trim().slice(0, 80) || "Payee");
  q.set("cu", "INR");
  if (opts.amount != null && opts.amount > 0.005) q.set("am", Number(opts.amount).toFixed(2));
  if (opts.note?.trim()) q.set("tn", opts.note.trim().slice(0, 80));
  return `upi://pay?${q.toString()}`;
}
