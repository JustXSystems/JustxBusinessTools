import { describe, expect, it } from "vitest";
import {
  allocateFifo,
  arStatus,
  billPayable,
  dayFigures,
  dsoDays,
  dueDateFor,
  gstStateCode,
  gstStateName,
  intraStateFor,
  ledgerEntrySigned,
  payMethodOf,
  posChange,
  reminderLink,
  runningBalance,
  waNumber,
} from "./logic.js";

describe("payMethodOf", () => {
  it("keeps known methods and falls back to bank", () => {
    expect(payMethodOf("upi")).toBe("upi");
    expect(payMethodOf("cheque")).toBe("cheque");
    expect(payMethodOf("neft")).toBe("bank");
    expect(payMethodOf(null)).toBe("bank");
  });
});

describe("GST states", () => {
  it("resolves names, aliases and codes", () => {
    expect(gstStateCode("Karnataka")).toBe("29");
    expect(gstStateCode("karnataka ")).toBe("29");
    expect(gstStateCode("Orissa")).toBe("21");
    expect(gstStateCode("7")).toBe("07");
    expect(gstStateCode("Atlantis")).toBeNull();
    expect(gstStateCode("")).toBeNull();
  });

  it("names the state from a GSTIN or code", () => {
    expect(gstStateName("29ABCDE1234F1Z5")).toBe("Karnataka");
    expect(gstStateName("27")).toBe("Maharashtra");
    expect(gstStateName("XX")).toBeNull();
  });

  it("splits CGST/SGST vs IGST by place of supply", () => {
    const seller = { state: "Karnataka", stateCode: "29" };
    expect(intraStateFor(seller, "Karnataka")).toBe(true);
    expect(intraStateFor(seller, "29")).toBe(true);
    expect(intraStateFor(seller, "Maharashtra")).toBe(false);
    expect(intraStateFor(seller, "")).toBe(true);
    expect(intraStateFor({ state: "Tamil Nadu" }, "33")).toBe(true);
  });
});

describe("dueDateFor", () => {
  it("prefers party terms, then the default", () => {
    expect(dueDateFor("2026-10-01", 15, 30)).toBe("2026-10-16");
    expect(dueDateFor("2026-10-01", null, 30)).toBe("2026-10-31");
    expect(dueDateFor("2026-10-01", 0, 30)).toBe("2026-10-01");
    expect(dueDateFor("2026-12-20", undefined, 15)).toBe("2027-01-04");
  });
});

describe("allocateFifo", () => {
  it("settles oldest first and leaves the rest on account", () => {
    const r = allocateFifo(1500, [
      { id: "a", balance: 1000 },
      { id: "b", balance: 0 },
      { id: "c", balance: 800 },
    ]);
    expect(r.allocations).toEqual([
      { id: "a", amount: 1000 },
      { id: "c", amount: 500 },
    ]);
    expect(r.remainder).toBe(0);
  });

  it("returns the overflow as remainder", () => {
    const r = allocateFifo(1200.5, [{ id: "a", balance: 1000.25 }]);
    expect(r.allocations).toEqual([{ id: "a", amount: 1000.25 }]);
    expect(r.remainder).toBe(200.25);
  });

  it("ignores non-positive amounts", () => {
    expect(allocateFifo(-5, [{ id: "a", balance: 10 }])).toEqual({ allocations: [], remainder: 0 });
  });
});

describe("dsoDays", () => {
  it("scales outstanding over the sales window", () => {
    expect(dsoDays(30000, 90000, 90)).toBe(30);
    expect(dsoDays(0, 90000)).toBe(0);
    expect(dsoDays(5000, 0, 90)).toBe(90);
  });
});

describe("posChange", () => {
  it("returns change or null when short / blank", () => {
    expect(posChange(472, 500)).toBe(28);
    expect(posChange(472.5, 472.5)).toBe(0);
    expect(posChange(472, 400)).toBeNull();
    expect(posChange(472, null)).toBeNull();
    expect(posChange(472, Number.NaN)).toBeNull();
  });
});

describe("reminder links", () => {
  it("normalises Indian mobiles for wa.me", () => {
    expect(waNumber("98450 12345")).toBe("919845012345");
    expect(waNumber("+91 98450-12345")).toBe("919845012345");
    expect(waNumber("09845012345")).toBe("919845012345");
    expect(waNumber("123")).toBeNull();
    expect(waNumber(null)).toBeNull();
  });

  it("builds click-to-send links per channel", () => {
    expect(reminderLink("whatsapp", "9845012345", "Hi there")).toBe("https://wa.me/919845012345?text=Hi%20there");
    expect(reminderLink("whatsapp", "", "Hi")).toBe("https://wa.me/?text=Hi");
    expect(reminderLink("sms", "+91 98450 12345", "Pay ₹100")).toBe(`sms:+919845012345?body=${encodeURIComponent("Pay ₹100")}`);
    expect(reminderLink("email", "a@b.in", "Body", "Due")).toBe("mailto:a@b.in?subject=Due&body=Body");
  });
});

describe("arStatus", () => {
  const base = { disputed: false, promiseDate: null, dueDate: "2026-10-10", amountPaid: 0 };
  it("ranks disputes, then promises, then aging", () => {
    expect(arStatus({ ...base, disputed: true, promiseDate: "2026-10-20" }, "2026-10-12")).toBe("disputed");
    expect(arStatus({ ...base, promiseDate: "2026-10-20" }, "2026-10-12")).toBe("promise");
    expect(arStatus({ ...base, promiseDate: "2026-10-11" }, "2026-10-12")).toBe("promise_missed");
    expect(arStatus(base, "2026-10-12")).toBe("overdue");
    expect(arStatus({ ...base, dueDate: "2026-10-30", amountPaid: 50 }, "2026-10-12")).toBe("partial");
    expect(arStatus({ ...base, dueDate: null }, "2026-10-12")).toBe("due");
  });
});

describe("billPayable", () => {
  it("allows payment only on approved or scheduled bills", () => {
    expect(billPayable("approved")).toBe(true);
    expect(billPayable("scheduled")).toBe(true);
    expect(billPayable("pending_approval")).toBe(false);
    expect(billPayable("on_hold")).toBe(false);
    expect(billPayable("paid")).toBe(false);
  });
});

describe("ledger", () => {
  it("signs manual entries (credit = they owe you)", () => {
    expect(ledgerEntrySigned("credit", 100.005)).toBe(100.01);
    expect(ledgerEntrySigned("debit", 250)).toBe(-250);
  });

  it("computes the running balance in order", () => {
    const rows = runningBalance(1000, [
      { ref: "INV-1", debit: 500, credit: 0 },
      { ref: "RCPT", debit: 0, credit: 1200 },
      { ref: "INV-2", debit: 0.1, credit: 0.2 },
    ]);
    expect(rows.map((r) => r.balance)).toEqual([1500, 300, 299.9]);
    expect(rows[0].ref).toBe("INV-1");
  });
});

describe("dayFigures", () => {
  it("splits receipts, payments and expenses by method and derives expected cash", () => {
    const f = dayFigures(
      [
        { direction: "in", method: "cash", amount: 1000, sameDaySale: true },
        { direction: "in", method: "upi", amount: 500, sameDaySale: true },
        { direction: "in", method: "cash", amount: 300, sameDaySale: false },
        { direction: "out", method: "cash", amount: 200, sameDaySale: false },
        { direction: "out", method: "bank", amount: 5000, sameDaySale: false },
      ],
      [
        { method: "cash", amount: 150 },
        { method: "upi", amount: 99.5 },
      ],
      2000,
    );
    expect(f.sales.cash).toBe(1000);
    expect(f.sales.upi).toBe(500);
    expect(f.collections.cash).toBe(300);
    expect(f.paid.bank).toBe(5000);
    expect(f.totals).toEqual({ sales: 1500, collections: 300, paid: 5200, expenses: 249.5 });
    expect(f.expectedCash).toBe(2000 + 1000 + 300 - 200 - 150);
  });

  it("treats unknown methods as bank", () => {
    const f = dayFigures([{ direction: "in", method: "neft", amount: 10, sameDaySale: false }], [], 0);
    expect(f.collections.bank).toBe(10);
    expect(f.expectedCash).toBe(0);
  });
});
