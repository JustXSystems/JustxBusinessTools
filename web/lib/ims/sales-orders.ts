/**
 * Sales orders client: order → delivery challan → invoice. Built on the request helpers in `api.ts`.
 * Server rules live in `server/src/ims/sales-orders.ts` and `so-logic.ts` (kept in sync below).
 */
import { del, get, post, put, type ImsEvent } from "./api";
import type { BadgeView, ImsLine, ImsLineInput } from "./format";

export type SoStatus = "draft" | "confirmed" | "partial" | "fulfilled" | "cancelled";

export const SO_STATUS_LABEL: Record<SoStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  partial: "Partially delivered",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

const SO_BADGE: Record<SoStatus, BadgeView> = {
  draft: { text: "DRAFT", tone: "neutral" },
  confirmed: { text: "CONFIRMED", tone: "blue" },
  partial: { text: "PARTIAL", tone: "amber" },
  fulfilled: { text: "FULFILLED", tone: "emerald" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};
export const soBadge = (s: SoStatus): BadgeView => SO_BADGE[s] ?? SO_BADGE.draft;

export const SO_STAMP: Partial<Record<SoStatus, { text: string; color: string }>> = {
  draft: { text: "DRAFT", color: "#8a8f99" },
  confirmed: { text: "CONFIRMED", color: "#2563eb" },
  partial: { text: "PARTIALLY DELIVERED", color: "#c27c0e" },
  fulfilled: { text: "FULFILLED", color: "#14915f" },
  cancelled: { text: "CANCELLED", color: "#8a8f99" },
};

/** Statuses that accept deliveries (a fulfilled order can still be invoiced from its challans). */
export const SO_OPEN_STATUSES: ReadonlySet<SoStatus> = new Set(["confirmed", "partial"]);
export const SO_BILLABLE_STATUSES: ReadonlySet<SoStatus> = new Set(["confirmed", "partial", "fulfilled"]);

export type SoLine = ImsLine;

export type SalesOrder = {
  id: string;
  soNo: string;
  status: SoStatus;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  customerEmail: string | null;
  customerMobile: string | null;
  billToAddress: string | null;
  shipToAddress: string | null;
  customerPoRef: string | null;
  orderDate: string;
  deliveryDate: string | null;
  currencyCode: string;
  intraState: boolean;
  lines: SoLine[];
  lineCount: number;
  subtotal: number;
  discountTotal: number;
  taxable: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  notes: string | null;
  terms: string | null;
  createdBy: number | null;
  createdByName: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SalesOrderRow = SalesOrder & { deliveredPct: number; remainingQty: number; dcCount: number; invoiceCount: number };

export type SoSummary = { counts: Record<SoStatus, number>; total: number; openValue: number };
export type SoList = { orders: SalesOrderRow[]; summary: SoSummary };
export type SoListParams = { status?: SoStatus | "open"; customerId?: string; q?: string };

export type SoLineProgress = {
  lineIndex: number;
  ordered: number;
  /** On approved DCs (stock already out). */
  delivered: number;
  /** On draft DCs. */
  reserved: number;
  invoicedDirect: number;
  invoicedIssued: number;
  /** Approved DC qty not yet on an invoice. */
  deliveredUnbilled: number;
  /** Still available for a new DC / direct invoice. */
  remaining: number;
};

export type SoQtySummary = { orderedQty: number; deliveredQty: number; remainingQty: number; deliveredUnbilledQty: number; deliveredPct: number };

export type SoDcLine = { lineIndex: number; itemId: string | null; name: string; sku: string | null; hsn: string | null; unit: string | null; qty: number };
export type SoDcStatus = "draft" | "approved" | "cancelled";
export type SoDc = {
  id: string;
  salesOrderId: string;
  docNo: string;
  status: SoDcStatus;
  docDate: string;
  shipTo: string | null;
  transporter: string | null;
  vehicleNo: string | null;
  notes: string | null;
  lines: SoDcLine[];
  stockPosted: boolean;
  approvedByName: string | null;
  approvedAt: string | null;
  createdByName: string | null;
  createdAt: string | null;
  /** The invoice this challan is billed on, if any. */
  invoiceId: string | null;
};

export type SoInvoice = { id: string; salesOrderId: string; invoiceNo: string; status: string; invoiceDate: string; grandTotal: number; amountPaid: number; dcIds: string[] };

export type SoDetail = { order: SalesOrder; progress: SoLineProgress[]; summary: SoQtySummary; dcs: SoDc[]; invoices: SoInvoice[] };
export type SoDcResult = SoDetail & { dc: SoDc | null };
export type SoInvoiceResult = SoDetail & { invoice: { id: string; invoiceNo: string; status: string; grandTotal: number } };

export type SoInput = {
  customerId: string | null;
  customerName: string;
  customerGstin?: string | null;
  customerEmail?: string | null;
  customerMobile?: string | null;
  billToAddress?: string | null;
  shipToAddress?: string | null;
  customerPoRef?: string | null;
  orderDate?: string;
  deliveryDate?: string | null;
  lines: ImsLineInput[];
  notes?: string | null;
  terms?: string | null;
};

export type SoQtyPick = { lineIndex: number; qty: number };
export type SoDcInput = { lines?: SoQtyPick[]; shipTo?: string | null; transporter?: string | null; vehicleNo?: string | null; notes?: string | null; docDate?: string };
export type SoInvoiceInput = { issue?: boolean; dcIds?: string[]; lines?: SoQtyPick[]; invoiceDate?: string; dueDate?: string | null };

export const salesOrders = {
  list: (params: SoListParams = {}) => get<SoList>("/sales-orders", params),
  detail: (id: string) => get<SoDetail>(`/sales-orders/${id}`),
  create: (input: SoInput) => post<SoDetail>("/sales-orders", input),
  update: (id: string, input: SoInput) => put<SoDetail>(`/sales-orders/${id}`, input),
  confirm: (id: string) => post<SoDetail>(`/sales-orders/${id}/confirm`),
  cancel: (id: string, reason: string) => post<SoDetail>(`/sales-orders/${id}/cancel`, { reason }),
  remove: (id: string) => del(`/sales-orders/${id}`),
  createDc: (id: string, input: SoDcInput = {}) => post<SoDcResult>(`/sales-orders/${id}/dcs`, input),
  approveDc: (dcId: string, date?: string) => post<SoDcResult>(`/sales-orders/dcs/${dcId}/approve`, date ? { date } : {}),
  cancelDc: (dcId: string) => post<SoDcResult>(`/sales-orders/dcs/${dcId}/cancel`),
  invoice: (id: string, input: SoInvoiceInput = {}) => post<SoInvoiceResult>(`/sales-orders/${id}/invoice`, input),
  events: (id: string) => get<{ events: ImsEvent[] }>("/events", { entityType: "sales_order", entityId: id, limit: 100 }),
};

/** Deep-link intents for `?m=salesOrders`. */
export const soLink = {
  new: () => "new",
  open: (id: string) => `open:${id}`,
  toDc: (id: string) => `to-dc:${id}`,
  toInvoice: (id: string) => `to-invoice:${id}`,
};

/** Wizard steps in order. */
export type SoWizardStep = "order" | "delivery" | "invoice";
export const SO_WIZARD_STEPS: ReadonlyArray<{ key: SoWizardStep; label: string }> = [
  { key: "order", label: "Order" },
  { key: "delivery", label: "Delivery" },
  { key: "invoice", label: "Invoice" },
];
