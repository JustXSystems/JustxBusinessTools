import type { DocumentConfig } from "@/config/tools.config";
import type { BusinessProfile } from "@/lib/types/business-profile";
import type { DocumentState, DocumentTotals } from "@/lib/types/document";
import { todayISO } from "@/lib/format";

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ` ${ONES[o]}` : "");
}

function threeDigitWords(n: number): string {
  let str = "";
  if (n >= 100) {
    str += `${ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n) str += " ";
  }
  str += twoDigitWords(n);
  return str;
}

export function numberToWordsIndian(num: number): string {
  let n = Math.round(num);
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;
  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh) parts.push(`${threeDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigitWords(thousand)} Thousand`);
  if (hundred) parts.push(threeDigitWords(hundred));
  return parts.join(" ");
}

export function blankDocumentState(docNo: string): DocumentState {
  return {
    id: null,
    docNo,
    docDate: todayISO(),
    extraDate: todayISO(),
    party: { name: "", address: "", phone: "", gstin: "", state: "" },
    items: [{ id: 1, name: "", hsn: "", qty: 1, unit: "NOS", rate: 0 }],
    igstPct: 18,
    cgstPct: 0,
    sgstPct: 0,
    cgstSgstEnabled: false,
    notes: "",
    status: "draft",
  };
}

export function docComputeTotals(state: DocumentState): DocumentTotals {
  const computed = state.items.map((it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const taxable = qty * rate;
    const cgstAmt = taxable * (Number(state.cgstPct) || 0) / 100;
    const sgstAmt = taxable * (Number(state.sgstPct) || 0) / 100;
    const igstAmt = taxable * (Number(state.igstPct) || 0) / 100;
    const total = taxable + cgstAmt + sgstAmt + igstAmt;
    return { ...it, qty, rate, taxable, cgstAmt, sgstAmt, igstAmt, total };
  });
  const totalQty = computed.reduce((s, i) => s + i.qty, 0);
  const taxable = computed.reduce((s, i) => s + i.taxable, 0);
  const cgst = computed.reduce((s, i) => s + i.cgstAmt, 0);
  const sgst = computed.reduce((s, i) => s + i.sgstAmt, 0);
  const igst = computed.reduce((s, i) => s + i.igstAmt, 0);
  const totalTax = cgst + sgst + igst;
  const grand = taxable + totalTax;
  return { computed, totalQty, taxable, cgst, sgst, igst, totalTax, grand };
}

export function docMissingFields(
  state: DocumentState,
  profile: BusinessProfile,
  cfg: DocumentConfig,
): string[] {
  const missing: string[] = [];
  if (!profile.businessName?.trim()) {
    missing.push("Set up your Business Profile first (name required)");
  }
  if (!state.party.name.trim()) missing.push(`${cfg.partyLabel} name`);
  if (!state.items.length) missing.push("At least one item");
  state.items.forEach((it, i) => {
    if (!String(it.name).trim()) missing.push(`Item ${i + 1} — name`);
    if (!it.rate || Number(it.rate) <= 0) missing.push(`Item ${i + 1} — rate`);
  });
  return missing;
}

export function sanitizeFilenamePart(s: string): string {
  return String(s || "")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/-{2,}/g, "-");
}

export function documentFilename(state: DocumentState): string {
  const party = state.party.name || "Party";
  return `${sanitizeFilenamePart(state.docNo)}_${sanitizeFilenamePart(party)}`;
}

export function wordsTotal(grand: number): string {
  return grand > 0
    ? `${numberToWordsIndian(Math.floor(grand))} Rupees Only`
    : "Zero Rupees Only";
}

export function newDocumentClientId(toolId: string): string {
  return `${toolId}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

export function parseDocumentFromApi(raw: Record<string, unknown>): DocumentState {
  const partyRaw = raw.party as Partial<import("@/lib/types/document").DocumentParty> | undefined;
  const itemsRaw = raw.items as import("@/lib/types/document").DocumentItem[] | undefined;
  const base = blankDocumentState(String(raw.docNo ?? ""));

  return {
    id: raw.id != null ? String(raw.id) : null,
    docNo: String(raw.docNo ?? ""),
    docDate: String(raw.docDate ?? todayISO()),
    extraDate: String(raw.extraDate ?? todayISO()),
    party: {
      name: partyRaw?.name ?? "",
      address: partyRaw?.address ?? "",
      phone: partyRaw?.phone ?? "",
      gstin: partyRaw?.gstin ?? "",
      state: partyRaw?.state ?? "",
    },
    items: itemsRaw?.length
      ? itemsRaw.map((it) => ({
          id: Number(it.id),
          name: String(it.name ?? ""),
          hsn: String(it.hsn ?? ""),
          qty: Number(it.qty) || 0,
          unit: String(it.unit ?? "NOS"),
          rate: Number(it.rate) || 0,
        }))
      : base.items,
    igstPct: Number(raw.igstPct) || 18,
    cgstPct: Number(raw.cgstPct) || 0,
    sgstPct: Number(raw.sgstPct) || 0,
    cgstSgstEnabled: Boolean(raw.cgstSgstEnabled),
    notes: String(raw.notes ?? ""),
    status: raw.status === "saved" ? "saved" : "draft",
  };
}
