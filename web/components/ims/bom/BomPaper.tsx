"use client";

import type { BomBusiness, BomDoc, BomTotals } from "@/lib/ims/bom";
import {
  bomPaperTemplateMeta,
  normalizeBomPaperTemplate,
  type BomPaperLine,
  type BomPaperTemplateId,
} from "@/lib/ims/bom-paper";
import {
  AtelierBomPaper,
  AuroraBomPaper,
  ClassicBomPaper,
  EpcBomPaper,
  ExecutiveBomPaper,
  FieldBomPaper,
  FolioBomPaper,
  ForgeBomPaper,
  LedgerBomPaper,
  NovaBomPaper,
  OrbitBomPaper,
  PrismBomPaper,
  TieredBomPaper,
} from "./bom-paper-layouts";

export type BomPaperModel = {
  business: BomBusiness;
  docNo?: string | null;
  docDate?: string | null;
  status?: string | null;
  title: string;
  capacityLabel: string;
  customerName: string;
  location: string;
  preparedBy?: string | null;
  notes?: string | null;
  marginPct: number;
  taxPct: number;
  lines: ReadonlyArray<BomPaperLine>;
  totals: BomTotals;
  /** Tenant default from Settings → Documents. */
  template?: BomPaperTemplateId | null;
};

export function modelFromDoc(doc: BomDoc, business: BomBusiness, template?: BomPaperTemplateId | null): BomPaperModel {
  return {
    business,
    docNo: doc.docNo,
    docDate: doc.docDate,
    status: doc.status,
    title: doc.title || doc.packageName || "Bill of materials",
    capacityLabel: doc.capacityLabel || "",
    customerName: doc.customerName || "",
    location: doc.location || "",
    preparedBy: doc.preparedBy,
    notes: doc.notes,
    marginPct: doc.marginPct,
    taxPct: doc.taxPct,
    lines: (doc.lines ?? []).map((l) => ({
      section: l.section,
      lineKind: l.lineKind,
      description: l.description,
      makeText: l.makeText,
      qty: l.qty,
      unit: l.unit,
      rate: l.rate,
      amount: l.amount,
      remarks: l.remarks,
    })),
    totals: {
      materialsTotal: doc.materialsTotal,
      marginAmount: doc.marginAmount,
      taxAmount: doc.taxAmount,
      grandTotal: doc.grandTotal,
    },
    template,
  };
}

/** Printable commercial BOM sheet — layout chosen in IMS Settings → Documents. */
export function BomPaper({ model }: { model: BomPaperModel }) {
  const template = normalizeBomPaperTemplate(model.template);
  switch (template) {
    case "tiered":
      return <TieredBomPaper model={model} />;
    case "epc":
      return <EpcBomPaper model={model} />;
    case "executive":
      return <ExecutiveBomPaper model={model} />;
    case "field":
      return <FieldBomPaper model={model} />;
    case "aurora":
      return <AuroraBomPaper model={model} />;
    case "ledger":
      return <LedgerBomPaper model={model} />;
    case "atelier":
      return <AtelierBomPaper model={model} />;
    case "prism":
      return <PrismBomPaper model={model} />;
    case "orbit":
      return <OrbitBomPaper model={model} />;
    case "forge":
      return <ForgeBomPaper model={model} />;
    case "nova":
      return <NovaBomPaper model={model} />;
    case "folio":
      return <FolioBomPaper model={model} />;
    case "classic":
    default:
      return <ClassicBomPaper model={model} />;
  }
}

export function BomPaperTemplateLabel({ id }: { id: BomPaperTemplateId | null | undefined }) {
  return <>{bomPaperTemplateMeta(id).label}</>;
}
