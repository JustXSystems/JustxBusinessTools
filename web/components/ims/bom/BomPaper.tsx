"use client";

import type { BomBusiness, BomDoc, BomTotals } from "@/lib/ims/bom";
import {
  bomPaperPurposeMeta,
  normalizeBomIndustryPack,
  normalizeBomPaperDensity,
  normalizeBomPaperPurpose,
  normalizeBomPaperTone,
  type BomIndustryPackId,
  type BomPaperDensity,
  type BomPaperLine,
  type BomPaperPurpose,
  type BomPaperTemplateId,
  type BomPaperTone,
  type BomScheduleColumn,
} from "@/lib/ims/bom-paper";
import {
  ExecutiveBomPaper,
  FieldBomPaper,
  ProposalBomPaper,
  ShareBomPaper,
  TechnicalBomPaper,
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
  /** Customer billing state for GST place of supply (not site city). */
  customerState?: string | null;
  projectRef?: string | null;
  preparedBy?: string | null;
  notes?: string | null;
  revision?: number | null;
  validUntil?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  warrantyTerms?: string | null;
  scopeOfSupply?: string | null;
  exclusions?: string | null;
  marginPct: number;
  taxPct: number;
  lines: ReadonlyArray<BomPaperLine>;
  totals: BomTotals;
  /** Document purpose (legacy skin ids still accepted). */
  template?: BomPaperTemplateId | null;
  industryPack?: BomIndustryPackId | null;
  tone?: BomPaperTone | null;
  density?: BomPaperDensity | null;
  /** When true, customer PDF folds margin into supply total. */
  hideMargin?: boolean | null;
  /** Tenant/doc schedule column preference (null = pack defaults). */
  scheduleColumns?: ReadonlyArray<BomScheduleColumn> | null;
};

export type BomPaperOptions = {
  template?: BomPaperTemplateId | null;
  industryPack?: BomIndustryPackId | null;
  tone?: BomPaperTone | null;
  density?: BomPaperDensity | null;
  hideMargin?: boolean | null;
  customerState?: string | null;
  scheduleColumns?: ReadonlyArray<BomScheduleColumn> | null;
};

export function modelFromDoc(doc: BomDoc, business: BomBusiness, options?: BomPaperOptions | BomPaperTemplateId | null): BomPaperModel {
  const opts: BomPaperOptions =
    typeof options === "string" || options == null
      ? { template: options as BomPaperTemplateId | null | undefined }
      : options;
  return {
    business,
    docNo: doc.docNo,
    docDate: doc.docDate,
    status: doc.status,
    title: doc.title || doc.packageName || "Materials proposal",
    capacityLabel: doc.capacityLabel || "",
    customerName: doc.customerName || "",
    location: doc.location || "",
    customerState: opts.customerState ?? null,
    projectRef: doc.projectRef ?? null,
    preparedBy: doc.preparedBy,
    notes: doc.notes,
    revision: doc.revision ?? 1,
    validUntil: doc.validUntil ?? null,
    paymentTerms: doc.paymentTerms ?? null,
    deliveryTerms: doc.deliveryTerms ?? null,
    warrantyTerms: doc.warrantyTerms ?? null,
    scopeOfSupply: doc.scopeOfSupply ?? null,
    exclusions: doc.exclusions ?? null,
    marginPct: doc.marginPct,
    taxPct: doc.taxPct,
    lines: (doc.lines ?? []).map((l) => ({
      section: l.section,
      lineKind: l.lineKind,
      description: l.description,
      makeText: l.makeText,
      sku: l.itemSku,
      hsn: l.itemHsn ?? null,
      qty: l.qty,
      unit: l.unit,
      rate: l.rate,
      amount: l.amount,
      remarks: l.remarks,
      optionalFlag: Boolean(l.optionalFlag),
      optionKey: l.optionKey ?? null,
      alternateCount: Array.isArray(l.alternateItemIds) ? l.alternateItemIds.length : 0,
      issuedQty: Number(l.issuedQty) || 0,
    })),
    totals: {
      materialsTotal: doc.materialsTotal,
      marginAmount: doc.marginAmount,
      taxAmount: doc.taxAmount,
      grandTotal: doc.grandTotal,
    },
    template: opts.template ?? (doc.paper?.purpose as BomPaperTemplateId | undefined) ?? null,
    industryPack: opts.industryPack ?? (doc.paper?.industryPack as BomIndustryPackId | undefined) ?? null,
    tone: opts.tone ?? (doc.paper?.tone as BomPaperTone | undefined) ?? null,
    density: opts.density ?? (doc.paper?.density as BomPaperDensity | undefined) ?? null,
    hideMargin: opts.hideMargin ?? doc.paper?.hideMargin ?? null,
    scheduleColumns:
      opts.scheduleColumns ??
      (Array.isArray(doc.paper?.columns) ? (doc.paper!.columns as BomScheduleColumn[]) : null),
  };
}

/** Merge tenant defaults with optional per-doc paper override. */
export function mergePaperOptions(
  tenant: BomPaperOptions,
  docPaper?: {
    purpose?: string | null;
    industryPack?: string | null;
    tone?: string | null;
    density?: string | null;
    hideMargin?: boolean | null;
    columns?: ReadonlyArray<string> | null;
  } | null,
): BomPaperOptions {
  const docCols = Array.isArray(docPaper?.columns) ? (docPaper!.columns as BomScheduleColumn[]) : null;
  return {
    template: (docPaper?.purpose as BomPaperTemplateId | undefined) || tenant.template,
    industryPack: (docPaper?.industryPack as BomIndustryPackId | undefined) || tenant.industryPack,
    tone: (docPaper?.tone as BomPaperTone | undefined) || tenant.tone,
    density: (docPaper?.density as BomPaperDensity | undefined) || tenant.density,
    hideMargin: docPaper?.hideMargin ?? tenant.hideMargin,
    scheduleColumns: docCols?.length ? docCols : tenant.scheduleColumns,
  };
}

/** Printable commercial BOM sheet — purpose chosen in IMS Settings → Documents. */
export function BomPaper({ model }: { model: BomPaperModel }) {
  const purpose = normalizeBomPaperPurpose(model.template);
  switch (purpose) {
    case "executive":
      return <ExecutiveBomPaper model={model} />;
    case "technical":
      return <TechnicalBomPaper model={model} />;
    case "field":
      return <FieldBomPaper model={model} />;
    case "share":
      return <ShareBomPaper model={model} />;
    case "proposal":
    default:
      return <ProposalBomPaper model={model} />;
  }
}

export function BomPaperTemplateLabel({ id }: { id: BomPaperTemplateId | null | undefined }) {
  return <>{bomPaperPurposeMeta(normalizeBomPaperPurpose(id)).label}</>;
}

export function resolvePaperOptions(partial: BomPaperOptions): {
  purpose: BomPaperPurpose;
  industryPack: BomIndustryPackId;
  tone: BomPaperTone;
  density: BomPaperDensity;
  hideMargin: boolean;
} {
  return {
    purpose: normalizeBomPaperPurpose(partial.template),
    industryPack: normalizeBomIndustryPack(partial.industryPack),
    tone: normalizeBomPaperTone(partial.tone),
    density: normalizeBomPaperDensity(partial.density),
    hideMargin: Boolean(partial.hideMargin),
  };
}
