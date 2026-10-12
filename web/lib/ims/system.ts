/**
 * Client for IMS system, compliance & interop: Tally / POS, excise register,
 * auditor workspace, help desk and connected tools.
 */
import { apiUrl } from "@/lib/api-base";
import { ImsApiError, del, get, patch, post, put, qs, type DateRange, type Period } from "./api";

/* ---------- Integrations ---------- */

export type SyncStatus = "success" | "failed" | "partial";
export type SyncLogEntry = { id: number; provider: string; direction: "export" | "import"; entity: string; status: SyncStatus; records: number; message: string | null; actorName: string | null; createdAt: string | null };

export type TallyProduct = "prime" | "erp9";
export type TallySyncMode = "export" | "two_way" | "import";
export type TallyFrequency = "realtime" | "15m" | "hourly" | "daily" | "manual";
export type TallyConfig = { host: string; port: number; company: string; product: TallyProduct; syncMode: TallySyncMode };
export type TallySync = { ledgers: boolean; stockItems: boolean; salesVouchers: boolean; purchaseVouchers: boolean; receipts: boolean; notes: boolean; frequency: TallyFrequency };
export type TallyView = { enabled: boolean; config: TallyConfig | null; sync: TallySync; lastSyncAt: string | null; lastStatus: string | null };

export type PosFrequency = "realtime" | "15m" | "hourly" | "daily";
export type PosConfigView = { provider: string; storeId: string | null; syncFrequency: PosFrequency; ratesIncludeTax: boolean; customerName: string; hasApiKey: boolean; apiKeyHint: string | null };
export type PosView = { enabled: boolean; config: PosConfigView | null; lastSyncAt: string | null; lastStatus: string | null };
export type PosConfigInput = { provider: string; storeId?: string | null; apiKey?: string | null; syncFrequency: PosFrequency; ratesIncludeTax: boolean; customerName: string; enabled?: boolean };
export type PosPayMode = "cash" | "upi" | "card" | "bank" | "cheque" | "credit";
export type PosSaleInput = {
  billNo: string;
  date?: string;
  paymentMode: PosPayMode;
  customerName?: string | null;
  customerMobile?: string | null;
  ratesIncludeTax?: boolean;
  items: Array<{ sku?: string; barcode?: string; qty: number; rate?: number }>;
};
export type PosSaleResult = { invoiceId: string; invoiceNo: string; grandTotal: number; lines: number; units: number; paid: boolean };

export type IntegrationsOverview = {
  tally: TallyView;
  pos: PosView;
  log: SyncLogEntry[];
  counts: { parties: number; items: number; invoices: number; bills: number; posToday: number };
  posProviders: string[];
};

export type TallyTestResult = { reachable: boolean; latencyMs: number; message: string; companies: string[]; companyFound: boolean | null; httpStatus?: number };
export type TallySyncResult = { status: SyncStatus; steps: Array<{ entity: string; status: SyncStatus; records: number; message: string }>; tally: TallyView };
export type TallyExportType = "masters" | "sales" | "purchases" | "notes" | "receipts" | "all";

/* ---------- Excise ---------- */

export type ExciseStatus = "received" | "in_transit" | "verified" | "issued";
export type ExciseRecord = {
  id: string;
  date: string;
  itemId: string | null;
  itemName: string;
  brand: string | null;
  volumeMl: number | null;
  exciseCategory: string | null;
  batchNo: string | null;
  permitNo: string | null;
  transportPermitNo: string | null;
  permitDate: string | null;
  vendorId: string | null;
  vendorName: string | null;
  cases: number;
  bottlesPerCase: number | null;
  openingQty: number;
  receivedQty: number;
  issuedQty: number;
  closingQty: number;
  bulkLitres: number;
  dutyRate: number;
  dutyAmount: number;
  status: ExciseStatus;
  stockPosted: boolean;
  notes: string | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
export type ExciseInput = {
  date: string;
  itemId?: string | null;
  itemName?: string | null;
  brand?: string | null;
  volumeMl?: number | null;
  exciseCategory?: string | null;
  batchNo?: string | null;
  permitNo: string;
  transportPermitNo?: string | null;
  permitDate?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  cases?: number;
  bottlesPerCase?: number | null;
  receivedQty?: number;
  issuedQty?: number;
  openingQty?: number | null;
  dutyRate?: number;
  dutyAmount?: number | null;
  status?: ExciseStatus;
  notes?: string | null;
  postStock?: boolean;
};
export type ExciseRegisterRow = { key: string; itemId: string | null; itemName: string; brand: string | null; volumeMl: number | null; opening: number; received: number; issued: number; closing: number; duty: number; first: string; last: string };
export type ExciseItem = { id: string; name: string; brand: string | null; volumeMl: number | null; exciseCategory: string | null; unit: string; currentStock: number };
export type ExciseList = {
  range: DateRange;
  records: ExciseRecord[];
  totals: { records: number; dutyPeriod: number; dutyMtd: number; dutyFy: number; bottlesIn: number; bottlesOut: number; casesIn: number; bulkLitresIn: number; permits: number; inTransit: number };
  register: ExciseRegisterRow[];
  items: ExciseItem[];
  canEdit: boolean;
};

/* ---------- Audit ---------- */

export type AuditCategory = "gst" | "bank" | "ar" | "ap" | "duplicates" | "documents" | "stock" | "unusual" | "changed" | "tally";
export type AuditSeverity = "low" | "medium" | "high" | "critical";
export type AuditItemStatus = "open" | "responded" | "resolved" | "dismissed";
export type AuditArea = "sales" | "purchases" | "banking" | "gst" | "inventory" | "expenses" | "aging" | "other";
export type AuditHealth = { score: number; grade: "A" | "B" | "C" | "D" | "E"; bySeverity: Record<AuditSeverity, number> };
export type AuditCategorySummary = { key: AuditCategory; label: string; icon: string; fix: string; open: number; total: number; amount: number; worst: AuditSeverity | null };
export type AuditIssue = {
  key: string;
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  detail: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  amount: number | null;
  date: string | null;
  verdict: { id: string; status: AuditItemStatus; kind: string } | null;
  open: boolean;
};
export type AuditOverview = {
  range: DateRange;
  health: AuditHealth;
  categories: AuditCategorySummary[];
  openIssues: number;
  totals: {
    sales: number;
    salesCount: number;
    salesTaxable: number;
    outputTax: number;
    purchases: number;
    purchaseCount: number;
    inputTax: number;
    receivable: number;
    overdueReceivable: number;
    payable: number;
    overduePayable: number;
    expenses: number;
    stockValue: number;
    items: number;
    cashIn: number;
    cashOut: number;
    bankIn: number;
    bankOut: number;
  };
  bank: { total: number; unmatched: number; matched: number; ignored: number; unmatchedValue: number };
  workload: { openFlags: number; openQueries: number; answered: number; resolved: number };
  documents: number;
  integrations: Array<{ provider: string; enabled: boolean; lastSyncAt: string | null; lastStatus: string | null }>;
  insights: Array<{ tone: "coral" | "amber" | "blue" | "emerald"; text: string }>;
  canWrite: boolean;
};
export type ThreadEntry = { id: string; authorId: number | null; author: string; role: string | null; at: string; text: string };
export type AuditItem = {
  id: string;
  kind: "flag" | "query";
  area: AuditArea;
  title: string;
  detail: string | null;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  severity: AuditSeverity;
  status: AuditItemStatus;
  thread: ThreadEntry[];
  replies: number;
  raisedBy: number | null;
  raisedByName: string | null;
  assigneeUserId: number | null;
  assigneeName: string | null;
  ruleKey: string | null;
  amount: number | null;
  dueDate: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
export type AuditItemInput = {
  kind: "flag" | "query";
  area?: AuditArea;
  title: string;
  detail?: string | null;
  severity?: AuditSeverity;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  ruleKey?: string | null;
  amount?: number | null;
  dueDate?: string | null;
  assigneeUserId?: number | null;
  assigneeName?: string | null;
};
export type AuditItemPatch = {
  status?: AuditItemStatus;
  severity?: AuditSeverity;
  title?: string;
  detail?: string | null;
  dueDate?: string | null;
  assigneeUserId?: number | null;
  assigneeName?: string | null;
  note?: string | null;
};
export type AuditVerdictInput = {
  ruleKey: string;
  verdict: "resolved" | "dismissed" | "open";
  note?: string | null;
  category: AuditCategory;
  title: string;
  detail?: string | null;
  severity?: AuditSeverity;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  amount?: number | null;
};

export type LedgerKind = "sales" | "purchases" | "inventory" | "receivables" | "payables" | "expenses";
export type SalesLedgerRow = { id: string; date: string; no: string; party: string; gstin: string | null; taxable: number; cgst: number; sgst: number; igst: number; tax: number; total: number; paid: number; balance: number; status: string; source: string | null };
export type PurchaseLedgerRow = { id: string; date: string; no: string; supplierBillNo: string | null; poNo: string | null; party: string; taxable: number; tax: number; total: number; paid: number; balance: number; status: string; documents: number };
export type InventoryLedgerRow = { id: string; name: string; sku: string | null; unit: string; category: string | null; opening: number; inQty: number; outQty: number; closing: number; cost: number; value: number };
export type AgingLedgerRow = { id: string; no: string; party: string; date: string; dueDate: string; total: number; paid: number; balance: number; daysOverdue: number; bucket: string; status: string };
export type ExpenseLedgerRow = { id: string; date: string; category: string; description: string | null; vendor: string | null; amount: number; gst: number; method: string; reference: string | null; by: string | null; documents: number };
export type LedgerResponse =
  | { kind: "sales"; range: DateRange; rows: SalesLedgerRow[]; totals: { count: number; taxable: number; tax: number; total: number; balance: number } }
  | { kind: "purchases"; range: DateRange; rows: PurchaseLedgerRow[]; totals: { count: number; taxable: number; tax: number; total: number; balance: number } }
  | { kind: "inventory"; range: DateRange; rows: InventoryLedgerRow[]; totals: { count: number; openingValue: number; value: number; negative: number } }
  | { kind: "receivables" | "payables"; range: DateRange; rows: AgingLedgerRow[]; totals: { count: number; balance: number; overdue: number }; buckets: Array<{ key: string; value: number; count: number }> }
  | { kind: "expenses"; range: DateRange; rows: ExpenseLedgerRow[]; totals: { count: number; amount: number; gst: number; cash: number }; byCategory: Array<{ category: string; amount: number }> };

export type BookVoucherType = "Opening" | "Sales" | "Purchase" | "Receipt" | "Payment" | "Credit note" | "Debit note" | "Expense" | "Journal";
export type BookVoucher = {
  date: string;
  type: BookVoucherType;
  ref: string | null;
  party: string | null;
  narration: string;
  amount: number;
  lines: Array<{ account: string; dr: number; cr: number }>;
  source: { type: "invoice" | "bill" | "payment" | "return" | "expense" | "ledger" | "party"; id: string | null };
};
export type StatementRow = { name: string; amount: number; account?: string };
export type TrialBalanceRow = { account: string; name: string; group: string; type: "asset" | "liability" | "income" | "expense"; dr: number; cr: number };
export type BooksReport = {
  range: DateRange;
  trialBalance: { rows: TrialBalanceRow[]; dr: number; cr: number; difference: number };
  profitLoss: {
    sales: number;
    salesReturns: number;
    netSales: number;
    openingStock: number;
    purchases: number;
    purchaseReturns: number;
    netPurchases: number;
    closingStock: number;
    cogs: number;
    grossProfit: number;
    expenses: StatementRow[];
    totalExpenses: number;
    netProfit: number;
  };
  balanceSheet: { assets: StatementRow[]; liabilities: StatementRow[]; totalAssets: number; totalLiabilities: number; difference: number };
  dayBook: { rows: BookVoucher[]; truncated: boolean; totals: Partial<Record<BookVoucherType, { count: number; amount: number }>> };
};

export type AuditGst = {
  range: DateRange;
  output: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  input: { cgst: number; sgst: number; igst: number; total: number; fromBills: number; fromExpenses: number };
  net: number;
  b2b: { count: number; value: number };
  b2c: { count: number; value: number };
  byRate: Array<{ rate: number; taxable: number; tax: number }>;
  missingHsnLines: number;
  invoices: number;
  bills: number;
};

export type BankSuggestion = { type: "payment" | "expense"; id: string; label: string; date: string; amount: number; score: number; reasons: string[] };
export type BankTxn = {
  id: string;
  date: string;
  description: string;
  amount: number;
  direction: "in" | "out";
  reference: string | null;
  status: "unmatched" | "matched" | "ignored";
  matchedType: string | null;
  matchedId: string | null;
  matchedLabel: string | null;
  matchScore: number | null;
  matchedBy: string | null;
  suggestions: BankSuggestion[];
};
export type BankOverview = {
  txns: BankTxn[];
  summary: { total: number; unmatched: number; matched: number; ignored: number; inflow: number; outflow: number; unmatchedValue: number; lastImportAt: string | null };
  canWrite: boolean;
};
export type BankImportResult = { imported: number; duplicates: number; skipped: number; matched: number; errors: string[]; from: string; to: string };

export type AuditDocCategory = "invoice" | "bill" | "bank_statement" | "gst_return" | "tds" | "agreement" | "ledger" | "payroll" | "other";
export type AuditEntityType = "invoice" | "bill" | "payment" | "expense" | "party" | "item" | "bank" | "audit" | "po";
export type AuditDocument = {
  id: string;
  title: string;
  category: AuditDocCategory;
  period: string | null;
  url: string | null;
  notes: string | null;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  hasFile: boolean;
  entityType: AuditEntityType | null;
  entityId: string | null;
  entityLabel: string | null;
  uploadedBy: number | null;
  uploadedByName: string | null;
  createdAt: string | null;
};
export type AuditDocumentInput = {
  title: string;
  category: AuditDocCategory;
  period?: string | null;
  url?: string | null;
  content?: string | null;
  fileName?: string | null;
  notes?: string | null;
  entityType?: AuditEntityType | null;
  entityId?: string | null;
  entityLabel?: string | null;
};
export type AuditEntity = { id: string; label: string; sub: string | null };

/* ---------- Help desk ---------- */

export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type Ticket = {
  id: string;
  ticketNo: string;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  description: string | null;
  raisedBy: number | null;
  raisedByName: string | null;
  assignedTo: number | null;
  assignedToName: string | null;
  replies: number;
  lastReplyAt: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  thread?: ThreadEntry[];
};
export type TicketList = {
  tickets: Ticket[];
  counts: Partial<Record<TicketStatus, number>>;
  scope: "mine" | "all";
  canManage: boolean;
  categories: ReadonlyArray<{ key: string; label: string }>;
  businessCode: string;
};
export type TicketInput = { subject: string; category: string; priority: TicketPriority; description: string };
export type TicketPatch = { status?: TicketStatus; priority?: TicketPriority; assignedTo?: number | null; assignedToName?: string | null };

/* ---------- Connected tools ---------- */

export type ConnectParty = { name: string; company?: string | null; gstin?: string | null; email?: string | null; phone?: string | null; address?: string | null; city?: string | null; state?: string | null };
export type ConnectSourceCard = { id: string; label: string; icon: string; description: string; href: string; total: number; imported: number; ready: number; error: string | null };
export type ConnectCatalogCard = { id: string; label: string; icon: string; description: string; href: string; items: number; itemsLinked: number; parties: number; partiesLinked: number };
export type ConnectOverview = {
  sources: ConnectSourceCard[];
  catalogs: ConnectCatalogCard[];
  outbound: Array<{ id: string; label: string; icon: string; href: string; description: string; available: number; value: number }>;
  recent: Array<{ id: number; actorName: string | null; summary: string; createdAt: string | null }>;
  can: { importDocuments: boolean; importItems: boolean; importParties: boolean };
};
export type ConnectToolRef = { id: string; label: string; icon: string; description: string; href: string };
export type ConnectRecord = {
  ref: string;
  docNo: string;
  date: string;
  status: string;
  amount: number;
  title: string;
  party: ConnectParty;
  placeOfSupply: string | null;
  lineCount: number;
  imported: boolean;
  links: Partial<Record<"invoice" | "party" | "item", string>>;
  invoice: { id: string; invoiceNo: string; status: string; grandTotal: number } | null;
};
export type DocImportResult = { ref: string; docNo: string; status: "imported" | "skipped" | "failed"; message?: string; invoiceId?: string; invoiceNo?: string; partyId?: string; partyName?: string; partyCreated?: boolean; linkedLines?: number; freeLines?: number };
export type CatalogState = "linked" | "match" | "new";
export type ConnectCatalogItem = { ref: string; name: string; sku: string | null; hsn: string | null; unit: string | null; rate: number; gstRate: number; kind: "goods" | "service"; linkedId: string | null; matchId: string | null; matchName: string | null; state: CatalogState };
export type ConnectCatalogParty = ConnectParty & { ref: string; kind: "customer" | "supplier" | "both"; linkedId: string | null; matchId: string | null; matchName: string | null; state: CatalogState };
export type CatalogImportResult = { ref: string; name: string; status: "created" | "linked" | "skipped" | "failed"; id?: string; message?: string };
export type CatalogImportResponse = { results: CatalogImportResult[]; summary: { created: number; linked: number; skipped: number; failed: number } };
export type ConnectLink = { sourceTool: string; toolLabel: string; sourceRef: string; targetType: "invoice" | "party" | "item"; targetId: string; label: string; sub: string; exists: boolean; createdAt: string | null; date: string };

/* ---------- File downloads (XML / attachments need the raw response) ---------- */

export type Downloaded = { blob: Blob; fileName: string; records: number | null };

async function download(path: string, fallbackName: string): Promise<Downloaded> {
  const res = await fetch(apiUrl(`/api/ims${path}`), { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
    throw new ImsApiError(res.status, typeof data.error === "string" ? data.error : `Download failed (${res.status})`, typeof data.code === "string" ? data.code : undefined);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackName;
  const count = res.headers.get("X-Record-Count");
  return { blob: await res.blob(), fileName: name, records: count === null ? null : Number(count) };
}

/** Hands a downloaded blob to the browser as a file save. */
export function saveBlob({ blob, fileName }: Pick<Downloaded, "blob" | "fileName">): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Reads a File as a base64 data URL (documents are stored inline up to 2 MB). */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file"));
    reader.readAsDataURL(file);
  });
}

type RangeParams = { period?: Period; from?: string; to?: string };

export const TRACE_TYPES = ["invoice", "bill", "po", "payment", "expense"] as const;
export type TraceType = (typeof TRACE_TYPES)[number];
export const isTraceType = (t: string | null): t is TraceType => (TRACE_TYPES as ReadonlyArray<string | null>).includes(t);
export type TraceState = "ok" | "warn" | "bad" | "na";
export type TraceStep = { label: string; title: string; detail: string; state: TraceState; link?: { type: string; id: string } };
export type Trace = {
  type: TraceType;
  id: string;
  title: string;
  subtitle: string;
  details: Array<[string, string]>;
  steps: TraceStep[];
  events: Array<{ at: string | null; by: string | null; summary: string }>;
};

export type Gstr2bRow = { gstin: string; supplier: string; invoiceNo: string; date: string | null; value: number; taxable: number; igst: number; cgst: number; sgst: number };
export type Gstr2bStatus = "matched" | "mismatch" | "missing_2b" | "missing_books";
export type Gstr2bResult = {
  range: DateRange;
  rows: Array<{
    status: Gstr2bStatus;
    gstin: string;
    supplier: string;
    invoiceNo: string;
    date: string | null;
    bill: { id: string; no: string; taxable: number; tax: number; total: number } | null;
    portal: { taxable: number; tax: number; total: number } | null;
    taxDiff: number;
    note: string;
  }>;
  summary: { counts: Record<Gstr2bStatus, number>; itcBooks: number; itcPortal: number; itcMatched: number; itcAtRisk: number; itcNotBooked: number };
};

export const imsSystem = {
  integrations: () => get<IntegrationsOverview>("/integrations"),
  syncLog: (provider?: "tally" | "pos", limit?: number) => get<{ log: SyncLogEntry[] }>("/integrations/log", { provider, limit }),
  saveTally: (input: TallyConfig & { enabled?: boolean }) => put<{ tally: TallyView }>("/integrations/tally", input),
  saveTallySync: (input: TallySync) => put<{ tally: TallyView }>("/integrations/tally/sync", input),
  disconnectTally: () => post<{ tally: TallyView }>("/integrations/tally/disconnect"),
  testTally: (input: Partial<Pick<TallyConfig, "host" | "port" | "company">> = {}) => post<TallyTestResult>("/integrations/tally/test", input),
  syncTally: () => post<TallySyncResult>("/integrations/tally/sync-now"),
  exportTally: (type: TallyExportType, range: RangeParams = {}) => download(`/integrations/tally/export${qs({ type, ...range })}`, `Tally_${type}.xml`),
  savePos: (input: PosConfigInput) => put<{ pos: PosView }>("/integrations/pos", input),
  disconnectPos: () => post<{ pos: PosView }>("/integrations/pos/disconnect"),
  posSale: (input: PosSaleInput) => post<{ sale: PosSaleResult }>("/integrations/pos/sale", input),
  simulatePos: () => post<{ sale: PosSaleResult; billNo: string }>("/integrations/pos/simulate"),

  excise: (params: RangeParams & { q?: string; itemId?: string; status?: ExciseStatus } = {}) => get<ExciseList>("/excise", params),
  createExcise: (input: ExciseInput) => post<{ record: ExciseRecord | null }>("/excise", input),
  updateExcise: (id: string, input: Partial<ExciseInput>) => patch<{ record: ExciseRecord | null }>(`/excise/${id}`, input),
  deleteExcise: (id: string) => del<{ ok: true; stockPosted: boolean }>(`/excise/${id}`),

  auditOverview: (range: RangeParams = {}) => get<AuditOverview>("/audit/overview", range),
  auditIssues: (params: RangeParams & { category?: AuditCategory; show?: "open" | "closed" | "all" } = {}) =>
    get<{ range: DateRange; issues: AuditIssue[]; categories: AuditCategorySummary[]; health: AuditHealth; rules: Record<string, number>; canWrite: boolean }>("/audit/issues", params),
  auditVerdict: (input: AuditVerdictInput) => post<{ item: AuditItem }>("/audit/issues/verdict", input),
  auditItems: (params: { kind?: "flag" | "query"; status?: AuditItemStatus | "active"; area?: AuditArea; manual?: boolean; q?: string } = {}) => get<{ items: AuditItem[]; canWrite: boolean }>("/audit/items", params),
  auditItem: (id: string) => get<{ item: AuditItem }>(`/audit/items/${id}`),
  createAuditItem: (input: AuditItemInput) => post<{ item: AuditItem }>("/audit/items", input),
  updateAuditItem: (id: string, input: AuditItemPatch) => patch<{ item: AuditItem }>(`/audit/items/${id}`, input),
  replyAuditItem: (id: string, text: string) => post<{ item: AuditItem }>(`/audit/items/${id}/reply`, { text }),
  deleteAuditItem: (id: string) => del(`/audit/items/${id}`),
  ledger: (kind: LedgerKind, params: RangeParams & { q?: string } = {}) => get<LedgerResponse>(`/audit/ledger/${kind}`, params),
  auditGst: (range: RangeParams = {}) => get<AuditGst>("/audit/gst", range),
  books: (range: RangeParams = {}) => get<BooksReport>("/audit/books", range),
  trace: (type: TraceType, id: string, range: RangeParams = {}) => get<{ trace: Trace; findings: AuditIssue[] }>(`/audit/trace/${type}/${encodeURIComponent(id)}`, range),
  gstr2b: (rows: Gstr2bRow[], range: RangeParams = {}) => post<Gstr2bResult>(`/audit/gstr2b${qs(range)}`, { rows }),
  auditAsk: (q: string, range: RangeParams = {}) => get<{ question: string; range: DateRange; answer: string; rows: AuditIssue[]; matched: number }>("/audit/ask", { q, ...range }),
  auditEntities: (type: AuditEntityType, q: string) => get<{ entities: AuditEntity[] }>("/audit/entities", { type, q }),

  bank: (params: { status?: "unmatched" | "matched" | "ignored" | "all"; from?: string; to?: string } = {}) => get<BankOverview>("/audit/bank", params),
  importBank: (rows: Array<Record<string, unknown>>, autoMatch = true) => post<BankImportResult>("/audit/bank/import", { rows, autoMatch }),
  autoMatchBank: () => post<{ matched: number }>("/audit/bank/auto-match"),
  bankCandidates: (id: string, q?: string) => get<{ candidates: BankSuggestion[] }>(`/audit/bank/${id}/candidates`, { q }),
  matchBank: (id: string, target: { type: "payment" | "expense"; id: string }) => post<{ ok: true }>(`/audit/bank/${id}/match`, target),
  unmatchBank: (id: string) => post<{ ok: true }>(`/audit/bank/${id}/unmatch`),
  ignoreBank: (id: string) => post<{ ok: true }>(`/audit/bank/${id}/ignore`),
  restoreBank: (id: string) => post<{ ok: true }>(`/audit/bank/${id}/restore`),
  deleteBank: (id: string) => del(`/audit/bank/${id}`),

  documents: (params: { category?: AuditDocCategory; entityType?: AuditEntityType; entityId?: string; q?: string } = {}) =>
    get<{ documents: AuditDocument[]; categories: AuditDocCategory[]; maxBytes: number }>("/audit/documents", params),
  addDocument: (input: AuditDocumentInput) => post<{ document: AuditDocument | null }>("/audit/documents", input),
  deleteDocument: (id: string) => del(`/audit/documents/${id}`),
  documentFile: (id: string, fallbackName: string) => download(`/audit/documents/${id}/file`, fallbackName),

  tickets: (params: { scope?: "mine" | "all"; status?: TicketStatus | "active"; q?: string } = {}) => get<TicketList>("/tickets", params),
  ticket: (id: string) => get<{ ticket: Ticket }>(`/tickets/${id}`),
  createTicket: (input: TicketInput) => post<{ ticket: Ticket }>("/tickets", input),
  replyTicket: (id: string, text: string) => post<{ ticket: Ticket }>(`/tickets/${id}/reply`, { text }),
  updateTicket: (id: string, input: TicketPatch) => patch<{ ticket: Ticket }>(`/tickets/${id}`, input),

  connectOverview: () => get<ConnectOverview>("/connect/overview"),
  sourceRecords: (id: string) => get<{ source: ConnectToolRef; records: ConnectRecord[] }>(`/connect/sources/${encodeURIComponent(id)}/records`),
  importSource: (id: string, refs: string[]) => post<{ results: DocImportResult[]; summary: { imported: number; skipped: number; failed: number } }>(`/connect/sources/${encodeURIComponent(id)}/import`, { refs }),
  catalogItems: (id: string) => get<{ catalog: ConnectToolRef; items: ConnectCatalogItem[] }>(`/connect/catalogs/${encodeURIComponent(id)}/items`),
  catalogParties: (id: string) => get<{ catalog: ConnectToolRef; parties: ConnectCatalogParty[] }>(`/connect/catalogs/${encodeURIComponent(id)}/parties`),
  importCatalogItems: (id: string, refs: string[]) => post<CatalogImportResponse>(`/connect/catalogs/${encodeURIComponent(id)}/import-items`, { refs }),
  importCatalogParties: (id: string, refs: string[]) => post<CatalogImportResponse>(`/connect/catalogs/${encodeURIComponent(id)}/import-parties`, { refs }),
  links: (params: { tool?: string; type?: "invoice" | "party" | "item"; limit?: number } = {}) => get<{ links: ConnectLink[] }>("/connect/links", params),
};

/* ---------- Shared display vocabulary ---------- */

export const SEVERITY_TONE: Record<AuditSeverity, "neutral" | "blue" | "amber" | "coral"> = { low: "neutral", medium: "blue", high: "amber", critical: "coral" };
export const SEVERITY_LABEL: Record<AuditSeverity, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
export const AUDIT_STATUS_LABEL: Record<AuditItemStatus, string> = { open: "Open", responded: "Answered", resolved: "Resolved", dismissed: "Dismissed" };
export const AUDIT_STATUS_TONE: Record<AuditItemStatus, "amber" | "blue" | "emerald" | "neutral"> = { open: "amber", responded: "blue", resolved: "emerald", dismissed: "neutral" };
export const AUDIT_AREA_LABEL: Record<AuditArea, string> = { sales: "Sales", purchases: "Purchases", banking: "Banking", gst: "GST", inventory: "Inventory", expenses: "Expenses", aging: "Receivables / payables", other: "Other" };
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { open: "Open", in_progress: "In progress", waiting: "Waiting on you", resolved: "Resolved", closed: "Closed" };
export const TICKET_STATUS_TONE: Record<TicketStatus, "amber" | "blue" | "lavender" | "emerald" | "neutral"> = { open: "amber", in_progress: "blue", waiting: "lavender", resolved: "emerald", closed: "neutral" };
export const TICKET_PRIORITY_TONE: Record<TicketPriority, "neutral" | "blue" | "amber" | "coral"> = { low: "neutral", normal: "blue", high: "amber", urgent: "coral" };
export const SYNC_TONE: Record<SyncStatus, "emerald" | "amber" | "coral"> = { success: "emerald", partial: "amber", failed: "coral" };
export const DOC_CATEGORY_LABEL: Record<AuditDocCategory, string> = {
  invoice: "Sales invoice",
  bill: "Supplier bill",
  bank_statement: "Bank statement",
  gst_return: "GST return",
  tds: "TDS",
  agreement: "Agreement",
  ledger: "Ledger / books",
  payroll: "Payroll",
  other: "Other",
};
export const EXCISE_STATUS_LABEL: Record<ExciseStatus, string> = { received: "Received", in_transit: "In transit", verified: "Verified", issued: "Issued" };
export const EXCISE_STATUS_TONE: Record<ExciseStatus, "emerald" | "amber" | "blue" | "lavender"> = { received: "emerald", in_transit: "amber", verified: "blue", issued: "lavender" };

export const fileSize = (bytes: number | null | undefined): string => {
  const b = Number(bytes ?? 0);
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
};
