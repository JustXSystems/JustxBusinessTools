import { describe, expect, it } from "vitest";
import { BOOKS_EPOCH, bookStatements, buildBookVouchers, splitInclusiveNote, type BookSources } from "./logic.js";

const sources: BookSources = {
  homeState: "Karnataka",
  parties: [{ id: "p1", name: "Acme", opening: 1000 }],
  invoices: [
    { id: "i0", no: "INV-0099", date: "2026-03-10", party: "Acme", taxable: 100, cgst: 9, sgst: 9, igst: 0, total: 118 },
    { id: "i1", no: "INV-0100", date: "2026-04-10", party: "Acme", taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180 },
  ],
  bills: [{ id: "b1", no: "BILL-1", supplierBillNo: "S-77", date: "2026-04-05", party: "Mumbai Traders", partyState: "Maharashtra", taxable: 500, tax: 90, total: 590 }],
  payments: [
    { id: "pay1", direction: "in", date: "2026-04-20", party: "Acme", amount: 1180, method: "upi", docNo: "INV-0100", reference: "UTR1" },
    { id: "pay2", direction: "out", date: "2026-04-21", party: "Mumbai Traders", amount: 590, method: "cash", docNo: "BILL-1", reference: null },
  ],
  notes: [{ id: "r1", no: "RET-1", kind: "Credit Note", date: "2026-04-25", party: "Acme", against: "INV-0099", taxable: 100, cgst: 9, sgst: 9, igst: 0, total: 118 }],
  expenses: [{ id: "e1", date: "2026-04-30", category: "Rent", description: "April", vendor: "Landlord", amount: 1180, gst: 180, method: "bank" }],
  entries: [
    { id: "l1", date: "2026-04-15", party: "Acme", type: "credit", category: "udhaar", amount: 200, refNo: null, settledOn: null, settleMethod: null },
    { id: "l2", date: "2026-04-01", party: "Mumbai Traders", type: "debit", category: "opening", amount: 50, refNo: null, settledOn: "2026-04-28", settleMethod: "cash" },
  ],
};

describe("books", () => {
  const vouchers = buildBookVouchers(sources);

  it("turns every IMS record into a balanced voucher, oldest first", () => {
    expect(vouchers).toHaveLength(11);
    for (const v of vouchers) {
      const dr = v.lines.reduce((s, l) => s + l.dr, 0);
      const cr = v.lines.reduce((s, l) => s + l.cr, 0);
      expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
    }
    expect(vouchers[0]).toMatchObject({ date: BOOKS_EPOCH, type: "Opening", party: "Acme" });
    expect(vouchers.map((v) => v.date)).toEqual([...vouchers.map((v) => v.date)].sort());
    const bill = vouchers.find((v) => v.type === "Purchase");
    expect(bill?.lines).toContainEqual({ account: "inputIgst", dr: 90, cr: 0 });
    const payment = vouchers.find((v) => v.type === "Payment" && v.source.type === "payment");
    expect(payment?.lines).toContainEqual({ account: "cash", dr: 0, cr: 590 });
    const expense = vouchers.find((v) => v.type === "Expense");
    expect(expense?.lines).toEqual([
      { account: "exp:Rent", dr: 1000, cr: 0 },
      { account: "inputGstExpenses", dr: 180, cr: 0 },
      { account: "bank", dr: 0, cr: 1180 },
    ]);
  });

  it("builds a trial balance, P&L and a balance sheet that all agree", () => {
    const s = bookStatements(vouchers, { from: "2026-04-01", to: "2027-03-31", openingStock: 300, closingStock: 450 });
    expect(s.trialBalance.difference).toBe(0);
    expect(s.profitLoss).toMatchObject({ sales: 1000, salesReturns: 100, netSales: 900, purchases: 500, netPurchases: 500, cogs: 350, grossProfit: 550, totalExpenses: 1000, netProfit: -450 });
    const bs = Object.fromEntries([...s.balanceSheet.assets, ...s.balanceSheet.liabilities].map((r) => [r.name, r.amount]));
    expect(bs["Sundry Debtors"]).toBe(1200);
    expect(bs["Cash in hand"]).toBe(-640);
    expect(bs["Closing stock"]).toBe(450);
    expect(bs["GST input credit"]).toBe(270);
    expect(bs["GST output payable"]).toBe(180);
    expect(bs["Manual ledger entries (suspense)"]).toBe(200);
    // Opening party balance + last year's sale + opening stock − opening debit entry.
    expect(bs["Capital & reserves"]).toBe(1350);
    expect(bs["Loss for the period"]).toBe(-450);
    expect(s.balanceSheet.totalAssets).toBe(1280);
    expect(s.balanceSheet.difference).toBe(0);
  });

  it("ignores anything after the period end", () => {
    const s = bookStatements(vouchers, { from: "2026-04-01", to: "2026-04-12", openingStock: 0, closingStock: 0 });
    expect(s.profitLoss.sales).toBe(1000);
    expect(s.profitLoss.totalExpenses).toBe(0);
    expect(s.trialBalance.difference).toBe(0);
    expect(s.balanceSheet.difference).toBe(0);
  });
});

describe("splitInclusiveNote", () => {
  const lines = [
    { name: "A", qty: 1, rate: 100, gstRate: 18 },
    { name: "B", qty: 2, rate: 50, gstRate: 5 },
  ];

  it("backs GST out of the credited amount at each line's rate", () => {
    expect(splitInclusiveNote(lines, 223, true)).toMatchObject({ taxable: 200, cgst: 11.5, sgst: 11.5, igst: 0, total: 223 });
    const half = splitInclusiveNote(lines, 111.5, false);
    expect(half).toMatchObject({ taxable: 100, cgst: 0, sgst: 0, igst: 11.5, total: 111.5 });
    expect(half.lines.map((l) => l.amount)).toEqual([50, 50]);
  });

  it("keeps line amounts equal to the taxable value and handles empty lines", () => {
    const odd = splitInclusiveNote(lines, 100, true);
    expect(odd.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(odd.taxable, 2);
    expect(Math.round((odd.taxable + odd.cgst + odd.sgst) * 100)).toBe(10000);
    expect(splitInclusiveNote([], 500, true)).toMatchObject({ taxable: 500, cgst: 0, total: 500, lines: [] });
  });
});
