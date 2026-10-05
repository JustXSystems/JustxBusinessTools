import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BosDb } from "./db.js";
import type { BosActor, BosHost } from "./host.js";
import { createBosRouter } from "./index.js";

const ACTOR: BosActor = { tenantId: 7, userId: 3, role: "staff", name: "Asha", email: "asha@example.com" };

/** Every query fails as if the BOS tables were missing, so a request that passes the gates answers 503. */
function missingTablesDb() {
  const missing = (..._args: unknown[]) => Promise.reject(Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE" }));
  return { query: vi.fn(missing), getConnection: vi.fn(missing) };
}

function host(overrides: Partial<BosHost> = {}): BosHost {
  return {
    id: "test",
    appHref: "/tools/bos",
    actor: async () => ACTOR,
    requireWrite: (_req, _res, next) => next(),
    audit: async () => undefined,
    notify: () => undefined,
    brand: async () => ({ name: "", gstin: null, state: null, stateCode: null, address: null, email: null, phone: null, logoUrl: null, accent: null }),
    ...overrides,
  };
}

let server: Server | null = null;

async function call(h: BosHost, path = "/session", init?: RequestInit, db = missingTablesDb()) {
  const app = express();
  app.use(express.json());
  app.use("/api/bos", createBosRouter({ db: db as unknown as BosDb, host: h }));
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/api/bos${path}`, init);
  return { status: res.status, body: (await res.json()) as { error?: string; code?: string }, db };
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe("createBosRouter gates", () => {
  it("asks anonymous callers to sign in", async () => {
    const { status, db } = await call(host({ actor: async () => null }));
    expect(status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("refuses an org where BOS isn't enabled, before touching any data", async () => {
    const enabled = vi.fn(async () => false);
    const { status, body, db } = await call(host({ enabled }));
    expect(status).toBe(403);
    expect(body.code).toBe("BOS_NOT_ENABLED");
    expect(enabled).toHaveBeenCalledWith(ACTOR);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("lets enabled orgs through to the API", async () => {
    const { status, body } = await call(host({ enabled: async () => true }));
    expect(status).toBe(503);
    expect(body.code).toBe("BOS_SCHEMA_PENDING");
  });

  it("treats a host without an enabled check as always on", async () => {
    const { status } = await call(host());
    expect(status).toBe(503);
  });
});

describe("reports", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });

  it.each(["/reports/finance?from=2026-04-01&to=2026-09-30", "/reports/hr?month=2026-09"])("keeps %s to owners and admins", async (path) => {
    const { status, db } = await call(host(), path);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("rejects an inverted or missing period before querying", async () => {
    for (const path of ["/reports/finance?from=2026-09-30&to=2026-04-01", "/reports/finance?from=2026-04-01"]) {
      const { status, db } = await call(owner, path);
      expect(status).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("payroll", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it.each([
    ["/payroll/overview", undefined],
    ["/payroll/settings", undefined],
    ["/payroll/structures", undefined],
    ["/payroll/runs/r1", undefined],
    ["/payroll/runs", post({ period: "2026-09" })],
    ["/payroll/runs/r1/finalize", post({})],
    ["/payroll/runs/r1/bank-advice", undefined],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("lets staff reach their own payslips", async () => {
    const { status, body } = await call(host(), "/payroll/me");
    expect(status).toBe(503);
    expect(body.code).toBe("BOS_SCHEMA_PENDING");
  });

  it("refuses a future or malformed payroll month before querying", async () => {
    for (const period of ["2999-01", "2026-13", "Sept"]) {
      const { status, db } = await call(owner, "/payroll/runs", post({ period }));
      expect(status).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("banking", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it.each([
    ["/banking/overview", undefined],
    ["/banking/accounts/a1", undefined],
    ["/banking/accounts", post({ name: "HDFC Current", openingDate: "2026-04-01" })],
    ["/banking/accounts/a1/import", post({ lines: [{ date: "2026-10-01", description: "NEFT", amount: 100 }] })],
    ["/banking/transactions/t1/candidates", undefined],
    ["/banking/transactions/t1/reconcile", post({ action: "exclude" })],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates statement lines and reconcile requests before querying", async () => {
    const bad: Array<[string, unknown]> = [
      ["/banking/accounts/a1/import", { lines: [] }],
      ["/banking/accounts/a1/import", { lines: [{ date: "2026-02-30", description: "NEFT", amount: 100 }] }],
      ["/banking/accounts/a1/import", { lines: [{ date: "2026-10-01", description: "NEFT", amount: 0 }] }],
      ["/banking/accounts", { name: "HDFC", openingDate: "2026-04-01", ifsc: "HDFC123" }],
      ["/banking/accounts", { name: "HDFC", openingDate: "2026-04-01", accountLast4: "12345" }],
      ["/banking/transactions/t1/reconcile", { action: "match", type: "invoice", id: "i1" }],
      ["/banking/transactions/t1/reconcile", { action: "categorize", category: "" }],
    ];
    for (const [path, body] of bad) {
      const { status, db } = await call(owner, path, post(body));
      expect(status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("budgets", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const twelve = Array.from({ length: 12 }, () => 1000);

  it.each([
    ["/budgets", undefined],
    ["/budgets/b1", undefined],
    ["/budgets", send("POST", { year: 2026 })],
    ["/budgets/b1/lines", send("POST", { kind: "category", name: "Travel", months: twelve })],
    ["/budgets/b1/lines/l1", send("PATCH", { months: twelve })],
    ["/budgets/b1", send("DELETE", {})],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates budgets and heads before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/budgets", send("POST", { year: "next" })],
      ["/budgets", send("POST", { year: 2026, basis: "project" })],
      ["/budgets", send("POST", { year: 2026, seed: "actuals", uplift: 900 })],
      ["/budgets/b1/lines", send("POST", { kind: "category", name: "Travel", months: [1000] })],
      ["/budgets/b1/lines", send("POST", { kind: "category", name: "Travel", months: [-1, ...twelve.slice(1)] })],
      ["/budgets/b1/lines", send("POST", { kind: "vendor", months: twelve })],
      ["/budgets/b1/lines/l1", send("PATCH", { months: ["x", ...twelve.slice(1)] })],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("assets", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const laptop = { name: "Laptop", category: "Computers & IT", purchaseDate: "2026-04-10", cost: 85000, method: "slm", rate: 31.67 };

  it.each([
    ["/assets", undefined],
    ["/assets/depreciation", undefined],
    ["/assets/x1", undefined],
    ["/assets", send(laptop)],
    ["/assets/x1/assign", send({ employeeId: "e1", date: "2026-10-01" })],
    ["/assets/x1/dispose", send({ date: "2026-10-01", amount: 1000 })],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates assets and actions before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/assets", send({ ...laptop, cost: 0 })],
      ["/assets", send({ ...laptop, salvageValue: 90000 })],
      ["/assets", send({ ...laptop, method: "double" })],
      ["/assets", send({ ...laptop, rate: 150 })],
      ["/assets", send({ ...laptop, purchaseDate: "2026-02-30" })],
      ["/assets/x1", send({ cost: -5 }, "PATCH")],
      ["/assets/x1/maintenance", send({ action: "pause", date: "2026-10-01" })],
      ["/assets/x1/dispose", send({ date: "2026-10-01", amount: -1 })],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("accounting", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const entry = { date: "2026-10-01", narration: "Rent accrual", lines: [{ accountId: "a1", debit: 1800 }, { accountId: "a2", credit: 1800 }] };

  it.each([
    ["/accounting/overview", undefined],
    ["/accounting/ledger?account=a1", undefined],
    ["/accounting/trial-balance", undefined],
    ["/accounting/journals", undefined],
    ["/accounting/opening", undefined],
    ["/accounting/accounts", send({ code: "6100", name: "Rent", type: "expense" })],
    ["/accounting/journals", send(entry)],
    ["/accounting/journals/j1/void", send({ reason: "Duplicate" })],
    ["/accounting/opening", send({ booksStart: "2026-04-01", lines: [] }, "PUT")],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates accounts, journals and opening balances before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/accounting/accounts", send({ code: "61 00", name: "Rent", type: "expense" })],
      ["/accounting/accounts", send({ code: "6100", name: "", type: "expense" })],
      ["/accounting/accounts", send({ code: "6100", name: "Rent", type: "cost" })],
      ["/accounting/journals", send({ ...entry, narration: "" })],
      ["/accounting/journals", send({ ...entry, lines: [{ accountId: "a1", debit: 1800 }] })],
      ["/accounting/journals", send({ ...entry, lines: [{ accountId: "a1", debit: 1800 }, { accountId: "a2", credit: 1700 }] })],
      ["/accounting/journals", send({ ...entry, lines: [{ accountId: "a1", debit: 5, credit: 5 }, { accountId: "a2", credit: 0 }] })],
      ["/accounting/journals", send({ ...entry, date: "2026-13-01" })],
      ["/accounting/journals", send({ ...entry, date: "2999-01-01" })],
      ["/accounting/journals/j1/void", send({ reason: " " })],
      ["/accounting/opening", send({ booksStart: "2026-04-31", lines: [] }, "PUT")],
      ["/accounting/opening", send({ booksStart: "2999-04-01", lines: [] }, "PUT")],
      ["/accounting/opening", send({ booksStart: "2026-04-01", lines: [{ accountId: "a1", debit: -5 }] }, "PUT")],
      ["/accounting/trial-balance?from=2026-05-01&to=2026-04-01", { method: "GET" }],
      ["/accounting/opening?suggest=2999-01-01", { method: "GET" }],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("recruitment", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const role = { title: "Site Engineer", openings: 2, priority: "high", status: "open" };
  const applicant = { openingId: "o1", name: "Nisha Gupta", source: "LinkedIn", appliedOn: "2026-10-01" };

  it.each([
    ["/recruitment/overview", undefined],
    ["/recruitment/candidates/c1", undefined],
    ["/recruitment/openings", send(role)],
    ["/recruitment/candidates", send(applicant)],
    ["/recruitment/candidates/c1/stage", send({ stage: "interview" })],
    ["/recruitment/candidates/c1/offer", send({ ctc: 600000, joiningDate: "2026-11-01", sentOn: "2026-10-04" })],
    ["/recruitment/candidates/c1/offer-response", send({ response: "accepted", date: "2026-10-05" })],
    ["/recruitment/candidates/c1/onboarding", send({ task: "kyc", done: true }, "PATCH")],
    ["/recruitment/candidates/c1/employee", send({ firstName: "Nisha", joinDate: "2026-11-01" })],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates roles, candidates and pipeline actions before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/recruitment/openings", send({ ...role, title: " " })],
      ["/recruitment/openings", send({ ...role, openings: 0 })],
      ["/recruitment/openings", send({ ...role, priority: "urgent" })],
      ["/recruitment/openings", send({ ...role, salaryMin: 900000, salaryMax: 600000 })],
      ["/recruitment/openings/o1", send({ status: "paused" }, "PATCH")],
      ["/recruitment/candidates", send({ ...applicant, name: "" })],
      ["/recruitment/candidates", send({ ...applicant, email: "not-an-email" })],
      ["/recruitment/candidates", send({ ...applicant, appliedOn: "2999-01-01" })],
      ["/recruitment/candidates", send({ ...applicant, rating: 6 })],
      ["/recruitment/candidates", send({ ...applicant, resumeLink: "javascript:alert(1)" })],
      ["/recruitment/candidates/c1/stage", send({ stage: "onboarded" })],
      ["/recruitment/candidates/c1/interview", send({ at: "2026-10-06 25:00" })],
      ["/recruitment/candidates/c1/offer", send({ ctc: 0, joiningDate: "2026-11-01", sentOn: "2026-10-04" })],
      ["/recruitment/candidates/c1/offer-response", send({ response: "maybe", date: "2026-10-05" })],
      ["/recruitment/candidates/c1/onboarding", send({ task: "laptop", done: true }, "PATCH")],
      ["/recruitment/candidates/c1/notes", send({ note: "  " })],
      ["/recruitment/candidates/c1/employee", send({ firstName: "", joinDate: "2026-11-01" })],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("performance & learning", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const program = { title: "Safety Training", team: "operations", durationDays: 1, certificate: true, validityMonths: 12 };
  const kra = { employeeIds: ["e1"], title: "Project delivery SLA", target: "95%", periodStart: "2026-04-01", periodEnd: "2027-03-31" };

  it.each([
    ["/performance/overview", undefined],
    ["/performance/programs", send(program)],
    ["/performance/enrollments", send({ programId: "p1", employeeIds: ["e1"] })],
    ["/performance/enrollments/n1/complete", send({ date: "2026-10-05" })],
    ["/performance/certifications", send({ employeeId: "e1", name: "First aid", issuedOn: "2026-10-01" })],
    ["/performance/kras", send(kra)],
    ["/performance/promotions", send({ employeeId: "e1", proposedDesignation: "Lead", effectiveDate: "2026-11-01" })],
    ["/performance/promotions/r1/decision", send({ decision: "approved", apply: true })],
    ["/performance/pips", send({ employeeId: "e1", reason: "Attendance", startedOn: "2026-10-01", reviewOn: "2026-11-01" })],
    ["/performance/recognitions", send({ employeeId: "e1", category: "Star Technician", awardedOn: "2026-10-01" })],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates programs, training, certificates, KRAs, promotions, plans and awards before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/performance/programs", send({ ...program, title: " " })],
      ["/performance/programs", send({ ...program, team: "sales" })],
      ["/performance/programs", send({ ...program, durationDays: 1.3 })],
      ["/performance/programs", send({ ...program, validityMonths: 0 })],
      ["/performance/programs/p1", send({ team: "sales" }, "PATCH")],
      ["/performance/enrollments", send({ programId: "p1", employeeIds: [] })],
      ["/performance/enrollments/n1", send({ sessionDate: "2026-02-30" }, "PATCH")],
      ["/performance/enrollments/n1/complete", send({ date: "2999-01-01" })],
      ["/performance/certifications", send({ employeeId: "e1", name: "First aid", issuedOn: "2999-01-01" })],
      ["/performance/certifications", send({ employeeId: "e1", name: "First aid", issuedOn: "2026-10-01", expiresOn: "2026-09-01" })],
      ["/performance/certifications", send({ employeeId: "e1", name: "First aid", issuedOn: "2026-10-01", link: "javascript:alert(1)" })],
      ["/performance/kras", send({ ...kra, periodEnd: "2026-03-31" })],
      ["/performance/kras", send({ ...kra, periodEnd: "2031-03-31" })],
      ["/performance/kras", send({ ...kra, weight: 150 })],
      ["/performance/kras/k1", send({ status: "great" }, "PATCH")],
      ["/performance/kras/k1", send({ progress: 120 }, "PATCH")],
      ["/performance/promotions", send({ employeeId: "e1", proposedDesignation: "", effectiveDate: "2026-11-01" })],
      ["/performance/promotions/r1/decision", send({ decision: "maybe" })],
      ["/performance/pips", send({ employeeId: "e1", reason: "Attendance", startedOn: "2026-10-01", reviewOn: "2026-10-01" })],
      ["/performance/pips/x1/close", send({ outcome: "extended", date: "2026-10-01" })],
      ["/performance/recognitions", send({ employeeId: "e1", category: "", awardedOn: "2026-10-01" })],
      ["/performance/recognitions", send({ employeeId: "e1", category: "Star Technician", awardedOn: "2999-01-01" })],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("travel requests", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const trip = { purpose: "Site survey", fromPlace: "Bengaluru", toPlace: "Mysuru", departOn: inDays(7), returnOn: inDays(8), mode: "car", estimatedCost: 4000, advance: 1000 };

  it("keeps decisions to owners and admins", async () => {
    const { status, db } = await call(host(), "/travel/t1/decision", send({ decision: "approved" }));
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates trips before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/travel", send({ ...trip, purpose: " " })],
      ["/travel", send({ ...trip, mode: "rocket" })],
      ["/travel", send({ ...trip, estimatedCost: -1 })],
      ["/travel", send({ ...trip, advance: 5000 })],
      ["/travel", send({ ...trip, returnOn: inDays(6) })],
      ["/travel", send({ ...trip, returnOn: inDays(120) })],
      ["/travel", send({ ...trip, departOn: inDays(-45), returnOn: inDays(-44) })],
      ["/travel", send({ ...trip, departOn: "2026-02-30" })],
      ["/travel/t1", send({ mode: "rocket" }, "PATCH")],
      ["/travel/t1/decision", send({ decision: "maybe" })],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it("stops staff from requesting travel for a colleague", async () => {
    const db = missingTablesDb();
    const missing = db.query.getMockImplementation()!;
    db.query.mockImplementation(((sql: unknown) =>
      /FROM bos_employees WHERE id = /.test(String(sql)) ? Promise.resolve([[{ id: "e9", name: "Ravi Kumar", status: "active", user_id: 99 }], []]) : missing()) as never);
    const { status, body } = await call(host(), "/travel", send({ ...trip, employeeId: "e9" }), db);
    expect(status).toBe(403);
    expect(body.error).toMatch(/only request travel for yourself/);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO bos_travel_requests/.test(String(sql)))).toBe(false);
  });
});

describe("employee services", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it.each([
    ["/services/requests/s1/assign", send({ employeeId: "e1" })],
    ["/services/requests/s1/resolve", send({})],
    ["/services/requests/s1/comments", send({ body: "Checking with payroll", internal: true })],
    ["/services/requests/s1", send({ priority: "high" }, "PATCH")],
  ] as const)("keeps %s triage to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates requests and replies before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/services/requests", send({ subject: "ID card" })],
      ["/services/requests", send({ type: "parking", subject: "Slot" })],
      ["/services/requests", send({ type: "certificate" })],
      ["/services/requests", send({ type: "certificate", certificateKind: "noc" })],
      ["/services/requests", send({ type: "helpdesk", subject: " " })],
      ["/services/requests", send({ type: "helpdesk", subject: "Payslip", priority: "urgent" })],
      ["/services/requests/s1", send({ subject: " " }, "PATCH")],
      ["/services/requests/s1/assign", send({})],
      ["/services/requests/s1/comments", send({ body: " " })],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("policies & compliance", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it.each([
    ["/policies", send({ title: "POSH Policy", body: "…" })],
    ["/policies/p1", send({ title: "POSH" }, "PATCH")],
    ["/policies/p1/publish", send({})],
    ["/policies/p1/archive", send({})],
    ["/policies/p1", { method: "DELETE" }],
    ["/policies/p1/acknowledgements", send({ employeeId: "e1" })],
    ["/policies/p1/acknowledgements/e1", { method: "DELETE" }],
    ["/compliance", send({ title: "PF ECR", dueOn: "2026-10-15" })],
    ["/compliance/templates", send({ keys: ["pf_ecr"] })],
    ["/compliance/c1/done", send({})],
    ["/agreements", send({ type: "nda", employeeId: "e1" })],
    ["/agreements/a1/end", send({})],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init as RequestInit);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates policies, filings and agreements before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/policies", send({ title: "Leave Policy" })],
      ["/policies", send({ title: " ", body: "Text" })],
      ["/policies", send({ title: "Leave", body: "Text", category: "legal" })],
      ["/policies", send({ title: "Leave", body: "Text", effectiveOn: "2026-02-30" })],
      ["/policies/p1", send({ body: " " }, "PATCH")],
      ["/policies/p1/acknowledgements", send({})],
      ["/compliance", send({ title: "PF ECR" })],
      ["/compliance", send({ title: "PF ECR", dueOn: "2026-10-15", recurrence: "weekly" })],
      ["/compliance", send({ title: "PF ECR", dueOn: "2026-10-15", area: "gst" })],
      ["/compliance/c1/done", send({ doneOn: "2999-01-01" })],
      ["/compliance/templates", send({ keys: [] })],
      ["/compliance/templates", send({ keys: ["gst_return"] })],
      ["/agreements", send({ type: "nda" })],
      ["/agreements", send({ type: "nda", employeeId: "e1", counterparty: "Sunrise Manpower" })],
      ["/agreements", send({ type: "lease", counterparty: "Sunrise Manpower" })],
      ["/agreements", send({ type: "nda", counterparty: "Acme", startsOn: "2026-10-01", expiresOn: "2026-09-01" })],
      ["/agreements", send({ type: "nda", counterparty: "Acme", signedOn: "2999-01-01" })],
      ["/agreements", send({ type: "nda", counterparty: "Acme", documentUrl: "javascript:alert(1)" })],
      ["/agreements/a1", send({ documentUrl: "file:///C:/nda.pdf" }, "PATCH")],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("sales billing", () => {
  const owner = host({ actor: async () => ({ ...ACTOR, role: "owner" }) });
  const send = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const line = { description: "Solar panel 540W", quantity: 2, rate: 14500, taxRate: 12 };

  it.each([
    ["/sales/items", send({ name: "Panel", rate: 100, taxRate: 18 })],
    ["/sales/items/i1", send({ rate: 90 }, "PATCH")],
    ["/sales/items/i1", { method: "DELETE" }],
    ["/sales/docs/d1/cancel", send({})],
  ] as const)("keeps %s to owners and admins", async (path, init) => {
    const { status, db } = await call(host(), path, init as RequestInit);
    expect(status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("keeps the POS counter behind the admin switch, before reading anything", async () => {
    const feature = vi.fn(async () => false);
    const { status, body, db } = await call(host({ feature }), "/sales/pos", send({ lines: [line], method: "cash" }));
    expect(status).toBe(403);
    expect(body.code).toBe("FEATURE_OFF");
    expect(feature).toHaveBeenCalledWith(ACTOR, "bos.sales.pos");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("validates sales documents, items and counter bills before querying", async () => {
    const bad: Array<[string, RequestInit]> = [
      ["/sales/docs", send({ kind: "quotation", partyName: "Meridian", docDate: "2026-10-05", lines: [] })],
      ["/sales/docs", send({ kind: "invoice", partyName: "Meridian", docDate: "2026-10-05", lines: [line] })],
      ["/sales/docs", send({ kind: "quotation", partyName: " ", docDate: "2026-10-05", lines: [line] })],
      ["/sales/docs", send({ kind: "quotation", partyName: "Meridian", docDate: "2026-10-05", validUntil: "2026-10-01", lines: [line] })],
      ["/sales/docs", send({ kind: "order", partyName: "Meridian", docDate: "2026-10-05", deliveryOn: "2026-10-04", lines: [line] })],
      ["/sales/docs", send({ kind: "challan", partyName: "Meridian", docDate: "2026-10-05", challanReason: "gift", lines: [line] })],
      ["/sales/docs/d1", send({ partyName: "Meridian", docDate: "2026-02-30", lines: [line] }, "PUT")],
      ["/sales/docs/d1/decide", send({ decision: "maybe" })],
      ["/sales/docs/d1/dispatch", send({ dispatchedOn: "2999-01-01" })],
      ["/sales/docs/d1/deliver", send({ deliveredOn: "2999-01-01" })],
      ["/sales/items", send({ name: "Panel", rate: -1, taxRate: 18 })],
      ["/sales/items", send({ name: "Panel", rate: 100, taxRate: 18, kind: "bundle" })],
      ["/sales/pos", send({ lines: [line], method: "cheque" })],
      ["/sales/pos", send({ lines: [], method: "cash" })],
    ];
    for (const [path, init] of bad) {
      const { status, db } = await call(owner, path, init);
      expect(status, `${path} ${String(init.body)}`).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});

describe("expense claims", () => {
  /** Knows one employee, linked to another user; every other query behaves as if the tables were missing. */
  function colleagueDb() {
    const db = missingTablesDb();
    const missing = db.query.getMockImplementation()!;
    db.query.mockImplementation(((sql: unknown) =>
      /FROM bos_employees WHERE id = /.test(String(sql)) ? Promise.resolve([[{ first_name: "Ravi", last_name: "Kumar", user_id: 99 }], []]) : missing()) as never);
    return db;
  }
  const claim = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: "e9", category: "Travel", amount: 250, spentOn: "2026-10-02" }) };
  const inserted = (db: ReturnType<typeof colleagueDb>) => db.query.mock.calls.some(([sql]) => /INSERT INTO bos_expenses/.test(String(sql)));

  it("stops staff from claiming against a colleague's record", async () => {
    const db = colleagueDb();
    const { status, body } = await call(host(), "/expenses", claim, db);
    expect(status).toBe(403);
    expect(body.error).toMatch(/only claim expenses for yourself/);
    expect(inserted(db)).toBe(false);
  });

  it("lets owners file a claim on an employee's behalf", async () => {
    const db = colleagueDb();
    await call(host({ actor: async () => ({ ...ACTOR, role: "owner" }) }), "/expenses", claim, db);
    expect(inserted(db)).toBe(true);
  });

  const listSql = (db: ReturnType<typeof missingTablesDb>) => String(db.query.mock.calls.find(([sql]) => /FROM bos_expenses/.test(String(sql)))?.[0] ?? "");

  it("keeps the team-wide claim list for staff while the private-claims switch is off", async () => {
    const feature = vi.fn(async () => false);
    const { db } = await call(host({ feature }), "/expenses");
    expect(feature).toHaveBeenCalledWith(ACTOR, "bos.expenses.own_claims");
    expect(listSql(db)).not.toMatch(/created_by = :uid/);
  });

  it("shows staff only their own claims once the switch is on", async () => {
    const { db } = await call(host({ feature: vi.fn(async () => true) }), "/expenses");
    expect(listSql(db)).toMatch(/created_by = :uid OR employee_id IN/);
  });

  it("always shows owners every claim (the switch isn't even read)", async () => {
    const feature = vi.fn(async () => true);
    const { db } = await call(host({ feature, actor: async () => ({ ...ACTOR, role: "owner" }) }), "/expenses");
    expect(feature).not.toHaveBeenCalled();
    expect(listSql(db)).not.toMatch(/created_by = :uid/);
  });
});

describe("invoice list", () => {
  const invoiceSql = (db: ReturnType<typeof missingTablesDb>) => db.query.mock.calls.map(([sql]) => String(sql)).filter((sql) => /FROM bos_invoices/.test(sql));

  it("loads every draft and unpaid invoice, and caps only the paid and void ones", async () => {
    const { db } = await call(host(), "/invoices");
    const sql = invoiceSql(db);
    expect(sql.some((s) => /status IN \('draft','sent','partial'\)/.test(s) && /LIMIT 5000/.test(s))).toBe(true);
    expect(sql.some((s) => /status NOT IN \('draft','sent','partial'\)/.test(s) && /LIMIT 1001/.test(s))).toBe(true);
  });

  it("asks only for unpaid invoices for receivables", async () => {
    const { db } = await call(host(), "/invoices?status=open");
    const sql = invoiceSql(db);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/status IN \('sent','partial'\)/);
  });
});

describe("own deletes switch", () => {
  /** A pending bill and a draft invoice, both created by user 99; every other query behaves as if the tables were missing. */
  function othersDb() {
    const db = missingTablesDb();
    const missing = db.query.getMockImplementation()!;
    db.query.mockImplementation(((sql: unknown) => {
      const s = String(sql);
      if (/SELECT created_by FROM bos_bills/.test(s)) return Promise.resolve([[{ created_by: 99 }], []]);
      if (/SELECT \* FROM bos_invoices WHERE id = /.test(s)) return Promise.resolve([[{ id: "i1", invoice_no: "INV/1", status: "draft", created_by: 99 }], []]);
      return missing();
    }) as never);
    return db;
  }
  const remove = { method: "DELETE" };
  const deleted = (db: ReturnType<typeof othersDb>, table: string) => db.query.mock.calls.some(([sql]) => new RegExp(`DELETE FROM ${table}`).test(String(sql)));

  it("lets staff delete a colleague's bill or draft while the switch is off", async () => {
    const db = othersDb();
    await call(host({ feature: vi.fn(async () => false) }), "/bills/b1", remove, db);
    expect(deleted(db, "bos_bills")).toBe(true);
  });

  it("stops staff deleting a colleague's bill once the switch is on", async () => {
    const db = othersDb();
    const feature = vi.fn(async () => true);
    const { status, body } = await call(host({ feature }), "/bills/b1", remove, db);
    expect(status).toBe(403);
    expect(body.error).toMatch(/bills you added/);
    expect(feature).toHaveBeenCalledWith(ACTOR, "bos.finance.own_deletes");
    expect(deleted(db, "bos_bills")).toBe(false);
  });

  it("stops staff deleting a colleague's draft invoice once the switch is on", async () => {
    const db = othersDb();
    const { status } = await call(host({ feature: vi.fn(async () => true) }), "/invoices/i1", remove, db);
    expect(status).toBe(403);
    expect(deleted(db, "bos_invoices")).toBe(false);
  });

  it("lets owners delete anyone's bill with the switch on", async () => {
    const db = othersDb();
    await call(host({ feature: vi.fn(async () => true), actor: async () => ({ ...ACTOR, role: "owner" }) }), "/bills/b1", remove, db);
    expect(deleted(db, "bos_bills")).toBe(true);
  });
});

describe("tasks", () => {
  const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it.each([
    ["/tasks", send("POST", { title: " " }), /title/],
    ["/tasks", send("POST", { title: "Weekly site report", recurrence: "weekly" }), /needs a due date/],
    ["/tasks", send("POST", { title: "Install panels", startOn: "2026-10-10", dueOn: "2026-10-09" }), /before the start/],
    ["/tasks", send("POST", { title: "Install panels", milestoneId: "m1" }), /project/],
    ["/tasks", send("POST", { title: "Install panels", priority: "asap" }), /priority/],
    ["/tasks/k1/status", send("POST", { status: "finished" }), /status/],
    ["/projects/p1/milestones", send("POST", { name: "" }), /name/],
    ["/milestones/m1", send("PATCH", { status: "closed" }), /status/],
  ] as const)("checks %s input before querying", async (path, init, detail) => {
    const { status, body, db } = await call(host(), path, init);
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(detail);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("lets staff open the task list", async () => {
    const { status, body } = await call(host(), "/tasks?mine=1");
    expect(status).toBe(503);
    expect(body.code).toBe("BOS_SCHEMA_PENDING");
  });

  /** One open task created by user 99 and assigned to user 42; every other query behaves as if the tables were missing. */
  function taskDb() {
    const db = missingTablesDb();
    const missing = db.query.getMockImplementation()!;
    const task = { id: "k1", task_no: "TSK-0001", title: "Fix inverter", status: "todo", recurrence: "none", due_on: null, created_by: 99, assignee_employee_id: "e9", assignee_user_id: 42 };
    db.query.mockImplementation(((sql: unknown) => (/FROM bos_project_tasks t[\s\S]*WHERE t\.id = :id/.test(String(sql)) ? Promise.resolve([[task], []]) : missing())) as never);
    return db;
  }
  const wrote = (db: ReturnType<typeof taskDb>, re: RegExp) => db.query.mock.calls.some(([sql]) => re.test(String(sql)));
  const as = (userId: number, role: BosActor["role"] = "staff") => host({ actor: async () => ({ ...ACTOR, userId, role }) });

  it("stops staff who neither created nor own a task from changing, moving or deleting it", async () => {
    for (const [path, init] of [
      ["/tasks/k1", send("PATCH", { title: "Renamed" })],
      ["/tasks/k1/status", send("POST", { status: "done" })],
      ["/tasks/k1", { method: "DELETE" }],
    ] as const) {
      const db = taskDb();
      const { status } = await call(host(), path, init, db);
      expect(status).toBe(403);
      expect(wrote(db, /UPDATE bos_project_tasks|DELETE FROM bos_project_tasks/)).toBe(false);
      expect(db.getConnection).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it("lets the assignee move a task along but not cancel or edit it", async () => {
    const moved = await call(as(42), "/tasks/k1/status", send("POST", { status: "in_progress" }), taskDb());
    expect(moved.db.getConnection).toHaveBeenCalled();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    const cancelled = await call(as(42), "/tasks/k1/status", send("POST", { status: "cancelled" }), taskDb());
    expect(cancelled.status).toBe(403);
    expect(cancelled.body.error).toMatch(/cancel/);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    const edited = await call(as(42), "/tasks/k1", send("PATCH", { dueOn: "2026-10-30" }), taskDb());
    expect(edited.status).toBe(403);
  });

  it("lets owners delete anyone's task", async () => {
    const db = taskDb();
    await call(as(1, "owner"), "/tasks/k1", { method: "DELETE" }, db);
    expect(wrote(db, /DELETE FROM bos_project_tasks/)).toBe(true);
  });
});
