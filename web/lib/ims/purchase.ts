/**
 * Purchasing client: parties (suppliers & customers), purchase orders, goods receipts
 * and the approvals inbox. Built on the request helpers in `api.ts`.
 */
import type { BadgeView } from "./format";
import { del, get, ImsApiError, patch, post, put, type ImsEvent, type PartyKind, type PartyOption, type Period, type StockStatus } from "./api";
import type { ImsLine, ImsLineInput } from "./format";

/* ---------- Parties ---------- */

export type PartyStats = {
  itemsSupplied: number;
  openPoCount: number;
  openPoValue: number;
  lastPurchaseDate: string | null;
  receivable: number;
  payable: number;
  /** Opening balance + receivable − payable (positive = they owe us). */
  netBalance: number;
};

export type Party = PartyOption & {
  pan: string | null;
  openingBalance: number;
  accountManagerId: number | null;
  accountManagerName: string | null;
  tags: string[];
  notes: string | null;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  stats?: PartyStats;
};

export type PartyInput = {
  kind?: PartyKind;
  name?: string;
  contactPerson?: string | null;
  mobile?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  paymentTermsDays?: number | null;
  creditLimit?: number | null;
  openingBalance?: number | null;
  accountManagerId?: number | null;
  tags?: string[];
  notes?: string | null;
  active?: boolean;
};

export type PartyDetail = {
  party: Party & { stats: PartyStats };
  purchaseOrders: Array<{ id: string; poNo: string; status: PoStatus; orderDate: string; expectedDate: string | null; grandTotal: number; lineCount: number }>;
  invoices: Array<{ id: string; invoiceNo: string; status: string; invoiceDate: string; dueDate: string | null; grandTotal: number; amountPaid: number }>;
  bills: Array<{ id: string; billNo: string; supplierBillNo: string | null; status: string; billDate: string; dueDate: string | null; grandTotal: number; amountPaid: number; poNo: string | null }>;
  movements: Array<{ id: string; itemId: string; itemName: string; type: string; qty: number; value: number; refNo: string | null; date: string; actorName: string | null; createdAt: string | null }>;
  items: Array<{ id: string; name: string; sku: string | null; unit: string; currentStock: number; minStock: number; purchasePrice: number; gstRate: number; status: StockStatus }>;
};

export const PARTY_KIND_TAG: Record<PartyKind, { text: string; tag: "lavender" | "mint" | "blue" }> = {
  supplier: { text: "SUPPLIER", tag: "lavender" },
  customer: { text: "CUSTOMER", tag: "mint" },
  both: { text: "BOTH", tag: "blue" },
};

/* ---------- Purchase orders ---------- */

export type PoStatus = "draft" | "pending_approval" | "approved" | "rejected" | "sent" | "partially_received" | "received" | "cancelled";

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  sent: "Sent",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

const PO_BADGE: Record<PoStatus, BadgeView> = {
  draft: { text: "DRAFT", tone: "neutral" },
  pending_approval: { text: "PENDING", tone: "amber" },
  approved: { text: "APPROVED", tone: "blue" },
  rejected: { text: "REJECTED", tone: "coral" },
  sent: { text: "SENT", tone: "lavender" },
  partially_received: { text: "PARTIAL", tone: "amber" },
  received: { text: "RECEIVED", tone: "emerald" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};
export const poBadge = (s: PoStatus): BadgeView => PO_BADGE[s] ?? PO_BADGE.draft;

export const PO_STAMP: Partial<Record<PoStatus, { text: string; color: string }>> = {
  draft: { text: "DRAFT", color: "#8a8f99" },
  pending_approval: { text: "AWAITING APPROVAL", color: "#c27c0e" },
  approved: { text: "APPROVED", color: "#2563eb" },
  rejected: { text: "REJECTED", color: "#d23c33" },
  sent: { text: "SENT", color: "#6d4fc2" },
  partially_received: { text: "PARTIALLY RECEIVED", color: "#c27c0e" },
  received: { text: "RECEIVED", color: "#14915f" },
  cancelled: { text: "CANCELLED", color: "#8a8f99" },
};

export const RECEIVABLE_STATUSES: ReadonlySet<PoStatus> = new Set(["approved", "sent", "partially_received"]);
export const EDITABLE_STATUSES: ReadonlySet<PoStatus> = new Set(["draft", "rejected"]);
export const CANCELLABLE_STATUSES: ReadonlySet<PoStatus> = new Set(["draft", "pending_approval", "approved", "rejected", "sent"]);

export type PoLine = ImsLine & { receivedQty: number };
export type PoParty = { name: string; contactPerson?: string | null; mobile?: string | null; email?: string | null; gstin?: string | null; address?: string | null; city?: string | null; state?: string | null; stateCode?: string | null; phone?: string | null };

export type PurchaseOrder = {
  id: string;
  poNo: string;
  status: PoStatus;
  supplierId: string | null;
  supplierName: string;
  supplier: PoParty;
  business: PoParty;
  orderDate: string;
  expectedDate: string | null;
  deliveryAddress: string | null;
  paymentTermsDays: number | null;
  intraState: boolean;
  lines: PoLine[];
  lineCount: number;
  subtotal: number;
  discountTotal: number;
  taxable: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  receivedPct: number;
  receivedValue: number;
  overdue: boolean;
  terms: string | null;
  notes: string | null;
  approvalNote: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  sentAt: string | null;
  sentVia: string | null;
  receivedAt: string | null;
  billId: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PoSummary = {
  counts: Record<PoStatus, number>;
  total: number;
  openValue: number;
  awaitingApproval: number;
  awaitingValue: number;
  dueThisWeek: number;
  overdue: number;
  receivedThisMonth: number;
  receivedPosThisMonth: number;
};

export type PoList = { orders: PurchaseOrder[]; summary: PoSummary; approvalLimit: number; draftPurgeDays: number };
export type PoShare = { text: string; subject: string; whatsappUrl: string; mailto: string };
export type PoBill = { id: string; billNo: string; supplierBillNo: string | null; status: string; billDate: string; dueDate: string | null; grandTotal: number; amountPaid: number; createdAt: string | null };
export type PoReceiptRow = { id: string; itemId: string; itemName: string; qty: number; unitCost: number | null; value: number; date: string; actorName: string | null; createdAt: string | null };
export type PoDetail = { order: PurchaseOrder; bills: PoBill[]; receipts: PoReceiptRow[]; share: PoShare; approvalLimit: number };

export type PoAction = "draft" | "submit" | "send";
export type PoInput = {
  supplierId: string | null;
  supplierName: string;
  orderDate?: string;
  expectedDate?: string | null;
  deliveryAddress?: string | null;
  paymentTermsDays?: number | null;
  lines: ImsLineInput[];
  terms?: string | null;
  notes?: string | null;
  action: PoAction;
};

export type ReceiveInput = {
  lines: Array<{ lineIndex: number; qty: number; unitCost?: number | null }>;
  date?: string;
  supplierBillNo?: string | null;
  supplierBillDate?: string | null;
  notes?: string | null;
  createBill?: boolean;
};

export type ReorderDraft = { supplier: Party | null; lines: Array<ImsLineInput & { currentStock: number; minStock: number }> };

export type PoListParams = { status?: PoStatus | "open" | "overdue"; supplierId?: string; q?: string; period?: Period | "all"; from?: string; to?: string };

/* ---------- Approvals (bills are owned by the payables module) ---------- */

export type ApprovalBill = {
  id: string;
  billNo: string;
  supplierName: string;
  billDate: string;
  dueDate: string | null;
  grandTotal: number;
  status: string;
  supplierBillNo?: string | null;
  poId?: string | null;
  poNo?: string | null;
  daysToDue?: number | null;
  category?: string | null;
  notes?: string | null;
  lineCount?: number;
  createdByName?: string | null;
  createdAt?: string | null;
};

/** `null` when the bills API isn't available yet. */
async function pendingBills(): Promise<ApprovalBill[] | null> {
  try {
    const res = await get<{ bills?: ApprovalBill[] } | ApprovalBill[]>("/bills", { status: "pending_approval" });
    const list = Array.isArray(res) ? res : (res.bills ?? []);
    return list.filter((b) => b.status === "pending_approval");
  } catch (err) {
    if (err instanceof ImsApiError && (err.status === 404 || err.status === 501)) return null;
    throw err;
  }
}

export const purchase = {
  parties: (params: { kind?: "supplier" | "customer"; q?: string; includeInactive?: boolean; stats?: boolean } = {}) => get<{ parties: Party[]; truncated?: boolean }>("/parties", params),
  party: (id: string) => get<PartyDetail>(`/parties/${id}`),
  createParty: (input: PartyInput) => post<{ party: Party }>("/parties", input),
  updateParty: (id: string, input: PartyInput) => patch<{ party: Party }>(`/parties/${id}`, input),
  deleteParty: (id: string) => del<{ archived?: boolean } | undefined>(`/parties/${id}`),
  importParties: (parties: Array<Record<string, unknown>>, defaultKind?: PartyKind) => post<{ created: number; updated: number; errors: string[] }>("/parties/bulk", { parties, defaultKind }),
  exportParties: () => get<{ parties: Array<Party & { stats: PartyStats }> }>("/parties/export"),

  orders: (params: PoListParams = {}) => get<PoList>("/purchase-orders", params),
  order: (id: string) => get<PoDetail>(`/purchase-orders/${id}`),
  createOrder: (input: PoInput) => post<{ order: PurchaseOrder; share: PoShare | null }>("/purchase-orders", input),
  updateOrder: (id: string, input: PoInput) => put<{ order: PurchaseOrder; share: PoShare | null }>(`/purchase-orders/${id}`, input),
  submitOrder: (id: string) => post<{ order: PurchaseOrder }>(`/purchase-orders/${id}/submit`),
  approveOrder: (id: string, note?: string | null) => post<{ order: PurchaseOrder }>(`/purchase-orders/${id}/approve`, { note: note || null }),
  rejectOrder: (id: string, reason: string) => post<{ order: PurchaseOrder }>(`/purchase-orders/${id}/reject`, { reason }),
  bulkApprove: (ids: string[], note?: string | null) => post<{ approved: number; errors: string[] }>("/purchase-orders/bulk-approve", { ids, note: note || null }),
  sendOrder: (id: string, via: "whatsapp" | "email" | "print" | "manual") => post<{ order: PurchaseOrder; share: PoShare }>(`/purchase-orders/${id}/send`, { via }),
  cancelOrder: (id: string, reason?: string | null) => post<{ order: PurchaseOrder }>(`/purchase-orders/${id}/cancel`, { reason: reason || null }),
  duplicateOrder: (id: string) => post<{ order: PurchaseOrder }>(`/purchase-orders/${id}/duplicate`),
  deleteOrder: (id: string) => del(`/purchase-orders/${id}`),
  receiveOrder: (id: string, input: ReceiveInput) => post<{ order: PurchaseOrder; bill: PoBill | null }>(`/purchase-orders/${id}/receive`, input),
  reorderDraft: (supplierId: string) => get<ReorderDraft>("/purchase-orders/reorder-draft", { supplierId }),
  events: (entityType: string, entityId: string) => get<{ events: ImsEvent[] }>("/events", { entityType, entityId, limit: 100 }),

  pendingBills,
  approveBill: (id: string, note?: string | null) => post<unknown>(`/bills/${id}/approve`, { note: note || null }),
  holdBill: (id: string, reason: string) => post<unknown>(`/bills/${id}/hold`, { reason }),
};

/** Copies text, falling back to a hidden textarea where the async clipboard isn't allowed. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
