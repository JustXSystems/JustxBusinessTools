/**
 * JustTestX narrative: a Bengaluru IT services company (mirrors Justx Systems shape).
 * Data window = rolling 1 year ending today (Asia/Kolkata).
 */
import {
  SYSTEM_ACCOUNTS,
} from "../../src/bos/accounting-logic.js";
import {
  computeInvoiceTotals,
  todayISO,
  type BosLineInput,
} from "../../src/bos/logic.js";
import {
  computePayslip,
  structureFromCtc,
  type PayrollConfig,
} from "../../src/bos/payroll-logic.js";
import {
  addDays,
  addMonths,
  daysInMonth,
  eachDate,
  eachMonth,
  fiscalYearLabel,
  formatDocNo,
  fingerprint,
  tid,
  weekday,
  COMPANY,
  GSTIN,
  PAN,
} from "./lib.js";

export const TODAY = todayISO(new Date(), "Asia/Kolkata");
export const WINDOW_START = addDays(TODAY, -365);

export const OWNER_EMAIL = process.env.JUSTTESTX_EMAIL ?? "santhosh.hs@justxsystems.com";
export const OWNER_PASSWORD = process.env.JUSTTESTX_PASSWORD ?? "Justx@2026";
export const OWNER_NAME = "Santhosh HS";

export const PAYROLL_CONFIG: PayrollConfig = {
  basicPct: 50,
  hraPct: 40,
  pfEnabled: true,
  pfCapWage: true,
  esiEnabled: true,
  ptSlabs: [
    { from: 0, amount: 0 },
    { from: 15_000, amount: 200 },
  ],
  unmarkedPaid: true,
};

export const PROFILE = {
  businessName: COMPANY,
  gstin: GSTIN,
  pan: PAN,
  addressLine1: "4th Floor, JustTestX Hub, Indiranagar",
  addressLine2: "100 Feet Road, Bengaluru 560038",
  state: "Karnataka",
  stateCode: "29",
  phone: "+91 80 4567 2100",
  email: "ops@justtestx.example",
  bankName: "HDFC Bank",
  bankBranch: "Indiranagar",
  bankAccount: "50200011223344",
  bankIfsc: "HDFC0001234",
  bankUpi: "justtestx@hdfcbank",
  terms: "Payment due within 15 days. Delayed payments attract 1.5% per month interest.",
  homeToolIds: ["bos", "quotationv1", "sitesurveyv1"],
};

export const BOS_SETTINGS = {
  companyName: COMPANY,
  gstin: GSTIN,
  state: "Karnataka",
  stateCode: "29",
  address: `${PROFILE.addressLine1}, ${PROFILE.addressLine2}`,
  email: PROFILE.email,
  phone: PROFILE.phone,
  invoicePrefix: "JTX",
  employeePrefix: "JTX",
  fiscalYearStart: 4,
  defaultTaxRate: 18,
  paymentTermsDays: 15,
  invoiceNotes: "Thank you for choosing JustTestX. Support: support@justtestx.example",
  weekendDays: "0",
  leavePolicy: { casual: 12, sick: 10, earned: 18, lop: 0 },
  autoSync: 1,
};

export type DeptDef = { key: string; name: string; code: string };
export const DEPARTMENTS: DeptDef[] = [
  { key: "leadership", name: "Leadership", code: "LDR" },
  { key: "engineering", name: "Engineering", code: "ENG" },
  { key: "product", name: "Product", code: "PRD" },
  { key: "delivery", name: "Delivery", code: "DEL" },
  { key: "sales", name: "Sales", code: "SLS" },
  { key: "finance", name: "Finance", code: "FIN" },
  { key: "people", name: "People Ops", code: "PPL" },
  { key: "success", name: "Customer Success", code: "CS" },
];

export type EmpDef = {
  key: string;
  code: string;
  first: string;
  last: string;
  email: string;
  phone: string;
  designation: string;
  dept: string;
  manager?: string;
  type: "full_time" | "part_time" | "contract" | "intern";
  status: "active" | "probation" | "notice" | "exited";
  join: string;
  exit?: string;
  ctc: number;
  location: string;
  dob: string;
  linkOwner?: boolean;
};

export const EMPLOYEES: EmpDef[] = [
  { key: "santhosh", code: "JTX-0001", first: "Santhosh", last: "HS", email: OWNER_EMAIL, phone: "+91 98765 01001", designation: "Founder & CEO", dept: "leadership", type: "full_time", status: "active", join: "2024-04-01", ctc: 3_600_000, location: "Bengaluru", dob: "1988-06-14", linkOwner: true },
  { key: "priya", code: "JTX-0002", first: "Priya", last: "Nair", email: "priya.nair@justtestx.example", phone: "+91 98765 01002", designation: "COO", dept: "leadership", manager: "santhosh", type: "full_time", status: "active", join: "2024-06-01", ctc: 2_800_000, location: "Bengaluru", dob: "1990-02-21" },
  { key: "arjun", code: "JTX-0003", first: "Arjun", last: "Mehta", email: "arjun.mehta@justtestx.example", phone: "+91 98765 01003", designation: "CTO", dept: "engineering", manager: "santhosh", type: "full_time", status: "active", join: "2024-07-15", ctc: 3_200_000, location: "Bengaluru", dob: "1987-11-03" },
  { key: "kavya", code: "JTX-0004", first: "Kavya", last: "Reddy", email: "kavya.reddy@justtestx.example", phone: "+91 98765 01004", designation: "Engineering Manager", dept: "engineering", manager: "arjun", type: "full_time", status: "active", join: "2024-09-01", ctc: 2_400_000, location: "Bengaluru", dob: "1992-08-19" },
  { key: "rohan", code: "JTX-0005", first: "Rohan", last: "Shah", email: "rohan.shah@justtestx.example", phone: "+91 98765 01005", designation: "Senior Full-Stack Engineer", dept: "engineering", manager: "kavya", type: "full_time", status: "active", join: "2024-10-01", ctc: 2_100_000, location: "Bengaluru", dob: "1994-01-12" },
  { key: "meera", code: "JTX-0006", first: "Meera", last: "Iyer", email: "meera.iyer@justtestx.example", phone: "+91 98765 01006", designation: "Backend Engineer", dept: "engineering", manager: "kavya", type: "full_time", status: "active", join: "2025-01-06", ctc: 1_680_000, location: "Bengaluru", dob: "1996-05-28" },
  { key: "vikram", code: "JTX-0007", first: "Vikram", last: "Das", email: "vikram.das@justtestx.example", phone: "+91 98765 01007", designation: "Frontend Engineer", dept: "engineering", manager: "kavya", type: "full_time", status: "active", join: "2025-02-10", ctc: 1_560_000, location: "Bengaluru", dob: "1995-09-07" },
  { key: "ananya", code: "JTX-0008", first: "Ananya", last: "Bose", email: "ananya.bose@justtestx.example", phone: "+91 98765 01008", designation: "QA Lead", dept: "delivery", manager: "priya", type: "full_time", status: "active", join: "2024-11-12", ctc: 1_800_000, location: "Bengaluru", dob: "1993-03-30" },
  { key: "nikhil", code: "JTX-0009", first: "Nikhil", last: "Patil", email: "nikhil.patil@justtestx.example", phone: "+91 98765 01009", designation: "DevOps Engineer", dept: "engineering", manager: "arjun", type: "full_time", status: "active", join: "2025-03-03", ctc: 1_920_000, location: "Pune", dob: "1994-12-16" },
  { key: "sneha", code: "JTX-0010", first: "Sneha", last: "Kapoor", email: "sneha.kapoor@justtestx.example", phone: "+91 98765 01010", designation: "Product Manager", dept: "product", manager: "priya", type: "full_time", status: "active", join: "2025-01-20", ctc: 2_200_000, location: "Bengaluru", dob: "1991-07-22" },
  { key: "aditya", code: "JTX-0011", first: "Aditya", last: "Rao", email: "aditya.rao@justtestx.example", phone: "+91 98765 01011", designation: "Sales Manager", dept: "sales", manager: "santhosh", type: "full_time", status: "active", join: "2024-08-01", ctc: 1_800_000, location: "Bengaluru", dob: "1989-04-05" },
  { key: "fatima", code: "JTX-0012", first: "Fatima", last: "Khan", email: "fatima.khan@justtestx.example", phone: "+91 98765 01012", designation: "Account Executive", dept: "sales", manager: "aditya", type: "full_time", status: "active", join: "2025-04-01", ctc: 1_200_000, location: "Hyderabad", dob: "1997-10-11" },
  { key: "lakshmi", code: "JTX-0013", first: "Lakshmi", last: "Venkat", email: "lakshmi.venkat@justtestx.example", phone: "+91 98765 01013", designation: "Finance Controller", dept: "finance", manager: "santhosh", type: "full_time", status: "active", join: "2024-05-15", ctc: 1_680_000, location: "Bengaluru", dob: "1986-08-02" },
  { key: "deepak", code: "JTX-0014", first: "Deepak", last: "Joshi", email: "deepak.joshi@justtestx.example", phone: "+91 98765 01014", designation: "HR Business Partner", dept: "people", manager: "priya", type: "full_time", status: "active", join: "2024-12-01", ctc: 1_440_000, location: "Bengaluru", dob: "1990-12-25" },
  { key: "imran", code: "JTX-0015", first: "Imran", last: "Ali", email: "imran.ali@justtestx.example", phone: "+91 98765 01015", designation: "Support Engineer", dept: "success", manager: "priya", type: "full_time", status: "active", join: "2025-05-12", ctc: 960_000, location: "Bengaluru", dob: "1998-02-14" },
  { key: "tara", code: "JTX-0016", first: "Tara", last: "Menon", email: "tara.menon@justtestx.example", phone: "+91 98765 01016", designation: "Software Intern", dept: "engineering", manager: "kavya", type: "intern", status: "probation", join: "2026-07-01", ctc: 360_000, location: "Bengaluru", dob: "2003-06-18" },
  { key: "rahul", code: "JTX-0017", first: "Rahul", last: "Verma", email: "rahul.verma@justtestx.example", phone: "+91 98765 01017", designation: "Contract UI Designer", dept: "product", manager: "sneha", type: "contract", status: "exited", join: "2025-06-01", exit: "2026-03-31", ctc: 1_080_000, location: "Remote", dob: "1993-09-09" },
];

export type PartyDef = {
  key: string;
  kind: "customer" | "vendor" | "both";
  name: string;
  company: string;
  gstin: string | null;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  notes?: string;
};

export const PARTIES: PartyDef[] = [
  { key: "cascade", kind: "customer", name: "Cascade Fintech", company: "Cascade Fintech Pvt Ltd", gstin: "29CACAD1234F1Z2", email: "ap@cascadefintech.example", phone: "+91 80 2222 1001", address: "Koramangala, Bengaluru", city: "Bengaluru", state: "Karnataka", notes: "AMS + product engineering retainer" },
  { key: "meridian", kind: "customer", name: "Meridian Retail", company: "Meridian Retail Pvt Ltd", gstin: "29MERID5678G1Z3", email: "it@meridianretail.example", phone: "+91 80 3333 2002", address: "Whitefield, Bengaluru", city: "Bengaluru", state: "Karnataka" },
  { key: "bluepeak", kind: "customer", name: "BluePeak Logistics", company: "BluePeak Logistics Ltd", gstin: "27BLUEP9012H1Z4", email: "projects@bluepeak.example", phone: "+91 22 4444 3003", address: "Andheri East, Mumbai", city: "Mumbai", state: "Maharashtra", notes: "Inter-state — IGST invoices" },
  { key: "northwind", kind: "customer", name: "Northwind Hospitals", company: "Northwind Hospitals Pvt Ltd", gstin: "07NORTH3456I1Z5", email: "cio@northwind.example", phone: "+91 11 5555 4004", address: "Saket, New Delhi", city: "New Delhi", state: "Delhi" },
  { key: "oriole", kind: "customer", name: "Oriole Manufacturing", company: "Oriole Manufacturing Ltd", gstin: "33ORIOL7890J1Z6", email: "digital@oriole.example", phone: "+91 44 6666 5005", address: "Guindy, Chennai", city: "Chennai", state: "Tamil Nadu" },
  { key: "harbor", kind: "customer", name: "Harbor Education", company: "Harbor Education Trust", gstin: "29HARBO2345K1Z7", email: "tech@harboredu.example", phone: "+91 80 7777 6006", address: "Jayanagar, Bengaluru", city: "Bengaluru", state: "Karnataka" },
  { key: "zenith", kind: "customer", name: "Zenith AgriTech", company: "Zenith AgriTech Pvt Ltd", gstin: "24ZENIT6789L1Z8", email: "ops@zenithagri.example", phone: "+91 79 8888 7007", address: "SG Highway, Ahmedabad", city: "Ahmedabad", state: "Gujarat" },
  { key: "pixelforge", kind: "customer", name: "PixelForge Media", company: "PixelForge Media LLP", gstin: null, email: "hello@pixelforge.example", phone: "+91 80 9999 8008", address: "HSR Layout, Bengaluru", city: "Bengaluru", state: "Karnataka", notes: "Unregistered — composition / B2C style" },
  { key: "aws", kind: "vendor", name: "Amazon Web Services", company: "Amazon Internet Services Pvt Ltd", gstin: "29AAACA0000A1Z9", email: "billing@aws.example", phone: "+91 80 1111 9001", address: "Bengaluru", city: "Bengaluru", state: "Karnataka" },
  { key: "office", kind: "vendor", name: "Indira Workspace", company: "Indira Workspace Pvt Ltd", gstin: "29INDWK1111B1Z0", email: "accounts@indiraworkspace.example", phone: "+91 80 2222 9002", address: "Indiranagar, Bengaluru", city: "Bengaluru", state: "Karnataka" },
  { key: "compu", kind: "vendor", name: "Compuworld", company: "Compuworld Systems", gstin: "29COMPU2222C1Z1", email: "sales@compuworld.example", phone: "+91 80 3333 9003", address: "MG Road, Bengaluru", city: "Bengaluru", state: "Karnataka" },
  { key: "jio", kind: "vendor", name: "Jio Business", company: "Reliance Jio Infocomm", gstin: "27JIOTP3333D1Z2", email: "enterprise@jio.example", phone: "+91 22 4444 9004", address: "Mumbai", city: "Mumbai", state: "Maharashtra" },
  { key: "ca", kind: "vendor", name: "Ramesh & Co CA", company: "Ramesh & Co Chartered Accountants", gstin: "29RAMCA4444E1Z3", email: "ramesh@cacafirm.example", phone: "+91 80 5555 9005", address: "Church Street, Bengaluru", city: "Bengaluru", state: "Karnataka" },
  { key: "travelco", kind: "vendor", name: "Skyline Travels", company: "Skyline Travels Pvt Ltd", gstin: "29SKYLN5555F1Z4", email: "corp@skylinetvl.example", phone: "+91 80 6666 9006", address: "Bengaluru", city: "Bengaluru", state: "Karnataka" },
];

export type ItemDef = { key: string; name: string; sku: string; kind: "goods" | "service"; hsn: string; unit: string; rate: number; tax: number };
export const CATALOG: ItemDef[] = [
  { key: "ams", name: "Application Managed Services (monthly)", sku: "SVC-AMS-M", kind: "service", hsn: "998314", unit: "Month", rate: 2_50_000, tax: 18 },
  { key: "custom", name: "Custom software development", sku: "SVC-DEV-D", kind: "service", hsn: "998314", unit: "Day", rate: 12_000, tax: 18 },
  { key: "cloud", name: "Cloud migration & landing zone", sku: "SVC-CLD-P", kind: "service", hsn: "998314", unit: "Project", rate: 8_50_000, tax: 18 },
  { key: "staff", name: "Staff augmentation — senior engineer", sku: "SVC-AUG-M", kind: "service", hsn: "998314", unit: "Month", rate: 1_80_000, tax: 18 },
  { key: "support", name: "L2/L3 support retainer", sku: "SVC-SUP-M", kind: "service", hsn: "998313", unit: "Month", rate: 75_000, tax: 18 },
  { key: "impl", name: "ERP / BOS implementation", sku: "SVC-IMPL-P", kind: "service", hsn: "998314", unit: "Project", rate: 12_00_000, tax: 18 },
  { key: "train", name: "Onsite training workshop", sku: "SVC-TRN-D", kind: "service", hsn: "999293", unit: "Day", rate: 35_000, tax: 18 },
  { key: "license", name: "JustTestX Ops Suite license", sku: "LIC-OPS-Y", kind: "service", hsn: "997331", unit: "Year", rate: 4_80_000, tax: 18 },
  { key: "laptop", name: "Developer laptop kit", sku: "HW-LAP-1", kind: "goods", hsn: "8471", unit: "Nos", rate: 95_000, tax: 18 },
  { key: "pos", name: "Quick support visit (POS)", sku: "POS-VISIT", kind: "service", hsn: "998313", unit: "Visit", rate: 2_500, tax: 18 },
];

export const HOLIDAYS: Array<{ date: string; name: string }> = [
  { date: "2025-10-02", name: "Gandhi Jayanti" },
  { date: "2025-10-20", name: "Diwali" },
  { date: "2025-10-21", name: "Diwali (company)" },
  { date: "2025-12-25", name: "Christmas" },
  { date: "2026-01-01", name: "New Year" },
  { date: "2026-01-15", name: "Makar Sankranti" },
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-14", name: "Holi" },
  { date: "2026-04-14", name: "Ambedkar Jayanti" },
  { date: "2026-05-01", name: "May Day" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-08-27", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-10-20", name: "Diwali" },
];

const holidaySet = new Set(HOLIDAYS.map((h) => h.date));

export function deptId(key: string) {
  return tid(`dept:${key}`);
}
export function empId(key: string) {
  return tid(`emp:${key}`);
}
export function partyId(key: string) {
  return tid(`party:${key}`);
}
export function itemId(key: string) {
  return tid(`item:${key}`);
}

function isWorkingDay(date: string): boolean {
  const w = weekday(date);
  return w !== 0 && w !== 6 && !holidaySet.has(date);
}

function intra(state: string): boolean {
  return state.trim().toLowerCase() === "karnataka";
}

function linesFrom(...inputs: BosLineInput[]) {
  return inputs;
}

export type BuiltInvoice = {
  id: string;
  no: string;
  partyKey: string;
  issue: string;
  due: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  place: string;
  lines: BosLineInput[];
  notes?: string;
  paidAmount?: number;
  paidOn?: string;
  method?: string;
  sourceTool?: string | null;
};

/** Monthly retainers + milestone / one-off invoices across the year. */
export function buildInvoices(): BuiltInvoice[] {
  const out: BuiltInvoice[] = [];
  let seqByFy = new Map<string, number>();
  const nextNo = (date: string) => {
    const fy = fiscalYearLabel(date);
    const n = (seqByFy.get(fy) ?? 0) + 1;
    seqByFy.set(fy, n);
    return { fy, no: formatDocNo(BOS_SETTINGS.invoicePrefix, fy, n), seq: n };
  };

  const push = (inv: Omit<BuiltInvoice, "id" | "no"> & { key: string }) => {
    const { no } = nextNo(inv.issue);
    out.push({ ...inv, id: tid(`inv:${inv.key}`), no });
  };

  // Cascade AMS retainer — every month in window
  for (const ym of eachMonth(WINDOW_START.slice(0, 7), TODAY.slice(0, 7))) {
    const issue = `${ym}-05`;
    if (issue < WINDOW_START || issue > TODAY) continue;
    const due = addDays(issue, 15);
    const paid = issue < addMonths(TODAY, -1);
    const partial = !paid && issue < addDays(TODAY, -20);
    push({
      key: `cascade-ams-${ym}`,
      partyKey: "cascade",
      issue,
      due,
      status: paid ? "paid" : partial ? "partial" : "sent",
      place: "Karnataka",
      lines: linesFrom({ description: "Application Managed Services — Cascade Fintech", hsn: "998314", unit: "Month", quantity: 1, rate: 2_50_000, taxRate: 18 }),
      notes: `Retainer for ${ym}`,
      paidAmount: paid ? undefined : partial ? 1_50_000 : 0,
      paidOn: paid ? addDays(issue, 10) : partial ? addDays(issue, 12) : undefined,
      method: "bank",
    });
  }

  // Meridian support retainer
  for (const ym of eachMonth(WINDOW_START.slice(0, 7), TODAY.slice(0, 7))) {
    const issue = `${ym}-08`;
    if (issue < WINDOW_START || issue > TODAY) continue;
    const paid = issue <= addMonths(TODAY, -1);
    push({
      key: `meridian-sup-${ym}`,
      partyKey: "meridian",
      issue,
      due: addDays(issue, 15),
      status: paid ? "paid" : "sent",
      place: "Karnataka",
      lines: linesFrom({ description: "L2/L3 support retainer — Meridian Retail", hsn: "998313", unit: "Month", quantity: 1, rate: 75_000, taxRate: 18 }),
      paidOn: paid ? addDays(issue, 8) : undefined,
      method: "upi",
    });
  }

  // BluePeak — cloud migration milestones (IGST)
  const bluePeaks = [
    { key: "bp-1", issue: "2025-11-15", rate: 4_25_000, status: "paid" as const },
    { key: "bp-2", issue: "2026-01-20", rate: 4_25_000, status: "paid" as const },
    { key: "bp-3", issue: "2026-04-10", rate: 2_00_000, status: "partial" as const, paidAmount: 1_00_000 },
    { key: "bp-4", issue: "2026-09-12", rate: 1_50_000, status: "sent" as const },
  ];
  for (const bp of bluePeaks) {
    if (bp.issue < WINDOW_START || bp.issue > TODAY) continue;
    push({
      key: bp.key,
      partyKey: "bluepeak",
      issue: bp.issue,
      due: addDays(bp.issue, 30),
      status: bp.status,
      place: "Maharashtra",
      lines: linesFrom({ description: "Cloud migration milestone — BluePeak Logistics", hsn: "998314", unit: "Project", quantity: 1, rate: bp.rate, taxRate: 18 }),
      paidAmount: bp.paidAmount,
      paidOn: bp.status === "paid" || bp.status === "partial" ? addDays(bp.issue, 14) : undefined,
      method: "bank",
    });
  }

  // Northwind implementation
  push({
    key: "nw-impl",
    partyKey: "northwind",
    issue: "2026-02-28",
    due: "2026-03-30",
    status: "paid",
    place: "Delhi",
    lines: linesFrom(
      { description: "BOS / ERP implementation — Northwind Hospitals", hsn: "998314", unit: "Project", quantity: 1, rate: 12_00_000, taxRate: 18, discountPct: 5 },
      { description: "Onsite training workshop (5 days)", hsn: "999293", unit: "Day", quantity: 5, rate: 35_000, taxRate: 18 },
    ),
    paidOn: "2026-03-18",
    method: "bank",
  });

  // Oriole staff aug
  for (const ym of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) {
    const issue = `${ym}-12`;
    if (issue > TODAY) continue;
    push({
      key: `oriole-aug-${ym}`,
      partyKey: "oriole",
      issue,
      due: addDays(issue, 15),
      status: ym < TODAY.slice(0, 7) ? "paid" : "sent",
      place: "Tamil Nadu",
      lines: linesFrom({ description: "Staff augmentation — senior engineer", hsn: "998314", unit: "Month", quantity: 1, rate: 1_80_000, taxRate: 18 }),
      paidOn: ym < TODAY.slice(0, 7) ? addDays(issue, 9) : undefined,
      method: "bank",
    });
  }

  // Harbor license + overdue
  push({
    key: "harbor-lic",
    partyKey: "harbor",
    issue: "2026-06-01",
    due: "2026-06-16",
    status: "sent",
    place: "Karnataka",
    lines: linesFrom({ description: "JustTestX Ops Suite annual license", hsn: "997331", unit: "Year", quantity: 1, rate: 4_80_000, taxRate: 18 }),
    notes: "Renewal — follow up overdue",
  });

  // Zenith custom days
  push({
    key: "zenith-dev",
    partyKey: "zenith",
    issue: "2026-08-20",
    due: "2026-09-04",
    status: "partial",
    place: "Gujarat",
    lines: linesFrom({ description: "Custom software development (22 billable days)", hsn: "998314", unit: "Day", quantity: 22, rate: 12_000, taxRate: 18 }),
    paidAmount: 1_50_000,
    paidOn: "2026-09-01",
    method: "bank",
  });

  // PixelForge small + draft + void scenarios
  push({
    key: "pixel-paid",
    partyKey: "pixelforge",
    issue: "2026-07-04",
    due: "2026-07-19",
    status: "paid",
    place: "Karnataka",
    lines: linesFrom({ description: "Landing page + CMS setup", hsn: "998314", unit: "Project", quantity: 1, rate: 95_000, taxRate: 18 }),
    paidOn: "2026-07-10",
    method: "upi",
  });
  push({
    key: "pixel-draft",
    partyKey: "pixelforge",
    issue: TODAY,
    due: addDays(TODAY, 15),
    status: "draft",
    place: "Karnataka",
    lines: linesFrom({ description: "Q4 feature sprint estimate", hsn: "998314", unit: "Day", quantity: 10, rate: 12_000, taxRate: 18 }),
  });
  push({
    key: "pixel-void",
    partyKey: "pixelforge",
    issue: "2026-03-05",
    due: "2026-03-20",
    status: "void",
    place: "Karnataka",
    lines: linesFrom({ description: "Duplicate invoice — voided", hsn: "998314", unit: "Project", quantity: 1, rate: 40_000, taxRate: 18 }),
  });

  // POS day bills (source_tool = pos)
  for (let i = 0; i < 8; i++) {
    const issue = addDays(TODAY, -i);
    if (!isWorkingDay(issue) && i > 0) continue;
    push({
      key: `pos-${issue}`,
      partyKey: "pixelforge",
      issue,
      due: issue,
      status: "paid",
      place: "Karnataka",
      lines: linesFrom({ description: "Quick support visit", hsn: "998313", unit: "Visit", quantity: 1, rate: 2_500, taxRate: 18 }),
      paidOn: issue,
      method: "cash",
      sourceTool: "pos",
    });
  }

  return out;
}

export function invoiceMoney(inv: BuiltInvoice) {
  const party = PARTIES.find((p) => p.key === inv.partyKey)!;
  const totals = computeInvoiceTotals(inv.lines, intra(party.state));
  const paid =
    inv.status === "paid"
      ? totals.grandTotal
      : inv.status === "partial"
        ? Math.min(inv.paidAmount ?? 0, totals.grandTotal)
        : 0;
  return { party, totals, paid, intra: intra(party.state) };
}

export type BuiltBill = {
  id: string;
  billNo: string;
  partyKey: string;
  billDate: string;
  dueDate: string;
  category: string;
  amount: number;
  tax: number;
  status: "pending" | "approved" | "rejected" | "paid";
  notes?: string;
  paidOn?: string;
};

export function buildBills(): BuiltBill[] {
  const out: BuiltBill[] = [];
  let n = 0;
  const add = (b: Omit<BuiltBill, "id" | "billNo"> & { key: string }) => {
    n += 1;
    out.push({ ...b, id: tid(`bill:${b.key}`), billNo: `VB-${String(n).padStart(4, "0")}` });
  };

  for (const ym of eachMonth(WINDOW_START.slice(0, 7), TODAY.slice(0, 7))) {
    const d = `${ym}-01`;
    if (d < WINDOW_START) continue;
    add({
      key: `rent-${ym}`,
      partyKey: "office",
      billDate: d,
      dueDate: `${ym}-05`,
      category: "Rent",
      amount: 1_85_000,
      tax: 33_300,
      status: d < addMonths(TODAY, -0) ? "paid" : "approved",
      paidOn: d < TODAY ? `${ym}-03` : undefined,
      notes: "Office lease — Indiranagar hub",
    });
    add({
      key: `aws-${ym}`,
      partyKey: "aws",
      billDate: `${ym}-28`.replace(/-(\d{2})$/, (_, dd) => `-${String(Math.min(Number(dd), daysInMonth(ym))).padStart(2, "0")}`),
      dueDate: addDays(`${ym}-28`, 10),
      category: "Cloud hosting",
      amount: 42_000 + ((Number(ym.slice(5)) * 1373) % 18_000),
      tax: 0,
      status: ym < TODAY.slice(0, 7) ? "paid" : "pending",
      paidOn: ym < TODAY.slice(0, 7) ? addDays(`${ym}-28`, 5) : undefined,
    });
  }

  add({ key: "laptops", partyKey: "compu", billDate: "2026-04-10", dueDate: "2026-04-25", category: "IT hardware", amount: 4_75_000, tax: 85_500, status: "paid", paidOn: "2026-04-18", notes: "5× developer laptops" });
  add({ key: "jio", partyKey: "jio", billDate: "2026-09-01", dueDate: "2026-09-15", category: "Internet", amount: 18_000, tax: 3_240, status: "approved" });
  add({ key: "ca-q2", partyKey: "ca", billDate: "2026-07-05", dueDate: "2026-07-20", category: "Professional fees", amount: 45_000, tax: 8_100, status: "paid", paidOn: "2026-07-12" });
  add({ key: "travel-bulk", partyKey: "travelco", billDate: "2026-08-22", dueDate: "2026-09-05", category: "Travel", amount: 62_400, tax: 11_232, status: "pending", notes: "Client visits — BluePeak / Oriole" });
  add({ key: "rejected", partyKey: "compu", billDate: "2026-05-02", dueDate: "2026-05-17", category: "IT hardware", amount: 12_000, tax: 2_160, status: "rejected", notes: "Wrong SKU billed — rejected" });

  return out;
}

export type BuiltExpense = {
  id: string;
  empKey: string;
  category: string;
  description: string;
  amount: number;
  spentOn: string;
  status: "submitted" | "approved" | "rejected" | "reimbursed";
};

export function buildExpenses(): BuiltExpense[] {
  const samples: Array<Omit<BuiltExpense, "id">> = [
    { empKey: "aditya", category: "Travel", description: "Cab to BluePeak kickoff — Mumbai", amount: 4_820, spentOn: "2025-11-12", status: "reimbursed" },
    { empKey: "fatima", category: "Travel", description: "Hyderabad client dinner", amount: 3_450, spentOn: "2026-05-18", status: "reimbursed" },
    { empKey: "nikhil", category: "Cloud tools", description: "Personal AWS sandbox (reimbursable)", amount: 2_100, spentOn: "2026-06-03", status: "approved" },
    { empKey: "rohan", category: "Meals", description: "Team sprint dinner", amount: 6_800, spentOn: "2026-07-22", status: "reimbursed" },
    { empKey: "sneha", category: "Software", description: "Figma annual seat", amount: 14_400, spentOn: "2026-08-01", status: "approved" },
    { empKey: "imran", category: "Travel", description: "Onsite support — Meridian Whitefield", amount: 780, spentOn: "2026-09-14", status: "submitted" },
    { empKey: "kavya", category: "Training", description: "KubeCon India ticket", amount: 18_000, spentOn: "2026-09-28", status: "submitted" },
    { empKey: "vikram", category: "Meals", description: "Duplicate claim — rejected", amount: 1_200, spentOn: "2026-04-04", status: "rejected" },
    { empKey: "meera", category: "Internet", description: "WFH broadband top-up", amount: 999, spentOn: addDays(TODAY, -3), status: "submitted" },
    { empKey: "priya", category: "Travel", description: "Delhi — Northwind go-live", amount: 22_500, spentOn: "2026-02-20", status: "reimbursed" },
  ];
  return samples.map((s) => ({ ...s, id: tid(`exp:${s.empKey}:${s.spentOn}:${s.description}`) }));
}

export function buildAttendance(): Array<{ empKey: string; date: string; status: string; checkIn: string | null; checkOut: string | null }> {
  const rows: Array<{ empKey: string; date: string; status: string; checkIn: string | null; checkOut: string | null }> = [];
  for (const emp of EMPLOYEES) {
    const from = emp.join > WINDOW_START ? emp.join : WINDOW_START;
    const to = emp.exit && emp.exit < TODAY ? emp.exit : TODAY;
    let i = 0;
    for (const date of eachDate(from, to)) {
      i += 1;
      if (!isWorkingDay(date)) continue;
      // Sparse realistic mix
      const mod = (i + emp.code.charCodeAt(4)) % 37;
      let status = "present";
      if (mod === 0) status = "wfh";
      if (mod === 1) status = "half_day";
      if (mod === 2) status = "absent";
      if (holidaySet.has(date)) status = "holiday";
      rows.push({
        empKey: emp.key,
        date,
        status,
        checkIn: status === "present" || status === "wfh" || status === "half_day" ? "09:35:00" : null,
        checkOut: status === "present" || status === "wfh" ? "18:40:00" : status === "half_day" ? "13:30:00" : null,
      });
    }
  }
  return rows;
}

export function buildLeaves(): Array<{
  id: string;
  empKey: string;
  type: string;
  from: string;
  to: string;
  days: number;
  half: number;
  reason: string;
  status: string;
}> {
  const rows = [
    { empKey: "rohan", type: "casual", from: "2026-01-08", to: "2026-01-09", days: 2, half: 0, reason: "Family function", status: "approved" },
    { empKey: "meera", type: "sick", from: "2026-03-11", to: "2026-03-12", days: 2, half: 0, reason: "Fever", status: "approved" },
    { empKey: "vikram", type: "earned", from: "2026-05-19", to: "2026-05-23", days: 5, half: 0, reason: "Vacation", status: "approved" },
    { empKey: "fatima", type: "casual", from: "2026-08-04", to: "2026-08-04", days: 0.5, half: 1, reason: "Bank work", status: "approved" },
    { empKey: "imran", type: "casual", from: addDays(TODAY, 5), to: addDays(TODAY, 6), days: 2, half: 0, reason: "Personal", status: "pending" },
    { empKey: "tara", type: "sick", from: addDays(TODAY, -2), to: addDays(TODAY, -2), days: 1, half: 0, reason: "Migraine", status: "pending" },
    { empKey: "nikhil", type: "lop", from: "2026-06-16", to: "2026-06-16", days: 1, half: 0, reason: "Unplanned absence", status: "approved" },
    { empKey: "ananya", type: "casual", from: "2026-02-14", to: "2026-02-14", days: 1, half: 0, reason: "Rejected — peak release", status: "rejected" },
  ];
  return rows.map((r) => ({ ...r, id: tid(`leave:${r.empKey}:${r.from}`) }));
}

export function buildProjects() {
  return [
    { key: "cascade-ams", name: "Cascade Fintech — AMS", partyKey: "cascade", status: "active", value: 30_00_000, start: "2025-10-01", due: "2026-12-31", site: "Bengaluru / remote", notes: "24×7 AMS with monthly steering" },
    { key: "bluepeak-cloud", name: "BluePeak — Cloud landing zone", partyKey: "bluepeak", status: "active", value: 12_00_000, start: "2025-11-01", due: "2026-10-31", site: "Mumbai DC + AWS", notes: "Migration in waves" },
    { key: "northwind-bos", name: "Northwind — BOS implementation", partyKey: "northwind", status: "completed", value: 14_00_000, start: "2025-12-01", due: "2026-03-15", site: "New Delhi", notes: "Went live Feb 2026" },
    { key: "oriole-aug", name: "Oriole — Staff augmentation", partyKey: "oriole", status: "active", value: 10_80_000, start: "2026-05-01", due: "2026-12-31", site: "Chennai hybrid" },
    { key: "harbor-ops", name: "Harbor — Ops Suite rollout", partyKey: "harbor", status: "on_hold", value: 4_80_000, start: "2026-06-01", due: "2026-11-30", site: "Bengaluru", notes: "Waiting on license payment" },
    { key: "zenith-app", name: "Zenith — Field app rebuild", partyKey: "zenith", status: "planned", value: 9_50_000, start: "2026-09-01", due: "2027-02-28", site: "Ahmedabad" },
    { key: "pixel-web", name: "PixelForge — Marketing site", partyKey: "pixelforge", status: "completed", value: 95_000, start: "2026-06-15", due: "2026-07-10", site: "Remote" },
    { key: "lead-retail", name: "Prospect — Omnichannel retail OS", partyKey: "meridian", status: "lead", value: 25_00_000, start: null, due: null, site: "Bengaluru", notes: "Discovery workshop scheduled" },
    { key: "cancelled-poc", name: "PoC — AI ticket triage", partyKey: "cascade", status: "cancelled", value: 1_50_000, start: "2026-01-10", due: "2026-02-10", site: "Remote", notes: "Budget pulled" },
  ].map((p) => ({ ...p, id: tid(`proj:${p.key}`) }));
}

export function buildTasks(projects: ReturnType<typeof buildProjects>) {
  const byKey = Object.fromEntries(projects.map((p) => [p.key, p]));
  const defs = [
    { key: "t1", project: "cascade-ams", title: "October AMS report", status: "done", priority: "normal", assignee: "imran", start: "2026-10-01", due: "2026-10-07" },
    { key: "t2", project: "cascade-ams", title: "Patch Cascade API gateway", status: "in_progress", priority: "high", assignee: "rohan", start: "2026-10-15", due: "2026-10-28" },
    { key: "t3", project: "bluepeak-cloud", title: "Wave-3 cutover checklist", status: "todo", priority: "urgent", assignee: "nikhil", start: "2026-10-20", due: "2026-10-30" },
    { key: "t4", project: "oriole-aug", title: "Oriole sprint planning", status: "done", priority: "normal", assignee: "kavya", start: "2026-10-06", due: "2026-10-08" },
    { key: "t5", project: "harbor-ops", title: "Unblock license payment", status: "on_hold", priority: "high", assignee: "aditya", start: "2026-09-01", due: "2026-10-15" },
    { key: "t6", project: "zenith-app", title: "Discovery workshop agenda", status: "todo", priority: "normal", assignee: "sneha", start: "2026-10-22", due: "2026-11-05" },
    { key: "t7", project: "northwind-bos", title: "Post-go-live warranty bugs", status: "done", priority: "normal", assignee: "meera", start: "2026-03-16", due: "2026-04-15" },
    { key: "t8", project: null, title: "Renew AWS support plan", status: "todo", priority: "high", assignee: "lakshmi", start: TODAY, due: addDays(TODAY, 14) },
    { key: "t9", project: "cascade-ams", title: "Cancelled — obsolete runbook", status: "cancelled", priority: "low", assignee: "imran", start: "2026-08-01", due: "2026-08-05" },
  ];
  const milestones = [
    { key: "m1", project: "bluepeak-cloud", name: "Landing zone ready", due: "2026-01-31", status: "done" },
    { key: "m2", project: "bluepeak-cloud", name: "Wave-3 production", due: "2026-10-31", status: "open" },
    { key: "m3", project: "northwind-bos", name: "Go-live", due: "2026-02-28", status: "done" },
    { key: "m4", project: "zenith-app", name: "MVP release", due: "2027-01-15", status: "open" },
  ];
  return {
    milestones: milestones.map((m) => ({ ...m, id: tid(`ms:${m.key}`), projectId: byKey[m.project!]!.id })),
    tasks: defs.map((t, i) => ({
      ...t,
      id: tid(`task:${t.key}`),
      taskNo: `TSK-${String(i + 1).padStart(4, "0")}`,
      projectId: t.project ? byKey[t.project]!.id : null,
    })),
  };
}

export function buildPayroll() {
  const structures = EMPLOYEES.filter((e) => e.status !== "exited" || true).map((e) => {
    const s = structureFromCtc(e.ctc, PAYROLL_CONFIG);
    return {
      empKey: e.key,
      ...s,
      pf: e.type !== "intern",
      pt: e.type !== "intern",
      tdsMonthly: e.ctc >= 1_500_000 ? Math.round(e.ctc / 12 / 20) : null,
      pan: `ABCDE${e.code.replace(/\D/g, "").padStart(4, "0")}F`,
      uan: e.type === "intern" ? null : `100${e.code.replace(/\D/g, "").padStart(9, "0")}`,
    };
  });

  const runs: Array<{
    id: string;
    period: string;
    status: "draft" | "finalized" | "paid";
    paidOn: string | null;
    slips: Array<Record<string, unknown>>;
    totals: { employees: number; gross: number; ded: number; net: number; employer: number };
  }> = [];

  for (const ym of eachMonth(WINDOW_START.slice(0, 7), TODAY.slice(0, 7))) {
    if (ym > TODAY.slice(0, 7)) continue;
    const days = daysInMonth(ym);
    const isCurrent = ym === TODAY.slice(0, 7);
    const isLast = ym === addMonths(TODAY, -1).slice(0, 7);
    const status: "draft" | "finalized" | "paid" = isCurrent ? "draft" : isLast ? "finalized" : "paid";
    const slips = [];
    let gross = 0;
    let ded = 0;
    let net = 0;
    let employer = 0;
    for (const emp of EMPLOYEES) {
      if (emp.join.slice(0, 7) > ym) continue;
      if (emp.exit && emp.exit.slice(0, 7) < ym) continue;
      const st = structures.find((s) => s.empKey === emp.key)!;
      const lop = emp.key === "nikhil" && ym === "2026-06" ? 1 : 0;
      const paidDays = days - lop;
      const calc = computePayslip({
        structure: { basic: st.basic, hra: st.hra, special: st.special, pf: st.pf, pt: st.pt, tdsMonthly: st.tdsMonthly },
        config: PAYROLL_CONFIG,
        daysInMonth: days,
        paidDays,
        bonus: emp.key === "aditya" && ym.endsWith("-03") ? 25_000 : 0,
      });
      gross += calc.gross;
      ded += calc.totalDeductions;
      net += calc.netPay;
      employer += calc.employerCost - calc.gross;
      slips.push({
        id: tid(`slip:${ym}:${emp.key}`),
        empKey: emp.key,
        empCode: emp.code,
        name: `${emp.first} ${emp.last}`,
        designation: emp.designation,
        departmentName: DEPARTMENTS.find((d) => d.key === emp.dept)?.name ?? null,
        daysInMonth: days,
        paidDays,
        lopDays: lop,
        attendance: { employedDays: days, absent: lop, halfDay: 0, lopLeave: 0, unmarked: 0, computedLop: lop },
        earnings: calc.earnings,
        deductions: calc.deductions,
        employer: calc.employer,
        adjustments: {},
        statutory: { pan: st.pan, uan: st.uan, pfNumber: st.uan ? `KN/BNG/${st.uan}` : null, esiNumber: null, pfWage: calc.pfWage, esiWage: calc.esiWage, tdsEstimated: calc.tdsEstimated },
        gross: calc.gross,
        totalDeductions: calc.totalDeductions,
        netPay: calc.netPay,
        employerCost: calc.employerCost,
      });
    }
    runs.push({
      id: tid(`run:${ym}`),
      period: ym,
      status,
      paidOn: status === "paid" ? `${ym}-${String(Math.min(28, days)).padStart(2, "0")}` : null,
      slips,
      totals: { employees: slips.length, gross, ded, net, employer },
    });
  }

  return { structures, runs };
}

export function buildBanking(invoices: BuiltInvoice[]) {
  const accountId = tid("bank:hdfc");
  const cashId = tid("bank:cash");
  const txns: Array<Record<string, unknown>> = [];
  let bal = 12_50_000;
  const openingDate = WINDOW_START;

  // Opening + monthly payroll outflows + invoice receipts
  for (const inv of invoices) {
    if (inv.status !== "paid" && inv.status !== "partial") continue;
    if (!inv.paidOn) continue;
    const { totals, paid } = invoiceMoney(inv);
    const amount = inv.status === "paid" ? totals.grandTotal : paid;
    bal += amount;
    txns.push({
      id: tid(`btxn:in:${inv.key}`),
      accountId,
      date: inv.paidOn,
      description: `NEFT CR ${PARTIES.find((p) => p.key === inv.partyKey)!.name.toUpperCase()} ${inv.no}`,
      reference: `N${inv.key.replace(/\W/g, "").slice(0, 10).toUpperCase()}`,
      amount,
      statementBalance: bal,
      source: "import",
      status: "matched",
      matchType: "payment",
      matchId: tid(`pay:${inv.key}`),
      category: null,
      fingerprint: fingerprint(inv.paidOn, amount, inv.key),
    });
  }

  // Unmatched recent credit for reconciliation testing
  bal += 1_180;
  txns.push({
    id: tid("btxn:unmatched"),
    accountId,
    date: addDays(TODAY, -2),
    description: "NEFT CR UNKNOWN SENDER TEST",
    reference: "NUNK001",
    amount: 1_180,
    statementBalance: bal,
    source: "import",
    status: "unmatched",
    matchType: null,
    matchId: null,
    category: null,
    fingerprint: fingerprint("unmatched", TODAY),
  });

  // Bank charges categorized
  bal -= 590;
  txns.push({
    id: tid("btxn:charges"),
    accountId,
    date: addDays(TODAY, -10),
    description: "ACH DR BANK CHARGES",
    reference: "CHG01",
    amount: -590,
    statementBalance: bal,
    source: "import",
    status: "categorized",
    matchType: null,
    matchId: null,
    category: "Bank charges",
    fingerprint: fingerprint("charges", TODAY),
  });

  return {
    accounts: [
      { id: accountId, name: "HDFC Current — JustTestX", kind: "bank", bankName: "HDFC Bank", accountLast4: "3344", ifsc: "HDFC0001234", openingBalance: 12_50_000, openingDate },
      { id: cashId, name: "Petty cash", kind: "cash", bankName: null, accountLast4: null, ifsc: null, openingBalance: 25_000, openingDate },
    ],
    txns,
  };
}

export function buildBudgets() {
  const months = Array.from({ length: 12 }, (_, i) => {
    const base = [1_85_000, 55_000, 45_000, 80_000, 25_000, 18_00_000][i % 6]!;
    return base;
  });
  return {
    id: tid("budget:fy26"),
    year: 2026,
    fyStart: "2026-04-01",
    name: "FY 26-27 operating budget",
    basis: "category",
    notes: "Seeded plan for JustTestX BOS testing",
    lines: [
      { key: "rent", kind: "category", label: "Rent", months: Array(12).fill(1_85_000) },
      { key: "cloud", kind: "category", label: "Cloud hosting", months: Array(12).fill(55_000) },
      { key: "travel", kind: "category", label: "Travel", months: Array(12).fill(45_000) },
      { key: "it", kind: "category", label: "IT hardware", months: Array(12).fill(40_000) },
      { key: "payroll", kind: "payroll", label: "Payroll", months: Array(12).fill(18_50_000) },
      { key: "professional", kind: "category", label: "Professional fees", months: months.map((m) => Math.round(m * 0.3)) },
    ],
  };
}

export function buildAssets() {
  return [
    { key: "lap1", tag: "AST-0001", name: "MacBook Pro 14 — Kavya", category: "Computers & IT", serial: "MBP14-KV-01", cost: 1_95_000, purchase: "2025-09-10", method: "wdv", rate: 40, emp: "kavya", status: "in_use" },
    { key: "lap2", tag: "AST-0002", name: "Dell Latitude 5440 — Rohan", category: "Computers & IT", serial: "DL5440-RH-02", cost: 95_000, purchase: "2026-04-10", method: "wdv", rate: 40, emp: "rohan", status: "in_use" },
    { key: "lap3", tag: "AST-0003", name: "Dell Latitude 5440 — Meera", category: "Computers & IT", serial: "DL5440-ME-03", cost: 95_000, purchase: "2026-04-10", method: "wdv", rate: 40, emp: "meera", status: "in_use" },
    { key: "mon", tag: "AST-0004", name: "LG UltraFine 27 — Conference", category: "Computers & IT", serial: "LG27-CONF", cost: 42_000, purchase: "2025-11-01", method: "wdv", rate: 40, emp: null, status: "in_use" },
    { key: "furn", tag: "AST-0005", name: "Workstation desks (set of 8)", category: "Furniture", serial: null, cost: 1_60_000, purchase: "2024-06-15", method: "wdv", rate: 10, emp: null, status: "in_use" },
    { key: "phone", tag: "AST-0006", name: "iPhone 15 — Sales", category: "Computers & IT", serial: "IP15-AD", cost: 79_000, purchase: "2025-08-01", method: "wdv", rate: 40, emp: "aditya", status: "maintenance" },
    { key: "old", tag: "AST-0007", name: "ThinkPad T480 — retired", category: "Computers & IT", serial: "T480-OLD", cost: 55_000, purchase: "2022-01-10", method: "wdv", rate: 40, emp: null, status: "disposed", disposedOn: "2026-02-01", disposalAmount: 8_000 },
  ].map((a) => ({ ...a, id: tid(`asset:${a.key}`) }));
}

export function buildAccounting() {
  const accounts = SYSTEM_ACCOUNTS.map((a) => ({
    id: tid(`acct:${a.key}`),
    code: a.code,
    name: a.name,
    type: a.type,
    systemKey: a.key,
  }));
  // Extra expense heads
  accounts.push(
    { id: tid("acct:rent"), code: "5310", name: "Rent — office", type: "expense", systemKey: null as unknown as string },
    { id: tid("acct:cloud"), code: "5320", name: "Cloud hosting", type: "expense", systemKey: null as unknown as string },
  );
  const journalId = tid("jv:capital");
  return {
    accounts,
    settings: { booksStart: "2025-04-01" },
    journals: [
      {
        id: journalId,
        journalNo: "JV/25-26/0001",
        date: "2025-10-01",
        narration: "Owner capital introduced — JustTestX seed",
        status: "posted",
        lines: [
          { accountId: tid("acct:bank"), debit: 25_00_000, credit: 0 },
          { accountId: tid("acct:capital"), debit: 0, credit: 25_00_000 },
        ],
      },
    ],
  };
}

export function buildRecruitment() {
  const openings = [
    { key: "o1", title: "Senior Backend Engineer", dept: "engineering", openings: 2, priority: "high", status: "open", salaryMin: 18_00_000, salaryMax: 28_00_000, neededBy: addDays(TODAY, 45) },
    { key: "o2", title: "Customer Success Manager", dept: "success", openings: 1, priority: "medium", status: "open", salaryMin: 12_00_000, salaryMax: 18_00_000, neededBy: addDays(TODAY, 60) },
    { key: "o3", title: "UI Designer (contract)", dept: "product", openings: 1, priority: "low", status: "closed", salaryMin: 8_00_000, salaryMax: 12_00_000, neededBy: "2026-03-01" },
  ].map((o) => ({ ...o, id: tid(`job:${o.key}`) }));

  const candidates = [
    { key: "c1", opening: "o1", name: "Siddharth Rao", email: "sid.rao@example.com", stage: "interview", applied: addDays(TODAY, -12) },
    { key: "c2", opening: "o1", name: "Neha Gupta", email: "neha.g@example.com", stage: "shortlisted", applied: addDays(TODAY, -20) },
    { key: "c3", opening: "o2", name: "Karthik Subramanian", email: "karthik.s@example.com", stage: "offer", applied: addDays(TODAY, -30), offer: "sent", offerCtc: 15_00_000 },
    { key: "c4", opening: "o3", name: "Rahul Verma", email: "rahul.verma@justtestx.example", stage: "hired", applied: "2025-05-10", offer: "accepted", offerCtc: 10_80_000 },
    { key: "c5", opening: "o1", name: "Withdrawn Candidate", email: "gone@example.com", stage: "withdrawn", applied: addDays(TODAY, -40) },
    { key: "c6", opening: "o2", name: "Rejected Profile", email: "nope@example.com", stage: "rejected", applied: addDays(TODAY, -25) },
  ].map((c) => ({ ...c, id: tid(`cand:${c.key}`), openingId: tid(`job:${c.opening}`) }));

  return { openings, candidates };
}

export function buildPerformance() {
  const programs = [
    { key: "p1", title: "Secure coding workshop", team: "technical", days: 2, certificate: 1, validity: 24, mandatory: 1 },
    { key: "p2", title: "People manager essentials", team: "management", days: 1, certificate: 1, validity: 12, mandatory: 0 },
    { key: "p3", title: "GST & invoicing for ops", team: "operations", days: 1, certificate: 0, validity: null, mandatory: 1 },
  ].map((p) => ({ ...p, id: tid(`train:${p.key}`) }));

  return {
    programs,
    enrollments: [
      { id: tid("enr:1"), program: "p1", emp: "rohan", enrolled: "2026-05-01", session: "2026-05-20", status: "completed", completed: "2026-05-20" },
      { id: tid("enr:2"), program: "p1", emp: "meera", enrolled: "2026-05-01", session: "2026-05-20", status: "completed", completed: "2026-05-20" },
      { id: tid("enr:3"), program: "p2", emp: "kavya", enrolled: "2026-08-01", session: "2026-08-15", status: "completed", completed: "2026-08-15" },
      { id: tid("enr:4"), program: "p3", emp: "lakshmi", enrolled: "2026-09-01", session: "2026-09-10", status: "enrolled", completed: null },
      { id: tid("enr:5"), program: "p1", emp: "vikram", enrolled: "2026-05-01", session: "2026-05-20", status: "cancelled", completed: null },
    ],
    certifications: [
      { id: tid("cert:1"), emp: "rohan", name: "Secure coding — JustTestX", issued: "2026-05-20", expires: "2028-05-20", no: "CERT-0001" },
      { id: tid("cert:2"), emp: "nikhil", name: "AWS Solutions Architect", issued: "2025-12-01", expires: "2028-12-01", no: "CERT-0002" },
    ],
    kras: [
      { id: tid("kra:1"), emp: "rohan", title: "Ship Cascade AMS SLAs ≥ 99.5%", start: "2026-04-01", end: "2027-03-31", progress: 72, status: "on_track" },
      { id: tid("kra:2"), emp: "aditya", title: "Close ₹1.2 Cr new ACV", start: "2026-04-01", end: "2027-03-31", progress: 48, status: "at_risk" },
      { id: tid("kra:3"), emp: "imran", title: "CSAT ≥ 4.5 / 5", start: "2026-04-01", end: "2027-03-31", progress: 90, status: "achieved" },
    ],
    promotions: [
      { id: tid("promo:1"), emp: "meera", proposed: "Senior Backend Engineer", effective: "2026-11-01", status: "pending", currentDesig: "Backend Engineer", currentCtc: 1_680_000, proposedCtc: 2_040_000 },
    ],
    pips: [
      { id: tid("pip:1"), emp: "vikram", reason: "Missed two release quality gates", started: "2026-07-01", review: "2026-09-30", status: "passed" },
    ],
    recognitions: [
      { id: tid("rec:1"), emp: "ananya", category: "Quality champion", awarded: "2026-06-30", note: "Zero Sev-1 escapes in Q1" },
      { id: tid("rec:2"), emp: "nikhil", category: "Ops hero", awarded: "2026-09-15", note: "BluePeak wave-2 cutover" },
    ],
  };
}

export function buildTravel() {
  return [
    { key: "1", emp: "aditya", purpose: "BluePeak kickoff", from: "Bengaluru", to: "Mumbai", depart: "2025-11-10", ret: "2025-11-12", mode: "flight", cost: 28_000, advance: 10_000, status: "approved", project: "bluepeak-cloud" },
    { key: "2", emp: "priya", purpose: "Northwind go-live support", from: "Bengaluru", to: "New Delhi", depart: "2026-02-18", ret: "2026-02-22", mode: "flight", cost: 35_000, advance: 15_000, status: "approved", project: "northwind-bos" },
    { key: "3", emp: "kavya", purpose: "Oriole engineering onsite", from: "Bengaluru", to: "Chennai", depart: "2026-06-09", ret: "2026-06-11", mode: "train", cost: 8_500, advance: 3_000, status: "approved", project: "oriole-aug" },
    { key: "4", emp: "sneha", purpose: "Zenith discovery", from: "Bengaluru", to: "Ahmedabad", depart: addDays(TODAY, 10), ret: addDays(TODAY, 12), mode: "flight", cost: 22_000, advance: 8_000, status: "pending", project: "zenith-app" },
    { key: "5", emp: "rohan", purpose: "Personal trip — cancelled", from: "Bengaluru", to: "Goa", depart: "2026-04-01", ret: "2026-04-03", mode: "bus", cost: 4_000, advance: 0, status: "cancelled", project: null },
    { key: "6", emp: "fatima", purpose: "Rejected — non-client travel", from: "Hyderabad", to: "Goa", depart: "2026-05-01", ret: "2026-05-03", mode: "flight", cost: 15_000, advance: 0, status: "rejected", project: null },
  ].map((t, i) => ({ ...t, id: tid(`trv:${t.key}`), requestNo: `TRV-${String(i + 1).padStart(4, "0")}` }));
}

export function buildServices() {
  return [
    { key: "1", emp: "rohan", type: "certificate", cert: "employment", subject: "Employment certificate", details: "Visa application", priority: "normal", status: "resolved", letter: "LTR-0001" },
    { key: "2", emp: "meera", type: "certificate", cert: "salary", subject: "Salary certificate", details: "Bank loan", priority: "high", status: "in_progress", letter: null },
    { key: "3", emp: "imran", type: "id_card", cert: null, subject: "Replacement ID card", details: "Lost card", priority: "normal", status: "open", letter: null },
    { key: "4", emp: "tara", type: "kit", cert: null, subject: "Laptop kit for intern", details: "Onboarding", priority: "normal", status: "resolved", letter: null },
    { key: "5", emp: "vikram", type: "helpdesk", cert: null, subject: "VPN access intermittent", details: "Fails on Jio fiber", priority: "urgent", status: "open", letter: null },
  ].map((s, i) => ({ ...s, id: tid(`srv:${s.key}`), requestNo: `SRV-${String(i + 1).padStart(4, "0")}` }));
}

export function buildPolicies() {
  const policies = [
    { key: "posh", title: "POSH Policy", category: "compliance", mandatory: 1, summary: "Prevention of Sexual Harassment.", body: "JustTestX is committed to a workplace free of harassment. Report concerns to the Internal Committee." },
    { key: "leave", title: "Leave & attendance policy", category: "hr", mandatory: 1, summary: "Casual, sick and earned leave rules.", body: "Casual 12, Sick 10, Earned 18. Apply in BOS before leave where possible." },
    { key: "info", title: "Information security policy", category: "it", mandatory: 1, summary: "Device, data and access controls.", body: "Company devices are encrypted. No customer data on personal drives. MFA required." },
    { key: "exp", title: "Expense reimbursement policy", category: "finance", mandatory: 0, summary: "What can be claimed and how.", body: "Submit within 30 days with receipts. Alcohol is not reimbursable." },
    { key: "draft", title: "AI usage guidelines (draft)", category: "it", mandatory: 0, summary: "Draft — not published.", body: "Do not paste customer PII into public AI tools.", status: "draft" },
  ].map((p) => ({
    ...p,
    id: tid(`pol:${p.key}`),
    status: (p as { status?: string }).status ?? "published",
    version: 1,
    effectiveOn: "2025-10-01",
  }));
  return policies;
}

export function buildCompliance() {
  return [
    { key: "gst", title: "GSTR-3B filing", area: "other", due: `${TODAY.slice(0, 7)}-20`, recurrence: "monthly", responsible: "Lakshmi Venkat", status: "open" },
    { key: "pf", title: "PF — ECR and contribution", area: "pf", due: `${TODAY.slice(0, 7)}-15`, recurrence: "monthly", responsible: "Deepak Joshi", status: "open" },
    { key: "pt", title: "Professional tax remittance", area: "pt", due: addDays(TODAY, 5), recurrence: "monthly", responsible: "Lakshmi Venkat", status: "open" },
    { key: "tds", title: "TDS quarterly return", area: "tds", due: "2026-07-31", recurrence: "quarterly", responsible: "Ramesh & Co CA", status: "done", doneOn: "2026-07-28", reference: "24Q-Q1-FY27" },
    { key: "shop", title: "Shop & Establishment renewal", area: "other", due: "2026-12-31", recurrence: "yearly", responsible: "Deepak Joshi", status: "open" },
  ].map((c) => ({ ...c, id: tid(`comp:${c.key}`) }));
}

export function buildAgreements() {
  return [
    { key: "a1", type: "employment", title: "Employment agreement — Santhosh HS", emp: "santhosh", counterparty: null, signed: "2024-04-01", starts: "2024-04-01", expires: null, status: "active" },
    { key: "a2", type: "nda", title: "NDA — Cascade Fintech", emp: null, counterparty: "Cascade Fintech Pvt Ltd", signed: "2025-09-15", starts: "2025-09-15", expires: "2028-09-14", status: "active" },
    { key: "a3", type: "other", title: "MSA — BluePeak Logistics", emp: null, counterparty: "BluePeak Logistics Ltd", signed: "2025-10-20", starts: "2025-11-01", expires: "2027-10-31", status: "active" },
    { key: "a4", type: "employment", title: "Contract — Rahul Verma (ended)", emp: "rahul", counterparty: null, signed: "2025-06-01", starts: "2025-06-01", expires: "2026-03-31", status: "ended" },
  ].map((a, i) => ({ ...a, id: tid(`agr:${a.key}`), agreementNo: `AGR-${String(i + 1).padStart(4, "0")}` }));
}

export function buildSalesDocs(invoices: BuiltInvoice[]) {
  const cascadeInv = invoices.find((i) => i.key.startsWith("cascade-ams-") && i.status === "paid");
  return [
    {
      key: "qt1",
      kind: "quotation",
      status: "accepted",
      partyKey: "zenith",
      docDate: "2026-07-15",
      validUntil: "2026-08-15",
      lines: linesFrom({ description: "Field app rebuild — discovery + MVP", hsn: "998314", unit: "Project", quantity: 1, rate: 9_50_000, taxRate: 18 }),
    },
    {
      key: "qt2",
      kind: "quotation",
      status: "sent",
      partyKey: "meridian",
      docDate: addDays(TODAY, -5),
      validUntil: addDays(TODAY, 25),
      lines: linesFrom({ description: "Omnichannel retail OS — Phase 1", hsn: "998314", unit: "Project", quantity: 1, rate: 25_00_000, taxRate: 18, discountPct: 5 }),
    },
    {
      key: "qt3",
      kind: "quotation",
      status: "declined",
      partyKey: "pixelforge",
      docDate: "2026-05-01",
      validUntil: "2026-05-31",
      lines: linesFrom({ description: "Brand portal", hsn: "998314", unit: "Project", quantity: 1, rate: 2_50_000, taxRate: 18 }),
    },
    {
      key: "so1",
      kind: "order",
      status: "confirmed",
      partyKey: "cascade",
      docDate: "2025-10-01",
      deliveryOn: "2025-10-05",
      customerRef: "PO-CF-1001",
      lines: linesFrom({ description: "Application Managed Services (monthly)", hsn: "998314", unit: "Month", quantity: 1, rate: 2_50_000, taxRate: 18 }),
      invoiceId: cascadeInv ? tid(`inv:${cascadeInv.key}`) : null,
    },
    {
      key: "dc1",
      kind: "challan",
      status: "delivered",
      partyKey: "meridian",
      docDate: "2026-04-12",
      deliveryOn: "2026-04-12",
      challanReason: "sale",
      lines: linesFrom({ description: "Developer laptop kit", hsn: "8471", unit: "Nos", quantity: 2, rate: 95_000, taxRate: 18 }),
      dispatchedOn: "2026-04-12",
      deliveredOn: "2026-04-12",
    },
  ].map((d, i) => {
    const party = PARTIES.find((p) => p.key === d.partyKey)!;
    const totals = computeInvoiceTotals(d.lines, intra(party.state));
    const prefix = d.kind === "quotation" ? "QT" : d.kind === "order" ? "SO" : "DC";
    const fy = fiscalYearLabel(d.docDate);
    return {
      ...d,
      id: tid(`sales:${d.key}`),
      docNo: formatDocNo(prefix, fy, i + 1),
      party,
      totals,
      intra: intra(party.state),
    };
  });
}

export { SYSTEM_ACCOUNTS };
