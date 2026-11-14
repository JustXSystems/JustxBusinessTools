/**
 * BOM paper — purpose-driven layouts, industry packs, and printable models.
 * Legacy aesthetic template ids still normalize to a document purpose.
 */
import type { BomBusiness, BomDocLine, BomLineKind, BomTotals } from "./bom";
import { BOM_LINE_KIND_LABEL } from "./bom";

/* ---------- Document purposes (canonical template ids) ---------- */

export const BOM_PAPER_PURPOSES = ["proposal", "executive", "technical", "field", "share"] as const;
export type BomPaperPurpose = (typeof BOM_PAPER_PURPOSES)[number];

/** @deprecated Prefer BomPaperPurpose — kept as alias for API / settings types. */
export type BomPaperTemplateId = BomPaperPurpose | BomPaperLegacyTemplateId;

/** Historic aesthetic skins — accepted on read, stored as purpose going forward. */
export const BOM_PAPER_LEGACY_TEMPLATES = [
  "aether",
  "classic",
  "tiered",
  "epc",
  "aurora",
  "ledger",
  "atelier",
  "prism",
  "orbit",
  "forge",
  "nova",
  "folio",
] as const;
export type BomPaperLegacyTemplateId = (typeof BOM_PAPER_LEGACY_TEMPLATES)[number];

/** All values the settings column / zod enum may accept. */
export const BOM_PAPER_TEMPLATES = [...BOM_PAPER_PURPOSES, ...BOM_PAPER_LEGACY_TEMPLATES] as const;

const PURPOSE_ALIAS: Record<string, BomPaperPurpose> = {
  proposal: "proposal",
  executive: "executive",
  technical: "technical",
  field: "field",
  share: "share",
  aether: "proposal",
  classic: "proposal",
  tiered: "proposal",
  aurora: "proposal",
  atelier: "proposal",
  prism: "proposal",
  nova: "proposal",
  orbit: "executive",
  epc: "technical",
  ledger: "technical",
  forge: "technical",
  folio: "share",
};

export type BomPaperPurposeMeta = {
  id: BomPaperPurpose;
  short: string;
  label: string;
  tagline: string;
  audience: string;
  features: ReadonlyArray<string>;
};

export const BOM_PAPER_PURPOSE_META: ReadonlyArray<BomPaperPurposeMeta> = [
  {
    id: "proposal",
    short: "Proposal",
    label: "Customer proposal",
    tagline: "Sell sheet — clear schedule, investment summary, commercial terms.",
    audience: "Dealers, distributors, project sales",
    features: ["Investment bar", "Section schedule", "SKU · HSN", "Terms + sign-off"],
  },
  {
    id: "executive",
    short: "Executive",
    label: "Executive brief",
    tagline: "Economics first — KPIs and compact lines for decision makers.",
    audience: "Owners & approvers",
    features: ["Investment hero", "Cost ribbon", "Section roll-ups", "Acceptance"],
  },
  {
    id: "technical",
    short: "Technical",
    label: "Technical BOQ",
    tagline: "Dense schedule with units, remarks and section totals for tenders.",
    audience: "EPC, estimators, procurement",
    features: ["Roman sections", "Units column", "Remarks", "Section totals"],
  },
  {
    id: "field",
    short: "Field",
    label: "Field pack",
    tagline: "Install checklist — quantities only, no commercial rates.",
    audience: "Site teams & technicians",
    features: ["No pricing", "Check boxes", "Make & remarks", "Site handoff"],
  },
  {
    id: "share",
    short: "Share",
    label: "Share cards",
    tagline: "Phone-friendly line cards for WhatsApp and public proposal links.",
    audience: "Customers on mobile",
    features: ["Line cards", "Scan-friendly", "Kind chips", "Compact total"],
  },
];

/** @deprecated Use BOM_PAPER_PURPOSE_META */
export type BomPaperTemplateMeta = BomPaperPurposeMeta & { era?: string };
/** @deprecated */
export type BomPaperEra = BomPaperPurpose | "all";
/** @deprecated */
export const BOM_PAPER_ERA_FILTERS: ReadonlyArray<{ id: "all" | BomPaperPurpose; label: string }> = [
  { id: "all", label: "All" },
  ...BOM_PAPER_PURPOSE_META.map((p) => ({ id: p.id, label: p.short })),
];
/** @deprecated */
export const BOM_PAPER_TEMPLATE_META: ReadonlyArray<BomPaperTemplateMeta> = BOM_PAPER_PURPOSE_META.map((p) => ({
  ...p,
  era: p.id,
}));

export function normalizeBomPaperPurpose(v: unknown): BomPaperPurpose {
  const s = String(v ?? "").trim().toLowerCase();
  return PURPOSE_ALIAS[s] ?? "proposal";
}

/** Normalizes legacy skins and purpose ids to a canonical purpose. */
export function normalizeBomPaperTemplate(v: unknown): BomPaperPurpose {
  return normalizeBomPaperPurpose(v);
}

export function bomPaperPurposeMeta(id: BomPaperPurpose | null | undefined): BomPaperPurposeMeta {
  const n = normalizeBomPaperPurpose(id);
  return BOM_PAPER_PURPOSE_META.find((t) => t.id === n) ?? BOM_PAPER_PURPOSE_META[0]!;
}

/** @deprecated Use bomPaperPurposeMeta */
export function bomPaperTemplateMeta(id: BomPaperTemplateId | null | undefined): BomPaperTemplateMeta {
  return bomPaperPurposeMeta(normalizeBomPaperPurpose(id));
}

/* ---------- Industry packs ---------- */

export const BOM_INDUSTRY_PACKS = ["general", "epc", "solar", "manufacturing", "services", "procurement"] as const;
export type BomIndustryPackId = (typeof BOM_INDUSTRY_PACKS)[number];

export type BomScheduleColumn =
  | "check"
  | "index"
  | "item"
  | "sku"
  | "hsn"
  | "make"
  | "kind"
  | "qty"
  | "unit"
  | "rate"
  | "amount"
  | "remarks";

export type BomIndustryPackMeta = {
  id: BomIndustryPackId;
  short: string;
  label: string;
  tagline: string;
  /** Replaces solar-centric "Capacity" wording. */
  sizeLabel: string;
  defaultSections: ReadonlyArray<string>;
  /** Columns for commercial purposes (proposal / executive / technical / share). */
  columns: ReadonlyArray<BomScheduleColumn>;
  /** Columns for field purpose (never includes rate/amount). */
  fieldColumns: ReadonlyArray<BomScheduleColumn>;
};

export const BOM_INDUSTRY_PACK_META: ReadonlyArray<BomIndustryPackMeta> = [
  {
    id: "general",
    short: "General",
    label: "General commerce",
    tagline: "Item · make · qty · rate — fits dealers, traders and retail.",
    sizeLabel: "Package",
    defaultSections: ["Main Items", "Accessories & Services"],
    columns: ["index", "item", "make", "qty", "unit", "rate", "amount"],
    fieldColumns: ["check", "index", "item", "make", "qty", "remarks"],
  },
  {
    id: "epc",
    short: "EPC",
    label: "EPC / projects",
    tagline: "BOQ-style schedule with units, remarks and section discipline.",
    sizeLabel: "Scope",
    defaultSections: ["Supply", "Installation", "Civil & Misc"],
    columns: ["index", "item", "make", "qty", "unit", "rate", "amount", "remarks"],
    fieldColumns: ["check", "index", "item", "make", "qty", "unit", "remarks"],
  },
  {
    id: "solar",
    short: "Solar",
    label: "Solar / energy",
    tagline: "Capacity-aware packs with SKU/HSN for modules and BOS.",
    sizeLabel: "Capacity",
    defaultSections: ["Main Items", "Accessories & Services"],
    columns: ["index", "item", "sku", "hsn", "make", "qty", "unit", "rate", "amount"],
    fieldColumns: ["check", "index", "item", "make", "qty", "remarks"],
  },
  {
    id: "manufacturing",
    short: "Mfg",
    label: "Manufacturing",
    tagline: "Part-centric schedule — SKU first, kind cues, tight units.",
    sizeLabel: "Batch / rev",
    defaultSections: ["Raw materials", "Components", "Overheads"],
    columns: ["index", "sku", "item", "kind", "qty", "unit", "rate", "amount"],
    fieldColumns: ["check", "index", "sku", "item", "qty", "unit", "remarks"],
  },
  {
    id: "services",
    short: "Services",
    label: "Services / fit-out",
    tagline: "Labour vs material kinds with warranty-friendly remarks.",
    sizeLabel: "Engagement",
    defaultSections: ["Materials", "Labour", "Other"],
    columns: ["index", "item", "kind", "make", "qty", "unit", "rate", "amount"],
    fieldColumns: ["check", "index", "item", "kind", "qty", "remarks"],
  },
  {
    id: "procurement",
    short: "Buy",
    label: "Procurement",
    tagline: "Stock-first buy list — supplier as make, qty locked for sourcing.",
    sizeLabel: "RFQ ref",
    defaultSections: ["Buy list", "Services"],
    columns: ["index", "sku", "item", "make", "qty", "unit", "rate", "amount"],
    fieldColumns: ["check", "index", "sku", "item", "make", "qty", "unit"],
  },
];

export function normalizeBomIndustryPack(v: unknown): BomIndustryPackId {
  const s = String(v ?? "").trim().toLowerCase();
  return (BOM_INDUSTRY_PACKS as readonly string[]).includes(s) ? (s as BomIndustryPackId) : "general";
}

export function bomIndustryPackMeta(id: BomIndustryPackId | null | undefined): BomIndustryPackMeta {
  const n = normalizeBomIndustryPack(id);
  return BOM_INDUSTRY_PACK_META.find((p) => p.id === n) ?? BOM_INDUSTRY_PACK_META[0]!;
}

export function bomPackFromBusinessType(businessType: string | null | undefined): BomIndustryPackId {
  switch (String(businessType ?? "").toLowerCase()) {
    case "manufacturer":
    case "manufacturing":
      return "manufacturing";
    case "distributor":
    case "wholesaler":
    case "procurement":
      return "procurement";
    case "epc":
    case "contractor":
    case "projects":
      return "epc";
    case "solar":
    case "energy":
    case "renewable":
      return "solar";
    case "services":
    case "service":
    case "fitout":
    case "fit-out":
      return "services";
    case "dealer":
    case "retailer":
    case "trader":
      return "general";
    default:
      return "general";
  }
}

/** Columns users can toggle in Settings (order is display order). */
export const BOM_CONFIGURABLE_COLUMNS: ReadonlyArray<BomScheduleColumn> = [
  "index",
  "item",
  "sku",
  "hsn",
  "make",
  "kind",
  "qty",
  "unit",
  "rate",
  "amount",
  "remarks",
];

/** Always kept on commercial / field schedules. */
export const BOM_REQUIRED_COLUMNS: ReadonlyArray<BomScheduleColumn> = ["item", "qty"];

export const BOM_COLUMN_LABEL: Record<BomScheduleColumn, string> = {
  check: "✓",
  index: "#",
  item: "Item",
  sku: "SKU",
  hsn: "HSN",
  make: "Make",
  kind: "Kind",
  qty: "Qty",
  unit: "Unit",
  rate: "Rate",
  amount: "Amount",
  remarks: "Remarks",
};

function packDefaultColumns(purpose: BomPaperPurpose, pack: BomIndustryPackId): ReadonlyArray<BomScheduleColumn> {
  const meta = bomIndustryPackMeta(pack);
  if (purpose === "field") return meta.fieldColumns;
  if (purpose === "executive") return meta.columns.filter((c) => c !== "sku" && c !== "hsn");
  if (purpose === "share") return meta.columns.filter((c) => c !== "hsn");
  return meta.columns;
}

/** Parse saved column preference; empty/invalid → fallback (usually pack defaults). */
export function normalizeBomScheduleColumns(
  v: unknown,
  fallback: ReadonlyArray<BomScheduleColumn> = ["index", "item", "make", "qty", "unit", "rate", "amount"],
): BomScheduleColumn[] {
  const allowed = new Set<string>(BOM_CONFIGURABLE_COLUMNS);
  let raw: unknown[] = [];
  if (Array.isArray(v)) raw = v;
  else if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = [];
    }
  }
  if (!raw.length) return [...fallback].filter((c) => c !== "check");
  const picked = new Set<BomScheduleColumn>();
  for (const x of raw) {
    const id = String(x ?? "")
      .trim()
      .toLowerCase();
    if (allowed.has(id)) picked.add(id as BomScheduleColumn);
  }
  for (const req of BOM_REQUIRED_COLUMNS) picked.add(req);
  return BOM_CONFIGURABLE_COLUMNS.filter((c) => picked.has(c));
}

/**
 * Resolve schedule columns for preview/PDF.
 * `override` (settings or per-doc) wins when present; field purpose never shows rate/amount.
 */
export function scheduleColumnsFor(
  purpose: BomPaperPurpose,
  pack: BomIndustryPackId,
  override?: ReadonlyArray<BomScheduleColumn> | null,
): ReadonlyArray<BomScheduleColumn> {
  const packCols = packDefaultColumns(purpose, pack);
  const hasOverride = Array.isArray(override) && override.length > 0;
  const base = hasOverride ? normalizeBomScheduleColumns(override, packCols) : [...packCols];
  if (purpose === "field") {
    const noPrice = base.filter((c) => c !== "rate" && c !== "amount" && c !== "check");
    return ["check", ...noPrice];
  }
  return base.filter((c) => c !== "check");
}

/* ---------- Tone & density ---------- */

export const BOM_PAPER_TONES = ["neutral", "bold", "editorial"] as const;
export type BomPaperTone = (typeof BOM_PAPER_TONES)[number];

export function normalizeBomPaperTone(v: unknown): BomPaperTone {
  const s = String(v ?? "").trim().toLowerCase();
  return (BOM_PAPER_TONES as readonly string[]).includes(s) ? (s as BomPaperTone) : "neutral";
}

export const BOM_PAPER_DENSITIES = ["compact", "comfort"] as const;
export type BomPaperDensity = (typeof BOM_PAPER_DENSITIES)[number];

export function normalizeBomPaperDensity(v: unknown): BomPaperDensity {
  const s = String(v ?? "").trim().toLowerCase();
  return (BOM_PAPER_DENSITIES as readonly string[]).includes(s) ? (s as BomPaperDensity) : "comfort";
}

/** Days from `fromIso` (YYYY-MM-DD) until validUntil; null if missing/invalid. */
export function bomValidityDaysRemaining(validUntil: string | null | undefined, fromIso?: string | null): number | null {
  const until = String(validUntil ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return null;
  const from = String(fromIso ?? "").trim().slice(0, 10);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00`) : new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(`${until}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** Fill missing BOM paper settings so older API payloads still render. */
export function withBomPaperSettingsDefaults<T extends Record<string, unknown>>(settings: T): T & {
  bomPaperTemplate: BomPaperPurpose;
  bomIndustryPack: BomIndustryPackId;
  bomPaperTone: BomPaperTone;
  bomPaperDensity: BomPaperDensity;
  bomHideMargin: boolean;
  bomScheduleColumns: BomScheduleColumn[] | null;
} {
  const pack = normalizeBomIndustryPack(settings.bomIndustryPack);
  const purpose = normalizeBomPaperPurpose(settings.bomPaperTemplate);
  const rawCols = settings.bomScheduleColumns;
  const hasCols = Array.isArray(rawCols) && rawCols.length > 0;
  return {
    ...settings,
    bomPaperTemplate: purpose,
    bomIndustryPack: pack,
    bomPaperTone: normalizeBomPaperTone(settings.bomPaperTone),
    bomPaperDensity: normalizeBomPaperDensity(settings.bomPaperDensity),
    bomHideMargin: Boolean(settings.bomHideMargin),
    bomScheduleColumns: hasCols
      ? normalizeBomScheduleColumns(rawCols, scheduleColumnsFor(purpose, pack))
      : null,
  };
}

/* ---------- Line / section helpers ---------- */

export type BomPaperLine = Pick<
  BomDocLine,
  "section" | "description" | "makeText" | "qty" | "unit" | "rate" | "amount" | "remarks"
> & {
  lineKind?: BomLineKind | null;
  sku?: string | null;
  hsn?: string | null;
  optionalFlag?: boolean | null;
  optionKey?: string | null;
  /** Count of linked alternate SKUs (shown as “N alts”). */
  alternateCount?: number | null;
  /** Qty already issued to site (field pack uses remaining = qty − issued). */
  issuedQty?: number | null;
};

export type BomPaperSection = {
  name: string;
  index: number;
  roman: string;
  lines: ReadonlyArray<BomPaperLine>;
  materials: number;
  /** 0–100 share of materials total (for composition bars). */
  sharePct: number;
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineAmount(line: Pick<BomPaperLine, "qty" | "rate" | "amount">): number {
  return round2(Number(line.amount ?? Number(line.qty || 0) * Number(line.rate || 0)));
}

export function groupBomSections(lines: ReadonlyArray<BomPaperLine>, materialsTotal?: number): BomPaperSection[] {
  const sections: Array<Omit<BomPaperSection, "sharePct"> & { sharePct?: number }> = [];
  for (const line of lines) {
    const last = sections[sections.length - 1];
    const amount = lineAmount(line);
    if (!last || last.name !== line.section) {
      const index = sections.length;
      sections.push({
        name: line.section || "Main Items",
        index,
        roman: ROMAN[index] ?? String(index + 1),
        lines: [line],
        materials: amount,
      });
    } else {
      last.lines = [...last.lines, line];
      last.materials = round2(last.materials + amount);
    }
  }
  const base = materialsTotal && materialsTotal > 0 ? materialsTotal : sections.reduce((s, x) => s + x.materials, 0);
  return sections.map((sec) => ({
    ...sec,
    sharePct: base > 0 ? Math.round((sec.materials / base) * 1000) / 10 : 0,
  }));
}

export function lineKindLabel(kind: BomLineKind | null | undefined): string | null {
  if (!kind) return null;
  return BOM_LINE_KIND_LABEL[kind] ?? kind;
}

export function lineKindCode(kind: BomLineKind | null | undefined): string {
  switch (kind) {
    case "stock":
      return "STK";
    case "service":
      return "SRV";
    case "overhead":
      return "OVH";
    case "scaled":
      return "SCL";
    default:
      return "—";
  }
}

export function lineIdentityBits(line: Pick<BomPaperLine, "sku" | "hsn">): string[] {
  const bits: string[] = [];
  if (line.sku?.trim()) bits.push(line.sku.trim());
  if (line.hsn?.trim()) bits.push(`HSN ${line.hsn.trim()}`);
  return bits;
}

export type BomCostComposition = {
  materials: number;
  margin: number;
  tax: number;
  grand: number;
  subtotal: number;
  materialsPct: number;
  marginPctOfGrand: number;
  taxPctOfGrand: number;
};

export function bomCostComposition(totals: BomTotals): BomCostComposition {
  const materials = round2(totals.materialsTotal);
  const margin = round2(totals.marginAmount);
  const tax = round2(totals.taxAmount);
  const grand = round2(totals.grandTotal) || 1;
  const subtotal = round2(materials + margin);
  return {
    materials,
    margin,
    tax,
    grand: totals.grandTotal,
    subtotal,
    materialsPct: Math.round((materials / grand) * 1000) / 10,
    marginPctOfGrand: Math.round((margin / grand) * 1000) / 10,
    taxPctOfGrand: Math.round((tax / grand) * 1000) / 10,
  };
}

/** Customer-facing totals when margin is hidden — fold margin into sell rates conceptually. */
export function bomCustomerComposition(totals: BomTotals, hideMargin: boolean): BomCostComposition {
  const c = bomCostComposition(totals);
  if (!hideMargin) return c;
  return {
    ...c,
    materials: c.subtotal,
    margin: 0,
    materialsPct: Math.round((c.subtotal / (c.grand || 1)) * 1000) / 10,
    marginPctOfGrand: 0,
  };
}

/** Factor that lifts materials line amounts to include document margin. */
export function bomCustomerMarginFactor(materialsTotal: number, marginAmount: number): number {
  const materials = Math.max(0, Number(materialsTotal) || 0);
  const margin = Math.max(0, Number(marginAmount) || 0);
  if (materials <= 0) return 1;
  return (materials + margin) / materials;
}

/**
 * Customer PDF line sell prices — when hideMargin, distribute margin into rate/amount
 * so line figures reconcile with the folded supply total.
 */
export function bomCustomerLinePricing(
  line: Pick<BomPaperLine, "qty" | "rate" | "amount">,
  factor: number,
  hideMargin: boolean,
): { rate: number; amount: number } {
  const amount = lineAmount(line);
  if (!hideMargin || factor === 1) {
    return { rate: Number(line.rate) || 0, amount };
  }
  const qty = Number(line.qty) || 0;
  const sellAmount = round2(amount * factor);
  const sellRate = qty > 0 ? round2(sellAmount / qty) : round2((Number(line.rate) || 0) * factor);
  return { rate: sellRate, amount: sellAmount };
}

/** Remaining qty for field checklists (never negative). */
export function bomFieldRemainingQty(line: Pick<BomPaperLine, "qty" | "issuedQty">): number {
  const qty = Number(line.qty) || 0;
  const issued = Math.max(0, Number(line.issuedQty) || 0);
  return Math.max(0, round2(qty - issued));
}

export type BomOptionAppendixRow = {
  description: string;
  section: string;
  makeText: string | null;
  optionKey: string | null;
  optional: boolean;
  alternateCount: number;
  qty: number;
  unit: string;
};

/** Lines that carry commercial option / alternate metadata for a proposal appendix. */
export function bomOptionAppendix(lines: ReadonlyArray<BomPaperLine>): BomOptionAppendixRow[] {
  return lines
    .filter(
      (l) =>
        Boolean(l.optionalFlag) ||
        Boolean(String(l.optionKey ?? "").trim()) ||
        (Number(l.alternateCount) || 0) > 0,
    )
    .map((l) => ({
      description: l.description,
      section: l.section || "Main Items",
      makeText: l.makeText ?? null,
      optionKey: String(l.optionKey ?? "").trim() || null,
      optional: Boolean(l.optionalFlag),
      alternateCount: Number(l.alternateCount) || 0,
      qty: Number(l.qty) || 0,
      unit: l.unit || "",
    }));
}

/**
 * Place of supply for GST breakup — customer billing state only.
 * Site/city `location` is never used (cities are not GST states).
 */
export function bomPlaceOfSupply(customerState?: string | null): string | null {
  const s = String(customerState ?? "").trim();
  return s || null;
}

export type BomTaxBreakup = {
  intraState: boolean;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  halfPct: number;
};

function normalizeStateToken(v: string | null | undefined): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

/** Split BOM tax into CGST/SGST or IGST from seller vs customer place of supply. */
export function bomTaxBreakup(
  taxAmount: number,
  taxPct: number,
  sellerState?: string | null,
  placeOfSupply?: string | null,
): BomTaxBreakup {
  const taxTotal = round2(taxAmount);
  const a = normalizeStateToken(sellerState);
  const b = normalizeStateToken(placeOfSupply);
  // Unknown PoS → treat as intra (conservative default matching invoice helper).
  const intraState = !a || !b || a === b;
  const cgst = intraState ? round2(taxTotal / 2) : 0;
  const sgst = intraState ? round2(taxTotal - cgst) : 0;
  const igst = intraState ? 0 : taxTotal;
  const halfPct = round2((Number(taxPct) || 0) / 2);
  return { intraState, taxTotal, cgst, sgst, igst, halfPct };
}

/** Demo model for Settings picker previews — pack-aware sample lines. */
export function sampleBomPaperModel(
  businessName = "Your business",
  pack: BomIndustryPackId = "general",
): {
  business: BomBusiness;
  docNo: string;
  docDate: string;
  status: string;
  title: string;
  capacityLabel: string;
  customerName: string;
  /** Site / city (not GST place of supply). */
  location: string;
  /** Customer billing state for CGST/SGST vs IGST. */
  customerState: string;
  projectRef: string;
  preparedBy: string;
  notes: string;
  revision: number;
  validUntil: string;
  paymentTerms: string;
  deliveryTerms: string;
  warrantyTerms: string;
  marginPct: number;
  taxPct: number;
  lines: BomPaperLine[];
  totals: BomTotals;
  industryPack: BomIndustryPackId;
} {
  const packMeta = bomIndustryPackMeta(pack);
  const lines: BomPaperLine[] =
    pack === "solar"
      ? [
          {
            section: packMeta.defaultSections[0]!,
            lineKind: "stock",
            description: "Solar Modules Bifacial DCR 620Wp",
            makeText: "Waaree / Adani / Vikram",
            sku: "MOD-620-DCR",
            hsn: "8541",
            qty: 6,
            unit: "nos",
            rate: 12500,
            amount: 75000,
            remarks: "ALMM listed",
          },
          {
            section: packMeta.defaultSections[0]!,
            lineKind: "stock",
            description: "On-Grid Inverter 3KW-1PH",
            makeText: "Solis / Sungrow",
            sku: "INV-3K-1PH",
            hsn: "8504",
            qty: 1,
            unit: "nos",
            rate: 28000,
            amount: 28000,
            remarks: null,
          },
          {
            section: packMeta.defaultSections[1]!,
            lineKind: "service",
            description: "Installation charges",
            makeText: "Third party",
            sku: null,
            hsn: null,
            qty: 1,
            unit: "job",
            rate: 9000,
            amount: 9000,
            remarks: "Includes commissioning",
          },
          {
            section: packMeta.defaultSections[1]!,
            lineKind: "overhead",
            description: "Transport & handling",
            makeText: "Own",
            sku: null,
            hsn: null,
            qty: 1,
            unit: "job",
            rate: 2500,
            amount: 2500,
            remarks: null,
          },
        ]
      : pack === "manufacturing"
        ? [
            {
              section: packMeta.defaultSections[0]!,
              lineKind: "stock",
              description: "Aluminium extrusion 40×40",
              makeText: "Hindalco",
              sku: "ALU-4040",
              hsn: "7604",
              qty: 120,
              unit: "mtr",
              rate: 85,
              amount: 10200,
              remarks: null,
            },
            {
              section: packMeta.defaultSections[1]!,
              lineKind: "stock",
              description: "Fastener kit M6",
              makeText: "Unbrako",
              sku: "FST-M6",
              hsn: "7318",
              qty: 200,
              unit: "nos",
              rate: 4.5,
              amount: 900,
              remarks: null,
            },
            {
              section: packMeta.defaultSections[2]!,
              lineKind: "overhead",
              description: "Shop consumables",
              makeText: "Various",
              sku: null,
              hsn: null,
              qty: 1,
              unit: "lot",
              rate: 1500,
              amount: 1500,
              remarks: null,
            },
          ]
        : pack === "services"
          ? [
              {
                section: packMeta.defaultSections[0]!,
                lineKind: "stock",
                description: "Acoustic wall panels",
                makeText: "Armstrong",
                sku: "ACP-24",
                hsn: "4418",
                qty: 45,
                unit: "sqm",
                rate: 1200,
                amount: 54000,
                remarks: null,
              },
              {
                section: packMeta.defaultSections[1]!,
                lineKind: "service",
                description: "Installation labour",
                makeText: "In-house",
                sku: null,
                hsn: null,
                qty: 3,
                unit: "day",
                rate: 4500,
                amount: 13500,
                remarks: "2 technicians",
              },
              {
                section: packMeta.defaultSections[2]!,
                lineKind: "overhead",
                description: "Scaffolding hire",
                makeText: "Vendor",
                sku: null,
                hsn: null,
                qty: 1,
                unit: "job",
                rate: 3200,
                amount: 3200,
                remarks: null,
              },
            ]
          : pack === "epc"
            ? [
                {
                  section: packMeta.defaultSections[0]!,
                  lineKind: "stock",
                  description: "LT panel 415V — form 4b",
                  makeText: "Schneider / L&T",
                  sku: "PNL-LT-415",
                  hsn: "8537",
                  qty: 1,
                  unit: "set",
                  rate: 185000,
                  amount: 185000,
                  remarks: "Factory tested",
                  optionalFlag: false,
                  optionKey: null,
                  alternateCount: 2,
                },
                {
                  section: packMeta.defaultSections[0]!,
                  lineKind: "stock",
                  description: "XLPE cable 3.5C × 240 sqmm",
                  makeText: "Polycab / KEI",
                  sku: "CBL-240-35",
                  hsn: "8544",
                  qty: 180,
                  unit: "mtr",
                  rate: 980,
                  amount: 176400,
                  remarks: "Incl. terminations",
                },
                {
                  section: packMeta.defaultSections[1]!,
                  lineKind: "service",
                  description: "Erection & commissioning",
                  makeText: "Own crew",
                  sku: null,
                  hsn: null,
                  qty: 1,
                  unit: "lot",
                  rate: 45000,
                  amount: 45000,
                  remarks: "As per BOQ notes",
                  optionalFlag: true,
                  optionKey: "EC-A",
                  alternateCount: 0,
                },
                {
                  section: packMeta.defaultSections[2]!,
                  lineKind: "service",
                  description: "Civil foundation for panels",
                  makeText: "Local civil",
                  sku: null,
                  hsn: null,
                  qty: 1,
                  unit: "lot",
                  rate: 28000,
                  amount: 28000,
                  remarks: "Exclude excavation beyond 1.2m",
                },
              ]
            : pack === "procurement"
              ? [
                  {
                    section: packMeta.defaultSections[0]!,
                    lineKind: "stock",
                    description: "Servo motor 1.5kW",
                    makeText: "Yaskawa",
                    sku: "SRV-1K5",
                    hsn: "8501",
                    qty: 4,
                    unit: "nos",
                    rate: 22000,
                    amount: 88000,
                    remarks: "Lead 3 weeks",
                    alternateCount: 1,
                  },
                  {
                    section: packMeta.defaultSections[0]!,
                    lineKind: "stock",
                    description: "Proximity sensor M18 PNP",
                    makeText: "Omron / Autonics",
                    sku: "SNS-M18",
                    hsn: "8536",
                    qty: 20,
                    unit: "nos",
                    rate: 850,
                    amount: 17000,
                    remarks: "MOQ 10",
                  },
                  {
                    section: packMeta.defaultSections[1]!,
                    lineKind: "service",
                    description: "Inbound QC & kitting",
                    makeText: "Store",
                    sku: null,
                    hsn: null,
                    qty: 1,
                    unit: "job",
                    rate: 3500,
                    amount: 3500,
                    remarks: null,
                  },
                ]
              : [
                  {
                    section: packMeta.defaultSections[0]!,
                    lineKind: "stock",
                    description: "Primary supply item",
                    makeText: "OEM / Approved make",
                    sku: "SKU-1001",
                    hsn: "8504",
                    qty: 10,
                    unit: "nos",
                    rate: 4500,
                    amount: 45000,
                    remarks: null,
                  },
                  {
                    section: packMeta.defaultSections[0]!,
                    lineKind: "stock",
                    description: "Secondary component",
                    makeText: "Local",
                    sku: "SKU-1002",
                    hsn: "8536",
                    qty: 25,
                    unit: "nos",
                    rate: 320,
                    amount: 8000,
                    remarks: null,
                  },
                  {
                    section: packMeta.defaultSections[1] ?? "Services",
                    lineKind: "service",
                    description: "Installation / commissioning",
                    makeText: "Own crew",
                    sku: null,
                    hsn: null,
                    qty: 1,
                    unit: "job",
                    rate: 7500,
                    amount: 7500,
                    remarks: "Includes handover",
                  },
                  {
                    section: packMeta.defaultSections[1] ?? "Services",
                    lineKind: "overhead",
                    description: "Freight & packing",
                    makeText: "Courier",
                    sku: null,
                    hsn: null,
                    qty: 1,
                    unit: "job",
                    rate: 1800,
                    amount: 1800,
                    remarks: null,
                  },
                ];

  const materialsTotal = round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
  const marginPct = 15;
  const taxPct = 18;
  const marginAmount = Math.round(materialsTotal * marginPct) / 100;
  const after = materialsTotal + marginAmount;
  const taxAmount = Math.round(after * taxPct) / 100;
  return {
    business: {
      name: businessName,
      gstin: "29AAAAA0000A1Z5",
      address: "Sample address",
      state: "Karnataka",
      phone: "+91 90000 00000",
      email: "hello@example.com",
      logoUrl: null,
    },
    docNo: "ZIG-BOM-2026/11-0001",
    docDate: "2026-11-11",
    status: "confirmed",
    title: `${packMeta.label} proposal`,
    capacityLabel: pack === "solar" ? "3KW 1PH" : packMeta.sizeLabel === "Capacity" ? "—" : "Standard",
    customerName: "Sample Customer",
    location: "Bengaluru",
    customerState: "Karnataka",
    projectRef: "SITE-BNG-042",
    preparedBy: "Sales desk",
    notes: "Prices valid as per terms. Scope exclusions apply unless listed.",
    revision: 1,
    validUntil: "2026-12-11",
    paymentTerms: "40% advance · 60% on delivery",
    deliveryTerms: "7–10 working days after advance",
    warrantyTerms: "As per OEM · Workmanship 1 year",
    marginPct,
    taxPct,
    lines,
    totals: {
      materialsTotal,
      marginAmount,
      taxAmount,
      grandTotal: after + taxAmount,
    },
    industryPack: pack,
  };
}

/** Optional commercial demo fields for settings preview models. */
export function withCommercialSample<T extends Record<string, unknown>>(model: T): T & {
  scopeOfSupply: string;
  exclusions: string;
  business: T extends { business: infer B } ? B & {
    bankName: string;
    bankBranch: string;
    bankAccount: string;
    bankIfsc: string;
    bankUpi: string;
  } : never;
} {
  const business = {
    ...((model as { business?: Record<string, unknown> }).business ?? {}),
    bankName: "HDFC Bank",
    bankBranch: "MG Road",
    bankAccount: "XXXX1234",
    bankIfsc: "HDFC0001234",
    bankUpi: "sales@example",
  };
  return {
    ...model,
    scopeOfSupply: "Supply of listed materials and standard commissioning as noted.",
    exclusions: "Civil works, statutory fees, and extra cabling beyond schedule.",
    business,
  } as never;
}
