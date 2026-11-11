/**
 * BOM paper templates — tenant-wide layouts for live preview and print/PDF.
 * Maps only to fields already on BomDoc / BomDocLine (no extra schema).
 */
import type { BomPaperTemplateId } from "./api";
import type { BomBusiness, BomDocLine, BomLineKind, BomTotals } from "./bom";
import { BOM_LINE_KIND_LABEL } from "./bom";

export const BOM_PAPER_TEMPLATES = ["classic", "tiered", "epc", "executive", "field"] as const;
export type { BomPaperTemplateId };

export const BOM_PAPER_TEMPLATE_META: ReadonlyArray<{
  id: BomPaperTemplateId;
  label: string;
  tagline: string;
  audience: string;
  features: ReadonlyArray<string>;
}> = [
  {
    id: "classic",
    label: "Classic Dealer",
    tagline: "Industry dealer sheet — sections, make, rates, margin & tax.",
    audience: "Day-to-day customer BOM",
    features: ["Section bands", "Make column", "Margin / tax footer", "Signatory"],
  },
  {
    id: "tiered",
    label: "Tiered Proposal",
    tagline: "Marketplace-style tiers with section roll-ups and line-kind cues.",
    audience: "Sales proposals & C&I bids",
    features: ["Tier badges", "Section subtotals", "Stock / service / overhead tags", "Cost waterfall"],
  },
  {
    id: "epc",
    label: "EPC Technical",
    tagline: "Dense EPC / GeM-style schedule with units and remarks.",
    audience: "Technical packs & tenders",
    features: ["Roman section marks", "Separate units", "Remarks column", "Capacity strip"],
  },
  {
    id: "executive",
    label: "Executive Summary",
    tagline: "Board-ready overview — section economics first, lines second.",
    audience: "Owners & decision makers",
    features: ["Hero total", "Section cards", "Compact line list", "Acceptance block"],
  },
  {
    id: "field",
    label: "Field Pack",
    tagline: "Install-crew checklist — quantities only, no commercial rates.",
    audience: "Site teams & technicians",
    features: ["No rates / amounts", "Check boxes", "Make & remarks", "Site header"],
  },
];

export function normalizeBomPaperTemplate(v: unknown): BomPaperTemplateId {
  const s = String(v ?? "").trim().toLowerCase();
  return (BOM_PAPER_TEMPLATES as readonly string[]).includes(s) ? (s as BomPaperTemplateId) : "classic";
}

export function bomPaperTemplateMeta(id: BomPaperTemplateId | null | undefined) {
  const n = normalizeBomPaperTemplate(id);
  return BOM_PAPER_TEMPLATE_META.find((t) => t.id === n) ?? BOM_PAPER_TEMPLATE_META[0]!;
}

export type BomPaperLine = Pick<
  BomDocLine,
  "section" | "description" | "makeText" | "qty" | "unit" | "rate" | "amount" | "remarks"
> & { lineKind?: BomLineKind | null };

export type BomPaperSection = {
  name: string;
  index: number;
  roman: string;
  lines: ReadonlyArray<BomPaperLine>;
  materials: number;
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

export function groupBomSections(lines: ReadonlyArray<BomPaperLine>): BomPaperSection[] {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const sections: BomPaperSection[] = [];
  for (const line of lines) {
    const last = sections[sections.length - 1];
    const amount = round2(Number(line.amount ?? Number(line.qty || 0) * Number(line.rate || 0)));
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
  return sections;
}

export function lineKindLabel(kind: BomLineKind | null | undefined): string | null {
  if (!kind) return null;
  return BOM_LINE_KIND_LABEL[kind] ?? kind;
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
  preparedBy: string;
  notes: string;
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
    preparedBy: "Sales desk",
    notes: "Subsidy scheme · Net metering as applicable.",
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
