/**
 * Pure business logic for IMS Quotations — 100% calculation, numbering, terms,
 * and settings parity with Quotation Generator V1, plus IMS-native helpers.
 */

export const QUOTE_CATEGORIES = ["solar", "ups", "battery", "inverter", "other"] as const;
export type QuoteCategory = (typeof QUOTE_CATEGORIES)[number];

export const QUOTE_ENGAGEMENTS = ["epc", "amc", "srv", "setup", "sale", "pm", "stin", "gsr", "misc"] as const;
export type QuoteEngagement = (typeof QUOTE_ENGAGEMENTS)[number];

export const QUOTE_STATUSES = ["draft", "submitted", "sent", "approved", "rejected", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_NUMBERING_MODES = ["v1_category", "ims_fy"] as const;
export type QuoteNumberingMode = (typeof QUOTE_NUMBERING_MODES)[number];

export const QUOTE_CATEGORY_META: Record<QuoteCategory, { label: string; code: string }> = {
  solar: { label: "Solar", code: "SOL" },
  ups: { label: "UPS", code: "UPS" },
  battery: { label: "Battery", code: "BAT" },
  inverter: { label: "Inverter", code: "INV" },
  other: { label: "Other", code: "OTH" },
};

export const QUOTE_ENGAGEMENT_META: Record<QuoteEngagement, { label: string; code: string }> = {
  epc: { label: "Installation (EPC)", code: "EPC" },
  amc: { label: "AMC", code: "AMC" },
  srv: { label: "Repair", code: "RPR" },
  setup: { label: "Setup", code: "STP" },
  sale: { label: "Sale", code: "SEL" },
  pm: { label: "Preventive Maintenance", code: "PM" },
  stin: { label: "Site Inspection", code: "STIN" },
  gsr: { label: "General Service", code: "GSR" },
  misc: { label: "Other", code: "OTH" },
};

const CATEGORY_ENGAGEMENT_OVERRIDES: Partial<
  Record<QuoteCategory, Partial<Record<QuoteEngagement, { label: string; code: string }>>>
> = {
  solar: {
    epc: { label: "Installation", code: "INST" },
    amc: { label: "Annual Maintenance -AMC", code: "AMC" },
    srv: { label: "Repair Works", code: "RPW" },
  },
  ups: {
    setup: { label: "Installation", code: "INST" },
    amc: { label: "Annual Maintenance -AMC", code: "AMC" },
    srv: { label: "Repair Works", code: "RPW" },
    sale: { label: "Sales", code: "SEL" },
  },
  inverter: {
    setup: { label: "Installation", code: "INST" },
    srv: { label: "Repair Works", code: "RPW" },
    sale: { label: "Sales", code: "SEL" },
  },
  battery: { sale: { label: "Sales", code: "SEL" } },
  other: {
    sale: { label: "Sales", code: "SEL" },
    srv: { label: "Repair Works", code: "RPR" },
  },
};

export function quoteEngMeta(category: QuoteCategory, engagement: QuoteEngagement) {
  const base = QUOTE_ENGAGEMENT_META[engagement] ?? QUOTE_ENGAGEMENT_META.misc;
  const override = CATEGORY_ENGAGEMENT_OVERRIDES[category]?.[engagement];
  return override ? { ...base, ...override } : base;
}

export type QuoteLineInput = {
  id?: string;
  itemId?: string | null;
  sku?: string | null;
  desc: string;
  hsn?: string | null;
  unit?: string | null;
  qty: number | string;
  rate: number | string;
  gst: number | string;
  discount?: number | string;
};

export type QuoteExtraCharge = {
  label: string;
  amount: number | string;
  gst: number | string;
};

export type QuoteGstOverride = {
  mode: "auto" | "manual";
  cgst: number | string | null;
  sgst: number | string | null;
  igst: number | string | null;
};

export type QuoteComputedTotals = {
  subtotal: number;
  subtotalGst: number;
  totalGst: number;
  oldBuybackLess: number;
  discountTotal: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  totalTax: number;
  grand: number;
  roundOff: number;
  interState: boolean;
  isManual: boolean;
  exBase: number;
  exGstRate: number;
  exGstAmt: number;
  exTotal: number;
};

/**
 * Exact 1:1 parity with `web/lib/quotation-v1/compute.ts`.
 * Negative line amounts are treated as old-buyback / trade-in deductions (excluded from GST).
 */
export function computeQuoteTotals(input: {
  items: ReadonlyArray<QuoteLineInput>;
  extraCharge?: QuoteExtraCharge | null;
  gstOverride?: QuoteGstOverride | null;
  customerState?: string | null;
  companyState?: string | null;
}): QuoteComputedTotals {
  const cState = String(input.customerState ?? "").trim();
  const bState = String(input.companyState ?? "").trim();
  const interState = Boolean(cState && bState && cState !== bState);

  let subtotal = 0;
  let oldBuybackLess = 0;
  let subtotalGst = 0;
  let discountTotal = 0;
  let itemsTaxable = 0;
  const gstBuckets: Record<number, number> = {};

  for (const it of input.items ?? []) {
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

  const exBase = Number(input.extraCharge?.amount) || 0;
  const exGstRate = Number(input.extraCharge?.gst) || 0;
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

  const manual = input.gstOverride?.mode === "manual";
  let cgstRate: number;
  let sgstRate: number;
  let igstRate: number;
  let cgst: number;
  let sgst: number;
  let igst: number;

  if (manual && input.gstOverride) {
    cgstRate = input.gstOverride.cgst != null ? Number(input.gstOverride.cgst) || 0 : autoCgstRate;
    sgstRate = input.gstOverride.sgst != null ? Number(input.gstOverride.sgst) || 0 : autoSgstRate;
    igstRate = input.gstOverride.igst != null ? Number(input.gstOverride.igst) || 0 : autoIgstRate;
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

/** Format V1-style quote number: `${PREFIX}-${CATCODE}/${ENGCODE}-${YYYY}/${MM}-${0001}` */
export function formatV1QuoteNo(input: {
  prefix: string;
  category: QuoteCategory;
  engagement: QuoteEngagement;
  dateIso: string;
  seq: number;
}): string {
  const p = (input.prefix || "QT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "QT";
  const catCode = (QUOTE_CATEGORY_META[input.category]?.code ?? "OTH").slice(0, 6);
  const engCode = quoteEngMeta(input.category, input.engagement).code.slice(0, 6);
  const d = /^\d{4}-\d{2}/.test(input.dateIso) ? input.dateIso : new Date().toISOString().slice(0, 10);
  const yyyy = d.slice(0, 4);
  const mm = d.slice(5, 7);
  const seqStr = String(Math.max(1, Math.trunc(input.seq))).padStart(4, "0");
  return `${p}-${catCode}/${engCode}-${yyyy}/${mm}-${seqStr}`;
}

/** Parse trailing numeric sequence from a V1 quote number (e.g. `...-0042` -> 42). */
export function parseQuoteTrailingSeq(quoteNo: string | null | undefined): number {
  const m = String(quoteNo ?? "").trim().match(/-(\d{1,6})(?:-R\d+)?$/);
  return m ? Number(m[1]) || 0 : 0;
}

/* ---------- IMS Quotation Settings (stored in ims_settings.quote_settings_json) ---------- */

export type ImsQuoteSettings = {
  /** Prefix used in quote numbers (e.g. `QT` or 3-letter company code). Blank = auto from company name. */
  quotePrefix: string;
  /** `v1_category` = PREFIX-CAT/ENG-YYYY/MM-0001 (V1 parity); `ims_fy` = PREFIX/26-27/0001. */
  numberingMode: QuoteNumberingMode;
  /** Default validity window in days from quotation date. */
  defaultValidityDays: number;
  /** Letterhead extras (V1 Company Profile parity). */
  tagline: string;
  landline: string;
  website: string;
  place: string;
  salesEmail: string;
  managerEmail: string;
  /** Default sheet display options. */
  defaultShowGstColumns: boolean;
  defaultGstNote: string;
  defaultBuybackLabel: string;
  /** Custom Terms & Notes per engagement ("For"). Blank/missing falls back to V1 BASE_TERMS. */
  termsByEngagement: Partial<Record<QuoteEngagement, string>>;
  /** Optional default email template id (matches QuotationEmailTemplateId). */
  defaultEmailTemplateId: string;
};

export const DEFAULT_IMS_QUOTE_SETTINGS: ImsQuoteSettings = {
  quotePrefix: "",
  numberingMode: "v1_category",
  defaultValidityDays: 15,
  tagline: "Quotations · Service · Sales",
  landline: "",
  website: "",
  place: "Bengaluru",
  salesEmail: "",
  managerEmail: "",
  defaultShowGstColumns: true,
  defaultGstNote: "",
  defaultBuybackLabel: "",
  termsByEngagement: {},
  defaultEmailTemplateId: "classic",
};

const clip = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

export function normalizeImsQuoteSettings(raw: unknown): ImsQuoteSettings {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }

  const modeRaw = String(obj.numberingMode ?? "").trim();
  const numberingMode: QuoteNumberingMode = (QUOTE_NUMBERING_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as QuoteNumberingMode)
    : DEFAULT_IMS_QUOTE_SETTINGS.numberingMode;

  const daysRaw = Number(obj.defaultValidityDays);
  const defaultValidityDays = Number.isFinite(daysRaw)
    ? Math.max(0, Math.min(365, Math.trunc(daysRaw)))
    : DEFAULT_IMS_QUOTE_SETTINGS.defaultValidityDays;

  const rawTerms =
    obj.termsByEngagement && typeof obj.termsByEngagement === "object" && !Array.isArray(obj.termsByEngagement)
      ? (obj.termsByEngagement as Record<string, unknown>)
      : {};
  const termsByEngagement: Partial<Record<QuoteEngagement, string>> = {};
  for (const key of QUOTE_ENGAGEMENTS) {
    if (typeof rawTerms[key] === "string" && rawTerms[key].trim()) {
      termsByEngagement[key] = rawTerms[key].trim().slice(0, 6000);
    }
  }

  return {
    quotePrefix: clip(obj.quotePrefix, 8).toUpperCase().replace(/[^A-Z0-9]/g, ""),
    numberingMode,
    defaultValidityDays,
    tagline: clip(obj.tagline, 160) || DEFAULT_IMS_QUOTE_SETTINGS.tagline,
    landline: clip(obj.landline, 40),
    website: clip(obj.website, 160),
    place: clip(obj.place, 80) || DEFAULT_IMS_QUOTE_SETTINGS.place,
    salesEmail: clip(obj.salesEmail, 180),
    managerEmail: clip(obj.managerEmail, 180),
    defaultShowGstColumns:
      typeof obj.defaultShowGstColumns === "boolean"
        ? obj.defaultShowGstColumns
        : DEFAULT_IMS_QUOTE_SETTINGS.defaultShowGstColumns,
    defaultGstNote: clip(obj.defaultGstNote, 300),
    defaultBuybackLabel: clip(obj.defaultBuybackLabel, 120),
    termsByEngagement,
    defaultEmailTemplateId: clip(obj.defaultEmailTemplateId, 40) || DEFAULT_IMS_QUOTE_SETTINGS.defaultEmailTemplateId,
  };
}

export function normalizeQuoteCategory(v: unknown): QuoteCategory {
  const s = String(v ?? "").trim().toLowerCase();
  return (QUOTE_CATEGORIES as readonly string[]).includes(s) ? (s as QuoteCategory) : "other";
}

export function normalizeQuoteEngagement(v: unknown): QuoteEngagement {
  const s = String(v ?? "").trim().toLowerCase();
  return (QUOTE_ENGAGEMENTS as readonly string[]).includes(s) ? (s as QuoteEngagement) : "sale";
}

export function normalizeQuoteStatus(v: unknown): QuoteStatus {
  const s = String(v ?? "").trim().toLowerCase();
  return (QUOTE_STATUSES as readonly string[]).includes(s) ? (s as QuoteStatus) : "draft";
}
