import type { CompanyProfileV1, QuotationV1, QuoteTotals } from "./types";

export function computeTotals(q: QuotationV1, company: CompanyProfileV1): QuoteTotals {
  const interState = Boolean(
    q.customer.state && company.state && q.customer.state !== company.state,
  );
  let subtotal = 0;
  let discountTotal = 0;
  let taxable = 0;
  const gstBuckets: Record<number, number> = {};

  for (const it of q.items) {
    const gross = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    const disc = gross * ((Number(it.discount) || 0) / 100);
    const net = gross - disc;
    subtotal += gross;
    discountTotal += disc;
    taxable += net;
    const rate = Number(it.gst) || 0;
    gstBuckets[rate] = (gstBuckets[rate] || 0) + net;
  }

  const exBase = Number(q.extraCharge?.amount) || 0;
  const exGstRate = Number(q.extraCharge?.gst) || 0;
  const exGstAmt = (exBase * exGstRate) / 100;
  const exTotal = exBase + exGstAmt;

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

  const autoCgstRate = taxable > 0 ? (autoCgst / taxable) * 100 : 0;
  const autoSgstRate = taxable > 0 ? (autoSgst / taxable) * 100 : 0;
  const autoIgstRate = taxable > 0 ? (autoIgst / taxable) * 100 : 0;

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
  const grandRaw = taxable + totalTax + exTotal;
  const grand = Math.round(grandRaw);
  const roundOff = grand - grandRaw;

  return {
    subtotal,
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

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
