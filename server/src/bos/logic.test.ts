import { describe, expect, it } from "vitest";
import {
  agingBucket,
  computeInvoiceTotals,
  countLeaveDays,
  displayStatus,
  fiscalYearLabel,
  formatDocNo,
  initialsOf,
  isISODate,
  isIntraState,
  leaveBalances,
  maskAccount,
  normalizeLeavePolicy,
  outstanding,
  parseWeekendDays,
  phoneKey,
  settleStatus,
  syncSummary,
  todayISO,
  attendanceSummary,
  fiscalYearStart,
  monthEndISO,
  monthsBetween,
  profitAndLoss,
} from "./logic.js";

describe("report periods", () => {
  it("finds the fiscal year start and month ends", () => {
    expect(fiscalYearStart("2026-10-05")).toBe("2026-04-01");
    expect(fiscalYearStart("2027-02-10")).toBe("2026-04-01");
    expect(fiscalYearStart("2026-10-05", 1)).toBe("2026-01-01");
    expect(monthEndISO("2026-02")).toBe("2026-02-28");
    expect(monthEndISO("2028-02")).toBe("2028-02-29");
    expect(monthEndISO("2026-12")).toBe("2026-12-31");
  });

  it("lists months across a year boundary", () => {
    expect(monthsBetween("2026-11-15", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-10-01", "2026-10-31")).toEqual(["2026-10"]);
  });
});

describe("profitAndLoss", () => {
  it("nets purchases, expenses and payroll off GST-exclusive sales, per month and in total", () => {
    const r = profitAndLoss(["2026-08", "2026-09"], {
      sales: new Map([["2026-08", 100000], ["2026-09", 50000.5]]),
      purchases: new Map([["2026-08", 40000]]),
      expenses: new Map([["2026-09", 60000]]),
      payroll: new Map([["2026-09", 20000]]),
    });
    expect(r.months).toEqual([
      { month: "2026-08", sales: 100000, purchases: 40000, expenses: 0, payroll: 0, net: 60000 },
      { month: "2026-09", sales: 50000.5, purchases: 0, expenses: 60000, payroll: 20000, net: -29999.5 },
    ]);
    expect(r.total).toEqual({ sales: 150000.5, purchases: 40000, expenses: 60000, payroll: 20000, net: 30000.5 });
  });
});

describe("attendanceSummary", () => {
  it("counts half days as half attended and flags unmarked working days", () => {
    expect(attendanceSummary({ present: 15, wfh: 2, half_day: 2, absent: 1, leave: 1 }, 22)).toEqual({
      present: 15, wfh: 2, halfDay: 2, absent: 1, leave: 1, unmarked: 1, attendancePct: 82,
    });
  });

  it("handles a month with no working days and never exceeds 100%", () => {
    expect(attendanceSummary({}, 0).attendancePct).toBe(0);
    expect(attendanceSummary({ present: 5 }, 4)).toMatchObject({ unmarked: 0, attendancePct: 100 });
  });
});

describe("syncSummary", () => {
  const item = (target: string, created = true) => ({ target, created });

  it("stays quiet when a sync only touched customers or existing records", () => {
    expect(syncSummary([])).toBeNull();
    expect(syncSummary([item("party"), item("invoice", false)])).toBeNull();
  });

  it("counts new invoices and projects in one message with the right deep link", () => {
    expect(syncSummary([item("party"), item("invoice")])).toEqual({ body: "1 draft invoice created from your tools.", path: "?ws=finance&m=invoices" });
    expect(syncSummary([item("project"), item("project")])).toEqual({ body: "2 project leads created from your tools.", path: "?ws=projects" });
    expect(syncSummary([item("invoice"), item("invoice"), item("invoice"), item("project")])).toEqual({
      body: "3 draft invoices and 1 project lead created from your tools.",
      path: "?ws=connect",
    });
  });
});

describe("computeInvoiceTotals", () => {
  const lines = [
    { description: "5kW solar system", quantity: 1, rate: 145000, taxRate: 12 },
    { description: "AMC", quantity: 2, rate: 6000, taxRate: 18, discountPct: 10 },
  ];

  it("splits intra-state tax into CGST + SGST", () => {
    const t = computeInvoiceTotals(lines, true);
    expect(t.subtotal).toBe(157000);
    expect(t.discountTotal).toBe(1200);
    expect(t.taxTotal).toBe(17400 + 1944);
    expect(t.cgst + t.sgst).toBe(t.taxTotal);
    expect(t.igst).toBe(0);
    expect(t.grandTotal).toBe(157000 - 1200 + 19344);
  });

  it("uses IGST across states", () => {
    const t = computeInvoiceTotals(lines, false);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
    expect(t.igst).toBe(t.taxTotal);
  });

  it("sanitises bad input and allows credit lines", () => {
    const t = computeInvoiceTotals(
      [
        { description: "Buy-back", quantity: 1, rate: -5000, taxRate: 0 },
        { description: "x", quantity: Number.NaN, rate: 100, taxRate: 500 },
      ],
      true,
    );
    expect(t.lines[1].quantity).toBe(0);
    expect(t.lines[1].taxRate).toBe(100);
    expect(t.grandTotal).toBe(-5000);
  });
});

describe("invoice status", () => {
  it("settles by amount paid", () => {
    expect(settleStatus("sent", 1000, 0)).toBe("sent");
    expect(settleStatus("sent", 1000, 400)).toBe("partial");
    expect(settleStatus("partial", 1000, 1000)).toBe("paid");
    expect(settleStatus("draft", 1000, 0)).toBe("draft");
    expect(settleStatus("void", 1000, 1000)).toBe("void");
  });

  it("derives overdue only for open invoices past due", () => {
    const base = { grandTotal: 1000, amountPaid: 0, dueDate: "2026-07-01" };
    expect(displayStatus({ ...base, status: "sent" }, "2026-07-02")).toBe("overdue");
    expect(displayStatus({ ...base, status: "sent" }, "2026-07-01")).toBe("sent");
    expect(displayStatus({ ...base, status: "draft" }, "2026-08-01")).toBe("draft");
    expect(displayStatus({ ...base, status: "paid", amountPaid: 1000 }, "2026-08-01")).toBe("paid");
  });

  it("computes outstanding", () => {
    expect(outstanding({ grandTotal: 1000, amountPaid: 250, status: "partial" })).toBe(750);
    expect(outstanding({ grandTotal: 1000, amountPaid: 0, status: "draft" })).toBe(0);
  });

  it("buckets aging", () => {
    expect(agingBucket(0)).toBe("current");
    expect(agingBucket(29)).toBe("1-30");
    expect(agingBucket(45)).toBe("31-60");
    expect(agingBucket(75)).toBe("61-90");
    expect(agingBucket(120)).toBe("90+");
  });
});

describe("dates and numbering", () => {
  it("validates ISO dates", () => {
    expect(isISODate("2026-02-28")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("28/02/2026")).toBe(false);
  });

  it("labels Indian fiscal years", () => {
    expect(fiscalYearLabel("2026-03-31")).toBe("25-26");
    expect(fiscalYearLabel("2026-04-01")).toBe("26-27");
    expect(fiscalYearLabel("2026-06-15", 1)).toBe("2026");
  });

  it("formats document numbers", () => {
    expect(formatDocNo("inv", "26-27", 7)).toBe("INV/26-27/0007");
    expect(formatDocNo("", "26-27", 12345)).toBe("DOC/26-27/12345");
  });

  it("returns today in the business timezone", () => {
    // 20:00 UTC on 31 Jul is already 1 Aug in India.
    expect(todayISO(new Date("2026-07-31T20:00:00Z"), "Asia/Kolkata")).toBe("2026-08-01");
  });

  it("matches GST states loosely", () => {
    expect(isIntraState("Karnataka", "karnataka ")).toBe(true);
    expect(isIntraState("Karnataka", "Kerala")).toBe(false);
    expect(isIntraState("Karnataka", "")).toBe(true);
  });
});

describe("leave", () => {
  it("skips weekends and holidays", () => {
    // Mon 3 Aug → Sun 9 Aug 2026, Sunday off, Saturday 8th is a holiday.
    expect(countLeaveDays("2026-08-03", "2026-08-09", { holidays: new Set(["2026-08-08"]) })).toBe(5);
    expect(countLeaveDays("2026-08-03", "2026-08-09", { weekendDays: [0, 6] })).toBe(5);
    expect(countLeaveDays("2026-08-03", "2026-08-03", { halfDay: true })).toBe(0.5);
    expect(countLeaveDays("2026-08-09", "2026-08-03")).toBe(0);
  });

  it("parses weekend settings", () => {
    expect(parseWeekendDays("0,6")).toEqual([0, 6]);
    expect(parseWeekendDays("junk")).toEqual([0]);
  });

  it("computes balances against policy", () => {
    const policy = normalizeLeavePolicy({ casual: 10, sick: "8", earned: -1 });
    expect(policy).toEqual({ casual: 10, sick: 8, earned: 15, lop: 0 });
    const b = leaveBalances(policy, { casual: 3.5, lop: 2 });
    expect(b.find((x) => x.type === "casual")?.remaining).toBe(6.5);
    expect(b.find((x) => x.type === "lop")?.used).toBe(2);
  });
});

describe("display helpers", () => {
  it("masks and abbreviates", () => {
    expect(maskAccount("50100234567821")).toBe("•••• •••• 7821");
    expect(maskAccount("")).toBe("");
    expect(initialsOf("Priya Sharma")).toBe("PS");
    expect(initialsOf("madhu")).toBe("MA");
    expect(phoneKey("+91 98450-12233")).toBe("9845012233");
  });
});
