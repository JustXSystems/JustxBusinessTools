/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BosApp } from "./BosApp";

const settings = {
  companyName: "Justx Systems",
  gstin: "29ABCDE1234F1Z5",
  state: "Karnataka",
  stateCode: "29",
  address: "Bengaluru",
  email: null,
  phone: null,
  invoicePrefix: "INV",
  employeePrefix: "EMP",
  fiscalYearStart: 4,
  defaultTaxRate: 18,
  paymentTermsDays: 15,
  invoiceNotes: null,
  weekendDays: [0],
  leavePolicy: { casual: 12, sick: 8, earned: 15, lop: 0 },
  autoSync: true,
};

const session = {
  host: "jbt",
  actor: { name: "Asha Rao", email: "asha@example.com", role: "owner", canManage: true, userId: 1 },
  tenantId: 1,
  settings,
  brand: null,
  connectors: [{ id: "quotationv1", label: "Quotation V1", icon: "📑", href: "/tools/quotationv1" }],
};

const invoice = {
  id: "i1",
  invoiceNo: "INV/26-27/0001",
  partyId: "p1",
  partyName: "Meridian Solar",
  partyGstin: null,
  partyAddress: null,
  issueDate: "2026-10-01",
  dueDate: "2026-10-16",
  status: "sent",
  displayStatus: "sent",
  placeOfSupply: "Karnataka",
  intraState: true,
  subtotal: 1000,
  discountTotal: 0,
  taxTotal: 180,
  cgst: 90,
  sgst: 90,
  igst: 0,
  grandTotal: 1180,
  amountPaid: 0,
  balance: 1180,
  daysOverdue: 0,
  lines: [{ description: "Panel", quantity: 1, rate: 1000, taxRate: 18, gross: 1000, discount: 0, taxable: 1000, tax: 180, amount: 1180 }],
  notes: null,
  sourceTool: "quotationv1",
  sourceRef: "q1",
  sentAt: null,
  createdAt: "2026-10-01 10:00:00",
  updatedAt: "2026-10-01 10:00:00",
};

const employee = {
  id: "e1",
  empCode: "EMP-0001",
  firstName: "Ravi",
  lastName: "Kumar",
  name: "Ravi Kumar",
  workEmail: "ravi@example.com",
  phone: null,
  designation: "Installer",
  departmentId: null,
  departmentName: null,
  managerId: null,
  managerName: null,
  employmentType: "full_time",
  status: "active",
  joinDate: "2025-01-10",
  exitDate: null,
  location: null,
  dob: null,
  ctcAnnual: 360000,
  personal: {},
  bank: { name: "", holder: "", account: "", ifsc: "", branch: "" },
  userId: null,
};

const months = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];

const payrollRun = { id: "r1", period: "2026-09", status: "draft", employeeCount: 1, grossTotal: 25000, deductionTotal: 1700, netTotal: 23300, employerTotal: 1500, paidOn: null, calculatedAt: "2026-10-04 10:00:00", finalizedAt: null, createdAt: "2026-10-04 10:00:00" };
const payslip = {
  id: "s1",
  runId: "r1",
  employeeId: "e1",
  empCode: "EMP-0001",
  name: "Ravi Kumar",
  designation: "Installer",
  departmentName: null,
  daysInMonth: 30,
  paidDays: 26.5,
  lopDays: 3.5,
  attendance: { employedDays: 30, absent: 3, halfDay: 1, lopLeave: 0, unmarked: 0, computedLop: 3.5 },
  earnings: [
    { key: "basic", label: "Basic", amount: 12500 },
    { key: "hra", label: "HRA", amount: 5000 },
    { key: "special", label: "Special allowance", amount: 7500 },
  ],
  deductions: [
    { key: "pf", label: "Provident fund", amount: 1500 },
    { key: "pt", label: "Professional tax", amount: 200 },
  ],
  employer: [{ key: "pf", label: "Employer PF", amount: 1500 }],
  adjustments: {},
  statutory: { pan: null, uan: null, pfNumber: null, esiNumber: null, pfWage: 12500, esiWage: 0, tdsEstimated: true },
  gross: 25000,
  totalDeductions: 1700,
  netPay: 23300,
  employerCost: 26500,
};
const bankAccount = { id: "a1", name: "HDFC Current", kind: "bank", bankName: "HDFC Bank", accountLast4: "4821", ifsc: "HDFC0001234", openingBalance: 500000, openingDate: "2026-09-01", archived: false, balance: 501180, statementBalance: 501180, statementDate: "2026-10-03", lastTxnDate: "2026-10-03", txnCount: 1, unreconciled: 1, createdAt: "2026-10-01 10:00:00" };
const bankTxn = {
  id: "t1",
  accountId: "a1",
  date: "2026-10-03",
  description: "NEFT CR MERIDIAN SOLAR",
  reference: "N123",
  amount: 1180,
  statementBalance: 501180,
  source: "import",
  status: "unmatched",
  matchType: null,
  matchId: null,
  matchLabel: null,
  category: null,
  note: null,
  reconciledAt: null,
  suggestion: { type: "invoice", id: "i1", action: "settle", label: "INV/26-27/0001", detail: "Meridian Solar · ₹1,180 due", date: "2026-10-01", amount: 1180, score: 95, exact: true },
};
const fyMonths = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 3 + i, 1)).toISOString().slice(0, 7));
const monthsOf = (first: number[]) => [...first, ...Array.from({ length: 12 - first.length }, () => 0)];
const budget = { id: "b1", year: 2026, fyStart: "2026-04-01", fyEnd: "2027-03-31", fyLabel: "FY 26-27", basis: "category", name: "FY 26-27 budget", notes: null, annual: 120000, lineCount: 1, updatedAt: "2026-10-01 10:00:00" };
const travelHead = {
  id: "l1",
  kind: "category",
  key: "travel",
  label: "Travel",
  note: null,
  budgetMonths: Array.from({ length: 12 }, () => 10000),
  actualMonths: monthsOf([30000, 30000, 30000, 30000, 0, 5000, 0]),
  lastYear: 98000,
  annual: 120000,
  toDate: 61290.32,
  actual: 125000,
  remaining: -5000,
  usedPct: 104,
  projected: 183709.68,
  status: "over",
};
const budgetDetail = {
  budget,
  today: "2026-10-04",
  months: fyMonths,
  heads: [travelHead],
  unbudgeted: [{ kind: "category", key: "fuel", label: "Fuel", actualMonths: monthsOf([0, 0, 0, 0, 0, 4200]), total: 4200, lastYear: 36000 }],
  monthly: { budget: travelHead.budgetMonths, actual: monthsOf([30000, 30000, 30000, 30000, 0, 9200]) },
  totals: { annual: 120000, toDate: 61290.32, actual: 129200, remaining: -9200, usedPct: 108, projected: 187909.68, status: "over", budgetedSpend: 125000, unbudgetedSpend: 4200 },
  options: { categories: ["Fuel", "Meals", "Office"], departments: [], payroll: true, company: false },
};
const laptop = {
  id: "as1",
  tag: "AST-0001",
  name: "Dell Latitude 5440",
  category: "Computers & IT",
  serialNo: "DL5440-77",
  location: "Head office",
  departmentId: null,
  departmentName: null,
  employeeId: "e1",
  employeeName: "Ravi Kumar",
  vendorName: "Compuworld",
  billId: null,
  purchaseDate: "2026-04-10",
  cost: 85000,
  salvageValue: 0,
  method: "wdv",
  rate: 40,
  status: "in_use",
  warrantyUntil: "2029-04-09",
  disposedOn: null,
  disposalAmount: null,
  disposalNote: null,
  notes: null,
  bookValue: 67395.62,
  accumulated: 17604.38,
  depreciationThisFy: 17604.38,
  createdAt: "2026-04-10 10:00:00",
};
const assetCategories = [{ name: "Computers & IT", wdv: 40, slm: 31.67 }, { name: "Other", wdv: 15, slm: 10 }];
const ledgerAccount = (id: string, code: string, name: string, type: string, systemKey: string | null, balance: number) => ({
  id,
  code,
  name,
  type,
  systemKey,
  categories: [],
  description: null,
  archived: false,
  balance,
  used: balance !== 0,
});
const ledgerAccounts = [
  ledgerAccount("ac1", "1000", "Cash in hand", "asset", "cash", 0),
  ledgerAccount("ac2", "1100", "Accounts receivable", "asset", "receivables", 1180),
  ledgerAccount("ac3", "2300", "Output GST", "liability", "output_gst", -180),
  ledgerAccount("ac4", "3000", "Owner's capital", "equity", "capital", 0),
  ledgerAccount("ac5", "4000", "Sales", "income", "sales", -1000),
];
const journal = { id: "j1", journalNo: "JV/26-27/0001", date: "2026-10-04", narration: "Capital introduced", total: 50000, status: "posted", voidReason: null, voidedAt: null, createdAt: "2026-10-04 10:00:00" };
const heldAsset = {
  category: "Computers & IT", serialNo: null, location: null, status: "in_use", employeeDesignation: null, departmentName: null, returnState: null,
};
const trip = {
  id: "t1", requestNo: "TRV-0001", employeeId: "e1", employeeName: "Ravi Kumar", empCode: "EMP-0001", designation: "Technician", departmentName: null,
  purpose: "Site survey", fromPlace: "Bengaluru", toPlace: "Mysuru", departOn: "2026-10-12", returnOn: "2026-10-14", days: 3, mode: "car",
  estimatedCost: 4000, advance: 1000, projectId: null, projectName: null, note: null, status: "pending", phase: "pending",
  decisionNote: null, decidedBy: null, decidedAt: null, createdAt: "2026-10-03 10:00:00", mine: false, canCancel: true,
};
const serviceRequest = {
  id: "s1", requestNo: "SRV-0001", employeeId: "e1", employeeName: "Ravi Kumar", empCode: "EMP-0001", designation: "Technician", departmentName: null,
  type: "certificate", certificateKind: "employment", subject: "Employment certificate", details: "visa application", addressedTo: "The Visa Officer",
  priority: "normal", status: "open", assigneeId: null, assigneeName: null, resolutionNote: null, resolvedAt: null, resolvedBy: null, resolutionDays: null,
  letterNo: null, letterOn: null, comments: 1, createdAt: "2026-10-03 10:00:00", mine: false,
};
const policy = {
  id: "pl1", title: "POSH Policy", category: "compliance", summary: "Prevention of Sexual Harassment policy.", mandatory: true, status: "published", version: 2,
  effectiveOn: null, publishedAt: "2026-09-01 10:00:00", publishedBy: "Asha", updatedAt: "2026-09-01 10:00:00", acknowledged: 1, acknowledgedAt: null, ackedVersion: 1,
};
const filing = {
  id: "c1", title: "PF — ECR and contribution payment", area: "pf", dueOn: "2026-10-15", recurrence: "monthly", responsible: "CA Ramesh", note: null,
  status: "open", doneOn: null, doneBy: null, reference: null, hasNext: false, templateKey: "pf_ecr", state: "upcoming",
};
const salesLines = [{ description: "Solar panel 540W", hsn: "8541", unit: "Nos", quantity: 2, rate: 14500, discountPct: 0, taxRate: 12, gross: 29000, discount: 0, taxable: 29000, tax: 3480, amount: 32480 }];
const salesOrder = {
  id: "sd1", kind: "order", docNo: "SO/26-27/0001", status: "confirmed", stage: "delivered", partyId: "p1", partyName: "Meridian Solar", partyGstin: null, partyAddress: "Mysuru",
  placeOfSupply: "Karnataka", intraState: true, docDate: "2026-10-02", validUntil: null, deliveryOn: "2026-10-10", customerRef: "PO-77", subtotal: 29000, discountTotal: 0,
  taxTotal: 3480, cgst: 1740, sgst: 1740, igst: 0, grandTotal: 32480, itemCount: 1, notes: null, shipTo: null, challanReason: null, transporter: null, vehicleNo: null,
  dispatchedOn: null, deliveredOn: null, receivedBy: null, decidedOn: null, decisionNote: null, sourceId: null, sourceNo: null, sourceKind: null, invoiceId: null, invoiceNo: null,
  deliveredPct: 100, childCount: 1, createdBy: "Asha", createdAt: "2026-10-02 10:00:00", updatedAt: "2026-10-03 10:00:00",
  blocks: {
    edit: "Orders with delivery challans can't be edited", invoice: null, order: null, challan: "Everything on this order is already on a challan",
    delete: "Orders with delivery challans can't be deleted — cancel instead",
  },
};
const salesChallan = {
  ...salesOrder, id: "sd2", kind: "challan", docNo: "DC/26-27/0001", status: "delivered", stage: "delivered", deliveryOn: null, customerRef: null, challanReason: "supply",
  transporter: "VRL", vehicleNo: "KA09AB1234", dispatchedOn: "2026-10-03", deliveredOn: "2026-10-04", receivedBy: "Ravi", sourceId: "sd1", sourceNo: "SO/26-27/0001",
  sourceKind: "order", deliveredPct: null, childCount: 0,
  blocks: { edit: "Dispatched challans can't be edited", invoice: null, order: null, challan: null, delete: "Only draft challans can be deleted — cancel dispatched ones instead" },
};
const panelItem = { id: "it1", name: "Solar panel 540W", sku: "SP-540", kind: "goods", hsn: "8541", unit: "Nos", rate: 14500, taxRate: 12, active: true };
const solarProgram = {
  id: "p1", title: "Solar EPC Fundamentals", team: "technical", durationDays: 3, certificate: true, validityMonths: 24, mandatory: true,
  description: null, archived: false, createdAt: "2026-09-01 10:00:00",
};
const enrollment = {
  id: "n1", programId: "p1", programTitle: "Solar EPC Fundamentals", employeeId: "e1", employeeName: "Ravi Kumar",
  enrolledOn: "2026-10-01", sessionDate: "2026-10-03", status: "enrolled", completedOn: null, note: null, certificateId: null,
};
const promotion = {
  id: "r1", employeeId: "e1", employeeName: "Ravi Kumar", currentDesignation: "Technician", proposedDesignation: "Senior Technician",
  currentCtc: 360000, proposedCtc: 420000, effectiveDate: "2026-11-01", reason: "Led 12 commissionings", status: "pending",
  decidedOn: null, decidedBy: null, decisionNote: null, applied: false, createdAt: "2026-10-01 10:00:00",
};
const opening = {
  id: "o1", title: "Solar Technician", departmentId: null, departmentName: null, location: "Mysuru", employmentType: "full_time", openings: 2, priority: "high", status: "open",
  salaryMin: 300000, salaryMax: 420000, targetDate: "2026-11-15", description: null, openedOn: "2026-09-01", closedOn: null, createdAt: "2026-09-01 10:00:00",
};
const candidateBase = {
  openingId: "o1", openingTitle: "Solar Technician", departmentId: null, departmentName: null, email: null, phone: null, referredBy: null, rating: null, currentCtc: null, noticeDays: null,
  resumeLink: null, notes: null, interviewAt: null, interviewMode: null, interviewer: null, offerTerms: null, closedReason: null, employeeId: null, employeeCode: null, createdAt: "2026-09-05 10:00:00",
};
const priya = {
  ...candidateBase, id: "c1", name: "Priya Sharma", source: "Naukri", appliedOn: "2026-09-05", stage: "offer", stageOn: "2026-09-28", expectedCtc: 380000,
  offerCtc: 360000, offerSentOn: "2026-09-28", offerStatus: "sent", offerRespondedOn: null, joiningDate: "2027-01-04", hiredOn: null, onboarding: {}, progress: null,
};
const arjun = {
  ...candidateBase, id: "c2", name: "Arjun Rao", source: "Referral", appliedOn: "2026-08-20", stage: "hired", stageOn: "2026-09-10", expectedCtc: 340000,
  offerCtc: 340000, offerSentOn: "2026-09-05", offerStatus: "accepted", offerRespondedOn: "2026-09-10", joiningDate: "2026-10-01", hiredOn: "2026-09-10",
  onboarding: { documents: { done: true, date: "2026-09-25" }, induction: { done: false, date: "2026-10-06" } }, progress: { done: 1, total: 6, synced: false, state: "delayed" },
};
const payrollConfig = { basicPct: 50, hraPct: 40, pfEnabled: true, pfCapWage: true, esiEnabled: false, ptSlabs: [{ from: 25000, amount: 200 }], unmarkedPaid: true };
const statutoryTotals = { pfEmployee: 1500, pfEmployer: 1500, esiEmployee: 0, esiEmployer: 0, pt: 200, tds: 0, due: { pfEsi: "2026-10-15", tds: "2026-10-07" } };

const task = {
  id: "t1",
  taskNo: "TSK-0001",
  title: "Install inverter",
  details: null,
  projectId: "pr1",
  projectName: "Meridian Solar — Rooftop 5kW",
  milestoneId: "m1",
  milestoneName: "Panels installed",
  assigneeId: "e1",
  assigneeName: "Ravi Kumar",
  assigneeDesignation: "Installer",
  status: "todo",
  priority: "high",
  startOn: null,
  dueOn: "2026-10-05",
  recurrence: "weekly",
  doneAt: null,
  doneBy: null,
  createdBy: "Asha",
  createdAt: "2026-10-01 10:00:00",
  updatedAt: "2026-10-01 10:00:00",
  state: "due_today",
  mine: false,
  access: { edit: true, status: true, cancel: true, delete: true },
};
const milestone = { id: "m1", projectId: "pr1", projectName: "Meridian Solar — Rooftop 5kW", name: "Panels installed", dueOn: "2026-10-09", status: "open", doneOn: null, total: 1, done: 0, progress: 0, state: "due_soon", canDelete: true };

const ROUTES: Record<string, unknown> = {
  "GET /session": session,
  "POST /connect/sync": { imported: [] },
  "GET /events": { events: [{ id: 1, actorName: "Asha Rao", type: "invoice.issue", entityType: "invoice", entityId: "i1", summary: "Issued INV/26-27/0001", createdAt: "2026-10-04 10:00:00" }] },
  "GET /finance/overview": {
    today: "2026-10-04",
    kpis: { revenueMtd: 1180, collectedMtd: 0, receivable: 1180, overdue: 0, overdueCount: 0, draftCount: 0, payable: 0, billsPending: 0, spendMtd: 0, expensesPending: 0 },
    series: months.map((label, i) => ({ month: `2026-${String(i + 5).padStart(2, "0")}`, label, revenue: i * 100, collected: 0, spend: 0 })),
    aging: { current: 1180, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 },
    overdueInvoices: [],
    spendByCategory: [],
  },
  "GET /invoices": { invoices: [invoice] },
  "GET /invoices/i1": { invoice, payments: [] },
  "GET /parties": { parties: [{ id: "p1", kind: "customer", name: "Meridian Solar", company: null, gstin: null, email: null, phone: null, address: null, city: "Mysuru", state: "Karnataka", notes: null, sourceTool: "quotationv1", sourceRef: "q1", createdAt: "2026-10-01", invoiced: 1180, balance: 1180 }] },
  "GET /bills": { bills: [] },
  "GET /expenses": { expenses: [], categories: ["Travel", "Food"] },
  "GET /finance/gst": { month: "2026-10", invoiceCount: 1, taxable: 1000, cgst: 90, sgst: 90, igst: 0, outputTax: 180, inputTax: 0, billCount: 0, netPayable: 180, byRate: [{ rate: 18, taxable: 1000, tax: 180 }] },
  "GET /reports/finance": {
    from: "2026-04-01",
    to: "2026-10-04",
    pnl: { months: [{ month: "2026-10", sales: 1000, purchases: 0, expenses: 250, payroll: 0, net: 750 }], total: { sales: 1000, purchases: 0, expenses: 250, payroll: 0, net: 750 } },
    expenseByCategory: [{ category: "Travel", total: 250 }],
    sales: { truncated: false, rows: [{ id: "i1", invoiceNo: "INV/26-27/0001", date: "2026-10-01", partyName: "Meridian Solar", partyGstin: null, placeOfSupply: "Karnataka", taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180, balance: 1180, status: "sent" }] },
    purchases: { truncated: false, rows: [] },
    expenses: { truncated: false, rows: [{ id: "x1", date: "2026-10-02", claimant: "Ravi Kumar", category: "Travel", description: "Site visit", amount: 250, status: "approved" }] },
  },
  "GET /reports/hr": {
    month: "2026-10",
    from: "2026-10-01",
    to: "2026-10-04",
    workingDays: 3,
    fiscalYear: "2026-27",
    leavePolicy: settings.leavePolicy,
    totals: { headcount: 1, joiners: 0, exits: 0, attendancePct: 67 },
    employees: [{ employeeId: "e1", empCode: "EMP-0001", name: "Ravi Kumar", departmentName: null, workingDays: 3, present: 2, wfh: 0, halfDay: 0, absent: 0, leave: 0, unmarked: 1, attendancePct: 67, leaveUsed: { casual: 1, sick: 0, earned: 0, lop: 0 } }],
    departments: [{ name: "Unassigned", headcount: 1, joiners: 0, exits: 0 }],
  },
  "GET /banking/overview": { today: "2026-10-04", accounts: [bankAccount], categories: ["Bank charges"], totals: { bank: 501180, cash: 0, unreconciled: 1, moneyIn: 1180, moneyOut: 0 } },
  "GET /banking/accounts/a1": { account: bankAccount, categories: ["Bank charges"], truncated: false, transactions: [bankTxn] },
  "POST /banking/accounts/a1/import": { imported: 2, skipped: 0, beforeOpening: 0, account: bankAccount },
  "POST /banking/transactions/t1/reconcile": { transaction: { ...bankTxn, status: "matched", matchType: "payment", matchId: "pay1", matchLabel: "INV/26-27/0001 · Meridian Solar", suggestion: null } },
  "GET /budgets": { today: "2026-10-04", fiscalYearStart: 4, currentYear: 2026, budgets: [budget] },
  "GET /budgets/b1": budgetDetail,
  "POST /budgets/b1/lines": { lineId: "l2" },
  "GET /assets": {
    today: "2026-10-04",
    fiscalYearStart: 4,
    currentYear: 2026,
    fyLabel: "FY 26-27",
    categories: assetCategories,
    assets: [laptop],
    totals: { count: 1, cost: 85000, bookValue: 67395.62, depreciationFy: 17604.38, maintenance: 0, transfersMtd: 0, disposedFy: 0, warrantySoon: 0 },
  },
  "GET /assets/as1": {
    asset: laptop,
    schedule: [{ fyStart: "2026-04-01", fyEnd: "2027-03-31", label: "FY 26-27", opening: 85000, depreciation: 17604.38, closing: 67395.62, days: 178 }],
    events: [{ id: "ev1", kind: "assign", date: "2026-04-10", employeeName: "Ravi Kumar", departmentName: null, location: null, amount: null, note: "Assigned when added", createdAt: "2026-04-10 10:00:00" }],
    bill: null,
    disposal: null,
    categories: assetCategories,
  },
  "POST /assets/as1/dispose": { asset: { ...laptop, status: "disposed", disposedOn: "2026-10-04", disposalAmount: 20000 }, disposal: { bookValue: 67395.62, gainLoss: -47395.62 } },
  "GET /accounting/overview": {
    today: "2026-10-04",
    fiscalYearStart: 4,
    fyStart: "2026-04-01",
    fyLabel: "FY 26-27",
    booksStart: null,
    accounts: ledgerAccounts,
    totals: { cashAndBank: 0, receivables: 1180, payables: 0, suspense: 0, openingTotal: 0, openingDifference: 0, manualMtd: 0, income: 1000, expense: 0, net: 1000, difference: 0 },
    recent: [{ date: "2026-10-01", source: "invoice", sourceId: "i1", linkId: "i1", ref: "INV/26-27/0001", memo: "Invoice to Meridian Solar", amount: 1180, debit: ["Accounts receivable"], credit: ["Output GST", "Sales"] }],
  },
  "POST /accounting/journals": { journal },
  "GET /accounting/journals/j1": {
    journal,
    lines: [
      { id: "jl1", accountId: "ac1", code: "1000", name: "Cash in hand", debit: 50000, credit: 0, note: null },
      { id: "jl2", accountId: "ac4", code: "3000", name: "Owner's capital", debit: 0, credit: 50000, note: null },
    ],
  },
  "GET /recruitment/overview": {
    today: "2026-10-04",
    fyStart: "2026-04-01",
    departments: [],
    openings: [{ ...opening, applicants: 2, active: 1, hired: 1 }],
    candidates: [priya, arjun],
    truncated: false,
    totals: {
      openPositions: 1, departmentsHiring: 1, openRoles: 1, draftRoles: 0, activeApplicants: 1,
      byStage: { applied: 0, interview: 0, shortlisted: 0, offer: 1, hired: 1, rejected: 0, withdrawn: 0 },
      avgDaysToHire: 21, hiresCounted: 1, offersAccepted: 1, offersDeclined: 0, offersPending: 1, offersSent: 2,
      joinersThisMonth: 1, documentsPending: 0, inductionsSoon: 1, onboarding: { total: 1, completed: 0, delayed: 1, it: 0, kyc: 0, kra: 0, synced: 0 },
    },
  },
  "GET /recruitment/candidates/c1": {
    candidate: priya,
    opening,
    events: [
      { id: "ev2", kind: "offer", fromStage: "interview", toStage: "offer", note: null, date: "2026-09-28", actorName: "Asha", createdAt: "2026-09-28 10:00:00" },
      { id: "ev1", kind: "applied", fromStage: null, toStage: "applied", note: null, date: "2026-09-05", actorName: "Asha", createdAt: "2026-09-05 10:00:00" },
    ],
  },
  "POST /recruitment/candidates/c1/offer-response": { candidate: { ...priya, stage: "hired", offerStatus: "accepted", hiredOn: "2026-10-04", onboarding: {}, progress: { done: 0, total: 6, synced: false, state: "not_started" } } },
  "GET /performance/overview": {
    today: "2026-10-04",
    fyStart: "2026-04-01",
    quarterStart: "2026-10-01",
    employees: [{ id: "e1", empCode: "EMP-0001", name: "Ravi Kumar", designation: "Technician", departmentName: null, status: "active", ctcAnnual: 360000 }],
    programs: [{ ...solarProgram, enrolled: 1, completed: 0 }],
    enrollments: [enrollment],
    certificates: [],
    kras: [],
    promotions: [promotion],
    pips: [],
    recognitions: [{ id: "g1", employeeId: "e1", employeeName: "Ravi Kumar", category: "Star Performer", awardedOn: "2026-10-02", note: "Commissioned 2 sites early" }],
    categories: ["Star Performer", "Team Player"],
    truncated: false,
    totals: {
      headcount: 1, promotionsPending: 1, promotionsApproved: 0, programs: 1, enrolledQuarter: 1, completedQuarter: 0, upcomingSessions: 0,
      certifiedEmployees: 0, mandatoryPrograms: 1, mandatoryCompliant: 0, expiringSoon: 0, expired: 0, issuedFy: 0,
      onPip: 0, nextPipReview: null, krasSet: 0, kras: { current: 0, onTrack: 0, atRisk: 0, offTrack: 0 }, recognitionsMonth: 1,
    },
  },
  "POST /performance/enrollments/n1/complete": { enrollment: { ...enrollment, status: "completed", completedOn: "2026-10-03", certificateId: "ct1" } },
  "POST /performance/promotions/r1/decision": { promotion: { ...promotion, status: "approved", decidedOn: "2026-10-04", decidedBy: "Asha", applied: true } },
  "GET /hr/expenses-assets": {
    today: "2026-10-04",
    manager: true,
    me: null,
    employees: [{ id: "e1", name: "Ravi Kumar", empCode: "EMP-0001", designation: "Technician", departmentName: null, status: "active" }],
    projects: [],
    assets: [
      { ...heldAsset, id: "as8", tag: "AST-0008", name: 'MacBook Pro 14"', employeeId: "e1", employeeName: "Ravi Kumar", employeeDesignation: "Technician", assignedOn: "2026-04-10" },
      { ...heldAsset, id: "as9", tag: "AST-0009", name: "iPhone 14", category: "Office equipment", employeeId: "e7", employeeName: "Meera Iyer", assignedOn: "2025-06-01", returnState: "overdue" },
    ],
    trips: [trip],
    claims: [],
    categories: ["Travel", "Meals"],
    truncated: false,
    totals: { assetsAssigned: 2, assetsInStore: 0, overdueReturns: 1, returnsDue: 0, travelPending: 1, travelPendingCost: 4000, travelUpcoming: 0, onTrip: 0, claimsPending: 0, claimsToReimburse: 0, claimsOpen: 0, claimsOpenAmount: 0 },
  },
  "POST /travel/t1/decision": { trip: { ...trip, status: "approved", phase: "upcoming", decidedBy: "Asha" } },
  "POST /assets/as9/assign": { asset: laptop },
  "GET /services/overview": {
    today: "2026-10-04",
    manager: true,
    me: null,
    employees: [{ id: "e1", name: "Ravi Kumar", empCode: "EMP-0001", designation: "Technician", status: "active" }],
    requests: [
      serviceRequest,
      { ...serviceRequest, id: "s2", requestNo: "SRV-0002", type: "helpdesk", certificateKind: null, subject: "Laptop won't charge", details: null, addressedTo: null, priority: "high", comments: 0 },
    ],
    truncated: false,
    totals: { open: 2, unassigned: 2, helpdeskOpen: 1, helpdeskUnassigned: 1, certificatesOpen: 1, kitsOpen: 0, resolvedRecent: 0, avgResolutionDays: null, avgResolutionPrevDays: null },
  },
  "GET /services/requests/s1": {
    request: serviceRequest,
    comments: [{ id: "c1", author: "Ravi Kumar", mine: false, body: "Needed by Friday please", internal: false, createdAt: "2026-10-03 10:05:00" }],
    letter: { kind: "employment", name: "Ravi Kumar", empCode: "EMP-0001", designation: "Technician", departmentName: null, joinDate: "2024-04-01", exitDate: null, status: "active", ctcAnnual: null },
  },
  "POST /services/requests/s1/comments": { ok: true },
  "GET /policies/pending": { policies: [] },
  "GET /policies/overview": {
    today: "2026-10-04",
    manager: true,
    me: { id: "e1", name: "Ravi Kumar", status: "active" },
    headcount: 2,
    policies: [
      policy,
      { ...policy, id: "pl2", title: "Leave Policy", category: "hr", summary: null, mandatory: false, version: 1, acknowledged: 2, acknowledgedAt: "2026-09-02 10:00:00", ackedVersion: 1 },
    ],
    employees: [{ id: "e1", name: "Ravi Kumar", empCode: "EMP-0001", designation: "Technician", status: "active", hasLogin: true }],
    compliance: [filing],
    templates: [
      { key: "pf_ecr", title: "PF — ECR and contribution payment", area: "pf", recurrence: "monthly", note: "Last month's contributions.", firstDue: "2026-10-15", added: true },
      { key: "esi", title: "ESI — contribution payment", area: "esi", recurrence: "monthly", note: "Last month's contributions.", firstDue: "2026-10-15", added: false },
    ],
    agreements: [],
    truncated: false,
    totals: {
      policies: { published: 2, mandatory: 1, drafts: 0, headcount: 2, ackRate: 75, mandatoryPending: 1 },
      mine: { toAcknowledge: 1, mandatoryPending: 1, acknowledged: 1 },
      compliance: { overdue: 0, dueSoon: 0, due30: 1, doneMonth: 0 },
      agreements: { active: 0, expiring: 0, expired: 0, unsigned: 0 },
    },
  },
  "GET /policies/pl1": {
    policy: { ...policy, body: "1. Commitment\nWe keep the workplace free from harassment." },
    canAcknowledge: true,
    roster: [
      { employeeId: "e1", name: "Ravi Kumar", empCode: "EMP-0001", designation: "Technician", departmentName: null, status: "active", hasLogin: true, acknowledgedAt: null, method: null, recordedBy: null, note: null, lastVersion: 1 },
      { employeeId: "e2", name: "Meera Iyer", empCode: "EMP-0002", designation: null, departmentName: null, status: "active", hasLogin: false, acknowledgedAt: "2026-09-03 10:00:00", method: "recorded", recordedBy: "Asha", note: "Paper copy", lastVersion: 2 },
    ],
  },
  "POST /policies/pl1/acknowledge": { ok: true, version: 2 },
  "POST /compliance/c1/done": { item: { ...filing, status: "done", doneOn: "2026-10-04", reference: "ACK-1", hasNext: true, state: "done" }, next: { ...filing, id: "c2", dueOn: "2026-11-15" } },
  "POST /compliance/templates": { added: 1, skipped: 0 },
  "POST /services/requests/s1/resolve": { request: { ...serviceRequest, status: "resolved", letterNo: "LTR-0001", letterOn: "2026-10-04" } },
  "GET /sales/overview": {
    docs: [salesChallan, salesOrder],
    totals: { ordersMonth: { count: 1, value: 32480 }, quotesOpen: { count: 0, value: 0 }, challans: { month: 1, pendingDispatch: 0, inTransit: 0 }, toInvoice: { count: 1, value: 32480 } },
    pos: { enabled: false },
  },
  "GET /sales/docs/sd1": { doc: { ...salesOrder, lines: salesLines, remaining: [{ ...salesLines[0], quantity: 0 }] }, children: [salesChallan] },
  "POST /sales/docs/sd1/invoice": {
    doc: { ...salesOrder, stage: "invoiced", invoiceId: "i1", invoiceNo: "INV/26-27/0001", lines: salesLines, remaining: [] },
    children: [salesChallan],
    invoice: { id: "i1", invoiceNo: "INV/26-27/0001" },
  },
  "GET /sales/items": { items: [panelItem] },
  "GET /sales/pos": { enabled: true, bills: [], count: 0, total: 0, byMethod: { cash: 0, upi: 0, card: 0 } },
  "POST /sales/pos": {
    enabled: true,
    invoice: { id: "i2", invoiceNo: "INV/26-27/0002", grandTotal: 32480 },
    bills: [{ id: "i2", invoiceNo: "INV/26-27/0002", partyName: "Walk-in customer", grandTotal: 32480, status: "paid", method: "upi", createdAt: "2026-10-04 11:00:00" }],
    count: 1,
    total: 32480,
    byMethod: { cash: 0, upi: 32480, card: 0 },
  },
  "GET /payroll/overview": { today: "2026-10-04", settingsSaved: true, config: payrollConfig, headcount: 1, withStructure: 1, missing: [], runs: [payrollRun], dues: null },
  "GET /payroll/runs/r1": { run: payrollRun, payslips: [payslip], statutory: statutoryTotals, missing: [] },
  "GET /payroll/payslips/s1": { payslip: { ...payslip, period: "2026-09", runStatus: "finalized", paidOn: null } },
  "GET /payroll/me": { employeeId: null, payslips: [] },
  "GET /hr/overview": {
    today: "2026-10-04",
    kpis: { headcount: 1, joinersThisMonth: 0, present: 0, attendanceMarked: 0, onLeave: 0, probation: 0, notice: 0 },
    pending: { leave: 0, expenses: 0, profileChanges: 0 },
    trend: months.map((label, i) => ({ month: `2026-${String(i + 5).padStart(2, "0")}`, label, headcount: 1, joiners: 0 })),
    byDepartment: [],
    celebrations: [{ employeeId: "e1", name: "Ravi Kumar", kind: "birthday", inDays: 2 }],
    holidays: [],
    pendingLeave: [],
  },
  "GET /hr/employees": { employees: [employee] },
  "GET /hr/employees/e1": {
    employee,
    isSelf: false,
    balances: [
      { type: "casual", allowed: 12, used: 0, remaining: 12 },
      { type: "sick", allowed: 8, used: 0, remaining: 8 },
      { type: "earned", allowed: 15, used: 0, remaining: 15 },
      { type: "lop", allowed: 0, used: 0, remaining: 0 },
    ],
    attendance: { month: "2026-10", present: 0, absent: 0, leave: 0, wfh: 0, records: [] },
    leaves: [],
    pendingChange: null,
  },
  "GET /hr/departments": { departments: [] },
  "GET /hr/profile-changes": { changes: [] },
  "GET /hr/leave": { leave: [] },
  "GET /hr/attendance": { date: "2026-10-04", holiday: null, weekend: false, roster: [{ employeeId: "e1", name: "Ravi Kumar", designation: "Installer", departmentName: null, status: null, checkIn: null, checkOut: null, source: null }] },
  "GET /hr/holidays": { year: 2026, holidays: [] },
  "GET /hr/me": { employee: null },
  "GET /projects": {
    projects: [{ id: "pr1", name: "Meridian Solar — Rooftop 5kW", partyId: "p1", partyName: "Meridian Solar", status: "lead", siteAddress: "Mysuru", valueEstimate: 250000, startDate: null, dueDate: null, notes: null, sourceTool: "sitesurveyv1", sourceRef: "s1", createdAt: "2026-10-01", updatedAt: "2026-10-01" }],
  },
  "GET /tasks/summary": { today: "2026-10-05", totals: { open: 0, todo: 0, inProgress: 0, onHold: 0, overdue: 0, dueToday: 0, recurring: 0, doneRecent: 0 }, upcoming: [], progress: {} },
  "GET /tasks": {
    today: "2026-10-05",
    manager: true,
    me: null,
    tasks: [task],
    milestones: [milestone],
    people: [{ id: "e1", name: "Ravi Kumar", designation: "Installer", isMe: false }],
    projects: [{ id: "pr1", name: "Meridian Solar — Rooftop 5kW", status: "lead" }],
    progress: { pr1: { total: 1, done: 0, overdue: 0, progress: 0 } },
    truncated: false,
    totals: { open: 1, todo: 1, inProgress: 0, onHold: 0, overdue: 0, dueToday: 1, recurring: 1, doneRecent: 0 },
  },
  "GET /tasks/t1": { task },
  "GET /connect": { autoSync: true, lastSyncAt: null, connectors: [{ id: "quotationv1", label: "Quotation V1", icon: "📑", href: "/tools/quotationv1", description: "Approved quotations become customers and draft invoices.", targets: ["party", "invoice"], total: 1, linked: 1, pending: 0 }] },
  "GET /connect/quotationv1": {
    connector: { id: "quotationv1", label: "Quotation V1", icon: "📑", href: "/tools/quotationv1", description: "Approved quotations become customers and draft invoices.", targets: ["party", "invoice"], total: 1, linked: 1, pending: 0 },
    items: [{ ref: "q1", docNo: "QT-0001", date: "2026-10-01", status: "approved", amount: 1180, title: "Rooftop", party: { name: "Meridian Solar" }, lineCount: 1, suggested: ["party", "invoice"], links: { party: "p1", invoice: "i1" } }],
  },
};

let overrides: Record<string, { status: number; body: unknown }> = {};
let unmatched: string[] = [];

function routeOf(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), "http://localhost");
  const path = url.pathname.replace(/^.*\/api\/bos/, "");
  return `${(init?.method ?? "GET").toUpperCase()} ${path}`;
}

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const WAIT = { timeout: 8000 };
const TEST_TIMEOUT = 30000;

const workspaceTabs = () => within(screen.getByRole("tablist", { name: "Workspaces" })).getAllByRole("tab");

function navItem(label: string) {
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>(".bos-nav-item")).find((b) => b.textContent?.trim().endsWith(label));
  if (!item) throw new Error(`No nav item "${label}"`);
  return item;
}

async function ready() {
  await screen.findByText("Link your employee record", undefined, WAIT);
}

describe("BosApp", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    overrides = {};
    unmatched = [];
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    Element.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(null, "", "/tools/bos");
    consoleError = vi.spyOn(console, "error");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const key = routeOf(input, init);
        const forced = overrides[key];
        if (forced) return new Response(JSON.stringify(forced.body), { status: forced.status, headers: { "Content-Type": "application/json" } });
        if (key in ROUTES) return new Response(JSON.stringify(ROUTES[key]), { status: 200, headers: { "Content-Type": "application/json" } });
        unmatched.push(key);
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    consoleError.mockRestore();
    document.body.className = "";
  });

  it("loads the session into a scoped .bos root and shows My Profile", async () => {
    const { container } = render(<BosApp mode="tool" />);
    await ready();
    expect((container.firstElementChild as HTMLElement).classList.contains("bos")).toBe(true);
    expect(workspaceTabs().map((t) => t.textContent)).toEqual(["Home", "Finance & Accounts", "HR Management", "Projects", "Connected Tools", "Settings & Audit"]);
    await flush();
    expect(unmatched).toEqual([]);
  }, TEST_TIMEOUT);

  it("walks every workspace and module without runtime errors", async () => {
    const { container } = render(<BosApp mode="tool" />);
    await ready();
    let visited = 0;
    for (let w = 0; w < workspaceTabs().length; w++) {
      fireEvent.click(workspaceTabs()[w]);
      await flush();
      const count = container.querySelectorAll(".bos-nav-item").length;
      visited += count;
      for (let i = 0; i < count; i++) {
        fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".bos-nav-item")[i]);
        await flush();
        if (!workspaceTabs()[w].getAttribute("aria-selected")?.includes("true")) fireEvent.click(workspaceTabs()[w]);
      }
    }
    expect(visited).toBeGreaterThan(30);
    expect(unmatched).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  }, TEST_TIMEOUT);

  it("computes intra-state GST live in the invoice editor", async () => {
    render(<BosApp mode="tool" />);
    await ready();
    fireEvent.click(workspaceTabs()[1]);
    fireEvent.click(await waitFor(() => navItem("Invoices"), WAIT));
    fireEvent.click(await screen.findByRole("button", { name: "Create Invoice" }, WAIT));
    await screen.findByLabelText("Item 1 description", undefined, WAIT);
    fireEvent.change(screen.getByLabelText("Item 1 description"), { target: { value: "Solar panel" } });
    fireEvent.change(screen.getByLabelText("Item 1 quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Item 1 rate"), { target: { value: "500" } });
    const paper = screen.getByRole("article", { name: "Invoice preview" });
    expect(within(paper).getByText("CGST")).toBeTruthy();
    expect(within(paper).getByText("SGST")).toBeTruthy();
    expect(within(paper).getAllByText("₹1,180.00").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Place of supply"), { target: { value: "Tamil Nadu" } });
    expect(within(paper).getByText("IGST")).toBeTruthy();
  }, TEST_TIMEOUT);

  it("opens the record named in a notification deep link", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=invoices&open=i1");
    render(<BosApp mode="tool" />);
    expect(await screen.findByRole("button", { name: /Record payment/ }, WAIT)).toBeTruthy();
    expect(window.location.search).toBe("?ws=finance&m=invoices");
  }, TEST_TIMEOUT);

  it("opens a project handed off from Site Survey", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=projects&m=board&open=pr1");
    render(<BosApp mode="tool" />);
    const dialog = await screen.findByRole("dialog", undefined, WAIT);
    expect(within(dialog).getByText("Edit project")).toBeTruthy();
    expect((within(dialog).getByLabelText("Project name") as HTMLInputElement).value).toBe("Meridian Solar — Rooftop 5kW");
  }, TEST_TIMEOUT);

  it("shows the profit & loss to owners and keeps reports from staff", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=reports");
    const { unmount } = render(<BosApp mode="tool" />);
    expect(await screen.findByText(/Profit & loss,/, undefined, WAIT)).toBeTruthy();
    unmount();

    overrides["GET /session"] = { status: 200, body: { ...session, actor: { ...session.actor, role: "staff", canManage: false } } };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=reports");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Owners and admins only", undefined, WAIT)).toBeTruthy();
    await flush();
    expect(fetchMock.mock.calls.some(([input, init]) => routeOf(input, init).startsWith("GET /reports"))).toBe(false);
  }, TEST_TIMEOUT);

  it("opens a payroll run from a notification and drills into the payslip", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=payroll&open=r1");
    render(<BosApp mode="tool" />);
    expect(await screen.findByRole("button", { name: "Finalise" }, WAIT)).toBeTruthy();
    expect(screen.getByText(/Draft · calculated/)).toBeTruthy();
    fireEvent.click(screen.getByText("Ravi Kumar"));
    const paper = await screen.findByRole("article", { name: "Payslip" }, WAIT);
    expect(within(paper).getByText("Rupees Twenty Three Thousand Three Hundred only")).toBeTruthy();
    expect(within(paper).getByText("26.5 of 30 · 3.5 LOP")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to the payroll run/ }));
    expect(await screen.findByRole("button", { name: "Finalise" }, WAIT)).toBeTruthy();
  }, TEST_TIMEOUT);

  it("shows staff their payslip but keeps payroll runs to owners", async () => {
    overrides["GET /session"] = { status: 200, body: { ...session, actor: { ...session.actor, role: "staff", canManage: false } } };
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=payroll&open=r1");
    const { unmount } = render(<BosApp mode="tool" />);
    expect(await screen.findByText("Owners and admins only", undefined, WAIT)).toBeTruthy();
    unmount();

    overrides["GET /payroll/me"] = { status: 200, body: { employeeId: "e1", payslips: [{ ...payslip, period: "2026-09", runStatus: "finalized", paidOn: null }] } };
    window.history.replaceState(null, "", "/tools/bos");
    render(<BosApp mode="tool" />);
    await ready();
    fireEvent.click(await screen.findByText(/^Sept? 2026$/, undefined, WAIT));
    const paper = await screen.findByRole("article", { name: "Payslip" }, WAIT);
    expect(within(paper).getByText("PAYSLIP")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back to My Profile/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finalise" })).toBeNull();
  }, TEST_TIMEOUT);

  it("reconciles a statement line by accepting its suggestion", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=banking&open=a1");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText(/Suggested: INV\/26-27\/0001/, undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("Matches · 3 Oct 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([input, init]) => routeOf(input, init) === "POST /banking/transactions/t1/reconcile");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ action: "settle", type: "invoice", id: "i1" });
    }, WAIT);
  }, TEST_TIMEOUT);

  it("imports a bank CSV statement through the column preview", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=banking&open=a1");
    render(<BosApp mode="tool" />);
    fireEvent.click(await screen.findByRole("button", { name: "Import statement" }, WAIT));
    const csv = ["HDFC BANK Ltd.", "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance", "05/10/26,SMS CHARGES,,05/10/26,15.00,,501165.00", '04/10/26,"NEFT CR, COASTAL",N9,04/10/26,,"2,000.00",501180.00'].join("\n");
    const input = screen.getByLabelText("Statement CSV file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([csv], "statement.csv", { type: "text/csv" })] } });
    const importButton = await screen.findByRole("button", { name: "Import 2 lines" }, WAIT);
    expect(screen.getByText("Newest-first file, put in date order")).toBeTruthy();
    fireEvent.click(importButton);
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /banking/accounts/a1/import");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body)).lines).toEqual([
        { date: "2026-10-04", description: "NEFT CR, COASTAL", reference: "N9", amount: 2000, balance: 501180 },
        { date: "2026-10-05", description: "SMS CHARGES", reference: null, amount: -15, balance: 501165 },
      ]);
    }, WAIT);
    expect(await screen.findByText("Imported 2 lines", undefined, WAIT)).toBeTruthy();
  }, TEST_TIMEOUT);

  it("tracks a budget against spend and budgets an unbudgeted category from last year", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=budgeting&open=b1");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("1 head over budget", undefined, WAIT)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Travel: 104% of budget used" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fuel · ₹4,200/ }));
    const annual = (await screen.findByLabelText("Annual budget (₹)", undefined, WAIT)) as HTMLInputElement;
    expect(annual.value).toBe("36000");
    expect(screen.getByText(/spent so far ₹4,200 · last year ₹36,000/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add head" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /budgets/b1/lines");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ kind: "category", name: "Fuel", months: Array.from({ length: 12 }, () => 3000), note: null });
    }, WAIT);
  }, TEST_TIMEOUT);

  it("lists assets with their depreciation and disposes of one from its record", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=assets");
    render(<BosApp mode="tool" />);
    const table = await screen.findByRole("table", { name: "Asset register & depreciation" }, WAIT);
    expect(within(table).getByText("WDV 40%")).toBeTruthy();
    expect(within(table).getByText("₹67,396")).toBeTruthy();
    fireEvent.click(within(table).getByText("Dell Latitude 5440"));
    expect(await screen.findByText("Accumulated depreciation", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("Assigned to Ravi Kumar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dispose" }));
    const dialog = await screen.findByRole("dialog", undefined, WAIT);
    fireEvent.change(within(dialog).getByLabelText(/Sale proceeds/), { target: { value: "20000" } });
    expect(within(dialog).getByText(/Ravi Kumar will no longer hold it/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Dispose" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /assets/as1/dispose");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ amount: 20000, note: null });
    }, WAIT);
  }, TEST_TIMEOUT);

  it("shows the chart of accounts and posts a balanced manual entry", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=accounting");
    render(<BosApp mode="tool" />);
    const chart = await screen.findByRole("table", { name: "Chart of accounts" }, WAIT);
    const receivable = within(chart).getByText("Accounts receivable").closest("tr")!;
    expect(within(receivable).getByText("ASSET")).toBeTruthy();
    expect(within(receivable).getByText("₹1,180")).toBeTruthy();
    expect(within(within(chart).getByText("Output GST").closest("tr")!).getByText("₹180")).toBeTruthy();
    const recent = screen.getByRole("table", { name: "General ledger — recent entries" });
    expect(within(recent).getByText("Output GST, Sales")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New entry" }));
    const dialog = await screen.findByRole("dialog", undefined, WAIT);
    fireEvent.change(within(dialog).getByLabelText("Narration"), { target: { value: "Capital introduced" } });
    fireEvent.change(within(dialog).getByLabelText("Line 1 account"), { target: { value: "ac1" } });
    fireEvent.change(within(dialog).getByLabelText("Line 1 debit"), { target: { value: "50000" } });
    fireEvent.change(within(dialog).getByLabelText("Line 2 account"), { target: { value: "ac4" } });
    fireEvent.change(within(dialog).getByLabelText("Line 2 credit"), { target: { value: "49000" } });
    expect(within(dialog).getByText("Off by ₹1,000")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Line 2 credit"), { target: { value: "50000" } });
    expect(within(dialog).getByText("Balanced")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Post entry" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /accounting/journals");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({
        narration: "Capital introduced",
        lines: [
          { accountId: "ac1", debit: 50000, credit: 0, note: null },
          { accountId: "ac4", debit: 0, credit: 50000, note: null },
        ],
      });
    }, WAIT);
    expect(await screen.findByRole("table", { name: "Lines, JV/26-27/0001" }, WAIT)).toBeTruthy();
  }, TEST_TIMEOUT);

  it("shows the hiring pipeline and records an accepted offer from the candidate", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=hr&m=recruit");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Offer acceptance rate", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("21 days")).toBeTruthy();
    const joiners = screen.getByRole("table", { name: "Onboarding — New Joiners" });
    const arjunRow = within(joiners).getByText("Arjun Rao").closest("tr")!;
    expect(within(arjunRow).getByText("SUBMITTED")).toBeTruthy();
    expect(within(arjunRow).getByText(/SCHEDULED/)).toBeTruthy();
    expect(within(arjunRow).getByText("DELAYED")).toBeTruthy();

    fireEvent.click(screen.getByText("Priya Sharma"));
    fireEvent.click(await screen.findByRole("button", { name: "Record response" }, WAIT));
    const dialog = await screen.findByRole("dialog", undefined, WAIT);
    expect(within(dialog).getByText(/Accepting hires the candidate/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Record acceptance" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /recruitment/candidates/c1/offer-response");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ response: "accepted", joiningDate: "2027-01-04", note: null });
    }, WAIT);
  }, TEST_TIMEOUT);

  it("tracks training and signs off a promotion that updates the employee record", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=hr&m=performance");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Promotions Details", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("🏆 Star Performer")).toBeTruthy();
    expect(screen.getByText("3 Days")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Training Programs" }));
    const schedule = await screen.findByRole("table", { name: "Training schedule" }, WAIT);
    fireEvent.click(within(schedule).getByRole("button", { name: "Mark complete" }));
    let dialog = await screen.findByRole("dialog", undefined, WAIT);
    expect(within(dialog).getByText(/BOS issues a certificate dated the completion day, valid for 24 months/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark complete" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /performance/enrollments/n1/complete");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ date: "2026-10-03" });
    }, WAIT);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), WAIT);

    fireEvent.click(screen.getByRole("tab", { name: "Performance" }));
    const pipeline = await screen.findByRole("table", { name: "Promotion pipeline" }, WAIT);
    expect(within(pipeline).getByText("PENDING SIGN-OFF")).toBeTruthy();
    fireEvent.click(within(pipeline).getByText("Senior Technician"));
    dialog = await screen.findByRole("dialog", undefined, WAIT);
    expect(within(dialog).getByText(/Revise the salary structure in Payroll separately/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /performance/promotions/r1/decision");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ decision: "approved", apply: true, note: null });
    }, WAIT);
  }, TEST_TIMEOUT);

  it("flags an overdue asset return, records it and approves a travel request", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=hr&m=expenses");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Overdue asset returns", undefined, WAIT)).toBeTruthy();
    const assets = screen.getByRole("table", { name: "Asset assignment" });
    const phone = within(assets).getByText("iPhone 14").closest("tr")!;
    expect(within(phone).getByText("OVERDUE RETURN")).toBeTruthy();
    fireEvent.click(within(phone).getByRole("button", { name: "Return" }));
    const dialog = await screen.findByRole("dialog", undefined, WAIT);
    fireEvent.change(within(dialog).getByLabelText("Condition"), { target: { value: "Good" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record return" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /assets/as9/assign");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ employeeId: null, note: "Good" });
    }, WAIT);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), WAIT);

    fireEvent.click(screen.getByRole("tab", { name: "Travel Requests" }));
    expect(await screen.findByText("✈ Awaiting approval", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText(/TRV-0001 · Bengaluru → Mysuru/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /travel/t1/decision");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ decision: "approved" });
    }, WAIT);
  }, TEST_TIMEOUT);

  it("opens a certificate request, adds an internal note, previews the letter and resolves it", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=hr&m=services");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Open helpdesk tickets", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("1 unassigned")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Service requests" });
    expect(within(table).getAllByText("UNASSIGNED")).toHaveLength(2);
    fireEvent.click(within(screen.getByRole("group", { name: "Request types" })).getByRole("button", { name: "Helpdesk" }));
    expect(within(table).queryByText("Employment certificate")).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Request types" })).getByRole("button", { name: "Helpdesk" }));
    fireEvent.click(within(table).getByText("Employment certificate"));

    expect(await screen.findByText("Needed by Friday please", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Internal note" }));
    fireEvent.change(screen.getByLabelText("Internal note", { selector: "textarea" }), { target: { value: "On it" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /services/requests/s1/comments");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ body: "On it", internal: true });
    }, WAIT);

    fireEvent.click(screen.getByRole("button", { name: "Preview letter" }));
    const letter = await screen.findByRole("article", { name: "Employment certificate" }, WAIT);
    expect(within(letter).getByText("To The Visa Officer")).toBeTruthy();
    expect(within(letter).getByText(/issued at the employee's request for visa application/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "‹ Back to SRV-0001" }));

    fireEvent.click(await screen.findByRole("button", { name: "Resolve & issue letter" }, WAIT));
    const dialog = await screen.findByRole("dialog", undefined, WAIT);
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve & issue" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /services/requests/s1/resolve");
      expect(call).toBeTruthy();
    }, WAIT);
  }, TEST_TIMEOUT);

  it("acknowledges a policy, files a compliance return and adds a standard filing", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=hr&m=policies");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Org-wide acknowledgment", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    const table = screen.getByRole("table", { name: "HR policies" });
    const posh = within(table).getByText("POSH Policy").closest("tr")!;
    expect(within(posh).getByText("MANDATORY")).toBeTruthy();
    expect(within(within(table).getByText("Leave Policy").closest("tr")!).getByText("✓ ACKNOWLEDGED")).toBeTruthy();
    fireEvent.click(within(posh).getByRole("button", { name: "Read & Acknowledge" }));
    const ack = await screen.findByRole("dialog", undefined, WAIT);
    expect(await within(ack).findByText(/We keep the workplace free from harassment/, undefined, WAIT)).toBeTruthy();
    fireEvent.click(within(ack).getByRole("button", { name: "I've read & acknowledge" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([i, init]) => routeOf(i, init) === "POST /policies/pl1/acknowledge")).toBe(true), WAIT);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), WAIT);

    fireEvent.click(screen.getByRole("tab", { name: "Compliance Calendar" }));
    const calendar = await screen.findByRole("table", { name: "Compliance calendar" }, WAIT);
    fireEvent.click(within(calendar).getByRole("button", { name: "Mark filed" }));
    const filed = await screen.findByRole("dialog", undefined, WAIT);
    fireEvent.change(within(filed).getByLabelText("Reference"), { target: { value: "ACK-1" } });
    fireEvent.click(within(filed).getByRole("button", { name: "Mark filed" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /compliance/c1/done");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ reference: "ACK-1", note: null });
    }, WAIT);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), WAIT);

    fireEvent.click(screen.getByRole("button", { name: "Standard filings · 1" }));
    const templates = await screen.findByRole("dialog", undefined, WAIT);
    fireEvent.click(within(templates).getByRole("button", { name: "Add 1 filing" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /compliance/templates");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ keys: ["esi"] });
    }, WAIT);
  }, TEST_TIMEOUT);

  it("asks for a pending policy acknowledgement on My Profile and opens the policy", async () => {
    overrides["GET /policies/pending"] = { status: 200, body: { policies: [{ id: "pl1", title: "POSH Policy", mandatory: true, version: 2, updated: true }] } };
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Please read and acknowledge the POSH Policy", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review policy →" }));
    expect(await screen.findByText("Updated since you acknowledged version 1", undefined, WAIT)).toBeTruthy();
    expect(screen.getByRole("article", { name: "POSH Policy" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Acknowledgements · 1/2" }));
    const register = await screen.findByRole("table", { name: "Acknowledgements" }, WAIT);
    expect(within(register).getByText("PENDING · SIGNED V1")).toBeTruthy();
  }, TEST_TIMEOUT);

  it("lists sales documents and turns a delivered sales order into a draft invoice", async () => {
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=salesbilling");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Sales orders (MTD)", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("Ready to invoice")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "POS Counter" })).toBeNull();
    const table = screen.getByRole("table", { name: "Sales documents" });
    expect(within(table).getByText("SALES ORDER")).toBeTruthy();
    expect(within(table).getByText("CHALLAN")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Filter sales documents" })).getByRole("button", { name: "Ready to invoice · 1" }));
    expect(within(table).queryByText("DC/26-27/0001")).toBeNull();
    fireEvent.click(within(table).getByText("SO/26-27/0001"));

    const paper = await screen.findByRole("article", { name: "Sales order preview" }, WAIT);
    expect(within(paper).getByText("SALES ORDER")).toBeTruthy();
    expect(within(paper).getByText("PO-77")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create delivery challan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([i, init]) => routeOf(i, init) === "POST /sales/docs/sd1/invoice")).toBe(true), WAIT);
    expect(await screen.findByRole("article", { name: "Invoice preview" }, WAIT)).toBeTruthy();
    expect(unmatched).toEqual([]);
  }, TEST_TIMEOUT);

  it("rings up a counter bill once the POS switch is on", async () => {
    overrides["GET /sales/overview"] = { status: 200, body: { ...(ROUTES["GET /sales/overview"] as object), pos: { enabled: true, count: 0, total: 0, byMethod: { cash: 0, upi: 0, card: 0 } } } };
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=salesbilling");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("POS billing today", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "POS Counter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Solar panel 540W, ₹14,500" }, WAIT));
    fireEvent.click(screen.getByRole("button", { name: "One more Solar panel 540W" }));
    expect(screen.getByLabelText("Quantity of Solar panel 540W").textContent).toBe("2");
    fireEvent.click(screen.getByRole("tab", { name: "UPI" }));
    fireEvent.change(screen.getByLabelText("UPI reference"), { target: { value: "UPI-881" } });
    fireEvent.click(screen.getByRole("button", { name: "Charge ₹32,480.00" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /sales/pos");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ method: "upi", reference: "UPI-881", partyName: null, lines: [{ description: "Solar panel 540W", quantity: 2, rate: 14500, taxRate: 12 }] });
    }, WAIT);
    expect(await screen.findByRole("button", { name: "Print receipt" }, WAIT)).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Invoice preview" })).getByText("INV/26-27/0002")).toBeTruthy();
    expect(unmatched).toEqual([]);
  }, TEST_TIMEOUT);

  it("finds an older paid invoice beyond the list cap", async () => {
    overrides["GET /invoices"] = { status: 200, body: { invoices: [invoice], truncated: true, month: { count: 3, total: 5000 } } };
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=invoices");
    render(<BosApp mode="tool" />);
    expect(await screen.findByText(/plus the latest 1,000 paid or void/, undefined, WAIT)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search invoices"), { target: { value: "INV/24" } });
    const older = { ...invoice, id: "i0", invoiceNo: "INV/24-25/0007", status: "paid", displayStatus: "paid", amountPaid: invoice.grandTotal, balance: 0 };
    overrides["GET /invoices"] = { status: 200, body: { invoices: [older] } };
    fireEvent.click(screen.getByRole("button", { name: "Search older invoices for “INV/24”" }));
    expect(await screen.findByText("INV/24-25/0007", undefined, WAIT)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([i]) => String(i).includes("/invoices?q=INV%2F24"))).toBe(true);
    expect(unmatched).toEqual([]);
  }, TEST_TIMEOUT);

  it("hides Delete draft when the server says the draft isn't the caller's", async () => {
    overrides["GET /invoices/i1"] = { status: 200, body: { invoice: { ...invoice, status: "draft", displayStatus: "draft" }, payments: [], canDelete: false } };
    window.history.replaceState(null, "", "/tools/bos?ws=finance&m=invoices&open=i1");
    render(<BosApp mode="tool" />);
    expect(await screen.findByRole("button", { name: "Issue invoice" }, WAIT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
    expect(unmatched).toEqual([]);
  }, TEST_TIMEOUT);

  it("finishes a repeating task from its deep link and adds a project milestone", async () => {
    const next = { ...task, id: "t2", taskNo: "TSK-0002", dueOn: "2026-10-12", state: "upcoming" };
    overrides["POST /tasks/t1/status"] = { status: 200, body: { task: { ...task, status: "done", state: "done" }, next } };
    overrides["POST /projects/pr1/milestones"] = { status: 201, body: { milestone: { ...milestone, id: "m2", name: "Grid connection", dueOn: "2026-10-20" } } };
    window.history.replaceState(null, "", "/tools/bos?ws=projects&m=tasks&open=t1");
    render(<BosApp mode="tool" />);
    const dialog = await screen.findByRole("dialog", { name: "Install inverter" }, WAIT);
    expect(within(dialog).getByText("EVERY WEEK")).toBeTruthy();
    expect(within(dialog).getByText("Ravi Kumar · Installer")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /tasks/t1/status");
      expect(JSON.parse(String(call![1]!.body))).toEqual({ status: "done" });
    }, WAIT);
    expect(await screen.findByText("Install inverter — the next one has been added.", undefined, WAIT)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "pr1" } });
    expect(await screen.findByText("0 of 1 tasks done", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("Panels installed")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([i]) => String(i).includes("/tasks?projectId=pr1"))).toBe(true);
    fireEvent.change(screen.getByLabelText("New milestone"), { target: { value: "Grid connection" } });
    fireEvent.change(screen.getByLabelText("Milestone due date"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Add milestone" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([i, init]) => routeOf(i, init) === "POST /projects/pr1/milestones");
      expect(JSON.parse(String(call![1]!.body))).toEqual({ name: "Grid connection", dueOn: "2026-10-20" });
    }, WAIT);
    expect(unmatched).toEqual([]);
  }, TEST_TIMEOUT);

  it("shows My Tasks on Home only to people who have tasks", async () => {
    overrides["GET /tasks/summary"] = {
      status: 200,
      body: { today: "2026-10-05", totals: { open: 2, todo: 1, inProgress: 1, onHold: 0, overdue: 1, dueToday: 0, recurring: 0, doneRecent: 0 }, upcoming: [{ ...task, state: "overdue", dueOn: "2026-10-03" }], progress: {} },
    };
    render(<BosApp mode="tool" />);
    await ready();
    expect(await screen.findByText("✅ My Tasks", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByText("Install inverter"));
    expect(await screen.findByRole("dialog", { name: "Install inverter" }, WAIT)).toBeTruthy();
    expect(unmatched).toEqual([]);
  }, TEST_TIMEOUT);

  it("explains a pending migration instead of failing", async () => {
    overrides["GET /session"] = { status: 503, body: { error: "BOS tables are not installed yet", code: "BOS_SCHEMA_PENDING" } };
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Justx BOS is being set up", undefined, WAIT)).toBeTruthy();
  }, TEST_TIMEOUT);

  it("tells users of an org that hasn't enabled BOS how to turn it on", async () => {
    overrides["GET /session"] = { status: 403, body: { error: "Justx BOS isn't enabled for this organization yet.", code: "BOS_NOT_ENABLED" } };
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Justx BOS isn't enabled yet", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText(/Admin → Tools/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  }, TEST_TIMEOUT);
});
