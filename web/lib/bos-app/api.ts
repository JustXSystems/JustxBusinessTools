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

  /** BOS isn't Live for the caller's org yet (Admin → Tools → Justx BOS). */
  get notEnabled(): boolean {
    return this.code === "BOS_NOT_ENABLED";
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
  canDelete?: boolean;
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

export type PnlRow = { month: string; sales: number; purchases: number; expenses: number; payroll: number; net: number };
type Register<T> = { truncated: boolean; rows: T[] };
export type SalesRegisterRow = {
  id: string;
  invoiceNo: string;
  date: string;
  partyName: string;
  partyGstin: string | null;
  placeOfSupply: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  balance: number;
  status: InvoiceStatus;
};
export type PurchaseRegisterRow = { id: string; billNo: string | null; date: string; partyName: string; category: string | null; amount: number; tax: number; total: number; status: BillStatus };
export type ExpenseRegisterRow = { id: string; date: string; claimant: string | null; category: string; description: string | null; amount: number; status: ExpenseStatus };
export type FinanceReport = {
  from: string;
  to: string;
  pnl: { months: PnlRow[]; total: Omit<PnlRow, "month"> };
  expenseByCategory: Array<{ category: string; total: number }>;
  sales: Register<SalesRegisterRow>;
  purchases: Register<PurchaseRegisterRow>;
  expenses: Register<ExpenseRegisterRow>;
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

export type HrReportRow = {
  employeeId: string;
  empCode: string;
  name: string;
  departmentName: string | null;
  workingDays: number;
  present: number;
  wfh: number;
  halfDay: number;
  absent: number;
  leave: number;
  unmarked: number;
  attendancePct: number;
  leaveUsed: Record<LeaveType, number>;
};
export type HrReport = {
  month: string;
  from: string;
  to: string;
  workingDays: number;
  fiscalYear: string;
  leavePolicy: LeavePolicy;
  totals: { headcount: number; joiners: number; exits: number; attendancePct: number };
  employees: HrReportRow[];
  departments: Array<{ name: string; headcount: number; joiners: number; exits: number }>;
};

export type MyHr = { employee: null } | { employee: BosEmployee; balances: LeaveBalance[]; attendance: MonthAttendance; leaves: BosLeave[] };

export type PtSlab = { from: number; amount: number };
export type PayrollConfig = { basicPct: number; hraPct: number; pfEnabled: boolean; pfCapWage: boolean; esiEnabled: boolean; ptSlabs: PtSlab[]; unmarkedPaid: boolean };
export type SalaryComponents = { basic: number; hra: number; special: number };
export type SalaryStructure = SalaryComponents & {
  gross: number;
  pf: boolean;
  pt: boolean;
  /** Fixed monthly TDS; null = the new-regime estimate (`tdsEstimate`). */
  tdsMonthly: number | null;
  tdsEstimate: number;
  pan: string | null;
  uan: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
  updatedAt: string;
};
export type SalaryStructureInput = SalaryComponents & { pf: boolean; pt: boolean; tdsMonthly: number | null; pan: string | null; uan: string | null; pfNumber: string | null; esiNumber: string | null };
export type PayrollEmployee = {
  employeeId: string;
  empCode: string;
  name: string;
  designation: string | null;
  departmentName: string | null;
  status: EmployeeStatus;
  joinDate: string;
  exitDate: string | null;
  ctcAnnual: number | null;
  structure: SalaryStructure | null;
  suggested: SalaryComponents | null;
};
export type PayrollRunStatus = "draft" | "finalized" | "paid";
export type PayrollRun = {
  id: string;
  period: string;
  status: PayrollRunStatus;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  employerTotal: number;
  paidOn: string | null;
  calculatedAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
};
export type PayslipLine = { key: string; label: string; amount: number };
export type PayslipAdjustments = { bonus?: number; otherDeduction?: number; tdsOverride?: number | null; lopDays?: number | null; note?: string | null };
export type BosPayslip = {
  id: string;
  runId: string;
  employeeId: string;
  empCode: string;
  name: string;
  designation: string | null;
  departmentName: string | null;
  daysInMonth: number;
  paidDays: number;
  lopDays: number;
  attendance: { employedDays: number; absent: number; halfDay: number; lopLeave: number; unmarked: number; computedLop: number } | null;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employer: PayslipLine[];
  adjustments: PayslipAdjustments;
  statutory: { pan: string | null; uan: string | null; pfNumber: string | null; esiNumber: string | null; pfWage: number; esiWage: number; tdsEstimated: boolean } | null;
  gross: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  /** Present when the payslip is loaded on its own (not inside a run). */
  period?: string;
  runStatus?: PayrollRunStatus;
  paidOn?: string | null;
};
export type StatutoryTotals = { pfEmployee: number; pfEmployer: number; esiEmployee: number; esiEmployer: number; pt: number; tds: number; due: { pfEsi: string; tds: string } };
export type PayrollOverview = {
  today: string;
  settingsSaved: boolean;
  config: PayrollConfig;
  headcount: number;
  withStructure: number;
  missing: Array<{ employeeId: string; empCode: string; name: string }>;
  runs: PayrollRun[];
  dues: (StatutoryTotals & { period: string }) | null;
};
export type PayrollRunDetail = { run: PayrollRun; payslips: BosPayslip[]; statutory: StatutoryTotals; missing: PayrollOverview["missing"] };
export type BankAdviceRow = { empCode: string; name: string; holder: string; account: string; ifsc: string; bankName: string; amount: number };

export type BankAccountKind = "bank" | "cash";
export type BosBankAccount = {
  id: string;
  name: string;
  kind: BankAccountKind;
  bankName: string | null;
  accountLast4: string | null;
  ifsc: string | null;
  openingBalance: number;
  openingDate: string;
  archived: boolean;
  /** Opening balance plus every line since the opening date. */
  balance: number;
  /** The closing balance printed on the latest imported statement line. */
  statementBalance: number | null;
  statementDate: string | null;
  lastTxnDate: string | null;
  txnCount: number;
  unreconciled: number;
  createdAt: string;
};
export type BankAccountInput = { name: string; kind: BankAccountKind; bankName: string | null; accountLast4: string | null; ifsc: string | null; openingBalance: number; openingDate: string };
export type BankTxnStatus = "unmatched" | "matched" | "categorized" | "excluded";
export type BankMatchTarget = "payment" | "invoice" | "bill" | "expense" | "payroll";
export type BankCandidate = { type: BankMatchTarget; id: string; action: "match" | "settle"; label: string; detail: string; date: string; amount: number; score: number; exact: boolean };
export type BosBankTxn = {
  id: string;
  accountId: string;
  date: string;
  description: string;
  reference: string | null;
  /** Money in is positive, money out negative. */
  amount: number;
  statementBalance: number | null;
  source: "import" | "manual";
  status: BankTxnStatus;
  matchType: BankMatchTarget | null;
  matchId: string | null;
  matchLabel: string | null;
  category: string | null;
  note: string | null;
  reconciledAt: string | null;
  suggestion: BankCandidate | null;
};
export type StatementLineInput = { date: string; description: string; reference: string | null; amount: number; balance: number | null };
export type BankingOverview = {
  today: string;
  accounts: BosBankAccount[];
  categories: string[];
  totals: { bank: number; cash: number; unreconciled: number; moneyIn: number; moneyOut: number };
};
export type BankReconcileInput =
  | { action: "match"; type: Exclude<BankMatchTarget, "invoice">; id: string; note?: string | null }
  | { action: "settle"; type: Exclude<BankMatchTarget, "payment">; id: string; note?: string | null }
  | { action: "categorize"; category: string; note?: string | null }
  | { action: "exclude"; note?: string | null };

export type BudgetBasis = "category" | "department";
export type BudgetHeadKind = "category" | "payroll" | "department" | "company";
export type BudgetStatus = "ok" | "watch" | "over";
export type BosBudget = {
  id: string;
  year: number;
  fyStart: string;
  fyEnd: string;
  fyLabel: string;
  basis: BudgetBasis;
  name: string;
  notes: string | null;
  annual: number;
  lineCount: number;
  updatedAt: string;
};
export type BudgetFigures = { annual: number; toDate: number; actual: number; remaining: number; usedPct: number | null; projected: number; status: BudgetStatus };
export type BudgetHead = BudgetFigures & {
  id: string;
  kind: BudgetHeadKind;
  key: string;
  label: string;
  note: string | null;
  budgetMonths: number[];
  actualMonths: number[];
  lastYear: number;
};
export type UnbudgetedHead = { kind: BudgetHeadKind; key: string; label: string; actualMonths: number[]; total: number; lastYear: number };
export type BudgetDetail = {
  budget: BosBudget;
  today: string;
  months: string[];
  heads: BudgetHead[];
  unbudgeted: UnbudgetedHead[];
  monthly: { budget: number[]; actual: number[] };
  totals: BudgetFigures & { budgetedSpend: number; unbudgetedSpend: number };
  options: { categories: string[]; departments: Array<{ id: string; name: string }>; payroll: boolean; company: boolean };
};
export type BudgetList = { today: string; fiscalYearStart: number; currentYear: number; budgets: BosBudget[] };
export type BudgetSeed = "blank" | "actuals" | "budget";
export type BudgetLineInput = { kind: BudgetHeadKind; name?: string; departmentId?: string; months: number[]; note?: string | null };

export type DepreciationMethod = "slm" | "wdv" | "none";
export type AssetStatus = "in_use" | "maintenance" | "disposed";
export type AssetCategoryPreset = { name: string; wdv: number; slm: number };
export type BosAsset = {
  id: string;
  tag: string;
  name: string;
  category: string;
  serialNo: string | null;
  location: string | null;
  departmentId: string | null;
  departmentName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  vendorName: string | null;
  billId: string | null;
  purchaseDate: string;
  cost: number;
  salvageValue: number;
  method: DepreciationMethod;
  rate: number;
  status: AssetStatus;
  warrantyUntil: string | null;
  disposedOn: string | null;
  disposalAmount: number | null;
  disposalNote: string | null;
  notes: string | null;
  bookValue: number;
  accumulated: number;
  depreciationThisFy: number;
  createdAt: string;
};
export type AssetEventKind = "assign" | "return" | "transfer" | "maintenance_start" | "maintenance_end" | "dispose" | "reinstate";
export type AssetEvent = {
  id: string;
  kind: AssetEventKind;
  date: string;
  employeeName: string | null;
  departmentName: string | null;
  location: string | null;
  amount: number | null;
  note: string | null;
  createdAt: string;
};
export type AssetsOverview = {
  today: string;
  fiscalYearStart: number;
  currentYear: number;
  fyLabel: string;
  categories: AssetCategoryPreset[];
  assets: BosAsset[];
  totals: { count: number; cost: number; bookValue: number; depreciationFy: number; maintenance: number; transfersMtd: number; disposedFy: number; warrantySoon: number };
};
export type DepreciationRow = { fyStart: string; fyEnd: string; label: string; opening: number; depreciation: number; closing: number; days: number };
export type AssetDetail = {
  asset: BosAsset;
  schedule: DepreciationRow[];
  events: AssetEvent[];
  bill: { id: string; billNo: string | null; partyName: string; date: string; total: number } | null;
  disposal: { bookValue: number; gainLoss: number } | null;
  categories: AssetCategoryPreset[];
};
export type YearFigures = { opening: number; additions: number; depreciation: number; disposals: number; closing: number };
export type DepreciationReport = {
  year: number;
  fyStart: string;
  fyEnd: string;
  fyLabel: string;
  complete: boolean;
  lines: Array<YearFigures & { id: string; tag: string; name: string; category: string; method: DepreciationMethod; rate: number; purchaseDate: string; disposedOn: string | null; cost: number }>;
  byCategory: Array<YearFigures & { category: string; count: number }>;
  totals: YearFigures;
};
export type AssetInput = {
  tag?: string | null;
  name: string;
  category: string;
  serialNo?: string | null;
  vendorName?: string | null;
  billId?: string | null;
  purchaseDate: string;
  cost: number;
  salvageValue?: number;
  method: DepreciationMethod;
  rate: number;
  warrantyUntil?: string | null;
  notes?: string | null;
  location?: string | null;
  departmentId?: string | null;
  employeeId?: string | null;
};
export type AssetPatch = Partial<Omit<AssetInput, "location" | "departmentId" | "employeeId">>;

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type PostingSource =
  | "opening"
  | "journal"
  | "invoice"
  | "payment"
  | "bill"
  | "bill_payment"
  | "expense"
  | "reimbursement"
  | "payroll"
  | "payroll_payment"
  | "bank"
  | "asset"
  | "depreciation"
  | "disposal";
export type BosAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  /** Set on accounts BOS posts to; they can be renamed but not retyped, archived or deleted. */
  systemKey: string | null;
  categories: string[];
  description: string | null;
  archived: boolean;
};
/** Balances are signed debit-positive throughout. */
export type PostingSummary = { date: string; source: PostingSource; sourceId: string; linkId: string; ref: string; memo: string; amount: number };
export type AccountingOverview = {
  today: string;
  fiscalYearStart: number;
  fyStart: string;
  fyLabel: string;
  booksStart: string | null;
  accounts: Array<BosAccount & { balance: number; used: boolean }>;
  totals: {
    cashAndBank: number;
    receivables: number;
    payables: number;
    suspense: number;
    openingTotal: number;
    openingDifference: number;
    manualMtd: number;
    income: number;
    expense: number;
    net: number;
    difference: number;
  };
  /** Account names on each side of the latest postings. */
  recent: Array<PostingSummary & { debit: string[]; credit: string[] }>;
};
export type AccountLedger = {
  account: BosAccount;
  from: string;
  to: string;
  booksStart: string | null;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  truncated: boolean;
  lines: Array<PostingSummary & { debit: number; credit: number; balance: number }>;
};
export type StatementTotals = { income: number; expense: number; net: number; assets: number; liabilities: number; equity: number; profitToDate: number; difference: number };
export type TrialBalance = {
  from: string;
  to: string;
  booksStart: string | null;
  rows: Array<BosAccount & { opening: number; debit: number; credit: number; closing: number }>;
  totals: { debit: number; credit: number; closingDebit: number; closingCredit: number };
  statements: StatementTotals;
};
export type OpeningLine = { accountId: string; debit: number; credit: number };
export type OpeningBalances = { booksStart: string | null; today: string; lines: OpeningLine[]; difference: number; suggestion: OpeningLine[] | null };
export type BosJournal = { id: string; journalNo: string; date: string; narration: string; total: number; status: "posted" | "void"; voidReason: string | null; voidedAt: string | null; createdAt: string };
export type JournalLine = { id: string; accountId: string; code: string; name: string; debit: number; credit: number; note: string | null };
export type JournalInput = { date: string; narration: string; lines: Array<{ accountId: string; debit: number; credit: number; note?: string | null }> };
export type AccountInput = { code: string; name: string; type: AccountType; categories?: string[]; description?: string | null };

export type OpeningStatus = "draft" | "open" | "on_hold" | "closed";
export type HiringPriority = "low" | "medium" | "high";
export type CandidateStage = "applied" | "interview" | "shortlisted" | "offer" | "hired" | "rejected" | "withdrawn";
export type InterviewMode = "in_person" | "phone" | "video";
export type OnboardingTask = "documents" | "kyc" | "it" | "induction" | "kra";
export type OnboardingState = "not_started" | "on_track" | "delayed" | "completed";
export type JobOpening = {
  id: string;
  title: string;
  departmentId: string | null;
  departmentName: string | null;
  location: string | null;
  employmentType: EmploymentType;
  openings: number;
  priority: HiringPriority;
  status: OpeningStatus;
  salaryMin: number | null;
  salaryMax: number | null;
  targetDate: string | null;
  description: string | null;
  openedOn: string | null;
  closedOn: string | null;
  createdAt: string;
};
export type Candidate = {
  id: string;
  openingId: string;
  openingTitle: string;
  departmentId: string | null;
  departmentName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  referredBy: string | null;
  appliedOn: string;
  stage: CandidateStage;
  stageOn: string;
  rating: number | null;
  currentCtc: number | null;
  expectedCtc: number | null;
  noticeDays: number | null;
  resumeLink: string | null;
  notes: string | null;
  /** Local "YYYY-MM-DDTHH:mm". */
  interviewAt: string | null;
  interviewMode: InterviewMode | null;
  interviewer: string | null;
  offerCtc: number | null;
  offerSentOn: string | null;
  offerStatus: "sent" | "accepted" | "declined" | null;
  offerRespondedOn: string | null;
  offerTerms: string | null;
  joiningDate: string | null;
  hiredOn: string | null;
  closedReason: string | null;
  employeeId: string | null;
  employeeCode: string | null;
  createdAt: string;
  /** For an induction not yet done, `date` is when it's scheduled. */
  onboarding: Partial<Record<OnboardingTask, { done: boolean; date: string | null }>>;
  /** Hired candidates only: five tasks plus the employee record. */
  progress: { done: number; total: number; synced: boolean; state: OnboardingState } | null;
};
export type RecruitmentOverview = {
  today: string;
  fyStart: string;
  departments: Array<{ id: string; name: string }>;
  openings: Array<JobOpening & { applicants: number; active: number; hired: number }>;
  candidates: Candidate[];
  truncated: boolean;
  totals: {
    openPositions: number;
    departmentsHiring: number;
    openRoles: number;
    draftRoles: number;
    activeApplicants: number;
    byStage: Record<CandidateStage, number>;
    avgDaysToHire: number | null;
    hiresCounted: number;
    offersAccepted: number;
    offersDeclined: number;
    offersPending: number;
    offersSent: number;
    joinersThisMonth: number;
    documentsPending: number;
    inductionsSoon: number;
    onboarding: { total: number; completed: number; delayed: number; it: number; kyc: number; kra: number; synced: number };
  };
};
export type CandidateEvent = { id: string; kind: string; fromStage: CandidateStage | null; toStage: CandidateStage | null; note: string | null; date: string; actorName: string | null; createdAt: string };
export type CandidateDetail = { candidate: Candidate; opening: JobOpening; events: CandidateEvent[] };
export type OpeningInput = {
  title: string;
  departmentId?: string | null;
  location?: string | null;
  employmentType?: EmploymentType;
  openings?: number;
  priority?: HiringPriority;
  status?: OpeningStatus;
  salaryMin?: number | null;
  salaryMax?: number | null;
  targetDate?: string | null;
  description?: string | null;
};
export type CandidateInput = {
  openingId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  source: string;
  referredBy?: string | null;
  appliedOn: string;
  rating?: number | null;
  currentCtc?: number | null;
  expectedCtc?: number | null;
  noticeDays?: number | null;
  resumeLink?: string | null;
  notes?: string | null;
};

export type ProgramTeam = "all" | "management" | "technical" | "operations";
export type EnrollmentStatus = "enrolled" | "completed" | "cancelled";
export type KraStatus = "on_track" | "at_risk" | "off_track" | "achieved" | "missed";
export type PromotionStatus = "pending" | "approved" | "rejected";
export type PipStatus = "active" | "passed" | "failed" | "cancelled";
export type CertificateStatus = "valid" | "expiring" | "expired";
export type PerfEmployee = { id: string; empCode: string; name: string; designation: string | null; departmentName: string | null; status: EmployeeStatus; ctcAnnual: number | null };
export type TrainingProgram = {
  id: string;
  title: string;
  team: ProgramTeam;
  /** Null means ongoing. */
  durationDays: number | null;
  certificate: boolean;
  validityMonths: number | null;
  mandatory: boolean;
  description: string | null;
  archived: boolean;
  createdAt: string;
};
export type TrainingEnrollment = {
  id: string;
  programId: string;
  programTitle: string;
  employeeId: string;
  employeeName: string;
  enrolledOn: string;
  sessionDate: string | null;
  status: EnrollmentStatus;
  completedOn: string | null;
  note: string | null;
  certificateId: string | null;
};
export type BosCertificate = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  name: string;
  programId: string | null;
  /** Set when BOS issued it from a completed training. */
  enrollmentId: string | null;
  certNo: string | null;
  issuer: string | null;
  credentialNo: string | null;
  link: string | null;
  issuedOn: string;
  expiresOn: string | null;
  status: CertificateStatus;
};
export type BosKra = {
  id: string;
  employeeId: string;
  employeeName: string;
  designation: string | null;
  title: string;
  target: string | null;
  weight: number | null;
  periodStart: string;
  periodEnd: string;
  status: KraStatus;
  progress: number | null;
  note: string | null;
  reviewedOn: string | null;
};
export type BosPromotion = {
  id: string;
  employeeId: string;
  employeeName: string;
  currentDesignation: string | null;
  proposedDesignation: string;
  currentCtc: number | null;
  proposedCtc: number | null;
  effectiveDate: string;
  reason: string | null;
  status: PromotionStatus;
  decidedOn: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  applied: boolean;
  createdAt: string;
};
export type BosPip = {
  id: string;
  employeeId: string;
  employeeName: string;
  designation: string | null;
  departmentName: string | null;
  reason: string;
  goals: string | null;
  startedOn: string;
  reviewOn: string;
  status: PipStatus;
  closedOn: string | null;
  outcomeNote: string | null;
};
export type BosRecognition = { id: string; employeeId: string; employeeName: string; category: string; awardedOn: string; note: string | null };
export type PerformanceOverview = {
  today: string;
  fyStart: string;
  quarterStart: string;
  employees: PerfEmployee[];
  programs: Array<TrainingProgram & { enrolled: number; completed: number }>;
  enrollments: TrainingEnrollment[];
  certificates: BosCertificate[];
  kras: BosKra[];
  promotions: BosPromotion[];
  pips: BosPip[];
  recognitions: BosRecognition[];
  categories: string[];
  truncated: boolean;
  totals: {
    headcount: number;
    promotionsPending: number;
    promotionsApproved: number;
    programs: number;
    enrolledQuarter: number;
    completedQuarter: number;
    upcomingSessions: number;
    certifiedEmployees: number;
    mandatoryPrograms: number;
    mandatoryCompliant: number;
    expiringSoon: number;
    expired: number;
    issuedFy: number;
    onPip: number;
    nextPipReview: string | null;
    krasSet: number;
    kras: { current: number; onTrack: number; atRisk: number; offTrack: number };
    recognitionsMonth: number;
  };
};
export type ProgramInput = { title: string; team: ProgramTeam; durationDays: number | null; certificate: boolean; validityMonths: number | null; mandatory: boolean; description: string | null };
export type CertificateInput = { employeeId: string; name: string; issuer?: string | null; credentialNo?: string | null; link?: string | null; issuedOn: string; expiresOn?: string | null };
export type KraInput = { title: string; target?: string | null; weight?: number | null; periodStart: string; periodEnd: string };
export type PromotionInput = { employeeId: string; proposedDesignation: string; proposedCtc?: number | null; effectiveDate: string; reason?: string | null };
export type PipInput = { employeeId: string; reason: string; goals?: string | null; startedOn: string; reviewOn: string };

export type TravelMode = "flight" | "train" | "bus" | "car" | "other";
export type TravelStatus = "pending" | "approved" | "rejected" | "cancelled";
export type TripPhase = "pending" | "upcoming" | "on_trip" | "completed" | "rejected" | "cancelled";
export type BosTrip = {
  id: string;
  requestNo: string;
  employeeId: string;
  employeeName: string;
  empCode: string;
  designation: string | null;
  departmentName: string | null;
  purpose: string;
  fromPlace: string;
  toPlace: string;
  departOn: string;
  returnOn: string;
  days: number;
  mode: TravelMode;
  estimatedCost: number;
  advance: number;
  projectId: string | null;
  projectName: string | null;
  note: string | null;
  status: TravelStatus;
  phase: TripPhase;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** The signed-in user is the traveller or filed it. */
  mine: boolean;
  canCancel: boolean;
};
export type HeldAsset = {
  id: string;
  tag: string;
  name: string;
  category: string;
  serialNo: string | null;
  location: string | null;
  status: AssetStatus;
  employeeId: string | null;
  employeeName: string | null;
  employeeDesignation: string | null;
  departmentName: string | null;
  assignedOn: string | null;
  /** Overdue once the holder has left; due while they serve notice. */
  returnState: "overdue" | "due" | null;
};
export type ExpensesAssetsOverview = {
  today: string;
  manager: boolean;
  me: { id: string; name: string; status: EmployeeStatus } | null;
  employees: Array<{ id: string; name: string; empCode: string; designation: string | null; departmentName: string | null; status: EmployeeStatus }>;
  projects: Array<{ id: string; name: string }>;
  assets: HeldAsset[];
  trips: BosTrip[];
  claims: BosExpense[];
  categories: string[];
  truncated: boolean;
  totals: {
    assetsAssigned: number;
    assetsInStore: number;
    overdueReturns: number;
    returnsDue: number;
    travelPending: number;
    travelPendingCost: number;
    travelUpcoming: number;
    onTrip: number;
    claimsPending: number;
    claimsToReimburse: number;
    claimsOpen: number;
    claimsOpenAmount: number;
  };
};
export type TravelInput = {
  purpose: string;
  fromPlace: string;
  toPlace: string;
  departOn: string;
  returnOn: string;
  mode: TravelMode;
  estimatedCost: number;
  advance: number;
  projectId?: string | null;
  note?: string | null;
};

export type ServiceType = "helpdesk" | "certificate" | "id_card" | "kit" | "other";
export type CertificateKind = "employment" | "experience" | "salary";
export type ServicePriority = "low" | "normal" | "high";
export type ServiceStatus = "open" | "in_progress" | "resolved" | "cancelled";
export type ServiceRequest = {
  id: string;
  requestNo: string;
  employeeId: string;
  employeeName: string;
  empCode: string;
  designation: string | null;
  departmentName: string | null;
  type: ServiceType;
  certificateKind: CertificateKind | null;
  subject: string;
  details: string | null;
  addressedTo: string | null;
  priority: ServicePriority;
  status: ServiceStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionDays: number | null;
  /** Set when a certificate request is resolved. */
  letterNo: string | null;
  letterOn: string | null;
  comments: number;
  createdAt: string;
  mine: boolean;
};
export type ServicesOverview = {
  today: string;
  manager: boolean;
  me: { id: string; name: string; status: EmployeeStatus } | null;
  employees: Array<{ id: string; name: string; empCode: string; designation: string | null; status: EmployeeStatus }>;
  requests: ServiceRequest[];
  truncated: boolean;
  totals: {
    open: number;
    unassigned: number;
    helpdeskOpen: number;
    helpdeskUnassigned: number;
    certificatesOpen: number;
    kitsOpen: number;
    resolvedRecent: number;
    avgResolutionDays: number | null;
    avgResolutionPrevDays: number | null;
  };
};
export type ServiceComment = { id: string; author: string | null; mine: boolean; body: string; internal: boolean; createdAt: string };
export type ServiceLetter = {
  kind: CertificateKind;
  name: string;
  empCode: string;
  designation: string | null;
  departmentName: string | null;
  joinDate: string;
  exitDate: string | null;
  status: EmployeeStatus;
  /** Salary certificates only. */
  ctcAnnual: number | null;
};
export type ServiceDetail = { request: ServiceRequest; comments: ServiceComment[]; letter: ServiceLetter | null };
export type ServiceRequestInput = {
  employeeId?: string | null;
  type: ServiceType;
  certificateKind?: CertificateKind | null;
  subject?: string;
  details?: string | null;
  addressedTo?: string | null;
  priority?: ServicePriority;
};

export type PolicyCategory = "hr" | "compliance" | "finance" | "it" | "safety" | "other";
export type PolicyStatus = "draft" | "published" | "archived";
export type BosPolicy = {
  id: string;
  title: string;
  category: PolicyCategory;
  summary: string | null;
  /** Only on the single-policy endpoint. */
  body?: string;
  mandatory: boolean;
  status: PolicyStatus;
  /** Counts publications; 0 while a draft. */
  version: number;
  effectiveOn: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  updatedAt: string;
  /** Managers: people who haven't left that acknowledged this version. */
  acknowledged: number | null;
  /** The signed-in employee's acknowledgement of this version. */
  acknowledgedAt: string | null;
  ackedVersion: number | null;
};
export type PolicyInput = { title: string; category: PolicyCategory; summary?: string | null; body: string; mandatory: boolean; effectiveOn?: string | null };
export type PolicyRosterRow = {
  employeeId: string;
  name: string;
  empCode: string;
  designation: string | null;
  departmentName: string | null;
  status: EmployeeStatus;
  hasLogin: boolean;
  acknowledgedAt: string | null;
  method: "self" | "recorded" | null;
  recordedBy: string | null;
  note: string | null;
  lastVersion: number | null;
};
/** `roster` is empty for staff. `canAcknowledge`: the caller has a current employee record and the policy is published. */
export type PolicyDetail = { policy: BosPolicy & { body: string }; roster: PolicyRosterRow[]; canAcknowledge: boolean };
export type PendingPolicy = { id: string; title: string; mandatory: boolean; version: number; updated: boolean };

export type ComplianceArea = "pf" | "esi" | "pt" | "tds" | "lwf" | "posh" | "shops" | "gratuity" | "bonus" | "other";
export type Recurrence = "none" | "monthly" | "quarterly" | "half_yearly" | "yearly";
export type ComplianceState = "done" | "overdue" | "due_soon" | "upcoming";
export type ComplianceItem = {
  id: string;
  title: string;
  area: ComplianceArea;
  dueOn: string;
  recurrence: Recurrence;
  responsible: string | null;
  note: string | null;
  status: "open" | "done";
  doneOn: string | null;
  doneBy: string | null;
  reference: string | null;
  hasNext: boolean;
  templateKey: string | null;
  state: ComplianceState;
};
export type ComplianceInput = { title: string; area: ComplianceArea; dueOn: string; recurrence: Recurrence; responsible?: string | null; note?: string | null };
export type ComplianceTemplate = { key: string; title: string; area: ComplianceArea; recurrence: "monthly" | "yearly"; note: string; firstDue: string; added: boolean };

export type AgreementType = "employment" | "nda" | "non_compete" | "consultant" | "internship" | "other";
export type AgreementState = "ended" | "unsigned" | "expired" | "expiring" | "active";
export type BosAgreement = {
  id: string;
  agreementNo: string;
  type: AgreementType;
  title: string;
  employeeId: string | null;
  employeeName: string | null;
  empCode: string | null;
  counterparty: string | null;
  signedOn: string | null;
  startsOn: string | null;
  expiresOn: string | null;
  documentUrl: string | null;
  note: string | null;
  status: "active" | "ended";
  endedOn: string | null;
  state: AgreementState;
  createdAt: string;
};
export type AgreementInput = {
  type: AgreementType;
  title?: string;
  employeeId?: string | null;
  counterparty?: string | null;
  signedOn?: string | null;
  startsOn?: string | null;
  expiresOn?: string | null;
  documentUrl?: string | null;
  note?: string | null;
};

export type PoliciesOverview = {
  today: string;
  manager: boolean;
  me: { id: string; name: string; status: EmployeeStatus } | null;
  headcount: number;
  policies: BosPolicy[];
  employees: Array<{ id: string; name: string; empCode: string; designation: string | null; status: EmployeeStatus; hasLogin: boolean }>;
  compliance: ComplianceItem[];
  templates: ComplianceTemplate[];
  agreements: BosAgreement[];
  truncated: boolean;
  totals: {
    policies: { published: number; mandatory: number; drafts: number; headcount: number; ackRate: number | null; mandatoryPending: number } | null;
    mine: { toAcknowledge: number; mandatoryPending: number; acknowledged: number } | null;
    compliance: { overdue: number; dueSoon: number; due30: number; doneMonth: number } | null;
    agreements: { active: number; expiring: number; expired: number; unsigned: number };
  };
};

export type SalesKind = "quotation" | "order" | "challan";
export type SalesStage =
  | "draft"
  | "sent"
  | "expired"
  | "accepted"
  | "declined"
  | "converted"
  | "confirmed"
  | "in_transit"
  | "part_delivered"
  | "delivered"
  | "invoiced"
  | "cancelled";
export type ChallanReason = "supply" | "job_work" | "approval" | "other";

export type SalesDocSummary = {
  id: string;
  kind: SalesKind;
  docNo: string;
  status: string;
  stage: SalesStage;
  partyId: string | null;
  partyName: string;
  partyGstin: string | null;
  partyAddress: string | null;
  placeOfSupply: string | null;
  intraState: boolean;
  docDate: string;
  validUntil: string | null;
  deliveryOn: string | null;
  customerRef: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  itemCount: number;
  notes: string | null;
  shipTo: string | null;
  challanReason: ChallanReason | null;
  transporter: string | null;
  vehicleNo: string | null;
  dispatchedOn: string | null;
  deliveredOn: string | null;
  receivedBy: string | null;
  decidedOn: string | null;
  decisionNote: string | null;
  sourceId: string | null;
  sourceNo: string | null;
  sourceKind: SalesKind | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  deliveredPct: number | null;
  childCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Why each next step isn't available, or null when it is. */
  blocks: { edit: string | null; invoice: string | null; order: string | null; challan: string | null; delete: string | null };
};
export type SalesDoc = SalesDocSummary & { lines: BosLine[]; remaining: BosLine[] | null };
export type SalesDocDetail = { doc: SalesDoc; children: SalesDocSummary[] };

export type SalesDocInput = {
  partyId?: string | null;
  partyName: string;
  partyGstin?: string | null;
  partyAddress?: string | null;
  placeOfSupply?: string | null;
  docDate: string;
  validUntil?: string | null;
  deliveryOn?: string | null;
  customerRef?: string | null;
  lines: BosLineInput[];
  notes?: string | null;
  shipTo?: string | null;
  challanReason?: ChallanReason;
  transporter?: string | null;
  vehicleNo?: string | null;
};

export type PosMethod = "cash" | "upi" | "card";
export type SalesOverview = {
  docs: SalesDocSummary[];
  truncated?: boolean;
  totals: {
    ordersMonth: { count: number; value: number };
    quotesOpen: { count: number; value: number };
    challans: { month: number; pendingDispatch: number; inTransit: number };
    toInvoice: { count: number; value: number };
  };
  pos: { enabled: true; count: number; total: number; byMethod: Record<PosMethod, number> } | { enabled: false };
};

export type BosItem = {
  id: string;
  name: string;
  sku: string | null;
  kind: "goods" | "service";
  hsn: string | null;
  unit: string | null;
  rate: number;
  taxRate: number;
  active: boolean;
};
export type ItemInput = Omit<BosItem, "id">;

export type PosBill = { id: string; invoiceNo: string; partyName: string; grandTotal: number; status: InvoiceStatus; method: PosMethod | null; createdAt: string };
export type PosDay = { enabled: boolean; bills: PosBill[]; truncated?: boolean; count: number; total: number; byMethod: Record<PosMethod, number> };
export type PosInput = { partyId?: string | null; partyName?: string | null; partyGstin?: string | null; lines: BosLineInput[]; method: PosMethod; reference?: string | null };

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

export type TaskStatus = "todo" | "in_progress" | "on_hold" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskRecurrence = "none" | "daily" | "weekly" | "monthly";
export type TaskState = "done" | "cancelled" | "overdue" | "due_today" | "upcoming" | "no_date";
export type BosTask = {
  id: string;
  taskNo: string;
  title: string;
  details: string | null;
  projectId: string | null;
  projectName: string | null;
  milestoneId: string | null;
  milestoneName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeDesignation: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startOn: string | null;
  dueOn: string | null;
  recurrence: TaskRecurrence;
  doneAt: string | null;
  doneBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  state: TaskState;
  /** Assigned to the caller, or unassigned and created by them. */
  mine: boolean;
  access: { edit: boolean; status: boolean; cancel: boolean; delete: boolean };
};
export type TaskInput = {
  title: string;
  details?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  startOn?: string | null;
  dueOn?: string | null;
  recurrence?: TaskRecurrence;
  status?: "todo" | "in_progress" | "on_hold";
};
export type MilestoneState = "done" | "overdue" | "due_soon" | "upcoming" | "no_date";
export type BosMilestone = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  dueOn: string | null;
  status: "open" | "done";
  doneOn: string | null;
  total: number;
  done: number;
  progress: number | null;
  state: MilestoneState;
  canDelete: boolean;
};
export type TaskTotals = { open: number; todo: number; inProgress: number; onHold: number; overdue: number; dueToday: number; recurring: number; doneRecent: number };
export type ProjectProgress = Record<string, { total: number; done: number; overdue: number; progress: number | null }>;
export type TasksOverview = {
  today: string;
  manager: boolean;
  me: { id: string; name: string } | null;
  tasks: BosTask[];
  milestones: BosMilestone[];
  people: Array<{ id: string; name: string; designation: string | null; isMe: boolean }>;
  projects: Array<{ id: string; name: string; status: ProjectStatus }>;
  progress: ProjectProgress;
  truncated: boolean;
  totals: TaskTotals;
};
export type TaskSummary = { today: string; totals: TaskTotals; upcoming: BosTask[]; progress: ProjectProgress };

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

  parties: (params: { kind?: "customer" | "vendor"; q?: string } = {}) => bosApi<{ parties: BosParty[]; truncated?: boolean }>(`/parties${qs(params)}`),
  createParty: (input: PartyInput) => post<{ party: BosParty }>("/parties", input),
  updateParty: (id: string, input: Partial<PartyInput>) => patch<{ party: BosParty }>(`/parties/${id}`, input),
  archiveParty: (id: string) => del(`/parties/${id}`),

  /** Drafts and unpaid invoices in full, plus the latest paid and void ones (`truncated` when older exist; `month` is then this month's issued totals). */
  invoices: (params: { partyId?: string; status?: "open"; q?: string } = {}) =>
    bosApi<{ invoices: BosInvoice[]; truncated?: boolean; month?: { count: number; total: number } }>(`/invoices${qs(params)}`),
  invoice: (id: string) => bosApi<{ invoice: BosInvoice; payments: BosPayment[]; canDelete?: boolean }>(`/invoices/${id}`),
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

  expenses: () => bosApi<{ expenses: BosExpense[]; categories: string[]; ownOnly?: boolean }>("/expenses"),
  createExpense: (input: { employeeId?: string | null; claimantName?: string | null; category: string; description?: string | null; amount: number; spentOn: string }) =>
    post<{ expense: BosExpense }>("/expenses", input),
  decideExpense: (id: string, decision: Decision) => post<{ expense: BosExpense }>(`/expenses/${id}/decision`, { decision }),
  reimburseExpense: (id: string) => post<{ expense: BosExpense }>(`/expenses/${id}/reimburse`),

  financeOverview: () => bosApi<FinanceOverview>("/finance/overview"),
  gst: (month?: string) => bosApi<GstSummary>(`/finance/gst${qs({ month })}`),
  financeReport: (from: string, to: string) => bosApi<FinanceReport>(`/reports/finance${qs({ from, to })}`),

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

  recruitment: () => bosApi<RecruitmentOverview>("/recruitment/overview"),
  createOpening: (input: OpeningInput) => post<{ opening: JobOpening }>("/recruitment/openings", input),
  updateOpening: (id: string, input: Partial<OpeningInput>) => patch<{ opening: JobOpening }>(`/recruitment/openings/${id}`, input),
  deleteOpening: (id: string) => del(`/recruitment/openings/${id}`),
  candidate: (id: string) => bosApi<CandidateDetail>(`/recruitment/candidates/${id}`),
  createCandidate: (input: CandidateInput) => post<{ candidate: Candidate }>("/recruitment/candidates", input),
  updateCandidate: (id: string, input: Partial<CandidateInput>) => patch<{ candidate: Candidate }>(`/recruitment/candidates/${id}`, input),
  deleteCandidate: (id: string) => del(`/recruitment/candidates/${id}`),
  moveCandidate: (id: string, stage: CandidateStage, reason?: string | null) => post<{ candidate: Candidate }>(`/recruitment/candidates/${id}/stage`, { stage, reason: reason || null }),
  scheduleInterview: (id: string, input: { at: string; mode: InterviewMode; interviewer?: string | null; note?: string | null }) => post<{ candidate: Candidate }>(`/recruitment/candidates/${id}/interview`, input),
  sendOffer: (id: string, input: { ctc: number; joiningDate: string; sentOn: string; terms?: string | null }) => post<{ candidate: Candidate }>(`/recruitment/candidates/${id}/offer`, input),
  offerResponse: (id: string, input: { response: "accepted" | "declined"; date: string; joiningDate?: string; note?: string | null }) =>
    post<{ candidate: Candidate }>(`/recruitment/candidates/${id}/offer-response`, input),
  undoHire: (id: string) => post<{ candidate: Candidate }>(`/recruitment/candidates/${id}/undo-hire`),
  candidateNote: (id: string, note: string) => post<{ ok: true }>(`/recruitment/candidates/${id}/notes`, { note }),
  updateOnboarding: (id: string, input: { task: OnboardingTask; done: boolean; date?: string | null }) => patch<{ candidate: Candidate }>(`/recruitment/candidates/${id}/onboarding`, input),
  hireAsEmployee: (id: string, input: EmployeeInput) => post<{ candidate: Candidate; employee: { id: string; empCode: string } }>(`/recruitment/candidates/${id}/employee`, input),

  performance: () => bosApi<PerformanceOverview>("/performance/overview"),
  createProgram: (input: ProgramInput) => post<{ program: TrainingProgram }>("/performance/programs", input),
  updateProgram: (id: string, input: Partial<ProgramInput> & { archived?: boolean }) => patch<{ program: TrainingProgram }>(`/performance/programs/${id}`, input),
  deleteProgram: (id: string) => del(`/performance/programs/${id}`),
  enroll: (input: { programId: string; employeeIds: string[]; sessionDate?: string | null; note?: string | null }) => post<{ enrolled: number; skipped: number }>("/performance/enrollments", input),
  rescheduleEnrollment: (id: string, sessionDate: string | null) => patch<{ enrollment: TrainingEnrollment }>(`/performance/enrollments/${id}`, { sessionDate }),
  completeEnrollment: (id: string, date: string) => post<{ enrollment: TrainingEnrollment }>(`/performance/enrollments/${id}/complete`, { date }),
  cancelEnrollment: (id: string) => post<{ enrollment: TrainingEnrollment }>(`/performance/enrollments/${id}/cancel`),
  createCertificate: (input: CertificateInput) => post<{ certificate: BosCertificate }>("/performance/certifications", input),
  updateCertificate: (id: string, input: Partial<Omit<CertificateInput, "employeeId">>) => patch<{ certificate: BosCertificate }>(`/performance/certifications/${id}`, input),
  deleteCertificate: (id: string) => del(`/performance/certifications/${id}`),
  createKras: (input: KraInput & { employeeIds: string[] }) => post<{ created: number }>("/performance/kras", input),
  updateKra: (id: string, input: Partial<KraInput> & { status?: KraStatus; progress?: number | null; note?: string | null }) => patch<{ kra: BosKra }>(`/performance/kras/${id}`, input),
  deleteKra: (id: string) => del(`/performance/kras/${id}`),
  proposePromotion: (input: PromotionInput) => post<{ promotion: BosPromotion }>("/performance/promotions", input),
  decidePromotion: (id: string, input: { decision: "approved" | "rejected"; apply: boolean; note?: string | null }) => post<{ promotion: BosPromotion }>(`/performance/promotions/${id}/decision`, input),
  withdrawPromotion: (id: string) => del(`/performance/promotions/${id}`),
  startPip: (input: PipInput) => post<{ pip: BosPip }>("/performance/pips", input),
  updatePip: (id: string, input: { reason?: string; goals?: string | null; reviewOn?: string }) => patch<{ pip: BosPip }>(`/performance/pips/${id}`, input),
  closePip: (id: string, input: { outcome: "passed" | "failed" | "cancelled"; date: string; note?: string | null }) => post<{ pip: BosPip }>(`/performance/pips/${id}/close`, input),
  recognize: (input: { employeeId: string; category: string; awardedOn: string; note?: string | null }) => post<{ recognition: BosRecognition }>("/performance/recognitions", input),
  deleteRecognition: (id: string) => del(`/performance/recognitions/${id}`),

  expensesAssets: () => bosApi<ExpensesAssetsOverview>("/hr/expenses-assets"),
  requestTravel: (input: TravelInput & { employeeId?: string | null }) => post<{ trip: BosTrip }>("/travel", input),
  updateTravel: (id: string, input: Partial<TravelInput>) => patch<{ trip: BosTrip }>(`/travel/${id}`, input),
  decideTravel: (id: string, input: { decision: Decision; note?: string | null }) => post<{ trip: BosTrip }>(`/travel/${id}/decision`, input),
  cancelTravel: (id: string) => post<{ trip: BosTrip }>(`/travel/${id}/cancel`),

  services: () => bosApi<ServicesOverview>("/services/overview"),
  serviceRequest: (id: string) => bosApi<ServiceDetail>(`/services/requests/${id}`),
  raiseRequest: (input: ServiceRequestInput) => post<{ request: ServiceRequest }>("/services/requests", input),
  updateRequest: (id: string, input: { subject?: string; details?: string | null; addressedTo?: string | null; priority?: ServicePriority }) =>
    patch<{ request: ServiceRequest }>(`/services/requests/${id}`, input),
  assignRequest: (id: string, employeeId: string | null) => post<{ request: ServiceRequest }>(`/services/requests/${id}/assign`, { employeeId }),
  commentOnRequest: (id: string, body: string, internal = false) => post<{ ok: true }>(`/services/requests/${id}/comments`, { body, internal }),
  resolveRequest: (id: string, note?: string | null) => post<{ request: ServiceRequest }>(`/services/requests/${id}/resolve`, { note }),
  reopenRequest: (id: string) => post<{ request: ServiceRequest }>(`/services/requests/${id}/reopen`),
  cancelRequest: (id: string) => post<{ request: ServiceRequest }>(`/services/requests/${id}/cancel`),

  policies: () => bosApi<PoliciesOverview>("/policies/overview"),
  pendingPolicies: () => bosApi<{ policies: PendingPolicy[] }>("/policies/pending"),
  policy: (id: string) => bosApi<PolicyDetail>(`/policies/${id}`),
  createPolicy: (input: PolicyInput & { publish?: boolean }) => post<{ policy: BosPolicy }>("/policies", input),
  updatePolicy: (id: string, input: Partial<PolicyInput> & { newVersion?: boolean }) => patch<{ ok: true }>(`/policies/${id}`, input),
  publishPolicy: (id: string) => post<{ ok: true }>(`/policies/${id}/publish`),
  archivePolicy: (id: string) => post<{ ok: true }>(`/policies/${id}/archive`),
  restorePolicy: (id: string) => post<{ ok: true }>(`/policies/${id}/restore`),
  deletePolicy: (id: string) => del(`/policies/${id}`),
  acknowledgePolicy: (id: string) => post<{ ok: true; version: number }>(`/policies/${id}/acknowledge`),
  recordAcknowledgement: (id: string, employeeId: string, note?: string | null) => post<{ ok: true }>(`/policies/${id}/acknowledgements`, { employeeId, note }),
  removeAcknowledgement: (id: string, employeeId: string) => del(`/policies/${id}/acknowledgements/${employeeId}`),
  addComplianceTemplates: (keys: string[]) => post<{ added: number; skipped: number }>("/compliance/templates", { keys }),
  createFiling: (input: ComplianceInput) => post<{ item: ComplianceItem }>("/compliance", input),
  updateFiling: (id: string, input: Partial<ComplianceInput>) => patch<{ item: ComplianceItem }>(`/compliance/${id}`, input),
  markFiled: (id: string, input: { doneOn?: string; reference?: string | null; note?: string | null }) =>
    post<{ item: ComplianceItem; next: ComplianceItem | null }>(`/compliance/${id}/done`, input),
  reopenFiling: (id: string) => post<{ item: ComplianceItem }>(`/compliance/${id}/reopen`),
  deleteFiling: (id: string) => del(`/compliance/${id}`),
  createAgreement: (input: AgreementInput) => post<{ agreement: BosAgreement }>("/agreements", input),
  updateAgreement: (id: string, input: Partial<AgreementInput>) => patch<{ agreement: BosAgreement }>(`/agreements/${id}`, input),
  endAgreement: (id: string, endedOn?: string) => post<{ agreement: BosAgreement }>(`/agreements/${id}/end`, { endedOn }),
  reinstateAgreement: (id: string) => post<{ agreement: BosAgreement }>(`/agreements/${id}/reinstate`),
  deleteAgreement: (id: string) => del(`/agreements/${id}`),

  salesOverview: () => bosApi<SalesOverview>("/sales/overview"),
  salesDoc: (id: string) => bosApi<SalesDocDetail>(`/sales/docs/${id}`),
  createSalesDoc: (input: SalesDocInput & { kind: SalesKind; send?: boolean }) => post<SalesDocDetail>("/sales/docs", input),
  updateSalesDoc: (id: string, input: SalesDocInput) => put<SalesDocDetail>(`/sales/docs/${id}`, input),
  sendQuotation: (id: string) => post<SalesDocDetail>(`/sales/docs/${id}/send`),
  decideQuotation: (id: string, decision: "accepted" | "declined", note?: string | null) => post<SalesDocDetail>(`/sales/docs/${id}/decide`, { decision, note }),
  orderFromQuotation: (id: string) => post<SalesDocDetail>(`/sales/docs/${id}/order`),
  challanFromOrder: (id: string) => post<SalesDocDetail>(`/sales/docs/${id}/challan`),
  invoiceSalesDoc: (id: string) => post<SalesDocDetail & { invoice: { id: string; invoiceNo: string } }>(`/sales/docs/${id}/invoice`),
  dispatchChallan: (id: string, input: { dispatchedOn?: string; transporter?: string | null; vehicleNo?: string | null }) => post<SalesDocDetail>(`/sales/docs/${id}/dispatch`, input),
  deliverChallan: (id: string, input: { deliveredOn?: string; receivedBy?: string | null }) => post<SalesDocDetail>(`/sales/docs/${id}/deliver`, input),
  cancelSalesDoc: (id: string) => post<SalesDocDetail>(`/sales/docs/${id}/cancel`),
  deleteSalesDoc: (id: string) => del(`/sales/docs/${id}`),
  salesItems: () => bosApi<{ items: BosItem[] }>("/sales/items"),
  createItem: (input: ItemInput) => post<{ item: BosItem }>("/sales/items", input),
  updateItem: (id: string, input: Partial<ItemInput>) => patch<{ item: BosItem }>(`/sales/items/${id}`, input),
  deleteItem: (id: string) => del(`/sales/items/${id}`),
  posDay: () => bosApi<PosDay>("/sales/pos"),
  posBill: (input: PosInput) => post<PosDay & { invoice: { id: string; invoiceNo: string; grandTotal: number } }>("/sales/pos", input),

  hrOverview: () => bosApi<HrOverview>("/hr/overview"),
  hrReport: (month: string) => bosApi<HrReport>(`/reports/hr${qs({ month })}`),
  me: () => bosApi<MyHr>("/hr/me"),

  bankingOverview: () => bosApi<BankingOverview>("/banking/overview"),
  createBankAccount: (input: BankAccountInput) => post<{ account: BosBankAccount }>("/banking/accounts", input),
  updateBankAccount: (id: string, input: Partial<BankAccountInput> & { archived?: boolean }) => patch<{ account: BosBankAccount }>(`/banking/accounts/${id}`, input),
  deleteBankAccount: (id: string) => del(`/banking/accounts/${id}`),
  bankAccount: (id: string) => bosApi<{ account: BosBankAccount; categories: string[]; truncated: boolean; transactions: BosBankTxn[] }>(`/banking/accounts/${id}`),
  importStatement: (id: string, lines: StatementLineInput[]) => post<{ imported: number; skipped: number; beforeOpening: number; account: BosBankAccount }>(`/banking/accounts/${id}/import`, { lines }),
  addBankEntry: (id: string, input: Omit<StatementLineInput, "balance">) => post<{ transaction: BosBankTxn }>(`/banking/accounts/${id}/transactions`, input),
  bankCandidates: (txnId: string) => bosApi<{ transaction: BosBankTxn; candidates: BankCandidate[]; categories: string[] }>(`/banking/transactions/${txnId}/candidates`),
  reconcileBankTxn: (txnId: string, input: BankReconcileInput) => post<{ transaction: BosBankTxn }>(`/banking/transactions/${txnId}/reconcile`, input),
  unreconcileBankTxn: (txnId: string) => post<{ transaction: BosBankTxn }>(`/banking/transactions/${txnId}/unreconcile`),
  deleteBankTxn: (txnId: string) => del(`/banking/transactions/${txnId}`),

  budgets: () => bosApi<BudgetList>("/budgets"),
  budget: (id: string) => bosApi<BudgetDetail>(`/budgets/${id}`),
  createBudget: (input: { year: number; basis: BudgetBasis; name?: string | null; seed: BudgetSeed; uplift?: number }) => post<{ budget: BosBudget; seeded: number }>("/budgets", input),
  updateBudget: (id: string, input: { name?: string; notes?: string | null }) => patch<{ budget: BosBudget }>(`/budgets/${id}`, input),
  deleteBudget: (id: string) => del(`/budgets/${id}`),
  addBudgetLine: (id: string, input: BudgetLineInput) => post<{ lineId: string }>(`/budgets/${id}/lines`, input),
  updateBudgetLine: (id: string, lineId: string, input: { months?: number[]; note?: string | null }) => patch<{ ok: true }>(`/budgets/${id}/lines/${lineId}`, input),
  deleteBudgetLine: (id: string, lineId: string) => del(`/budgets/${id}/lines/${lineId}`),

  assets: () => bosApi<AssetsOverview>("/assets"),
  asset: (id: string) => bosApi<AssetDetail>(`/assets/${id}`),
  assetDepreciation: (year?: number) => bosApi<DepreciationReport>(`/assets/depreciation${qs({ year })}`),
  createAsset: (input: AssetInput) => post<{ asset: BosAsset }>("/assets", input),
  updateAsset: (id: string, input: AssetPatch) => patch<{ asset: BosAsset }>(`/assets/${id}`, input),
  deleteAsset: (id: string) => del(`/assets/${id}`),
  assignAsset: (id: string, input: { employeeId: string | null; date: string; note?: string | null }) => post<{ asset: BosAsset }>(`/assets/${id}/assign`, input),
  transferAsset: (id: string, input: { departmentId?: string | null; location?: string | null; date: string; note?: string | null }) => post<{ asset: BosAsset }>(`/assets/${id}/transfer`, input),
  assetMaintenance: (id: string, input: { action: "start" | "end"; cost?: number; date: string; note?: string | null }) => post<{ asset: BosAsset }>(`/assets/${id}/maintenance`, input),
  disposeAsset: (id: string, input: { amount: number; date: string; note?: string | null }) =>
    post<{ asset: BosAsset; disposal: { bookValue: number; gainLoss: number } }>(`/assets/${id}/dispose`, input),
  reinstateAsset: (id: string) => post<{ asset: BosAsset }>(`/assets/${id}/reinstate`),

  accountingOverview: () => bosApi<AccountingOverview>("/accounting/overview"),
  accountLedger: (account: string, from?: string, to?: string) => bosApi<AccountLedger>(`/accounting/ledger${qs({ account, from, to })}`),
  trialBalance: (from?: string, to?: string) => bosApi<TrialBalance>(`/accounting/trial-balance${qs({ from, to })}`),
  createAccount: (input: AccountInput) => post<{ account: BosAccount }>("/accounting/accounts", input),
  updateAccount: (id: string, input: Partial<AccountInput> & { archived?: boolean }) => patch<{ account: BosAccount }>(`/accounting/accounts/${id}`, input),
  deleteAccount: (id: string) => del(`/accounting/accounts/${id}`),
  openingBalances: (suggest?: string) => bosApi<OpeningBalances>(`/accounting/opening${qs({ suggest })}`),
  saveOpening: (input: { booksStart: string; lines: OpeningLine[] }) => put<{ booksStart: string; difference: number }>("/accounting/opening", input),
  journals: (from?: string, to?: string) => bosApi<{ from: string; to: string; journals: Array<BosJournal & { lineCount: number }> }>(`/accounting/journals${qs({ from, to })}`),
  journal: (id: string) => bosApi<{ journal: BosJournal; lines: JournalLine[] }>(`/accounting/journals/${id}`),
  createJournal: (input: JournalInput) => post<{ journal: BosJournal }>("/accounting/journals", input),
  voidJournal: (id: string, reason: string) => post<{ journal: BosJournal }>(`/accounting/journals/${id}/void`, { reason }),

  payrollOverview: () => bosApi<PayrollOverview>("/payroll/overview"),
  payrollSettings: () => bosApi<{ config: PayrollConfig; saved: boolean; updatedAt: string | null }>("/payroll/settings"),
  savePayrollSettings: (config: PayrollConfig) => put<{ config: PayrollConfig; saved: boolean }>("/payroll/settings", config),
  salaryStructures: () => bosApi<{ config: PayrollConfig; settingsSaved: boolean; employees: PayrollEmployee[] }>("/payroll/structures"),
  saveSalaryStructure: (employeeId: string, input: SalaryStructureInput) => put<{ structure: SalaryStructure }>(`/payroll/structures/${employeeId}`, input),
  payrollRun: (id: string) => bosApi<PayrollRunDetail>(`/payroll/runs/${id}`),
  createPayrollRun: (period: string) => post<{ run: PayrollRun }>("/payroll/runs", { period }),
  recalculatePayrollRun: (id: string) => post<{ run: PayrollRun }>(`/payroll/runs/${id}/recalculate`),
  finalizePayrollRun: (id: string) => post<{ run: PayrollRun }>(`/payroll/runs/${id}/finalize`),
  reopenPayrollRun: (id: string) => post<{ run: PayrollRun }>(`/payroll/runs/${id}/reopen`),
  payPayrollRun: (id: string, paidOn: string) => post<{ run: PayrollRun }>(`/payroll/runs/${id}/pay`, { paidOn }),
  deletePayrollRun: (id: string) => del(`/payroll/runs/${id}`),
  bankAdvice: (id: string) => bosApi<{ period: string; rows: BankAdviceRow[] }>(`/payroll/runs/${id}/bank-advice`),
  adjustPayslip: (id: string, input: PayslipAdjustments) => patch<{ payslip: BosPayslip }>(`/payroll/payslips/${id}`, input),
  payslip: (id: string) => bosApi<{ payslip: BosPayslip }>(`/payroll/payslips/${id}`),
  employeePayslips: (employeeId: string) => bosApi<{ structure: SalaryStructure | null; payslips: BosPayslip[] }>(`/payroll/employees/${employeeId}/payslips`),
  myPayslips: () => bosApi<{ employeeId: string | null; payslips: BosPayslip[] }>("/payroll/me"),

  projects: () => bosApi<{ projects: BosProject[] }>("/projects"),
  createProject: (input: ProjectInput & { name: string }) => post<{ project: BosProject }>("/projects", input),
  updateProject: (id: string, input: ProjectInput) => patch<{ project: BosProject }>(`/projects/${id}`, input),

  tasks: (opts: { projectId?: string | null; mine?: boolean } = {}) => bosApi<TasksOverview>(`/tasks${qs({ projectId: opts.projectId, mine: opts.mine ? 1 : null })}`),
  taskSummary: () => bosApi<TaskSummary>("/tasks/summary"),
  task: (id: string) => bosApi<{ task: BosTask }>(`/tasks/${id}`),
  createTask: (input: TaskInput) => post<{ task: BosTask }>("/tasks", input),
  updateTask: (id: string, input: Partial<TaskInput>) => patch<{ task: BosTask }>(`/tasks/${id}`, input),
  setTaskStatus: (id: string, status: TaskStatus) => post<{ task: BosTask; next: BosTask | null }>(`/tasks/${id}/status`, { status }),
  deleteTask: (id: string) => del(`/tasks/${id}`),
  createMilestone: (projectId: string, input: { name: string; dueOn?: string | null }) => post<{ milestone: BosMilestone }>(`/projects/${projectId}/milestones`, input),
  updateMilestone: (id: string, input: { name?: string; dueOn?: string | null; status?: "open" | "done" }) => patch<{ milestone: BosMilestone }>(`/milestones/${id}`, input),
  deleteMilestone: (id: string) => del(`/milestones/${id}`),

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
