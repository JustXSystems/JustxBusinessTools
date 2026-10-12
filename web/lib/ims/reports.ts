/**
 * Reports & GST client: the report catalog runner, saved / scheduled reports with
 * their approval flow, and GSTR-1 / GSTR-3B / HSN summaries. Built on `api.ts`.
 */
import type { BosBadgeTone } from "@/components/bos";
import { del, get, patch, post, type Period } from "./api";

/* ---------- Report catalog ---------- */

export const REPORT_TYPES = [
  "stockin",
  "stockout",
  "fullstock",
  "damage",
  "po",
  "sales",
  "receivables",
  "payables",
  "margin",
  "suppliers",
  "onsite",
  "lowstock",
  "deadstock",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export type ReportFilterKey = "category" | "supplierId" | "partyId" | "userId" | "status" | "groupBy" | "days" | "q";

export type ReportCatalogEntry = {
  type: ReportType;
  label: string;
  icon: string;
  tint: string;
  group: "Inventory" | "Purchasing" | "Sales & finance" | "People";
  desc: string;
  /** Point-in-time reports ignore the period. */
  usesPeriod: boolean;
  filters: ReadonlyArray<ReportFilterKey>;
  statusOptions?: ReadonlyArray<{ value: string; label: string }>;
};

export const REPORT_CATALOG: ReadonlyArray<ReportCatalogEntry> = [
  { type: "stockin", label: "Stock in", icon: "📥", tint: "var(--bos-pastel-mint)", group: "Inventory", desc: "Every receipt with cost, supplier and reference", usesPeriod: true, filters: ["category", "supplierId", "q"] },
  { type: "stockout", label: "Stock out", icon: "📤", tint: "var(--bos-pastel-blue)", group: "Inventory", desc: "Issues and sales out of stock with value", usesPeriod: true, filters: ["category", "partyId", "q"] },
  { type: "fullstock", label: "Full stock & valuation", icon: "📦", tint: "var(--bos-pastel-lavender)", group: "Inventory", desc: "On-hand quantity, cost and retail value", usesPeriod: false, filters: ["category", "supplierId", "status", "q"], statusOptions: [
    { value: "GOOD", label: "In stock" },
    { value: "LOW", label: "Low" },
    { value: "OUT_OF_STOCK", label: "Out of stock" },
    { value: "OVERSTOCK", label: "Overstock" },
  ] },
  { type: "damage", label: "Damage & write-offs", icon: "⚠", tint: "var(--bos-pastel-rose)", group: "Inventory", desc: "Damaged and written-off stock by reason", usesPeriod: true, filters: ["category", "q"] },
  { type: "lowstock", label: "Low stock & reorder", icon: "📉", tint: "var(--bos-pastel-rose)", group: "Inventory", desc: "Below minimum with suggested reorder quantity", usesPeriod: false, filters: ["category", "supplierId", "q"] },
  { type: "deadstock", label: "Dead stock", icon: "🕸", tint: "var(--bos-pastel-sage)", group: "Inventory", desc: "Items with no movement for a long time", usesPeriod: false, filters: ["category", "days", "q"] },
  { type: "po", label: "Purchase orders", icon: "🧾", tint: "var(--bos-pastel-blue)", group: "Purchasing", desc: "Orders by status, value and fill rate", usesPeriod: true, filters: ["supplierId", "status", "q"], statusOptions: [
    { value: "draft", label: "Draft" },
    { value: "pending_approval", label: "Pending approval" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "sent", label: "Sent" },
    { value: "partially_received", label: "Partially received" },
    { value: "received", label: "Received" },
    { value: "cancelled", label: "Cancelled" },
  ] },
  { type: "suppliers", label: "Supplier performance", icon: "🤝", tint: "var(--bos-pastel-sage)", group: "Purchasing", desc: "Spend, fill rate, lead time and returns", usesPeriod: true, filters: ["supplierId"] },
  { type: "payables", label: "Payables aging", icon: "⏳", tint: "var(--bos-pastel-lavender)", group: "Purchasing", desc: "What you owe suppliers, by age", usesPeriod: false, filters: ["supplierId"] },
  { type: "sales", label: "Sales register", icon: "🛒", tint: "var(--bos-pastel-mint)", group: "Sales & finance", desc: "Invoices with taxable value and GST", usesPeriod: true, filters: ["partyId", "status", "q"], statusOptions: [
    { value: "unpaid", label: "Unpaid" },
    { value: "partial", label: "Partly paid" },
    { value: "paid", label: "Paid" },
    { value: "overdue", label: "Overdue" },
    { value: "cancelled", label: "Cancelled" },
  ] },
  { type: "receivables", label: "Receivables aging", icon: "💰", tint: "var(--bos-pastel-blue)", group: "Sales & finance", desc: "What customers owe you, by age", usesPeriod: false, filters: ["partyId"] },
  { type: "margin", label: "Profit & margin", icon: "📈", tint: "var(--bos-pastel-sage)", group: "Sales & finance", desc: "Revenue, cost and margin by item or category", usesPeriod: true, filters: ["category", "groupBy"] },
  { type: "onsite", label: "Onsite staff", icon: "🧭", tint: "var(--bos-pastel-lavender)", group: "People", desc: "Visits, time on site, travel and tasks per person", usesPeriod: true, filters: ["userId"] },
];

export const catalogEntry = (t: string): ReportCatalogEntry => REPORT_CATALOG.find((r) => r.type === t) ?? REPORT_CATALOG[0];

/* ---------- Result shape (mirrors server/src/ims/reports.ts) ---------- */

export type ReportCellKind = "text" | "number" | "money" | "qty" | "date" | "pct" | "status";
export type ReportColumn = { key: string; label: string; kind: ReportCellKind; total?: boolean };
export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;
export type ReportSummary = { label: string; value: number | string; kind: ReportCellKind; tone?: "blue" | "emerald" | "amber" | "coral"; hint?: string };
export type ReportChart = { kind: "bar" | "stack"; title: string; valueKind: ReportCellKind; data: Array<{ label: string; value: number; color?: string }> } | null;
export type ReportResult = {
  type: ReportType;
  title: string;
  range: { from: string; to: string } | null;
  asOf: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: ReportSummary[];
  chart: ReportChart;
  notes: string[];
};

export type ReportMeta = {
  types: ReadonlyArray<{ key: ReportType; label: string }>;
  categories: string[];
  suppliers: Array<{ id: string; name: string }>;
  customers: Array<{ id: string; name: string }>;
  members: Array<{ userId: number; name: string }>;
  canApprove: boolean;
};

export type ReportFilters = Partial<Record<ReportFilterKey, string>>;
export type ReportRunParams = { type: ReportType; period: Period; from?: string; to?: string } & ReportFilters;

/* ---------- Saved & scheduled ---------- */

export const REPORT_SCHEDULES = ["none", "daily", "weekly", "monthly"] as const;
export type ReportSchedule = (typeof REPORT_SCHEDULES)[number];
export const SCHEDULE_LABEL: Record<ReportSchedule, string> = { none: "Not scheduled", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

export type ReportApprovalStatus = "draft" | "pending_approval" | "approved" | "sent";
export const APPROVAL_META: Record<ReportApprovalStatus, { label: string; tone: BosBadgeTone }> = {
  draft: { label: "DRAFT", tone: "neutral" },
  pending_approval: { label: "PENDING APPROVAL", tone: "amber" },
  approved: { label: "APPROVED", tone: "emerald" },
  sent: { label: "SENT", tone: "blue" },
};

export type SavedReport = {
  id: string;
  name: string;
  type: ReportType;
  typeLabel: string;
  period: Period;
  from: string | null;
  to: string | null;
  filters: ReportFilters;
  format: "csv" | "xlsx";
  schedule: ReportSchedule;
  active: boolean;
  recipients: string[];
  approvalStatus: ReportApprovalStatus;
  approvedByName: string | null;
  approvedAt: string | null;
  reviewNote: string | null;
  sentTo: string | null;
  sentAt: string | null;
  lastRunAt: string | null;
  nextRunOn: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SavedReportInput = {
  name: string;
  type: ReportType;
  period: Period;
  from?: string | null;
  to?: string | null;
  filters: ReportFilters;
  format: "csv" | "xlsx";
  schedule: ReportSchedule;
  recipients: string[];
  active: boolean;
};

export const reports = {
  meta: () => get<ReportMeta>("/reports/meta"),
  run: (params: ReportRunParams) => get<{ report: ReportResult }>("/reports/run", params),
  saved: () => get<{ reports: SavedReport[]; canApprove: boolean }>("/reports/saved"),
  savedOne: (id: string) => get<{ report: SavedReport }>(`/reports/saved/${id}`),
  createSaved: (input: SavedReportInput) => post<{ report: SavedReport }>("/reports/saved", input),
  updateSaved: (id: string, input: Partial<SavedReportInput>) => patch<{ report: SavedReport; resetToDraft: boolean }>(`/reports/saved/${id}`, input),
  deleteSaved: (id: string) => del(`/reports/saved/${id}`),
  submit: (id: string) => post<{ report: SavedReport }>(`/reports/saved/${id}/submit`),
  approve: (id: string) => post<{ report: SavedReport }>(`/reports/saved/${id}/approve`),
  reject: (id: string, note?: string) => post<{ report: SavedReport }>(`/reports/saved/${id}/reject`, { note }),
  runSaved: (id: string) => post<{ report: ReportResult; saved: SavedReport }>(`/reports/saved/${id}/run`),
  markSent: (id: string, recipients: string[]) => post<{ report: SavedReport }>(`/reports/saved/${id}/sent`, { recipients }),
};

/* ---------- GST ---------- */

export type TaxHeads = { cgst: number; sgst: number; igst: number };
export type RateRow = { rate: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number };
type Section<R> = { rows: R[]; invoices: number; taxable: number; tax: number; value: number };

export type B2bRow = {
  gstin: string;
  receiverName: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  reverseCharge: string;
  invoiceType: string;
  rate: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
};
export type B2clRow = { invoiceNo: string; invoiceDate: string; invoiceValue: number; placeOfSupply: string; rate: number; taxableValue: number; igst: number; cess: number };
export type B2csRow = { type: string; placeOfSupply: string; rate: number; taxableValue: number; igst: number; cgst: number; sgst: number; cess: number };
export type CreditNoteRow = {
  noteNo: string;
  noteDate: string;
  noteType: string;
  party: string;
  gstin: string;
  registered: string;
  originalInvoice: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  noteValue: number;
};
export type InwardRow = { billNo: string; supplierBillNo: string; billDate: string; supplier: string; gstin: string; taxableValue: number; cgst: number; sgst: number; igst: number; itcEligible: string; billValue: number };
export type ProvisionalRow = { poNo: string; supplier: string; receivedOn: string; taxableValue: number; tax: number; cgst: number; sgst: number; igst: number };

export type GstSummary = {
  range: { from: string; to: string };
  seller: { gstin: string | null; state: string | null; stateCode: string | null; businessName: string };
  b2b: Section<B2bRow>;
  b2cl: Section<B2clRow>;
  b2cs: Section<B2csRow>;
  creditNotes: { rows: CreditNoteRow[]; count: number; taxable: number; tax: number } & TaxHeads;
  documents: { from: string | null; to: string | null; total: number; cancelled: number; issued: number; creditNotes: number };
  gross: { taxable: number; tax: number } & TaxHeads;
  outward: { taxable: number; tax: number } & TaxHeads;
  outwardRate: RateRow[];
  inward: { bills: number; taxable: number; tax: number; value: number; ineligibleTax: number; rows: InwardRow[] };
  inwardRate: RateRow[];
  itc: TaxHeads & { total: number };
  provisional: { rows: ProvisionalRow[]; taxable: number; tax: number };
  net: { payable: TaxHeads & { total: number }; carryForward: TaxHeads & { total: number } };
  warnings: string[];
};

export type HsnRow = { hsn: string; description: string; uqc: string; totalQuantity: number; totalValue: number; rate: number; taxableValue: number; igst: number; cgst: number; sgst: number; cess: number };
export type GstHsn = {
  range: { from: string; to: string };
  rows: HsnRow[];
  totals: { codes: number; totalValue: number; taxableValue: number; igst: number; cgst: number; sgst: number };
  missingHsnLines: number;
};

export type GstItemIssue = { id: string; name: string; sku: string | null; category: string | null; hsn: string | null; gstRate: number; stock: number; issues: string[]; suggestedHsn: string | null; suggestedRate: number | null };
export type GstItemsCheck = {
  items: GstItemIssue[];
  summary: { total: number; complete: number; flagged: number; missingHsn: number; badHsn: number; rateIssues: number; completenessPct: number };
};

type GstRangeParams = { period?: Period; from?: string; to?: string };

export const gst = {
  summary: (params: GstRangeParams = {}) => get<GstSummary>("/gst/summary", params),
  hsn: (params: GstRangeParams = {}) => get<GstHsn>("/gst/hsn", params),
  itemsCheck: () => get<GstItemsCheck>("/gst/items-check"),
};
