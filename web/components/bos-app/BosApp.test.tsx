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

  it("explains a pending migration instead of failing", async () => {
    overrides["GET /session"] = { status: 503, body: { error: "BOS tables are not installed yet", code: "BOS_SCHEMA_PENDING" } };
    render(<BosApp mode="tool" />);
    expect(await screen.findByText("Justx BOS is being set up", undefined, WAIT)).toBeTruthy();
  }, TEST_TIMEOUT);
});
