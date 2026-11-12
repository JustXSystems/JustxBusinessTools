/**
 * BOM packages (reusable templates) and customer BOM documents.
 * Invoice conversion supports both lump-sum and explode-lines (P3).
 */
import { del, get, patch, post, put } from "./api";

export const BOM_LINE_KINDS = ["stock", "service", "overhead", "scaled"] as const;
export type BomLineKind = (typeof BOM_LINE_KINDS)[number];
export const BOM_LINE_KIND_LABEL: Record<BomLineKind, string> = {
  stock: "Stock item",
  service: "Service",
  overhead: "Overhead",
  scaled: "Capacity-scaled",
};

export const BOM_DOC_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type BomDocStatus = (typeof BOM_DOC_STATUSES)[number];
export const BOM_DOC_STATUS_LABEL: Record<BomDocStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

/** User chooses at invoice time (P3). */
export const BOM_INVOICE_CONVERT_MODES = ["lump_sum", "explode_lines"] as const;
export type BomInvoiceConvertMode = (typeof BOM_INVOICE_CONVERT_MODES)[number];
export const BOM_INVOICE_CONVERT_LABEL: Record<BomInvoiceConvertMode, string> = {
  lump_sum: "One lump-sum package line",
  explode_lines: "Every BOM line on the invoice",
};

export type BomPackageLine = {
  id: string;
  packageId: string;
  section: string;
  sortNo: number;
  lineKind: BomLineKind;
  itemId: string | null;
  itemName: string | null;
  itemSku: string | null;
  description: string;
  makeText: string | null;
  qty: number;
  unit: string;
  scaleByCapacity: boolean;
  defaultRate: number;
  remarks: string | null;
  active: boolean;
  qtyFormula?: string | null;
  childPackageId?: string | null;
  optionalFlag?: boolean;
  optionKey?: string | null;
  alternateItemIds?: string[];
  serviceSpare?: boolean;
  scrapPct?: number;
  costRate?: number | null;
};

export type BomPackage = {
  id: string;
  code: string | null;
  name: string;
  capacityLabel: string | null;
  description: string | null;
  defaultMarginPct: number;
  defaultTaxPct: number;
  active: boolean;
  lineCount: number;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lines?: BomPackageLine[];
};

export type BomPackageLineInput = {
  id?: string;
  section: string;
  sortNo?: number;
  lineKind: BomLineKind;
  itemId?: string | null;
  description: string;
  makeText?: string | null;
  qty: number;
  unit: string;
  scaleByCapacity?: boolean;
  defaultRate?: number;
  remarks?: string | null;
  active?: boolean;
  qtyFormula?: string | null;
  childPackageId?: string | null;
  optionalFlag?: boolean;
  optionKey?: string | null;
  alternateItemIds?: string[];
  serviceSpare?: boolean;
  scrapPct?: number;
  costRate?: number | null;
};

export type BomPackageInput = {
  code?: string | null;
  name: string;
  capacityLabel?: string | null;
  description?: string | null;
  defaultMarginPct?: number;
  defaultTaxPct?: number;
  active?: boolean;
  lines?: BomPackageLineInput[];
};

export type BomDocLine = {
  id: string;
  docId: string;
  section: string;
  sortNo: number;
  lineKind: BomLineKind;
  itemId: string | null;
  itemName: string | null;
  itemSku: string | null;
  description: string;
  makeText: string | null;
  qty: number;
  unit: string;
  scaleByCapacity: boolean;
  rate: number;
  amount: number;
  remarks: string | null;
  qtyFormula?: string | null;
  childPackageId?: string | null;
  optionalFlag?: boolean;
  optionKey?: string | null;
  alternateItemIds?: string[];
  serviceSpare?: boolean;
  scrapPct?: number;
  costRate?: number | null;
  issuedQty?: number;
  serialNotes?: string | null;
  sourcePackageLineId?: string | null;
};

export type BomDoc = {
  id: string;
  packageId: string | null;
  packageName: string | null;
  docNo: string;
  status: BomDocStatus;
  docDate: string;
  capacityLabel: string | null;
  title: string | null;
  customerName: string;
  location: string | null;
  partyId: string | null;
  marginPct: number;
  taxPct: number;
  materialsTotal: number;
  marginAmount: number;
  taxAmount: number;
  grandTotal: number;
  notes: string | null;
  preparedBy: string | null;
  invoiceId: string | null;
  invoiceConvertMode: BomInvoiceConvertMode | null;
  invoiceConvertModes: ReadonlyArray<BomInvoiceConvertMode>;
  stockIssuedAt: string | null;
  stockIssueCount: number;
  variables?: Record<string, unknown> | null;
  options?: Record<string, unknown> | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lines?: BomDocLine[];
};

export type BomDocLineInput = {
  id?: string;
  section: string;
  sortNo?: number;
  lineKind: BomLineKind;
  itemId?: string | null;
  description: string;
  makeText?: string | null;
  qty: number;
  unit: string;
  scaleByCapacity?: boolean;
  rate?: number;
  remarks?: string | null;
  alternateItemIds?: string[];
  serviceSpare?: boolean;
  optionalFlag?: boolean;
  optionKey?: string | null;
};

export type BomDocInput = {
  packageId?: string | null;
  docDate?: string;
  capacityLabel?: string | null;
  title?: string | null;
  customerName?: string;
  location?: string | null;
  partyId?: string | null;
  marginPct?: number;
  taxPct?: number;
  notes?: string | null;
  preparedBy?: string | null;
  /** Selected optional-line keys when creating from a package. */
  options?: string[] | Record<string, boolean>;
  variables?: Record<string, number>;
  lines?: BomDocLineInput[];
};

export type BomExplodedLine = {
  section: string;
  sortNo: number;
  lineKind: BomLineKind;
  itemId: string | null;
  description: string;
  makeText: string | null;
  qty: number;
  unit: string;
  scaleByCapacity: boolean;
  rate: number;
  remarks: string | null;
  qtyFormula: string | null;
  optionalFlag: boolean;
  optionKey: string | null;
  alternateItemIds: string[];
  serviceSpare: boolean;
  scrapPct: number;
  costRate: number | null;
  sourcePackageId: string;
  sourcePackageLineId: string | null;
  depth: number;
};

export type BomAlternateItem = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  sellingPrice: number;
  currentStock: number;
  active: boolean;
};

export type BomAlternateSuggestion = {
  lineId: string;
  description: string;
  primaryItemId: string;
  need: number;
  onHand: number;
  shortfall: number;
  suggestedItemId: string | null;
  suggested: BomAlternateItem | null;
  candidates: Array<{ itemId: string; onHand: number; covers: boolean; item: BomAlternateItem | null }>;
};

export type BomPickListLine = {
  lineId: string;
  section: string;
  sortNo: number;
  itemId: string | null;
  sku: string | null;
  description: string;
  unit: string;
  qty: number;
  issuedQty: number;
  remainingQty: number;
  onHand: number | null;
  serialNotes: string | null;
  linked: boolean;
};

export type BomDiffEntry =
  | { kind: "added"; right: BomDiffLine }
  | { kind: "removed"; left: BomDiffLine }
  | { kind: "changed"; left: BomDiffLine; right: BomDiffLine; fields: string[] }
  | { kind: "same"; left: BomDiffLine; right: BomDiffLine };

export type BomDiffLine = { key: string; description: string; section: string; qty: number; rate: number; unit: string };

export type BomRateCardLine = {
  id?: string;
  itemId?: string | null;
  sku?: string | null;
  description?: string | null;
  unit?: string;
  rate: number;
  costRate?: number | null;
  sortNo?: number;
  active?: boolean;
};

export type BomRateCard = {
  id: string;
  code: string | null;
  name: string;
  currency: string;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  notes: string | null;
  lineCount?: number;
  lines?: BomRateCardLine[];
  createdByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type BomRateCardInput = {
  code?: string | null;
  name: string;
  currency?: string;
  validFrom?: string | null;
  validTo?: string | null;
  active?: boolean;
  notes?: string | null;
  lines?: BomRateCardLine[];
};

export type BomBusiness = {
  name: string | null;
  gstin: string | null;
  address: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  /** Business profile company logo (tokenized file URL). */
  logoUrl?: string | null;
};

export type BomTotals = {
  materialsTotal: number;
  marginAmount: number;
  taxAmount: number;
  grandTotal: number;
};

export function computeBomTotals(lines: ReadonlyArray<{ qty: number; rate: number }>, marginPct: number, taxPct: number): BomTotals {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const materialsTotal = round2(lines.reduce((s, l) => s + round2(Number(l.qty || 0) * Number(l.rate || 0)), 0));
  const marginAmount = round2(materialsTotal * (Number(marginPct) || 0) / 100);
  const afterMargin = round2(materialsTotal + marginAmount);
  const taxAmount = round2(afterMargin * (Number(taxPct) || 0) / 100);
  return { materialsTotal, marginAmount, taxAmount, grandTotal: round2(afterMargin + taxAmount) };
}

/** First numeric token in a capacity label (“3KW”, “Size 5”). */
export function parseCapacityNumber(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = String(label).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function qtyForCapacity(qty: number, scaleByCapacity: boolean, capacityLabel: string | null | undefined): number {
  const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
  if (!scaleByCapacity) return round3(qty);
  const factor = parseCapacityNumber(capacityLabel);
  if (!factor) return round3(qty);
  return round3(qty * factor);
}

/** Recover per-unit base qty after a saved/scaled document is reopened. */
export function inferBaseQty(qty: number, scaleByCapacity: boolean, capacityLabel: string | null | undefined): number {
  const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
  if (!scaleByCapacity) return round3(qty);
  const factor = parseCapacityNumber(capacityLabel);
  if (!factor) return round3(qty);
  return round3(qty / factor);
}

export type BomAvailabilityLine = {
  itemId: string;
  name: string;
  unit: string;
  need: number;
  have: number;
  shortfall: number;
};

/** Inflate explode rates so invoice taxable ≈ BOM materials + margin. */
export function applyMarginToExplodeRates(lines: ReadonlyArray<{ qty: number; rate: number }>, marginAmount: number): number[] {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const materials = round2(lines.reduce((s, l) => s + round2(Number(l.qty || 0) * Number(l.rate || 0)), 0));
  if (!(materials > 0) || !(marginAmount > 0)) return lines.map((l) => round2(l.rate));
  const factor = (materials + marginAmount) / materials;
  return lines.map((l) => round2(l.rate * factor));
}

/** Rough GST preview for convert modes (round-to-rupee off — exact invoice may differ by ₹1). */
export function previewBomInvoice(
  doc: Pick<BomDoc, "materialsTotal" | "marginAmount" | "taxPct" | "lines">,
  mode: BomInvoiceConvertMode,
  gstRate: number,
): { taxable: number; tax: number; grand: number; note: string } {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  if (mode === "lump_sum") {
    const taxable = round2(doc.materialsTotal + doc.marginAmount);
    const tax = round2(taxable * (gstRate || 0) / 100);
    return { taxable, tax, grand: round2(taxable + tax), note: "One package line at materials + margin, then GST." };
  }
  const billable = (doc.lines ?? []).filter((l) => l.qty > 0);
  const rates = applyMarginToExplodeRates(
    billable.map((l) => ({ qty: l.qty, rate: l.rate })),
    doc.marginAmount,
  );
  const taxable = round2(billable.reduce((s, l, i) => s + round2(l.qty * (rates[i] ?? l.rate)), 0));
  const tax = round2(taxable * (gstRate || doc.taxPct || 0) / 100);
  return {
    taxable,
    tax,
    grand: round2(taxable + tax),
    note:
      doc.marginAmount > 0
        ? "Margin spread across line rates. GST preview is approximate — catalogue items may use their own GST %."
        : "Each BOM line becomes an invoice line. GST preview is approximate — catalogue items may use their own GST %.",
  };
}

export const bom = {
  packages: (params?: { q?: string; active?: boolean; limit?: number }) =>
    get<{ packages: BomPackage[]; invoiceConvertModes: BomInvoiceConvertMode[] }>("/bom/packages", {
      q: params?.q,
      active: params?.active === false ? "0" : "1",
      limit: params?.limit,
    }),
  package: (id: string) => get<{ package: BomPackage }>(`/bom/packages/${id}`),
  createPackage: (body: BomPackageInput) => post<{ package: BomPackage }>("/bom/packages", body),
  savePackage: (id: string, body: BomPackageInput) => put<{ package: BomPackage }>(`/bom/packages/${id}`, body),
  patchPackage: (id: string, body: Partial<BomPackageInput>) => patch<{ package: BomPackage }>(`/bom/packages/${id}`, body),
  deletePackage: (id: string) => del<{ package?: BomPackage; deactivated?: boolean } | void>(`/bom/packages/${id}`),
  duplicatePackage: (id: string) => post<{ package: BomPackage }>(`/bom/packages/${id}/duplicate`),
  seedSamples: () => post<{ created: number; packages: BomPackage[] }>("/bom/packages/seed-samples"),

  docs: (params?: {
    q?: string;
    status?: string;
    invoice?: "linked" | "none" | "all";
    stock?: "issued" | "pending" | "all";
    limit?: number;
    offset?: number;
  }) =>
    get<{ docs: BomDoc[]; total: number; invoiceConvertModes: BomInvoiceConvertMode[] }>("/bom/docs", {
      q: params?.q,
      status: params?.status,
      invoice: params?.invoice && params.invoice !== "all" ? params.invoice : undefined,
      stock: params?.stock && params.stock !== "all" ? params.stock : undefined,
      limit: params?.limit,
      offset: params?.offset,
    }),
  doc: (id: string) =>
    get<{
      doc: BomDoc;
      business: BomBusiness;
      linkedInvoice: { id: string; status: string; stockPosted: boolean } | null;
    }>(`/bom/docs/${id}`),
  createDoc: (body: BomDocInput) => post<{ doc: BomDoc }>("/bom/docs", body),
  saveDoc: (id: string, body: BomDocInput) => put<{ doc: BomDoc }>(`/bom/docs/${id}`, body),
  confirmDoc: (id: string, body?: { acknowledgeWarnings?: boolean }) =>
    post<{ doc: BomDoc; gates?: unknown }>(`/bom/docs/${id}/confirm`, body ?? {}),
  reopenDoc: (id: string) => post<{ doc: BomDoc }>(`/bom/docs/${id}/reopen`),
  cancelDoc: (id: string) => post<{ doc: BomDoc }>(`/bom/docs/${id}/cancel`),
  deleteDoc: (id: string) => del(`/bom/docs/${id}`),
  docGates: (id: string) =>
    get<{
      gates: {
        ok: boolean;
        errors: Array<{ code: string; severity: string; message: string }>;
        warnings: Array<{ code: string; severity: string; message: string }>;
      };
    }>(`/bom/docs/${id}/gates`),
  docCost: (id: string) =>
    get<{
      materialsCost: number;
      materialsSell: number;
      marginAmount: number;
      marginPctOfSell: number;
      lines: Array<{ id: string; description: string; sell: number; cost: number; margin: number; marginPct: number }>;
    }>(`/bom/docs/${id}/cost`),
  revisions: (entityType: "package" | "doc", entityId: string) =>
    get<{ revisions: Array<{ id: string; revision: number; createdByName: string | null; createdAt: string | null }> }>("/bom/revisions", {
      entityType,
      entityId,
    }),
  createProposal: (id: string) =>
    post<{ token: string; proposalPath: string; proposalUrl: string; whatsappUrl: string; doc: BomDoc }>(`/bom/docs/${id}/proposal`),
  revokeProposal: (id: string) => post<{ doc: BomDoc }>(`/bom/docs/${id}/proposal/revoke`),
  createPosFromShortfall: (id: string) =>
    post<{ orders: Array<{ id: string; poNo: string; supplierName: string; status: string; grandTotal?: number }> }>(`/bom/docs/${id}/create-pos`),
  rateCards: () =>
    get<{
      rateCards: BomRateCard[];
    }>("/bom/rate-cards"),
  rateCard: (id: string) => get<{ rateCard: BomRateCard }>(`/bom/rate-cards/${id}`),
  createRateCard: (body: BomRateCardInput) => post<{ rateCard: BomRateCard }>("/bom/rate-cards", body),
  saveRateCard: (id: string, body: BomRateCardInput) => put<{ rateCard: BomRateCard }>(`/bom/rate-cards/${id}`, body),
  deleteRateCard: (id: string) => del<{ rateCard: BomRateCard }>(`/bom/rate-cards/${id}`),
  applyRateCard: (docId: string, rateCardId: string) =>
    post<{ doc: BomDoc; matched: number }>(`/bom/docs/${docId}/apply-rate-card`, { rateCardId }),
  uploadPdf: (id: string, pdfBase64: string) => post<{ sha256: string; artifactId: string; doc: BomDoc }>(`/bom/docs/${id}/pdf`, { pdfBase64 }),
  downloadPdf: (id: string) => get<{ sha256: string; pdfBase64: string }>(`/bom/docs/${id}/pdf`),
  asBuilt: (id: string) =>
    post<{
      variance: Array<{ lineId: string; description: string; soldQty: number; issuedQty: number; unit: string; variance: number }>;
      doc: BomDoc;
    }>(`/bom/docs/${id}/as-built`),
  serviceKit: (id: string) => get<{ lines: BomDocLine[]; count: number }>(`/bom/docs/${id}/service-kit`),
  formulaPresets: () => get<{ presets: Record<string, { label: string; variables: Record<string, number>; sampleFormula: string }> }>("/bom/formula-presets"),
  evalFormula: (body: { formula: string; variables?: Record<string, number>; capacityLabel?: string | null }) =>
    post<{ qty: number | null; variables: Record<string, number> }>("/bom/formula/eval", body),
  diff: (body: { leftDocId?: string; rightDocId?: string; leftPackageId?: string; rightPackageId?: string }) =>
    post<{ diff: BomDiffEntry[] }>("/bom/diff", body),
  suggestAlternates: (id: string) =>
    post<{ suggestions: BomAlternateSuggestion[]; count: number }>(`/bom/docs/${id}/suggest-alternates`),
  swapAlternate: (id: string, body: { lineId: string; itemId: string }) =>
    post<{ doc: BomDoc }>(`/bom/docs/${id}/swap-alternate`, body),
  explodePackage: (
    packageId: string,
    body?: { docId?: string; capacityLabel?: string | null; options?: string[] | Record<string, boolean>; variables?: Record<string, number>; depthLimit?: number },
  ) =>
    post<{
      packageId: string;
      capacityLabel: string | null;
      selectedOptions: string[];
      variables: Record<string, number>;
      lines: BomExplodedLine[];
      count: number;
    }>(`/bom/packages/${packageId}/explode`, body ?? {}),
  setOptions: (id: string, options: string[] | Record<string, boolean>) =>
    post<{
      options: Record<string, boolean>;
      selectedOptions: string[];
      optionalLines: Array<{ id: string; description: string; optionKey: string | null; included: boolean }>;
      doc: BomDoc;
    }>(`/bom/docs/${id}/set-options`, { options }),
  issueStockPartial: (id: string, body: { lines: Array<{ lineId: string; qty: number; serialNotes?: string | null }>; date?: string }) =>
    post<{
      doc: BomDoc;
      movements: Array<{ id: string; itemId: string; itemName: string; qty: number }>;
      issued: Array<{ lineId: string; qty: number; nextIssuedQty: number }>;
      fullyIssued: boolean;
    }>(`/bom/docs/${id}/issue-stock-partial`, body),
  pickList: (id: string) =>
    get<{
      docId: string;
      docNo: string;
      customerName: string;
      capacityLabel: string | null;
      generatedAt: string;
      lines: BomPickListLine[];
      count: number;
    }>(`/bom/docs/${id}/pick-list`),
  createInvoice: (
    id: string,
    body: { mode: BomInvoiceConvertMode; issue?: boolean; gstRate?: number; invoiceDate?: string },
  ) =>
    post<{ doc: BomDoc; invoice: { invoice: { id: string; invoiceNo: string; status: string; stockPosted: boolean } }; mode: BomInvoiceConvertMode }>(
      `/bom/docs/${id}/create-invoice`,
      body,
    ),
  issueStock: (id: string, body?: { date?: string }) =>
    post<{ doc: BomDoc; movements: Array<{ id: string; itemId: string; itemName: string; qty: number }> }>(`/bom/docs/${id}/issue-stock`, body ?? {}),
  reverseStock: (id: string, body?: { date?: string }) =>
    post<{ doc: BomDoc; movements: Array<{ id: string; itemId: string; itemName: string; qty: number }> }>(`/bom/docs/${id}/reverse-stock`, body ?? {}),
  availability: (id: string) =>
    get<{ allowNegativeStock: boolean; hasShortfall: boolean; items: BomAvailabilityLine[] }>(`/bom/docs/${id}/availability`),
};
