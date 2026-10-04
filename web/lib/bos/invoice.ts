export type InvoiceLineItem = {
  id: string;
  description: string;
  quantity: number;
  rate: number;
};

export type InvoiceTotals = {
  lines: Array<InvoiceLineItem & { amount: number }>;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
};

/** Parses user input into a finite, non-negative number (blank / NaN / negative → 0). */
export function toAmount(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function computeInvoice(items: InvoiceLineItem[], taxRatePercent: unknown): InvoiceTotals {
  const taxRate = toAmount(taxRatePercent);
  const lines = items.map((item) => {
    const quantity = toAmount(item.quantity);
    const rate = toAmount(item.rate);
    return { ...item, quantity, rate, amount: quantity * rate };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  return { lines, subtotal, taxRate, taxAmount, total: subtotal + taxAmount };
}

/** ₹ with Indian digit grouping (₹1,57,000), rounded to whole rupees. */
export function formatINR(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `₹${safe.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** `YYYY-MM-DD` in local time (what `<input type="date">` expects). */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** `2026-08-14` → `14 Aug 2026`; empty / invalid → `—`. */
export function formatInvoiceDate(iso: string): string {
  if (!iso) return "—";
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
