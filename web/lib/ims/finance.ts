/**
 * Sales & finance client: invoices and the POS counter, receivables (collections),
 * payables (bills, payment runs), the party ledger and daily closing.
 * Built on the request helpers in `api.ts`; pure helpers mirror server/src/ims/logic.ts.
 */
import { del, get, patch, post, type AgingKey, type DateRange, type Period, type ReminderSettings } from "./api";
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

export type InvoiceStatus = "draft" | "issued" | "cancelled";
export type InvoiceDisplayStatus = "draft" | "unpaid" | "partial" | "paid" | "overdue" | "cancelled";
export type ArPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ArStatus = "disputed" | "promise" | "promise_missed" | "overdue" | "partial" | "due";

export type ImsInvoice = {
  id: string;
  invoiceNo: string;
  isDraftNo: boolean;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
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
  roundOff: number;
  roundToRupee: boolean;
  grandTotal: number;
  amountPaid: number;
  balance: number;
  payMode: string | null;
  stockPosted: boolean;
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
  sourceRef: string | null;
  notes: string | null;
  terms: string | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
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
export type InvoiceDetail = { invoice: ImsInvoice & { lines: ImsLine[] }; hsn: HsnRow[]; payments: ImsPayment[]; activity: ArActivity[] };

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
  placeOfSupply?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  lines: ImsLineInput[];
  roundToRupee?: boolean;
  notes?: string | null;
  terms?: string | null;
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
};

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

export type InvoiceQuery = { period?: Period | "all"; from?: string; to?: string; customerId?: string; source?: "pos" | "quotation"; q?: string; status?: string };
export type BillQuery = { status?: string; supplierId?: string; q?: string; priority?: string };

export const finance = {
  salesMeta: () => get<{ canWrite: boolean; canCollect: boolean; allowNegativeStock: boolean; paymentTermsDays: number; invoicePrefix: string }>("/sales/meta"),
  invoices: (params: InvoiceQuery = {}) => get<InvoiceList>("/invoices", params),
  invoice: (id: string) => get<InvoiceDetail>(`/invoices/${id}`),
  customerSummary: (customerId: string) => get<CustomerSummary>("/invoices/customer-summary", { customerId }),
  createInvoice: (input: InvoiceInput & { issue?: boolean }) => post<InvoiceDetail>("/invoices", input),
  updateInvoice: (id: string, input: InvoiceInput) => patch<InvoiceDetail>(`/invoices/${id}`, input),
  issueInvoice: (id: string) => post<InvoiceDetail>(`/invoices/${id}/issue`),
  cancelInvoice: (id: string, reason: string) => post<InvoiceDetail>(`/invoices/${id}/cancel`, { reason }),
  duplicateInvoice: (id: string) => post<InvoiceDetail>(`/invoices/${id}/duplicate`),
  deleteInvoice: (id: string) => del(`/invoices/${id}`),
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
