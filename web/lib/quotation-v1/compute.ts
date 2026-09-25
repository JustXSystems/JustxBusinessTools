import type { CompanyProfileV1, QuotationV1, QuoteTotals } from "./types";

export function computeTotals(q: QuotationV1, company: CompanyProfileV1): QuoteTotals {
  const interState = Boolean(
    q.customer.state && company.state && q.customer.state !== company.state,
  );
  let subtotal = 0;
  let oldBuybackLess = 0;
  let subtotalGst = 0;
  let discountTotal = 0;
  let itemsTaxable = 0;
  const gstBuckets: Record<number, number> = {};

  for (const it of q.items) {
    const gross = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    if (gross < 0) {
      oldBuybackLess += gross;
      continue;
    }
    const disc = gross * ((Number(it.discount) || 0) / 100);
    const net = gross - disc;
    subtotal += gross;
    discountTotal += disc;
    itemsTaxable += net;
    const rate = Number(it.gst) || 0;
    gstBuckets[rate] = (gstBuckets[rate] || 0) + net;
    const lineGst = (gross * rate) / 100;
    if (lineGst > 0) subtotalGst += lineGst;
  }

  const exBase = Number(q.extraCharge?.amount) || 0;
  const exGstRate = Number(q.extraCharge?.gst) || 0;
  const exGstAmt = (exBase * exGstRate) / 100;
  const exTotal = exBase + exGstAmt;
  if (exBase > 0) subtotal += exBase;
  if (exGstAmt > 0) subtotalGst += exGstAmt;
  const taxable = subtotal;

  let autoCgst = 0;
  let autoSgst = 0;
  let autoIgst = 0;
  for (const [rate, amt] of Object.entries(gstBuckets)) {
    const r = Number(rate) / 100;
    if (interState) autoIgst += amt * r;
    else {
      autoCgst += (amt * r) / 2;
      autoSgst += (amt * r) / 2;
    }
  }

  const autoCgstRate = itemsTaxable > 0 ? (autoCgst / itemsTaxable) * 100 : 0;
  const autoSgstRate = itemsTaxable > 0 ? (autoSgst / itemsTaxable) * 100 : 0;
  const autoIgstRate = itemsTaxable > 0 ? (autoIgst / itemsTaxable) * 100 : 0;

  const manual = q.gstOverride?.mode === "manual";
  let cgstRate: number;
  let sgstRate: number;
  let igstRate: number;
  let cgst: number;
  let sgst: number;
  let igst: number;

  if (manual) {
    cgstRate =
      q.gstOverride.cgst != null ? Number(q.gstOverride.cgst) || 0 : autoCgstRate;
    sgstRate =
      q.gstOverride.sgst != null ? Number(q.gstOverride.sgst) || 0 : autoSgstRate;
    igstRate =
      q.gstOverride.igst != null ? Number(q.gstOverride.igst) || 0 : autoIgstRate;
    if (interState) {
      igst = (taxable * igstRate) / 100;
      cgst = 0;
      sgst = 0;
    } else {
      cgst = (taxable * cgstRate) / 100;
      sgst = (taxable * sgstRate) / 100;
      igst = 0;
    }
  } else {
    cgstRate = autoCgstRate;
    sgstRate = autoSgstRate;
    igstRate = autoIgstRate;
    cgst = autoCgst;
    sgst = autoSgst;
    igst = autoIgst;
  }

  const totalTax = cgst + sgst + igst;
  const totalGst = subtotalGst + totalTax;
  const grandRaw = subtotal + totalGst - Math.abs(oldBuybackLess);
  const grand = Math.round(grandRaw);
  const roundOff = grand - grandRaw;

  return {
    subtotal,
    subtotalGst,
    totalGst,
    oldBuybackLess,
    discountTotal,
    taxable,
    cgst,
    sgst,
    igst,
    cgstRate,
    sgstRate,
    igstRate,
    totalTax,
    grand,
    roundOff,
    interState,
    isManual: manual,
    exBase,
    exGstRate,
    exGstAmt,
    exTotal,
  };
}

export function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundMoney2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export type ReverseLineCalcInput = {
  /** GST-inclusive line total (matches Quote sheet “Total Amount”). */
  inclusiveTotal: number;
  gstPercent: number;
  qty: number;
  discountPercent?: number;
};

export type ReverseLineCalcResult =
  | {
      ok: true;
      rate: number;
      gross: number;
      taxable: number;
      gstAmount: number;
      inclusiveTotal: number;
    }
  | { ok: false; error: string };

/**
 * Back-calculate unit rate from a GST-inclusive line total.
 * Accounts for line discount % the same way {@link computeTotals} does.
 */
export function reverseLineFromInclusiveTotal(input: ReverseLineCalcInput): ReverseLineCalcResult {
  const qty = Number(input.qty);
  const gst = Number(input.gstPercent);
  const total = Number(input.inclusiveTotal);
  const disc = Number(input.discountPercent) || 0;

  if (!Number.isFinite(qty) || qty === 0) {
    return { ok: false, error: "Quantity must not be zero" };
  }
  if (!Number.isFinite(total)) {
    return { ok: false, error: "Enter a valid total amount" };
  }
  if (!Number.isFinite(gst) || gst < 0) {
    return { ok: false, error: "Enter a valid GST %" };
  }
  if (!Number.isFinite(disc) || disc < 0 || disc >= 100) {
    return { ok: false, error: "Discount must be between 0 and 100%" };
  }

  const taxable = total / (1 + gst / 100);
  const gross = taxable / (1 - disc / 100);
  const rate = gross / qty;
  const gstAmount = total - taxable;

  return {
    ok: true,
    rate: roundMoney2(rate),
    gross: roundMoney2(gross),
    taxable: roundMoney2(taxable),
    gstAmount: roundMoney2(gstAmount),
    inclusiveTotal: roundMoney2(total),
  };
}

/** Current GST-inclusive line total for seeding the reverse-calc modal. */
export function lineInclusiveTotal(item: {
  qty: number | string;
  rate: number | string;
  gst: number | string;
  discount?: number | string;
}): number {
  const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  const disc = gross * ((Number(item.discount) || 0) / 100);
  const taxable = gross - disc;
  const gstAmt = (taxable * (Number(item.gst) || 0)) / 100;
  return roundMoney2(taxable + gstAmt);
}


export function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateSlash(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function numToWordsIndian(num: number): string {
  let n = Math.round(num);
  if (n === 0) return "Zero Rupees Only";
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => {
    if (x < 20) return a[x];
    return b[Math.floor(x / 10)] + (x % 10 ? ` ${a[x % 10]}` : "");
  };
  const three = (x: number) => {
    if (x > 99) return `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${two(x % 100)}` : ""}`;
    return two(x);
  };
  let str = "";
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) str += `${three(crore)} Crore `;
  if (lakh) str += `${three(lakh)} Lakh `;
  if (thousand) str += `${three(thousand)} Thousand `;
  if (n) str += three(n);
  return `${str.trim()} Rupees Only`;
}

export function sanitizeNumStr(raw: string): string {
  let v = String(raw).replace(/[^0-9.]/g, "");
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
  return v;
}

/** Like sanitizeNumStr but allows a leading minus (line-item rate credits / adjustments). */
export function sanitizeSignedNumStr(raw: string): string {
  const s = String(raw);
  const neg = s.includes("-");
  let v = s.replace(/-/g, "").replace(/[^0-9.]/g, "");
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
  if (neg) {
    if (v === "" || v === ".") return "-";
    return `-${v}`;
  }
  return v;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short opaque id for draft/item rows (not security-sensitive). */
export function uid(): string {
  return randomHex(8);
}

/** High-entropy public share / approval token (unguessable). */
export function newApprovalToken(): string {
  return randomHex(24);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
