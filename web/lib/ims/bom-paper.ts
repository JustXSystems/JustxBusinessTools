/**
 * BOM paper templates — tenant-wide layouts for live preview and print/PDF.
 * Maps BomDoc / BomDocLine (+ commercial proposal terms) into printable models.
 */
import type { BomBusiness, BomDocLine, BomLineKind, BomTotals } from "./bom";
import { BOM_LINE_KIND_LABEL } from "./bom";

export const BOM_PAPER_TEMPLATES = [
  "aether",
  "classic",
  "tiered",
  "epc",
  "executive",
  "field",
  "aurora",
  "ledger",
  "atelier",
  "prism",
  "orbit",
  "forge",
  "nova",
  "folio",
] as const;

export type BomPaperTemplateId = (typeof BOM_PAPER_TEMPLATES)[number];

export type BomPaperEra = "timeless" | "commercial" | "technical" | "executive" | "field" | "futuristic";

export const BOM_PAPER_ERA_FILTERS: ReadonlyArray<{ id: "all" | BomPaperEra; label: string }> = [
  { id: "all", label: "All" },
  { id: "futuristic", label: "Futuristic" },
  { id: "commercial", label: "Commercial" },
  { id: "technical", label: "Technical" },
  { id: "executive", label: "Executive" },
  { id: "field", label: "Field" },
  { id: "timeless", label: "Classic" },
];

export type BomPaperTemplateMeta = {
  id: BomPaperTemplateId;
  /** Compact picker label */
  short: string;
  label: string;
  tagline: string;
  audience: string;
  era: BomPaperEra;
  features: ReadonlyArray<string>;
};

export const BOM_PAPER_TEMPLATE_META: ReadonlyArray<BomPaperTemplateMeta> = [
  {
    id: "aether",
    short: "Aether",
    label: "Aether Proposal",
    tagline: "Flagship materials proposal — investment hero, SKU/HSN schedule, commercial terms.",
    audience: "Premium dealer & EPC proposals",
    era: "futuristic",
    features: ["Investment hero", "SKU · HSN", "Terms grid", "Section subtotals"],
  },
  {
    id: "classic",
    short: "Classic",
    label: "Classic Dealer",
    tagline: "Refined dealer sheet — clear sections, make, rates, margin & tax.",
    audience: "Day-to-day customer BOM",
    era: "timeless",
    features: ["Accent rail", "Section bands", "Make · rate · amount", "Signatory"],
  },
  {
    id: "tiered",
    short: "Tiered",
    label: "Tiered Proposal",
    tagline: "Marketplace tiers with roll-ups, kind cues and a cost waterfall.",
    audience: "Sales proposals & C&I bids",
    era: "commercial",
    features: ["Tier marks", "Section subtotals", "Kind tags", "Cost waterfall"],
  },
  {
    id: "epc",
    short: "EPC",
    label: "EPC Technical",
    tagline: "Dense EPC / GeM-style schedule with units, remarks and section totals.",
    audience: "Technical packs & tenders",
    era: "technical",
    features: ["Roman sections", "Units column", "Remarks", "Capacity strip"],
  },
  {
    id: "executive",
    short: "Executive",
    label: "Executive Brief",
    tagline: "Board-ready economics first — investment hero, then compact lines.",
    audience: "Owners & decision makers",
    era: "executive",
    features: ["Investment hero", "KPI mosaic", "Section cards", "Acceptance"],
  },
  {
    id: "field",
    short: "Field",
    label: "Field Pack",
    tagline: "Install-crew checklist — quantities only, no commercial rates.",
    audience: "Site teams & technicians",
    era: "field",
    features: ["No pricing", "Check boxes", "Make & remarks", "Site handoff"],
  },
  {
    id: "aurora",
    short: "Aurora",
    label: "Aurora",
    tagline: "Futuristic masthead, soft panels and a living cost composition.",
    audience: "Modern EPC & premium residential",
    era: "futuristic",
    features: ["Signal masthead", "Glass panels", "Composition bars", "Dual sign-off"],
  },
  {
    id: "ledger",
    short: "Ledger",
    label: "Precision Ledger",
    tagline: "Engineering ledger — index rail, mono figures, hairline precision.",
    audience: "Engineers & estimators",
    era: "technical",
    features: ["Index rail", "Mono amounts", "Kind codes", "Tight grid"],
  },
  {
    id: "atelier",
    short: "Atelier",
    label: "Atelier",
    tagline: "Editorial proposal — generous space, display title, quiet luxury.",
    audience: "Boutique & brand-forward sellers",
    era: "commercial",
    features: ["Display title", "Quiet tables", "Section chapters", "Acceptance folio"],
  },
  {
    id: "prism",
    short: "Prism",
    label: "Prism Split",
    tagline: "Split identity rail + schedule — capacity badge and layered totals.",
    audience: "Premium quotes & digital-first print",
    era: "futuristic",
    features: ["Identity rail", "Capacity badge", "Layered totals", "Compact lines"],
  },
  {
    id: "orbit",
    short: "Orbit",
    label: "Orbit Cockpit",
    tagline: "2026 digital-proposal feel — KPI chips, density map, transparent schedule.",
    audience: "Digital-first EPC sales",
    era: "futuristic",
    features: ["KPI cockpit", "Density map", "Transparent rows", "Live total"],
  },
  {
    id: "forge",
    short: "Forge",
    label: "Forge Procurement",
    tagline: "Marketplace / BOQ handoff — stock-first, make as supplier, qty locked.",
    audience: "Procurement & sourcing desks",
    era: "technical",
    features: ["Stock-first", "Supplier make", "Qty lock", "Buy list"],
  },
  {
    id: "nova",
    short: "Nova",
    label: "Nova Close",
    tagline: "Investment narrative for close — capacity, outlay steps, accept strip.",
    audience: "Homeowner & C&I closing packs",
    era: "commercial",
    features: ["Outlay steps", "Capacity focus", "Close strip", "Clean lines"],
  },
  {
    id: "folio",
    short: "Folio",
    label: "Folio Cards",
    tagline: "Mobile-era dossier — one card per line, scannable on phone or print.",
    audience: "Field + customer WhatsApp share",
    era: "futuristic",
    features: ["Line cards", "Scan-friendly", "Kind chips", "Compact total"],
  },
];

export function normalizeBomPaperTemplate(v: unknown): BomPaperTemplateId {
  const s = String(v ?? "").trim().toLowerCase();
  return (BOM_PAPER_TEMPLATES as readonly string[]).includes(s) ? (s as BomPaperTemplateId) : "aether";
}

export function bomPaperTemplateMeta(id: BomPaperTemplateId | null | undefined): BomPaperTemplateMeta {
  const n = normalizeBomPaperTemplate(id);
  return BOM_PAPER_TEMPLATE_META.find((t) => t.id === n) ?? BOM_PAPER_TEMPLATE_META[0]!;
}

export type BomPaperLine = Pick<
  BomDocLine,
  "section" | "description" | "makeText" | "qty" | "unit" | "rate" | "amount" | "remarks"
> & {
  lineKind?: BomLineKind | null;
  sku?: string | null;
  hsn?: string | null;
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

/** Demo model for Settings picker previews — uses only real BOM fields. */
export function sampleBomPaperModel(businessName = "Your business"): {
  business: BomBusiness;
  docNo: string;
  docDate: string;
  status: string;
  title: string;
  capacityLabel: string;
  customerName: string;
  location: string;
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
} {
  const lines: BomPaperLine[] = [
    {
      section: "Main Items",
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
      section: "Main Items",
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
      section: "Accessories & Services",
      lineKind: "stock",
      description: "DC Cable SC 4sqmm (Red & Black)",
      makeText: "Polycab",
      sku: "CBL-DC-4",
      hsn: "8544",
      qty: 60,
      unit: "mtr",
      rate: 45,
      amount: 2700,
      remarks: null,
    },
    {
      section: "Accessories & Services",
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
      section: "Accessories & Services",
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
  ];
  const materialsTotal = 117200;
  const marginPct = 15;
  const taxPct = 8.9;
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
    docNo: "BOM/26-27/0001",
    docDate: "2026-11-11",
    status: "confirmed",
    title: "Residential on-grid package",
    capacityLabel: "3KW 1PH",
    customerName: "Sample Customer",
    location: "Bengaluru",
    projectRef: "SITE-BNG-042",
    preparedBy: "Sales desk",
    notes: "Subsidy scheme · Net metering as applicable.",
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
  };
}
