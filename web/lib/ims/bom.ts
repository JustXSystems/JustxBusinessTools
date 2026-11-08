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
  lines?: BomDocLineInput[];
};

export type BomBusiness = {
  name: string | null;
  gstin: string | null;
  address: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
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
    note: doc.marginAmount > 0 ? "Margin spread across line rates; GST from item/BOM rate." : "Each BOM line becomes an invoice line.",
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

  docs: (params?: { q?: string; status?: string; limit?: number; offset?: number }) =>
    get<{ docs: BomDoc[]; total: number; invoiceConvertModes: BomInvoiceConvertMode[] }>("/bom/docs", params),
  doc: (id: string) =>
    get<{
      doc: BomDoc;
      business: BomBusiness;
      linkedInvoice: { id: string; status: string; stockPosted: boolean } | null;
    }>(`/bom/docs/${id}`),
  createDoc: (body: BomDocInput) => post<{ doc: BomDoc }>("/bom/docs", body),
  saveDoc: (id: string, body: BomDocInput) => put<{ doc: BomDoc }>(`/bom/docs/${id}`, body),
  confirmDoc: (id: string) => post<{ doc: BomDoc }>(`/bom/docs/${id}/confirm`),
  reopenDoc: (id: string) => post<{ doc: BomDoc }>(`/bom/docs/${id}/reopen`),
  cancelDoc: (id: string) => post<{ doc: BomDoc }>(`/bom/docs/${id}/cancel`),
  deleteDoc: (id: string) => del(`/bom/docs/${id}`),
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
