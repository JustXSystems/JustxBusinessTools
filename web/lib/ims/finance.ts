/**
 * Sales & finance client: invoices and the POS counter, receivables (collections),
 * payables (bills, payment runs), the party ledger and daily closing.
 * Built on the request helpers in `api.ts`; pure helpers mirror server/src/ims/logic.ts.
 */
import { del, get, patch, post, type AgingKey, type DateRange, type DunningLevel, type DunningTone, type Period, type ReminderSettings } from "./api";
import { withBasePath } from "@/lib/base-path";
import type { BadgeView } from "./format";
import type { ImsLine, ImsLineInput } from "./format";

/* ---------- Shared ---------- */

export const PAY_METHODS = ["cash", "upi", "card", "bank", "cheque"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { cash: "Cash", upi: "UPI", card: "Card", bank: "Bank transfer", cheque: "Cheque" };
export const methodLabel = (m: string | null | undefined): string => (m && m in PAY_METHOD_LABEL ? PAY_METHOD_LABEL[m as PayMethod] : m ? m.toUpperCase() : "—");

export type ImsPayment = {
  id: string;
  direction: "in" | "out";
  partyId: string | null;
  partyName: string;
  docType: "invoice" | "bill" | "on_account";
  docId: string | null;
  docNo: string | null;
  amount: number;
  method: string;
  reference: string | null;
  paidOn: string;
  runId: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

export type PaymentInput = { amount: number; date?: string; method: PayMethod; reference?: string | null; notes?: string | null };

/* ---------- Invoices ---------- */

export type InvoiceStatus = "draft" | "pending_approval" | "issued" | "cancelled";
export type InvoiceDisplayStatus = "draft" | "pending_approval" | "unpaid" | "partial" | "paid" | "overdue" | "cancelled";
export type InvoiceDocKind = "tax_invoice" | "proforma" | "credit_note" | "debit_note" | "retainer";
export type ArPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ArStatus = "disputed" | "promise" | "promise_missed" | "overdue" | "partial" | "due";

export type ImsInvoice = {
  id: string;
  invoiceNo: string;
  isDraftNo: boolean;
  docKind: InvoiceDocKind;
  againstInvoiceId: string | null;
  againstInvoiceNo: string | null;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  customerPoNo: string | null;
  shipToName: string | null;
  shipToGstin: string | null;
  shipToAddress: string | null;
  shipToState: string | null;
  shipToMobile: string | null;
  placeOfSupply: string | null;
  intraState: boolean;
  invoiceDate: string;
  dueDate: string | null;
  subtotal: number;
  discountTotal: number;
  taxable: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  shippingCharges: number;
  shippingGstRate: number;
  shippingTax: number;
  retentionPct: number;
  retentionAmount: number;
  progressPct: number | null;
  progressLabel: string | null;
  recurringId: string | null;
  roundOff: number;
  roundToRupee: boolean;
  grandTotal: number;
  /** Document currency (ISO-4217). `INR` unless the invoice was raised in a foreign currency. */
  currencyCode: string;
  /** Locked FX rate vs the base currency (1 when the document is in the base currency). */
  fxRate: number;
  /** Grand total in the base currency (= grandTotal when not foreign). */
  fxBaseTotal: number;
  /** Customer portal magic link is live (token itself is only in the invoice detail). */
  portalEnabled: boolean;
  amountPaid: number;
  creditApplied: number;
  advanceApplied: number;
  balance: number;
  payMode: string | null;
  approvedBy: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  stockPosted: boolean;
  /** Linked delivery challans (stock already moved on DC approve when present). */
  dcIds?: string[];
  dcLinks?: Array<{ id: string; docNo: string; status: string; stockPosted: boolean }>;
  accountManagerId: number | null;
  accountManagerName: string | null;
  promiseDate: string | null;
  promiseAmount: number | null;
  disputed: boolean;
  disputeReason: string | null;
  lastReminderAt: string | null;
  lastReminderChannel: string | null;
  reminderCount: number;
  autoReminder: boolean;
  sourceTool: string | null;
  /** Internal link id (BOM uuid etc.) — use for navigation, not display. */
  sourceRef: string | null;
  /** Business document number for the source (e.g. BOM no.). */
  sourceLabel: string | null;
  notes: string | null;
  terms: string | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  einvStatus: string | null;
  irn: string | null;
  ackNo: string | null;
  ackAt: string | null;
  signedQr: string | null;
  ewayBillNo: string | null;
  ewayValidUpto: string | null;
  daysOverdue: number;
  ageDays: number;
  agingBucket: AgingKey;
  priority: ArPriority;
  arStatus: ArStatus;
  lineCount: number;
  lines?: ImsLine[];
};

export type ArActivity = {
  id: string;
  partyId: string | null;
  partyName: string | null;
  invoiceId: string | null;
  kind: string;
  channel: string | null;
  templateKey: string | null;
  message: string | null;
  promiseDate: string | null;
  promiseAmount: number | null;
  status: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

export type HsnRow = { hsn: string; unit: string; gstRate: number; qty: number; taxable: number; tax: number };
export type InvoiceDetail = {
  invoice: ImsInvoice & { lines: ImsLine[]; dcIds?: string[]; dcLinks?: Array<{ id: string; docNo: string; status: string; stockPosted: boolean }>; portalToken?: string | null };
  hsn: HsnRow[];
  payments: ImsPayment[];
  activity: ArActivity[];
};

export type InvoiceList = {
  range: DateRange | null;
  invoices: ImsInvoice[];
  counts: Record<"all" | InvoiceDisplayStatus, number>;
  kpis: {
    salesMtd: number;
    salesLastMonthToDate: number;
    invoicesMtd: number;
    outstanding: number;
    overdue: number;
    overdueCount: number;
    periodSales: number;
    avgInvoice: number;
    periodCount: number;
  };
};

export type InvoiceInput = {
  customerId?: string | null;
  customerName: string;
  customerGstin?: string | null;
  customerAddress?: string | null;
  customerMobile?: string | null;
  customerPoNo?: string | null;
  shipToName?: string | null;
  shipToGstin?: string | null;
  shipToAddress?: string | null;
  shipToState?: string | null;
  shipToMobile?: string | null;
  placeOfSupply?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  docKind?: InvoiceDocKind;
  shippingCharges?: number;
  shippingGstRate?: number;
  retentionPct?: number;
  progressPct?: number | null;
  progressLabel?: string | null;
  accountManagerId?: number | null;
  accountManagerName?: string | null;
  /** Document currency; omitted = the business base currency. */
  currencyCode?: string;
  /** Locked FX rate vs base. Forced to 1 by the server when currencyCode equals the base. */
  fxRate?: number;
  lines: ImsLineInput[];
  roundToRupee?: boolean;
  notes?: string | null;
  terms?: string | null;
};

export type RecurringProfile = {
  id: string;
  profileName: string;
  status: "active" | "paused" | "ended";
  frequency: "days" | "weeks" | "months" | "years";
  repeatEvery: number;
  startOn: string;
  nextRunOn: string;
  endOn: string | null;
  autoIssue: boolean;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  customerMobile: string | null;
  placeOfSupply: string | null;
  intraState: boolean;
  customerPoNo: string | null;
  shipToName: string | null;
  shipToGstin: string | null;
  shipToAddress: string | null;
  shipToState: string | null;
  shipToMobile: string | null;
  lines: ImsLineInput[];
  shippingCharges: number;
  shippingGstRate: number;
  roundToRupee: boolean;
  paymentTermsDays: number | null;
  accountManagerId: number | null;
  accountManagerName: string | null;
  notes: string | null;
  terms: string | null;
  lastRunOn: string | null;
  lastInvoiceId: string | null;
  lastInvoiceNo: string | null;
  runCount: number;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type RecurringInput = {
  profileName: string;
  frequency: "days" | "weeks" | "months" | "years";
  repeatEvery?: number;
  startOn?: string;
  endOn?: string | null;
  autoIssue?: boolean;
  customerId?: string | null;
  customerName: string;
  customerGstin?: string | null;
  customerAddress?: string | null;
  customerMobile?: string | null;
  placeOfSupply?: string | null;
  customerPoNo?: string | null;
  shipToName?: string | null;
  shipToGstin?: string | null;
  shipToAddress?: string | null;
  shipToState?: string | null;
  shipToMobile?: string | null;
  lines: ImsLineInput[];
  shippingCharges?: number;
  shippingGstRate?: number;
  roundToRupee?: boolean;
  paymentTermsDays?: number | null;
  accountManagerId?: number | null;
  accountManagerName?: string | null;
  notes?: string | null;
  terms?: string | null;
  status?: "active" | "paused" | "ended";
};

export type CustomerSummary = { outstanding: number; overdue: number; openCount: number; lastInvoiceDate: string | null; creditLimit: number | null };

export type PosSaleInput = {
  customerId?: string | null;
  customerName?: string | null;
  customerMobile?: string | null;
  customerGstin?: string | null;
  lines: ImsLineInput[];
  method: "cash" | "upi" | "card";
  tendered?: number | null;
  reference?: string | null;
  roundToRupee?: boolean;
};

export type PosToday = {
  today: string;
  bills: Array<{ id: string; invoiceNo: string; customerName: string; grandTotal: number; payMode: string | null; status: string; createdAt: string | null }>;
  total: number;
  count: number;
  byMethod: Record<string, number>;
};

export const INVOICE_BADGE: Record<InvoiceDisplayStatus, BadgeView> = {
  draft: { text: "Draft", tone: "neutral" },
  pending_approval: { text: "Pending approval", tone: "amber" },
  unpaid: { text: "Unpaid", tone: "blue" },
  partial: { text: "Partly paid", tone: "amber" },
  paid: { text: "Paid", tone: "emerald" },
  overdue: { text: "Overdue", tone: "coral" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

export const INVOICE_STAMP: Partial<Record<InvoiceDisplayStatus, { text: string; color: string }>> = {
  paid: { text: "PAID", color: "#1FA679" },
  overdue: { text: "OVERDUE", color: "#E1483F" },
  cancelled: { text: "CANCELLED", color: "#8A8FA3" },
  draft: { text: "DRAFT", color: "#8A8FA3" },
  pending_approval: { text: "APPROVAL", color: "#D97706" },
};

/* ---------- Receivables ---------- */

export type ReminderChannel = "whatsapp" | "sms" | "email";

export type ArCustomer = {
  key: string;
  customerId: string | null;
  name: string;
  mobile: string | null;
  email: string | null;
  accountManagerName: string | null;
  openCount: number;
  outstanding: number;
  overdue: number;
  oldestDaysOverdue: number;
  priority: ArPriority;
  disputedCount: number;
  promiseCount: number;
  lastReminderAt: string | null;
  invoiceIds: string[];
};

export type ReceivablesData = {
  today: string;
  businessName: string;
  invoices: ImsInvoice[];
  kpis: {
    totalOutstanding: number;
    openCount: number;
    customerCount: number;
    overdue: number;
    overdueCount: number;
    overdue90: number;
    dueThisWeek: number;
    dueThisWeekCount: number;
    collectedThisMonth: number;
    collectedThisMonthCount: number;
    expectedThisMonth: number;
    dso: number;
    promisesDue: number;
    promisesDueCount: number;
    promisesMissedCount: number;
    disputed: number;
    disputedCount: number;
  };
  aging: Array<{ key: AgingKey; label: string; color: string; amount: number; count: number; customers: number }>;
  notDue: { amount: number; count: number };
  customers: ArCustomer[];
  managers: Array<{ userId: number; name: string; isAccountManager: boolean }>;
  reminders: ReminderSettings;
  ruleMatches: Array<{ invoiceId: string; rule: string; ruleLabel: string; templateKey: string | null }>;
  /** Dunning sequence levels + the last letter prepared per customer key. */
  dunning?: { levels: DunningLevel[]; last: Record<string, DunningLast> };
};

export type DunningLast = { levelKey: string; levelLabel: string; preparedAt: string | null; runs: number };

export type DunningRun = {
  id: string;
  customerId: string | null;
  customerName: string;
  levelKey: string;
  levelLabel: string;
  tone: DunningTone;
  totalDue: number;
  invoiceIds: string[];
  status: string;
  preparedByName: string | null;
  preparedAt: string | null;
  notes: string | null;
};

export type DunningLetterPayload = {
  levelKey: string;
  levelLabel: string;
  tone: DunningTone;
  subject: string;
  intro: string;
  closing: string;
  asOf: string;
  customerName: string;
  businessName: string;
  totalDue: number;
  invoices: Array<{ invoiceNo: string; invoiceDate: string; dueDate: string | null; daysOverdue: number; balance: number; currencyCode: string }>;
};

/* ---------- Installment plans ---------- */

export type InstallmentStatus = "pending" | "partial" | "paid";
export type ImsInstallment = {
  id: string;
  seqNo: number;
  dueOn: string;
  amount: number;
  amountPaid: number;
  balance: number;
  status: InstallmentStatus;
  overdue: boolean;
  label: string | null;
};
export type ImsInstallmentPlan = {
  id: string;
  invoiceId: string;
  label: string | null;
  status: "active" | "completed" | "cancelled";
  total: number;
  paid: number;
  createdByName: string | null;
  createdAt: string | null;
  installments: ImsInstallment[];
};
export type InstallmentDraft = { dueOn: string; amount: number; label?: string | null };

/** Customer-portal link state for an invoice. `path` is app-relative (`/ims/portal/{token}`). */
export type PortalState = { enabled: boolean; token: string | null; path: string | null };

/** Absolute, base-path-aware URL a customer can open (call in the browser). */
export function portalUrl(path: string): string {
  return `${window.location.origin}${withBasePath(path)}`;
}

export type SentReminder = { invoiceId: string; invoiceNo: string; customerName: string; channel: ReminderChannel; to: string | null; message: string; subject: string | null; link: string };

export const AR_PRIORITY_BADGE: Record<ArPriority, BadgeView> = {
  CRITICAL: { text: "Critical", tone: "coral" },
  HIGH: { text: "High", tone: "amber" },
  MEDIUM: { text: "Medium", tone: "blue" },
  LOW: { text: "Low", tone: "neutral" },
};

export const AR_STATUS_BADGE: Record<ArStatus, BadgeView> = {
  disputed: { text: "Disputed", tone: "lavender" },
  promise: { text: "Promised", tone: "blue" },
  promise_missed: { text: "Promise missed", tone: "coral" },
  overdue: { text: "Overdue", tone: "coral" },
  partial: { text: "Partly paid", tone: "amber" },
  due: { text: "Not due", tone: "emerald" },
};

export const CHANNEL_LABEL: Record<ReminderChannel, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email" };

/* ---------- Payables ---------- */

export type BillStatus = "pending_approval" | "approved" | "on_hold" | "scheduled" | "cancelled";
export type BillDisplayStatus = BillStatus | "partial" | "paid" | "overdue";
export type ApPriority = "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "UPCOMING";

export type ImsBill = {
  id: string;
  billNo: string;
  supplierBillNo: string | null;
  supplierId: string | null;
  supplierName: string;
  supplierMobile: string | null;
  supplierEmail: string | null;
  supplierGstin: string | null;
  poId: string | null;
  poNo: string | null;
  billDate: string;
  dueDate: string | null;
  daysToDue: number | null;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  currencyCode: string;
  fxRate: number;
  fxBaseTotal: number;
  amountPaid: number;
  balance: number;
  status: BillStatus;
  displayStatus: BillDisplayStatus;
  priority: ApPriority;
  holdReason: string | null;
  scheduledOn: string | null;
  payMethod: string | null;
  category: string | null;
  runId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lineCount: number;
  lines?: ImsLine[];
};

export type BillDetail = {
  bill: ImsBill & { lines: ImsLine[] };
  payments: ImsPayment[];
  events: Array<{ id: number; actorName: string | null; type: string; summary: string; createdAt: string | null }>;
};

export type BillList = {
  bills: ImsBill[];
  counts: Record<string, number>;
  kpis: {
    totalPayable: number;
    overdue: number;
    overdueCount: number;
    dueThisWeek: number;
    dueThisWeekCount: number;
    scheduled: number;
    scheduledCount: number;
    onHold: number;
    onHoldCount: number;
    pendingApproval: number;
    pendingApprovalCount: number;
    paidThisMonth: number;
    paidThisMonthCount: number;
  };
  canApprove: boolean;
  canPay: boolean;
};

export type BillInput = {
  supplierId?: string | null;
  supplierName: string;
  supplierBillNo?: string | null;
  billDate: string;
  dueDate?: string | null;
  lines?: ImsLineInput[];
  amount?: number;
  taxAmount?: number;
  category?: string | null;
  notes?: string | null;
  currencyCode?: string;
  fxRate?: number;
};

export type PaymentRun = {
  id: string;
  runNo: string;
  status: "scheduled" | "paid" | "cancelled";
  runDate: string;
  method: string;
  reference: string | null;
  billIds: string[];
  billCount: number;
  total: number;
  notes: string | null;
  paidAt: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

export const BILL_BADGE: Record<BillDisplayStatus, BadgeView> = {
  pending_approval: { text: "Pending approval", tone: "amber" },
  approved: { text: "Approved", tone: "blue" },
  on_hold: { text: "On hold", tone: "lavender" },
  scheduled: { text: "Scheduled", tone: "blue" },
  cancelled: { text: "Cancelled", tone: "neutral" },
  partial: { text: "Partly paid", tone: "amber" },
  paid: { text: "Paid", tone: "emerald" },
  overdue: { text: "Overdue", tone: "coral" },
};

export const AP_PRIORITY_BADGE: Record<ApPriority, BadgeView> = {
  OVERDUE: { text: "Overdue", tone: "coral" },
  DUE_TODAY: { text: "Due today", tone: "amber" },
  DUE_SOON: { text: "Due this week", tone: "blue" },
  UPCOMING: { text: "Upcoming", tone: "neutral" },
};

export const RUN_BADGE: Record<PaymentRun["status"], BadgeView> = {
  scheduled: { text: "Scheduled", tone: "blue" },
  paid: { text: "Paid", tone: "emerald" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

/** Money can go out only against approved or scheduled bills. */
export const billPayable = (status: string): boolean => status === "approved" || status === "scheduled";

/* ---------- Ledger ---------- */

export type PartyBalance = {
  key: string;
  partyId: string | null;
  name: string;
  kind: string | null;
  mobile: string | null;
  opening: number;
  sales: number;
  received: number;
  purchases: number;
  paid: number;
  creditNotes: number;
  debitNotes: number;
  manual: number;
  /** Positive = the party owes you; negative = you owe the party. */
  balance: number;
  lastActivity: string | null;
};

export type LedgerEntryCategory = "udhaar" | "credit_note" | "debit_note" | "opening" | "adjustment";

export type LedgerEntry = {
  id: string;
  partyId: string | null;
  partyName: string;
  /** credit = the party owes you; debit = you owe the party. */
  type: "credit" | "debit";
  category: string;
  amount: number;
  date: string;
  dueDate: string | null;
  overdue: boolean;
  daysOverdue: number;
  refNo: string | null;
  phone: string | null;
  notes: string | null;
  status: "pending" | "settled";
  settledOn: string | null;
  settleMethod: string | null;
  settledByName: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

type PendingTotals = { total: number; count: number; overdue: number };

export type LedgerData = {
  today: string;
  parties: PartyBalance[];
  summary: { receivable: number; payable: number; receivableParties: number; payableParties: number; manualCredit: PendingTotals; manualDebit: PendingTotals };
  entries: LedgerEntry[];
};

export type LedgerEntryInput = {
  type: "credit" | "debit";
  partyId?: string | null;
  partyName: string;
  phone?: string | null;
  amount: number;
  date?: string;
  dueDate?: string | null;
  category?: LedgerEntryCategory;
  refNo?: string | null;
  notes?: string | null;
};

export type StatementKind = "opening" | "invoice" | "receipt" | "bill" | "payment" | "credit_note" | "debit_note" | "entry" | "settlement";
export type StatementRow = {
  date: string;
  kind: StatementKind;
  ref: string | null;
  description: string;
  debit: number;
  credit: number;
  module: "sales" | "payables" | "returns" | "ledger" | null;
  open: string | null;
  balance: number;
};

export type Statement = {
  party: { id: string | null; name: string; kind: string | null; mobile: string | null; email: string | null; gstin: string | null; address: string | null; state: string | null; creditLimit: number | null };
  range: DateRange;
  opening: number;
  rows: StatementRow[];
  totals: { debit: number; credit: number };
  closing: number;
};

export const LEDGER_CATEGORY_LABEL: Record<LedgerEntryCategory, string> = {
  udhaar: "Udhaar / credit",
  credit_note: "Credit note",
  debit_note: "Debit note",
  opening: "Opening balance",
  adjustment: "Adjustment",
};

export const STATEMENT_KIND_LABEL: Record<StatementKind, string> = {
  opening: "Opening",
  invoice: "Invoice",
  receipt: "Receipt",
  bill: "Bill",
  payment: "Payment",
  credit_note: "Credit note",
  debit_note: "Debit note",
  entry: "Entry",
  settlement: "Settlement",
};

/* ---------- Expenses & closing ---------- */

export type ImsExpense = {
  id: string;
  date: string;
  category: string;
  description: string | null;
  amount: number;
  gstAmount: number;
  method: string;
  vendor: string | null;
  reference: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

export type ExpenseInput = { date?: string; category: string; description?: string | null; amount: number; gstAmount?: number; method: PayMethod; vendor?: string | null; reference?: string | null };

export type MethodTotals = Record<PayMethod, number>;
export type DayFigures = {
  sales: MethodTotals;
  collections: MethodTotals;
  paid: MethodTotals;
  expenses: MethodTotals;
  totals: { sales: number; collections: number; paid: number; expenses: number };
  expectedCash: number;
};

export type ImsClosing = {
  id: string;
  date: string;
  status: "open" | "closed";
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number;
  summary: (Partial<DayFigures> & { sales?: DaySales | MethodTotals; expenseCount?: number; expenseTotal?: number }) | null;
  notes: string | null;
  closedByName: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DaySales = { count: number; total: number; posCount: number; posTotal: number; credit: number; tax: number };

export type ClosingDay = {
  date: string;
  today: string;
  closing: ImsClosing | null;
  lastClosing: ImsClosing | null;
  suggestedOpening: number;
  openingCash: number;
  figures: DayFigures;
  sales: DaySales;
  expenses: ImsExpense[];
  canReopen: boolean;
};

export type ClosingHistory = { closings: ImsClosing[]; stats: { days: number; shortDays: number; overDays: number; netVariance: number } };

/* ---------- Endpoints ---------- */

export type InvoiceQuery = {
  period?: Period | "all";
  from?: string;
  to?: string;
  customerId?: string;
  source?: "pos" | "quotation" | "bom" | "tally";
  docKind?: InvoiceDocKind | "notes";
  q?: string;
  status?: string;
  limit?: number;
};

/** NPCI UPI intent for payment QR on tax invoices. */
export function upiPayIntent(opts: { vpa: string; payeeName?: string | null; amount?: number | null; note?: string | null }): string | null {
  const pa = String(opts.vpa ?? "").trim();
  if (!pa || !pa.includes("@")) return null;
  const q = new URLSearchParams();
  q.set("pa", pa);
  q.set("pn", String(opts.payeeName ?? "Payee").trim().slice(0, 80) || "Payee");
  q.set("cu", "INR");
  if (opts.amount != null && opts.amount > 0.005) q.set("am", Number(opts.amount).toFixed(2));
  if (opts.note?.trim()) q.set("tn", opts.note.trim().slice(0, 80));
  return `upi://pay?${q.toString()}`;
}

export const DOC_KIND_LABEL: Record<InvoiceDocKind, string> = {
  tax_invoice: "Tax invoice",
  proforma: "Proforma",
  credit_note: "Credit note",
  debit_note: "Debit note",
  retainer: "Retainer / advance",
};
export type BillQuery = { status?: string; supplierId?: string; q?: string; priority?: string };

export const finance = {
  salesMeta: () => get<{ canWrite: boolean; canCollect: boolean; allowNegativeStock: boolean; paymentTermsDays: number; invoicePrefix: string }>("/sales/meta"),
  invoices: (params: InvoiceQuery = {}) => get<InvoiceList>("/invoices", params),
  invoice: (id: string) => get<InvoiceDetail>(`/invoices/${id}`),
  customerSummary: (customerId: string) => get<CustomerSummary>("/invoices/customer-summary", { customerId }),
  createInvoice: (input: InvoiceInput & { issue?: boolean }) => post<InvoiceDetail>("/invoices", input),
  updateInvoice: (id: string, input: InvoiceInput) => patch<InvoiceDetail>(`/invoices/${id}`, input),
  issueInvoice: (id: string) => post<InvoiceDetail>(`/invoices/${id}/issue`),
  approveInvoice: (id: string, note?: string | null) => post<InvoiceDetail>(`/invoices/${id}/approve`, { note: note || null }),
  rejectInvoice: (id: string, reason: string) => post<InvoiceDetail>(`/invoices/${id}/reject`, { reason }),
  withdrawInvoiceApproval: (id: string) => post<InvoiceDetail>(`/invoices/${id}/withdraw-approval`),
  applyAdvance: (id: string, input: { retainerId: string; amount?: number }) => post<InvoiceDetail>(`/invoices/${id}/apply-advance`, input),
  cancelInvoice: (id: string, reason: string) => post<InvoiceDetail>(`/invoices/${id}/cancel`, { reason }),
  duplicateInvoice: (id: string) => post<InvoiceDetail>(`/invoices/${id}/duplicate`),
  createCreditNote: (id: string, input?: { notes?: string | null; restock?: boolean }) => post<InvoiceDetail>(`/invoices/${id}/credit-note`, input ?? {}),
  createDebitNote: (id: string, input?: { notes?: string | null }) => post<InvoiceDetail>(`/invoices/${id}/debit-note`, input ?? {}),
  convertProforma: (id: string) => post<InvoiceDetail>(`/invoices/${id}/convert-proforma`),
  associateEInvoice: (
    id: string,
    input: { irn: string; ackNo?: string | null; ackAt?: string | null; signedQr?: string | null; ewayBillNo?: string | null; ewayValidUpto?: string | null },
  ) => post<InvoiceDetail>(`/invoices/${id}/e-invoice/associate`, input),
  pushEInvoice: (id: string) => post<InvoiceDetail>(`/invoices/${id}/e-invoice/push`),
  markEInvoiceCancelled: (id: string, reason?: string | null) => post<InvoiceDetail>(`/invoices/${id}/e-invoice/mark-cancelled`, { reason }),
  deleteInvoice: (id: string) => del(`/invoices/${id}`),

  recurringProfiles: () => get<{ profiles: RecurringProfile[] }>("/recurring-invoices"),
  recurringProfile: (id: string) => get<{ profile: RecurringProfile }>(`/recurring-invoices/${id}`),
  createRecurring: (input: RecurringInput) => post<{ profile: RecurringProfile }>("/recurring-invoices", input),
  updateRecurring: (id: string, input: Partial<RecurringInput> & { nextRunOn?: string; status?: "active" | "paused" | "ended" }) =>
    patch<{ profile: RecurringProfile }>(`/recurring-invoices/${id}`, input),
  runRecurring: (id: string, input?: { issue?: boolean }) =>
    post<{ invoice: InvoiceDetail; profile: RecurringProfile }>(`/recurring-invoices/${id}/run`, input ?? {}),
  tickRecurring: () =>
    post<{ today: string; due: number; created: Array<{ profileId: string; invoiceId: string; invoiceNo: string }>; errors: Array<{ profileId: string; error: string }> }>(
      "/recurring-invoices/tick",
    ),
  recordInvoicePayment: (id: string, input: PaymentInput) => post<InvoiceDetail>(`/invoices/${id}/payments`, input),
  recordReceipt: (input: PaymentInput & { partyId?: string | null; partyName: string; invoiceIds?: string[] }) =>
    post<{ applied: Array<{ invoiceId: string; invoiceNo: string; amount: number }>; onAccount: number }>("/receipts", input),
  voidPayment: (id: string) => del(`/payments/${id}`),

  posSale: (input: PosSaleInput) => post<InvoiceDetail & { change: number | null }>("/pos/sale", input),
  posToday: () => get<PosToday>("/pos/today"),

  receivables: () => get<ReceivablesData>("/receivables"),
  sendReminders: (input: { invoiceIds: string[]; channel: ReminderChannel; templateKey?: string | null; message?: string | null; subject?: string | null; rule?: string | null }) =>
    post<{ sent: SentReminder[] }>("/receivables/reminders", input),
  promise: (id: string, input: { date?: string | null; amount?: number | null; note?: string | null; clear?: boolean }) => post<InvoiceDetail>(`/invoices/${id}/promise`, input),
  dispute: (id: string, input: { disputed: boolean; reason?: string | null }) => post<InvoiceDetail>(`/invoices/${id}/dispute`, input),
  addNote: (id: string, input: { kind: "note" | "call" | "escalation"; channel?: string | null; message: string }) => post<InvoiceDetail>(`/invoices/${id}/notes`, input),
  assign: (input: { invoiceIds: string[]; managerId: number | null; applyToCustomer?: boolean }) => post<{ ok: true; managerName: string | null }>("/receivables/assign", input),
  setAutoReminder: (invoiceIds: string[], enabled: boolean) => post<{ ok: true }>("/receivables/auto-reminder", { invoiceIds, enabled }),

  /* Wave 6: dunning sequences, payment plans, customer portal */
  dunningRuns: (params: { customerId?: string | null; customerName?: string | null; limit?: number } = {}) =>
    get<{ runs: DunningRun[]; levels: DunningLevel[] }>("/receivables/dunning-runs", { customerId: params.customerId ?? undefined, customerName: params.customerName ?? undefined, limit: params.limit }),
  createDunningRun: (input: { customerId?: string | null; customerName?: string; levelKey: string; invoiceIds?: string[]; notes?: string | null }) =>
    post<{ run: DunningRun | null; suggestedLevelKey: string | null; letter: DunningLetterPayload }>("/receivables/dunning-runs", input),
  installments: (invoiceId: string) => get<{ plan: ImsInstallmentPlan | null; balance: number }>(`/invoices/${invoiceId}/installments`),
  createInstallments: (invoiceId: string, input: { label?: string | null; installments: InstallmentDraft[] }) => post<{ plan: ImsInstallmentPlan | null }>(`/invoices/${invoiceId}/installments`, input),
  deleteInstallments: (invoiceId: string) => del(`/invoices/${invoiceId}/installments`),
  invoicePortal: (invoiceId: string) => get<PortalState>(`/invoices/${invoiceId}/portal`),
  enableInvoicePortal: (invoiceId: string, input: { regenerate?: boolean } = {}) => post<PortalState>(`/invoices/${invoiceId}/portal/enable`, input),
  disableInvoicePortal: (invoiceId: string) => post<PortalState>(`/invoices/${invoiceId}/portal/disable`),

  bills: (params: BillQuery = {}) => get<BillList>("/bills", params),
  bill: (id: string) => get<BillDetail>(`/bills/${id}`),
  createBill: (input: BillInput & { approveNow?: boolean }) => post<BillDetail>("/bills", input),
  updateBill: (id: string, input: BillInput) => patch<BillDetail>(`/bills/${id}`, input),
  approveBill: (id: string, note?: string | null) => post<BillDetail>(`/bills/${id}/approve`, { note }),
  holdBill: (id: string, reason: string) => post<BillDetail>(`/bills/${id}/hold`, { reason }),
  releaseBill: (id: string) => post<BillDetail>(`/bills/${id}/release`),
  scheduleBill: (id: string, date: string, method: PayMethod) => post<BillDetail>(`/bills/${id}/schedule`, { date, method }),
  unscheduleBill: (id: string) => post<BillDetail>(`/bills/${id}/unschedule`),
  cancelBill: (id: string, reason: string) => post<BillDetail>(`/bills/${id}/cancel`, { reason }),
  payBill: (id: string, input: PaymentInput) => post<BillDetail>(`/bills/${id}/payments`, input),

  paymentRuns: () => get<{ runs: PaymentRun[] }>("/payment-runs"),
  paymentRun: (id: string) => get<{ run: PaymentRun; bills: ImsBill[]; payments: ImsPayment[] }>(`/payment-runs/${id}`),
  createPaymentRun: (input: { billIds: string[]; runDate: string; method: PayMethod; reference?: string | null; notes?: string | null; markPaid?: boolean }) =>
    post<{ run: PaymentRun | null }>("/payment-runs", input),
  payPaymentRun: (id: string, input: { paidOn?: string; reference?: string | null } = {}) => post<{ runNo: string; total: number; count: number }>(`/payment-runs/${id}/pay`, input),
  cancelPaymentRun: (id: string) => post<{ ok: true }>(`/payment-runs/${id}/cancel`),

  ledger: (params: { type?: "credit" | "debit"; status?: "pending" | "settled"; partyId?: string; q?: string; period?: Period | "all"; from?: string; to?: string } = {}) => get<LedgerData>("/ledger", params),
  statement: (params: { partyId?: string | null; partyName?: string; period?: Period | "all"; from?: string; to?: string }) => get<Statement>("/ledger/statement", params),
  addEntry: (input: LedgerEntryInput) => post<{ entry: LedgerEntry | null }>("/ledger/entries", input),
  settleEntry: (id: string, input: { date?: string; method: PayMethod }) => post<{ entry: LedgerEntry | null }>(`/ledger/entries/${id}/settle`, input),
  reopenEntry: (id: string) => post<{ ok: true }>(`/ledger/entries/${id}/reopen`),
  deleteEntry: (id: string) => del(`/ledger/entries/${id}`),

  expenses: (params: { date?: string; period?: Period; from?: string; to?: string; category?: string } = {}) =>
    get<{ range: DateRange; expenses: ImsExpense[]; totals: { total: number; gst: number; byCategory: Array<{ category: string; amount: number; count: number }>; byMethod: Record<string, number> }; categories: string[] }>("/expenses", params),
  addExpense: (input: ExpenseInput) => post<{ expense: ImsExpense | null }>("/expenses", input),
  deleteExpense: (id: string) => del(`/expenses/${id}`),

  closingDay: (date?: string) => get<ClosingDay>("/closing/day", { date }),
  closeDay: (input: { date?: string; openingCash: number; countedCash: number; notes?: string | null }) => post<{ closing: ImsClosing | null }>("/closing", input),
  reopenDay: (id: string, reason: string) => post<{ ok: true }>(`/closing/${id}/reopen`, { reason }),
  closingHistory: (limit = 90) => get<ClosingHistory>("/closing/history", { limit }),
  closing: (id: string) => get<{ closing: ImsClosing; expenses: ImsExpense[] }>(`/closing/${id}`),
};

/* ---------- Pure helpers (mirror server/src/ims/logic.ts) ---------- */

/** GST state codes (the first two digits of a GSTIN). */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

const STATE_ALIASES: Record<string, string> = { orissa: "21", pondicherry: "34", "new delhi": "07", "nct of delhi": "07", "j&k": "01", "jammu & kashmir": "01", "andaman & nicobar islands": "35", "daman and diu": "26", "dadra and nagar haveli": "26" };

export function gstStateCode(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/^\d{1,2}$/.test(v)) return v.padStart(2, "0");
  return GST_STATES.find((s) => s.name.toLowerCase() === v)?.code ?? STATE_ALIASES[v] ?? null;
}

export function gstStateName(gstinOrCode: string | null | undefined): string | null {
  const code = String(gstinOrCode ?? "").trim().slice(0, 2);
  return /^\d{2}$/.test(code) ? (GST_STATES.find((s) => s.code === code)?.name ?? null) : null;
}

/** CGST + SGST when the place of supply is the seller's state; unknown → intra-state. */
export function intraStateFor(seller: { state?: string | null; stateCode?: string | null }, placeOfSupply?: string | null): boolean {
  const pos = String(placeOfSupply ?? "").trim();
  if (!pos) return true;
  const a = gstStateCode(seller.stateCode) ?? gstStateCode(seller.state);
  const b = gstStateCode(pos);
  if (a && b) return a === b;
  const s = String(seller.state || seller.stateCode || "").trim().toLowerCase();
  return !s || s === pos.toLowerCase();
}

/** Change to hand back at the counter; null when the tender is blank or short. */
export function posChange(total: number, tendered: number | null | undefined): number | null {
  if (tendered == null || !Number.isFinite(tendered)) return null;
  const diff = Math.round((tendered - total) * 100) / 100;
  return diff < 0 ? null : diff;
}

export function waNumber(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Click-to-send link that opens WhatsApp / SMS / mail with the message filled in. */
export function reminderLink(channel: ReminderChannel, to: string | null | undefined, message: string, subject?: string | null): string {
  const body = encodeURIComponent(message);
  if (channel === "whatsapp") {
    const n = waNumber(to);
    return n ? `https://wa.me/${n}?text=${body}` : `https://wa.me/?text=${body}`;
  }
  if (channel === "sms") return `sms:${String(to ?? "").replace(/[^\d+]/g, "")}?body=${body}`;
  const email = String(to ?? "").trim();
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject ?? "")}&body=${body}`;
}

export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

const rupees = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** Template variables for one invoice (same names the server fills in). */
export function reminderVars(inv: Pick<ImsInvoice, "customerName" | "invoiceNo" | "balance" | "grandTotal" | "dueDate" | "daysOverdue">, business: string) {
  return {
    customer: inv.customerName,
    invoice: inv.invoiceNo,
    amount: rupees(inv.balance),
    balance: rupees(inv.balance),
    total: rupees(inv.grandTotal),
    due: shortDate(inv.dueDate),
    days: inv.daysOverdue,
    business: business || "Accounts team",
  };
}

/** Plain-text tax invoice for WhatsApp. */
export function invoiceShareText(inv: ImsInvoice & { lines: ImsLine[] }, seller: { name: string; gstin?: string | null; phone?: string | null }): string {
  const out = [`*TAX INVOICE — ${inv.isDraftNo ? "DRAFT" : inv.invoiceNo}*`, `Date: ${shortDate(inv.invoiceDate)}${inv.dueDate ? ` · Due: ${shortDate(inv.dueDate)}` : ""}`, ""];
  out.push(`From: ${seller.name || "—"}${seller.gstin ? ` (GSTIN ${seller.gstin})` : ""}`);
  out.push(`To: ${inv.customerName}${inv.customerGstin ? ` (GSTIN ${inv.customerGstin})` : ""}`, "");
  inv.lines.forEach((l, i) => out.push(`${i + 1}. ${l.name} — ${l.qty}${l.unit ? ` ${l.unit}` : ""} × ${rupees(l.rate)} = ${rupees(l.amount)}`));
  out.push("", `Taxable: ${rupees(inv.taxable)}`);
  if (inv.intraState) out.push(`CGST: ${rupees(inv.cgst)} · SGST: ${rupees(inv.sgst)}`);
  else out.push(`IGST: ${rupees(inv.igst)}`);
  out.push(`*Total: ${rupees(inv.grandTotal)}*`);
  if (inv.amountPaid > 0 && inv.balance > 0) out.push(`Paid: ${rupees(inv.amountPaid)} · *Balance: ${rupees(inv.balance)}*`);
  else if (inv.status === "issued" && inv.balance <= 0.005) out.push("Status: PAID — thank you!");
  if (seller.phone) out.push("", `Questions? Call ${seller.phone}`);
  return out.join("\n");
}

export const whatsappShareLink = (text: string, phone?: string | null) => reminderLink("whatsapp", phone, text);

/** Plain-text email compose for an invoice (mailto). */
export function invoiceEmailShareLink(
  inv: ImsInvoice & { lines?: ImsLine[] },
  seller: { name: string; gstin?: string | null; phone?: string | null },
): string | null {
  const email = String(inv.customerEmail ?? "").trim();
  if (!email || !email.includes("@")) return null;
  const lines = inv.lines ?? [];
  const body = invoiceShareText({ ...inv, lines }, seller).replace(/\*/g, "");
  const subject = `${DOC_KIND_LABEL[inv.docKind] || "Invoice"} ${inv.isDraftNo ? "draft" : inv.invoiceNo} — ${seller.name || "Invoice"}`;
  return reminderLink("email", email, body, subject);
}

/* ---------- Wave 6: currency + FX (mirrors server/src/ims/wave6-logic.ts) ---------- */

export const COMMON_CURRENCIES = ["INR", "USD", "EUR", "AED", "GBP"] as const;

/** Strict ISO-4217 shape (3 letters, upper-cased) or null. */
export function parseCurrencyCode(v: unknown): string | null {
  const s = String(v ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

export const normalizeCurrencyCode = (v: unknown, fallback = "INR"): string => parseCurrencyCode(v) ?? parseCurrencyCode(fallback) ?? "INR";

export type FxPreview = { currencyCode: string; fxRate: number; fxBaseTotal: number; foreign: boolean };

/** Same rule as the server: base currency → rate 1; foreign → base total = round2(total × rate). */
export function fxPreview(opts: { currencyCode?: string | null; fxRate?: number | string | null; baseCurrency?: string | null; grandTotal: number }): FxPreview {
  const base = normalizeCurrencyCode(opts.baseCurrency);
  const currencyCode = normalizeCurrencyCode(opts.currencyCode, base);
  const total = Math.round((opts.grandTotal + Number.EPSILON) * 100) / 100;
  if (currencyCode === base) return { currencyCode, fxRate: 1, fxBaseTotal: total, foreign: false };
  const raw = Number(opts.fxRate);
  const fxRate = Number.isFinite(raw) && raw > 0 ? Math.round(raw * 1e8) / 1e8 : 1;
  return { currencyCode, fxRate, fxBaseTotal: Math.round((total * fxRate + Number.EPSILON) * 100) / 100, foreign: true };
}

/** True when a document is in a currency other than the given base. */
export const isForeignCurrency = (code: string | null | undefined, base = "INR"): boolean => normalizeCurrencyCode(code, base) !== normalizeCurrencyCode(base);

/* ---------- Wave 6: installment plans ---------- */

/** `YYYY-MM-DD` plus whole months, clamping the day to the target month's length (31 Jan + 1 → 28/29 Feb). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = (y! * 12 + (m! - 1)) + months;
  const ty = Math.floor(idx / 12);
  const tm = idx - ty * 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${String(ty).padStart(4, "0")}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d!, last)).padStart(2, "0")}`;
}

/** N equal installments of `total` (to the paisa; the last absorbs rounding), due monthly from `firstDue`. */
export function splitInstallments(total: number, count: number, firstDue: string, everyMonths = 1): InstallmentDraft[] {
  const n = Math.max(1, Math.min(60, Math.floor(count) || 1));
  const cents = Math.round(total * 100);
  const each = Math.floor(cents / n);
  const out: InstallmentDraft[] = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    const c = i === n - 1 ? cents - used : each;
    used += c;
    out.push({ dueOn: addMonthsISO(firstDue, i * Math.max(1, everyMonths)), amount: c / 100, label: `Installment ${i + 1} of ${n}` });
  }
  return out;
}

/** Sum of drafted installments vs the balance — what the plan form validates before posting. */
export function installmentGap(items: ReadonlyArray<Pick<InstallmentDraft, "amount">>, balance: number): number {
  const sum = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  return Math.round((balance - sum) * 100) / 100;
}

/* ---------- Wave 6: dunning levels ---------- */

export const DUNNING_TONE_LABEL: Record<DunningTone, string> = { friendly: "Friendly", firm: "Firm", final: "Final notice" };

export const DEFAULT_DUNNING_LEVELS: ReadonlyArray<DunningLevel> = [
  { key: "L1", label: "Friendly reminder", minDaysOverdue: 1, tone: "friendly" },
  { key: "L2", label: "Firm reminder", minDaysOverdue: 15, tone: "firm" },
  { key: "L3", label: "Final notice", minDaysOverdue: 30, tone: "final" },
];

/** The strictest level whose threshold has been reached, or null while none qualifies. */
export function pickDunningLevel(levels: ReadonlyArray<DunningLevel>, daysOverdue: number): DunningLevel | null {
  let picked: DunningLevel | null = null;
  for (const l of [...levels].sort((a, b) => a.minDaysOverdue - b.minDaysOverdue)) if (daysOverdue >= l.minDaysOverdue) picked = l;
  return picked;
}

/** Tone wording for the letter (server returns the same copy in the run payload). */
export function dunningCopy(tone: DunningTone, v: { total: string; asOf: string; count: number }): { subject: string; intro: string; closing: string } {
  const plural = v.count === 1 ? "invoice is" : "invoices are";
  if (tone === "final") {
    return {
      subject: "FINAL NOTICE — immediate payment required",
      intro: `Despite our earlier reminders, the following ${plural} still unpaid as of ${v.asOf}. Please clear ${v.total} immediately. Failing this, we may have to suspend supplies and take recovery action without further notice.`,
      closing: "If payment has just been made, please share the transfer details so we can update our books at once.",
    };
  }
  if (tone === "firm") {
    return {
      subject: "Second reminder — overdue payment",
      intro: `We have not yet received payment for the following ${plural} overdue as of ${v.asOf}. Kindly arrange ${v.total} within the next 7 days.`,
      closing: "Please reply with the payment date if it has already been released, or call us if there is any dispute.",
    };
  }
  return {
    subject: "Outstanding dues — friendly payment reminder",
    intro: `This is a gentle reminder that the following ${plural} outstanding as of ${v.asOf}. Kindly arrange payment of ${v.total} at your earliest convenience.`,
    closing: "Please ignore this note if payment has already been made. Thank you for your business.",
  };
}
