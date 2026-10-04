/**
 * Typed client for the Justx BOS API (`/api/bos/*`). Shared by the JBT tool
 * (`/tools/bos`), the standalone app (`/bos`) and any JBT tool that wants to
 * hand a record to BOS (`sendToBos`).
 */
import { apiUrl } from "@/lib/api-base";

export class BosApiError extends Error {
  status: number;
  code?: string;
  details?: string[];

  constructor(status: number, message: string, code?: string, details?: string[]) {
    super(message);
    this.name = "BosApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get schemaPending(): boolean {
    return this.code === "BOS_SCHEMA_PENDING";
  }
}

export async function bosApi<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const res = await fetch(apiUrl(`/api/bos${path}`), {
    method,
    credentials: "include",
    cache: "no-store",
    signal: init?.signal,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const details = Array.isArray(data.details) ? (data.details as string[]) : undefined;
    const message = details?.length ? details.join(" · ") : typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
    throw new BosApiError(res.status, message, typeof data.code === "string" ? data.code : undefined, details);
  }
  return data as T;
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : "Something went wrong");

/* ---------- Shapes (mirror server/src/bos) ---------- */

export type BosRole = "owner" | "admin" | "staff" | "viewer" | "legacy";
export type LeaveType = "casual" | "sick" | "earned" | "lop";
export type LeavePolicy = Record<LeaveType, number>;

export type BosSettings = {
  companyName: string;
  gstin: string | null;
  state: string | null;
  stateCode: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  invoicePrefix: string;
  employeePrefix: string;
  fiscalYearStart: number;
  defaultTaxRate: number;
  paymentTermsDays: number;
  invoiceNotes: string | null;
  weekendDays: number[];
  leavePolicy: LeavePolicy;
  autoSync: boolean;
};

export type BosConnectorRef = { id: string; label: string; icon: string; href: string };

export type BosSession = {
  host: string;
  actor: { name: string | null; email: string | null; role: BosRole; canManage: boolean; userId: number | null };
  tenantId: number;
  settings: BosSettings;
  brand: { name: string; logoUrl?: string | null } | null;
  connectors: BosConnectorRef[];
};

export type PartyKind = "customer" | "vendor" | "both";
export type BosParty = {
  id: string;
  kind: PartyKind;
  name: string;
  company: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  sourceTool: string | null;
  sourceRef: string | null;
  createdAt: string;
  invoiced?: number;
  balance?: number;
};
export type PartyInput = Partial<Omit<BosParty, "id" | "createdAt" | "invoiced" | "balance" | "sourceTool" | "sourceRef">> & { name: string };

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void";
export type InvoiceDisplayStatus = InvoiceStatus | "overdue";

export type BosLineInput = {
  description: string;
  hsn?: string | null;
  unit?: string | null;
  quantity: number;
  rate: number;
  discountPct?: number;
  taxRate: number;
};
export type BosLine = BosLineInput & { gross: number; discount: number; taxable: number; tax: number; amount: number };

export type BosInvoice = {
  id: string;
  invoiceNo: string;
  partyId: string | null;
  partyName: string;
  partyGstin: string | null;
  partyAddress: string | null;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  placeOfSupply: string | null;
  intraState: boolean;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  amountPaid: number;
  balance: number;
  daysOverdue: number;
  lines: BosLine[];
  notes: string | null;
  sourceTool: string | null;
  sourceRef: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceInput = {
  partyId?: string | null;
  partyName: string;
  partyGstin?: string | null;
  partyAddress?: string | null;
  issueDate: string;
  dueDate: string;
  placeOfSupply?: string | null;
  lines: BosLineInput[];
  notes?: string | null;
  issue?: boolean;
};

export type PaymentMethod = "bank" | "upi" | "cash" | "cheque" | "card" | "other";
export type BosPayment = { id: string; amount: number; paidOn: string; method: PaymentMethod; reference: string | null; notes: string | null; createdAt: string };

export type BillStatus = "pending" | "approved" | "rejected" | "paid";
export type BosBill = {
  id: string;
  billNo: string | null;
  partyId: string | null;
  partyName: string;
  billDate: string;
  dueDate: string;
  category: string | null;
  amount: number;
  taxAmount: number;
  total: number;
  status: BillStatus;
  overdue: boolean;
  notes: string | null;
  decidedAt: string | null;
  paidOn: string | null;
  createdAt: string;
};

export type ExpenseStatus = "submitted" | "approved" | "rejected" | "reimbursed";
export type BosExpense = {
  id: string;
  employeeId: string | null;
  claimantName: string | null;
  category: string;
  description: string | null;
  amount: number;
  spentOn: string;
  status: ExpenseStatus;
  decidedAt: string | null;
  createdAt: string;
};

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export type FinanceOverview = {
  today: string;
  kpis: {
    revenueMtd: number;
    collectedMtd: number;
    receivable: number;
    overdue: number;
    overdueCount: number;
    draftCount: number;
    payable: number;
    billsPending: number;
    spendMtd: number;
    expensesPending: number;
  };
  series: Array<{ month: string; label: string; revenue: number; collected: number; spend: number }>;
  aging: Record<AgingBucket, number>;
  overdueInvoices: BosInvoice[];
  spendByCategory: Array<{ category: string; total: number }>;
};

export type GstSummary = {
  month: string;
  invoiceCount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  outputTax: number;
  inputTax: number;
  billCount: number;
  netPayable: number;
  byRate: Array<{ rate: number; taxable: number; tax: number }>;
};

export type EmployeeStatus = "active" | "probation" | "notice" | "exited";
export type EmploymentType = "full_time" | "part_time" | "contract" | "intern";
export type PersonalField = "fatherName" | "mobile" | "personalEmail" | "bloodGroup" | "address" | "emergencyName" | "emergencyRelation" | "emergencyPhone";
export type Personal = Partial<Record<PersonalField, string>>;
export type BankDetails = { name?: string; holder?: string; account?: string; ifsc?: string; branch?: string };

export type BosEmployee = {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string | null;
  name: string;
  workEmail: string | null;
  phone: string | null;
  designation: string | null;
  departmentId: string | null;
  departmentName: string | null;
  managerId: string | null;
  managerName: string | null;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joinDate: string;
  exitDate: string | null;
  location: string | null;
  dob: string | null;
  ctcAnnual: number | null;
  personal: Personal;
  bank: Required<BankDetails>;
  userId: number | null;
};

export type EmployeeInput = {
  firstName: string;
  lastName?: string | null;
  workEmail?: string | null;
  phone?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  managerId?: string | null;
  employmentType?: EmploymentType;
  status?: EmployeeStatus;
  joinDate: string;
  exitDate?: string | null;
  location?: string | null;
  dob?: string | null;
  ctcAnnual?: number | null;
  personal?: Personal;
  bank?: BankDetails;
};

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type BosLeave = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type LeaveBalance = { type: LeaveType; allowed: number; used: number; remaining: number };
export type AttendanceStatus = "present" | "absent" | "half_day" | "wfh" | "leave" | "holiday";
export type MonthAttendance = {
  month: string;
  present: number;
  absent: number;
  leave: number;
  wfh: number;
  records: Array<{ date: string; status: AttendanceStatus; checkIn: string | null; checkOut: string | null }>;
};

export type EmployeeDetail = {
  employee: BosEmployee;
  isSelf: boolean;
  balances: LeaveBalance[];
  attendance: MonthAttendance;
  leaves: BosLeave[];
  pendingChange: { id: string; changes: Personal; createdAt: string } | null;
};

export type BosDepartment = { id: string; name: string; code: string | null; headEmployeeId: string | null; headcount: number };
export type BosHoliday = { id: string; date: string; name: string; kind: "public" | "optional" | "company" };
export type ProfileChange = { id: string; employeeId: string; employeeName: string; changes: Personal; createdAt: string };

export type RosterRow = {
  employeeId: string;
  name: string;
  designation: string | null;
  departmentName: string | null;
  status: AttendanceStatus | null;
  checkIn: string | null;
  checkOut: string | null;
  source: string | null;
};
export type AttendanceDay = { date: string; holiday: string | null; weekend: boolean; roster: RosterRow[] };

export type HrOverview = {
  today: string;
  kpis: { headcount: number; joinersThisMonth: number; present: number; attendanceMarked: number; onLeave: number; probation: number; notice: number };
  pending: { leave: number; expenses: number; profileChanges: number };
  trend: Array<{ month: string; label: string; headcount: number; joiners: number }>;
  byDepartment: Array<{ name: string; count: number }>;
  celebrations: Array<{ employeeId: string; name: string; kind: "birthday" | "anniversary"; inDays: number; years?: number }>;
  holidays: Array<{ date: string; name: string }>;
  pendingLeave: BosLeave[];
};

export type MyHr = { employee: null } | { employee: BosEmployee; balances: LeaveBalance[]; attendance: MonthAttendance; leaves: BosLeave[] };

export type ProjectStatus = "lead" | "planned" | "active" | "on_hold" | "completed" | "cancelled";
export type BosProject = {
  id: string;
  name: string;
  partyId: string | null;
  partyName: string | null;
  status: ProjectStatus;
  siteAddress: string | null;
  valueEstimate: number;
  startDate: string | null;
  dueDate: string | null;
  notes: string | null;
  sourceTool: string | null;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ProjectInput = Partial<Omit<BosProject, "id" | "createdAt" | "updatedAt" | "sourceTool" | "sourceRef">>;

export type BosEvent = { id: number; actorName: string | null; type: string; entityType: string; entityId: string; summary: string; createdAt: string };

export type ConnectorTarget = "party" | "invoice" | "project";
export type ConnectorSummary = BosConnectorRef & { description: string; targets: ConnectorTarget[]; total: number; linked: number; pending: number };
export type ConnectorItem = {
  ref: string;
  docNo: string;
  date: string | null;
  status: string;
  amount: number;
  title: string;
  party: { name: string; company?: string | null; phone?: string | null; email?: string | null; city?: string | null };
  lineCount: number;
  suggested: ConnectorTarget[];
  links: Partial<Record<ConnectorTarget, string>>;
};
export type ImportedItem = { tool: string; ref: string; docNo: string; target: ConnectorTarget; id: string; label: string; created: boolean };
export type SyncResult = { imported: ImportedItem[]; errors?: string[]; skipped?: "disabled" | "throttled"; lastSyncAt?: number | null };

/* ---------- Endpoints ---------- */

const qs = (params: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

const post = <T>(path: string, body?: unknown) => bosApi<T>(path, { method: "POST", body: body ?? {} });
const put = <T>(path: string, body: unknown) => bosApi<T>(path, { method: "PUT", body });
const patch = <T>(path: string, body: unknown) => bosApi<T>(path, { method: "PATCH", body });
const del = (path: string) => bosApi<void>(path, { method: "DELETE" });

export type Decision = "approved" | "rejected";

export const bos = {
  session: () => bosApi<BosSession>("/session"),
  saveSettings: (input: Partial<BosSettings>) => put<{ settings: BosSettings }>("/settings", input),
  events: (params: { limit?: number; entityType?: string; entityId?: string } = {}) => bosApi<{ events: BosEvent[] }>(`/events${qs(params)}`),

  parties: (params: { kind?: "customer" | "vendor"; q?: string } = {}) => bosApi<{ parties: BosParty[] }>(`/parties${qs(params)}`),
  createParty: (input: PartyInput) => post<{ party: BosParty }>("/parties", input),
  updateParty: (id: string, input: Partial<PartyInput>) => patch<{ party: BosParty }>(`/parties/${id}`, input),
  archiveParty: (id: string) => del(`/parties/${id}`),

  invoices: (params: { partyId?: string } = {}) => bosApi<{ invoices: BosInvoice[] }>(`/invoices${qs(params)}`),
  invoice: (id: string) => bosApi<{ invoice: BosInvoice; payments: BosPayment[] }>(`/invoices/${id}`),
  createInvoice: (input: InvoiceInput) => post<{ invoice: BosInvoice }>("/invoices", input),
  updateInvoice: (id: string, input: InvoiceInput) => put<{ invoice: BosInvoice }>(`/invoices/${id}`, input),
  issueInvoice: (id: string) => post<{ invoice: BosInvoice }>(`/invoices/${id}/issue`),
  voidInvoice: (id: string) => post<{ invoice: BosInvoice }>(`/invoices/${id}/void`),
  deleteInvoice: (id: string) => del(`/invoices/${id}`),
  recordPayment: (id: string, input: { amount: number; paidOn: string; method: PaymentMethod; reference?: string | null; notes?: string | null }) =>
    post<{ invoice: BosInvoice }>(`/invoices/${id}/payments`, input),
  removePayment: (id: string, paymentId: string) => bosApi<{ invoice: BosInvoice }>(`/invoices/${id}/payments/${paymentId}`, { method: "DELETE" }),

  bills: () => bosApi<{ bills: BosBill[] }>("/bills"),
  createBill: (input: { partyId?: string | null; partyName: string; billNo?: string | null; billDate: string; dueDate: string; category?: string | null; amount: number; taxAmount?: number; notes?: string | null }) =>
    post<{ bill: BosBill }>("/bills", input),
  decideBill: (id: string, decision: Decision) => post<{ bill: BosBill }>(`/bills/${id}/decision`, { decision }),
  payBill: (id: string, paidOn: string) => post<{ bill: BosBill }>(`/bills/${id}/pay`, { paidOn }),
  deleteBill: (id: string) => del(`/bills/${id}`),

  expenses: () => bosApi<{ expenses: BosExpense[]; categories: string[] }>("/expenses"),
  createExpense: (input: { employeeId?: string | null; claimantName?: string | null; category: string; description?: string | null; amount: number; spentOn: string }) =>
    post<{ expense: BosExpense }>("/expenses", input),
  decideExpense: (id: string, decision: Decision) => post<{ expense: BosExpense }>(`/expenses/${id}/decision`, { decision }),
  reimburseExpense: (id: string) => post<{ expense: BosExpense }>(`/expenses/${id}/reimburse`),

  financeOverview: () => bosApi<FinanceOverview>("/finance/overview"),
  gst: (month?: string) => bosApi<GstSummary>(`/finance/gst${qs({ month })}`),

  departments: () => bosApi<{ departments: BosDepartment[] }>("/hr/departments"),
  createDepartment: (input: { name: string; code?: string | null }) => post<{ department: BosDepartment }>("/hr/departments", input),
  deleteDepartment: (id: string) => del(`/hr/departments/${id}`),
  employees: () => bosApi<{ employees: BosEmployee[] }>("/hr/employees"),
  employee: (id: string) => bosApi<EmployeeDetail>(`/hr/employees/${id}`),
  createEmployee: (input: EmployeeInput) => post<{ employee: BosEmployee }>("/hr/employees", input),
  updateEmployee: (id: string, input: Partial<EmployeeInput>) => patch<{ employee: BosEmployee }>(`/hr/employees/${id}`, input),
  employeeBank: (id: string) => bosApi<{ bank: BankDetails }>(`/hr/employees/${id}/bank`),
  requestProfileChange: (id: string, changes: Personal) => post<{ pendingChange: { id: string; changes: Personal } }>(`/hr/employees/${id}/profile-changes`, { changes }),
  profileChanges: () => bosApi<{ changes: ProfileChange[] }>("/hr/profile-changes"),
  decideProfileChange: (id: string, decision: Decision) => post<{ ok: true; employee: BosEmployee }>(`/hr/profile-changes/${id}/decision`, { decision }),

  leave: (status?: LeaveStatus) => bosApi<{ leave: BosLeave[] }>(`/hr/leave${qs({ status })}`),
  applyLeave: (input: { employeeId?: string; leaveType: LeaveType; fromDate: string; toDate: string; halfDay?: boolean; reason?: string | null }) =>
    post<{ leave: BosLeave }>("/hr/leave", input),
  decideLeave: (id: string, decision: Decision, note?: string) => post<{ leave: BosLeave }>(`/hr/leave/${id}/decision`, { decision, note: note || null }),
  cancelLeave: (id: string) => post<{ ok: true }>(`/hr/leave/${id}/cancel`),

  attendance: (date?: string) => bosApi<AttendanceDay>(`/hr/attendance${qs({ date })}`),
  markAttendance: (date: string, entries: Array<{ employeeId: string; status: AttendanceStatus; checkIn?: string | null; checkOut?: string | null }>) =>
    put<{ ok: true; saved: number }>("/hr/attendance", { date, entries }),

  holidays: (year?: number) => bosApi<{ year: number; holidays: BosHoliday[] }>(`/hr/holidays${qs({ year })}`),
  createHoliday: (input: { date: string; name: string; kind: BosHoliday["kind"] }) => post<{ holiday: BosHoliday }>("/hr/holidays", input),
  deleteHoliday: (id: string) => del(`/hr/holidays/${id}`),

  hrOverview: () => bosApi<HrOverview>("/hr/overview"),
  me: () => bosApi<MyHr>("/hr/me"),

  projects: () => bosApi<{ projects: BosProject[] }>("/projects"),
  createProject: (input: ProjectInput & { name: string }) => post<{ project: BosProject }>("/projects", input),
  updateProject: (id: string, input: ProjectInput) => patch<{ project: BosProject }>(`/projects/${id}`, input),

  connectors: () => bosApi<{ autoSync: boolean; lastSyncAt: number | null; connectors: ConnectorSummary[] }>("/connect"),
  connectorItems: (tool: string) => bosApi<{ connector: ConnectorSummary; items: ConnectorItem[] }>(`/connect/${tool}`),
  importRecord: (tool: string, ref: string, target: ConnectorTarget) =>
    post<{ imported: ImportedItem[]; links: Partial<Record<ConnectorTarget, string>> }>(`/connect/${encodeURIComponent(tool)}/${encodeURIComponent(ref)}/import`, { target }),
  sync: (force = false) => post<SyncResult>("/connect/sync", { force }),
  links: (sourceTool: string, sourceRef: string) => bosApi<{ links: Partial<Record<ConnectorTarget, string>> }>(`/links${qs({ sourceTool, sourceRef })}`),
};

/**
 * Bridge for other JBT tools: push one of their records into BOS (idempotent)
 * and get back what BOS created, e.g. `sendToBos("quotationv1", id, "invoice")`.
 */
export function sendToBos(tool: string, ref: string, target: ConnectorTarget) {
  return bos.importRecord(tool, ref, target);
}
