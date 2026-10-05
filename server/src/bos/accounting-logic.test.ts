import { describe, expect, it } from "vitest";
import {
  buildPostings,
  depreciationPostings,
  journalProblem,
  lineTotals,
  movements,
  openingPosting,
  statements,
  suggestOpening,
  SYSTEM_ACCOUNTS,
  type AccountResolver,
  type LedgerSources,
  type Posting,
  type SystemKey,
} from "./accounting-logic.js";
import { bookValue } from "./asset-logic.js";

const system = Object.fromEntries(SYSTEM_ACCOUNTS.map((a) => [a.key, a.key])) as Record<SystemKey, string>;
const accounts = [...SYSTEM_ACCOUNTS.map((a) => ({ id: a.key, type: a.type })), { id: "rent", type: "expense" as const }];
const acc: AccountResolver = { system, byCategory: new Map([["rent", "rent"]]) };

const empty: LedgerSources = { invoices: [], payments: [], bills: [], expenses: [], payroll: [], bankLines: [], assets: [] };
const build = (src: Partial<LedgerSources>, upTo = "2027-03-31", cuts: string[] = []) => buildPostings({ ...empty, ...src }, acc, { upTo, fyStartMonth: 4, cuts });
const linesOf = (p: Posting) => Object.fromEntries(p.lines.map((l) => [l.accountId, l.debit - l.credit]));
const balanced = (ps: Posting[]) => ps.every((p) => lineTotals(p.lines).debit === lineTotals(p.lines).credit);

const sources: Partial<LedgerSources> = {
  invoices: [{ id: "i1", no: "INV/1", date: "2026-05-02", party: "Meridian", tax: 180, total: 1180 }],
  payments: [{ id: "p1", invoiceId: "i1", invoiceNo: "INV/1", party: "Meridian", date: "2026-05-20", amount: 1000, cash: false }],
  bills: [
    { id: "b1", no: "V-9", party: "Vertex", date: "2026-05-03", category: " Rent ", tax: 0, total: 20000, paidOn: "2026-05-10", paidCash: false },
    { id: "b2", no: null, party: "Kirana", date: "2026-05-04", category: null, tax: 90, total: 590, paidOn: null, paidCash: false },
  ],
  expenses: [{ id: "x1", claimant: "Ravi", category: "Travel", date: "2026-05-05", amount: 250, reimbursedOn: "2026-05-06", paidCash: true }],
  payroll: [{ id: "r1", period: "2026-05", label: "May 2026", gross: 50000, employer: 1800, net: 45300, statutory: 5500, other: 1000, paidOn: "2026-06-01", paidCash: false }],
  bankLines: [
    { id: "t1", date: "2026-05-31", description: "SMS CHARGES", amount: -15, category: "Bank charges", cash: false },
    { id: "t2", date: "2026-05-15", description: "CAPITAL", amount: 100000, category: "Owner's contribution", cash: false },
    { id: "t3", date: "2026-05-16", description: "?", amount: 5, category: "Something new", cash: true },
  ],
};

describe("buildPostings", () => {
  it("turns every record into balanced postings", () => {
    const ps = build(sources);
    expect(balanced(ps)).toBe(true);
    expect(ps.map((p) => p.source).sort()).toEqual(["bank", "bank", "bank", "bill", "bill", "bill_payment", "expense", "invoice", "payment", "payroll", "payroll_payment", "reimbursement"]);
  });

  it("posts sales with output GST, and receipts against receivables", () => {
    const ps = build(sources);
    expect(linesOf(ps.find((p) => p.source === "invoice")!)).toEqual({ receivables: 1180, output_gst: -180, sales: -1000 });
    expect(linesOf(ps.find((p) => p.source === "payment")!)).toEqual({ bank: 1000, receivables: -1000 });
  });

  it("routes a bill to its category's account, with input GST and the payment", () => {
    const ps = build(sources);
    const [rent, kirana] = ps.filter((p) => p.source === "bill");
    expect(linesOf(rent)).toEqual({ rent: 20000, payables: -20000 });
    expect(linesOf(kirana)).toEqual({ purchases: 500, input_gst: 90, payables: -590 });
    expect(linesOf(ps.find((p) => p.source === "bill_payment")!)).toEqual({ payables: 20000, bank: -20000 });
  });

  it("books claims and their reimbursement in cash", () => {
    const ps = build(sources);
    expect(linesOf(ps.find((p) => p.source === "expense")!)).toEqual({ employee_expenses: 250, reimbursements: -250 });
    expect(linesOf(ps.find((p) => p.source === "reimbursement")!)).toEqual({ reimbursements: 250, cash: -250 });
  });

  it("accrues payroll at month end with statutory dues, then pays net", () => {
    const ps = build(sources);
    const run = ps.find((p) => p.source === "payroll")!;
    expect(run.date).toBe("2026-05-31");
    expect(linesOf(run)).toEqual({ salaries: 50000, employer_contributions: 1800, salaries_payable: -45300, statutory_payable: -5500, deductions_payable: -1000 });
    expect(linesOf(ps.find((p) => p.source === "payroll_payment")!)).toEqual({ salaries_payable: 45300, bank: -45300 });
  });

  it("keeps payroll balanced when deductions were capped", () => {
    const [run] = build({ payroll: [{ id: "r2", period: "2026-06", label: "June", gross: 1000, employer: 0, net: 0, statutory: 700, other: 500, paidOn: null, paidCash: false }] });
    expect(lineTotals(run.lines).debit).toBe(lineTotals(run.lines).credit);
    expect(linesOf(run).deductions_payable).toBe(-300);
  });

  it("maps bank categories, with unknown ones held in suspense", () => {
    const bank = build(sources).filter((p) => p.source === "bank");
    expect(bank.map(linesOf)).toEqual([
      { bank_charges: 15, bank: -15 },
      { bank: 100000, capital: -100000 },
      { cash: 5, suspense: -5 },
    ]);
  });

  it("leaves out anything after upTo", () => {
    expect(build(sources, "2026-05-10").map((p) => p.source).sort()).toEqual(["bill", "bill", "bill_payment", "expense", "invoice", "reimbursement"]);
  });
});

describe("assets in the ledger", () => {
  const laptop = { id: "a1", tag: "AST-0001", name: "Laptop", cost: 100000, salvage: 0, method: "wdv" as const, rate: 40, purchaseDate: "2025-04-10", billCategory: null, billPosted: true, disposalAmount: 0 };

  it("reclassifies a billed purchase out of purchases and depreciates it per year", () => {
    const ps = build({ assets: [laptop] }, "2026-09-30");
    expect(linesOf(ps[0])).toEqual({ fixed_assets: 100000, purchases: -100000 });
    const dep = ps.filter((p) => p.source === "depreciation");
    expect(dep.map((p) => p.date)).toEqual(["2026-03-31", "2026-09-30"]);
    const total = dep.reduce((s, p) => s + p.lines[0].debit, 0);
    expect(Math.round(total * 100) / 100).toBe(Math.round((100000 - bookValue(laptop, "2026-09-30", 4)) * 100) / 100);
  });

  it("holds an unbilled purchase in suspense", () => {
    const [first] = build({ assets: [{ ...laptop, billPosted: false }] });
    expect(linesOf(first)).toEqual({ fixed_assets: 100000, suspense: -100000 });
  });

  it("splits a year's depreciation at a cut without changing the total", () => {
    const whole = depreciationPostings(laptop, "2027-03-31", 4);
    const split = depreciationPostings(laptop, "2027-03-31", 4, ["2026-06-30"]);
    expect(split.map((d) => d.date)).toEqual(["2026-03-31", "2026-06-30", "2027-03-31"]);
    const sum = (l: Array<{ amount: number }>) => Math.round(l.reduce((s, d) => s + d.amount, 0) * 100) / 100;
    expect(sum(split)).toBe(sum(whole));
  });

  it("removes cost and depreciation on disposal, with the gain or loss", () => {
    const sold = { ...laptop, disposedOn: "2026-06-30", disposalAmount: 70000 };
    const ps = build({ assets: [sold] });
    expect(balanced(ps)).toBe(true);
    const book = bookValue(sold, "2026-06-30", 4);
    const disposal = linesOf(ps.find((p) => p.source === "disposal")!);
    expect(disposal.fixed_assets).toBe(-100000);
    expect(disposal.suspense).toBe(70000);
    expect(disposal.disposal_gain).toBeCloseTo(book - 70000, 2);
    const m = movements(ps, "2000-01-01", "2027-03-31");
    expect(m.get("fixed_assets")?.closing ?? 0).toBe(0);
    expect(m.get("acc_depreciation")?.closing ?? 0).toBe(0);
  });
});

describe("balances and statements", () => {
  it("splits opening, period movement and closing", () => {
    const m = movements(build(sources), "2026-05-11", "2026-05-31");
    expect(m.get("bank")).toEqual({ opening: -20000, debit: 101000, credit: 15, closing: 80985 });
  });

  it("keeps assets equal to liabilities, equity and profit", () => {
    const ps = build({ ...sources, assets: [{ id: "a1", tag: "A", name: "Desk", cost: 30000, salvage: 0, method: "slm", rate: 10, purchaseDate: "2026-04-15", billCategory: null, billPosted: false, disposalAmount: 0 }] });
    const s = statements(movements(ps, "2026-04-01", "2027-03-31"), accounts);
    expect(s.difference).toBe(0);
    expect(s.income).toBe(1000);
    expect(s.net).toBe(Math.round((s.income - s.expense) * 100) / 100);
  });

  it("balances opening entries through the adjustment account", () => {
    const { posting, difference } = openingPosting("2026-03-31", [{ accountId: "bank", debit: 50000, credit: 0 }, { accountId: "capital", debit: 0, credit: 40000 }], "opening_adjustment");
    expect(difference).toBe(10000);
    expect(linesOf(posting!)).toEqual({ bank: 50000, capital: -40000, opening_adjustment: -10000 });
    expect(openingPosting("2026-03-31", [], "opening_adjustment").posting).toBeNull();
  });

  it("suggests opening balances with profit rolled into retained earnings", () => {
    const lines = suggestOpening(build(sources), "2026-05-11", accounts, "retained_earnings");
    const by = Object.fromEntries(lines.map((l) => [l.accountId, l.debit - l.credit]));
    expect(by.bank).toBe(-20000);
    expect(by.receivables).toBe(1180);
    expect(by.sales).toBeUndefined();
    expect(lineTotals(lines).debit).toBe(lineTotals(lines).credit);
    // A loss of 1,000 − 20,000 − 500 − 250 sits as a debit on retained earnings.
    expect(by.retained_earnings).toBe(19750);
  });
});

describe("journalProblem", () => {
  it("accepts a balanced entry and explains what's wrong otherwise", () => {
    expect(journalProblem([{ accountId: "rent", debit: 1800, credit: 0 }, { accountId: "payables", debit: 0, credit: 1800 }])).toBeNull();
    expect(journalProblem([{ accountId: "rent", debit: 1800, credit: 0 }])).toBe("Add at least two lines");
    expect(journalProblem([{ accountId: "rent", debit: 10, credit: 10 }, { accountId: "bank", debit: 0, credit: 10 }])).toBe("Each line is either a debit or a credit");
    expect(journalProblem([{ accountId: "rent", debit: 100, credit: 0 }, { accountId: "bank", debit: 0, credit: 99 }])).toMatch(/must be equal/);
  });
});
