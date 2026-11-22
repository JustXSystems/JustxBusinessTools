import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUNNING_SEQUENCES,
  allocateToInstallments,
  deallocateFromInstallments,
  dunningCopy,
  findDunningLevel,
  isPortalToken,
  newPortalToken,
  normalizeCurrencyCode,
  normalizeDunningSequences,
  parseCurrencyCode,
  pickDunningLevel,
  resolveFx,
  upiIntent,
  validateInstallments,
} from "./wave6-logic.js";

describe("currency + fx", () => {
  it("validates ISO-shaped codes", () => {
    expect(parseCurrencyCode(" usd ")).toBe("USD");
    expect(parseCurrencyCode("US")).toBeNull();
    expect(parseCurrencyCode("US1")).toBeNull();
    expect(normalizeCurrencyCode("zzz!", "AED")).toBe("AED");
    expect(normalizeCurrencyCode(undefined)).toBe("INR");
  });

  it("forces rate 1 and base total = grand total in the base currency", () => {
    const r = resolveFx({ currencyCode: "INR", fxRate: 83.5, baseCurrency: "INR", grandTotal: 1180 });
    expect(r).toEqual({ currencyCode: "INR", fxRate: 1, fxBaseTotal: 1180, foreign: false });
  });

  it("defaults to the base currency when none is given", () => {
    expect(resolveFx({ baseCurrency: "AED", grandTotal: 50 }).currencyCode).toBe("AED");
    expect(resolveFx({ grandTotal: 50 }).currencyCode).toBe("INR");
  });

  it("locks the rate and converts foreign totals", () => {
    const r = resolveFx({ currencyCode: "usd", fxRate: 83.1234, baseCurrency: "INR", grandTotal: 1000.5 });
    expect(r.foreign).toBe(true);
    expect(r.currencyCode).toBe("USD");
    expect(r.fxRate).toBe(83.1234);
    expect(r.fxBaseTotal).toBe(83164.96);
  });

  it("falls back to rate 1 for a missing or non-positive foreign rate", () => {
    expect(resolveFx({ currencyCode: "EUR", fxRate: 0, grandTotal: 10 }).fxRate).toBe(1);
    expect(resolveFx({ currencyCode: "EUR", fxRate: "abc", grandTotal: 10 }).fxBaseTotal).toBe(10);
  });
});

describe("validateInstallments", () => {
  const ok = [
    { dueOn: "2026-12-15", amount: 500 },
    { dueOn: "2026-11-30", amount: 500.5, label: " First " },
  ];

  it("accepts a plan that sums to the balance and sorts by due date", () => {
    const r = validateInstallments(ok, 1000.5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items.map((i) => i.dueOn)).toEqual(["2026-11-30", "2026-12-15"]);
      expect(r.items[0].label).toBe("First");
      expect(r.total).toBe(1000.5);
    }
  });

  it("rejects a total that does not match the balance", () => {
    const r = validateInstallments(ok, 1200);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must match/);
  });

  it("rejects empty plans, zero amounts and bad dates", () => {
    expect(validateInstallments([], 100).ok).toBe(false);
    expect(validateInstallments([{ dueOn: "2026-12-01", amount: 0 }], 100).ok).toBe(false);
    expect(validateInstallments([{ dueOn: "12/01/2026", amount: 100 }], 100).ok).toBe(false);
    expect(validateInstallments([{ dueOn: "2026-12-01", amount: 100 }], 0).ok).toBe(false);
  });
});

describe("installment allocation", () => {
  const rows = [
    { id: "a", amount: 400, amountPaid: 0 },
    { id: "b", amount: 300, amountPaid: 0 },
    { id: "c", amount: 300, amountPaid: 0 },
  ];

  it("fills the earliest installments first", () => {
    const r = allocateToInstallments(rows, 500);
    expect(r.changes).toEqual([
      { id: "a", amountPaid: 400, status: "paid" },
      { id: "b", amountPaid: 100, status: "partial" },
    ]);
    expect(r.remainder).toBe(0);
  });

  it("skips settled rows and reports any remainder", () => {
    const r = allocateToInstallments([{ id: "a", amount: 100, amountPaid: 100 }, { id: "b", amount: 50, amountPaid: 0 }], 80);
    expect(r.changes).toEqual([{ id: "b", amountPaid: 50, status: "paid" }]);
    expect(r.remainder).toBe(30);
  });

  it("takes a voided payment back from the latest paid installments", () => {
    const paid = [
      { id: "a", amount: 400, amountPaid: 400 },
      { id: "b", amount: 300, amountPaid: 100 },
      { id: "c", amount: 300, amountPaid: 0 },
    ];
    const r = deallocateFromInstallments(paid, 150);
    expect(r.changes).toEqual([
      { id: "b", amountPaid: 0, status: "pending" },
      { id: "a", amountPaid: 350, status: "partial" },
    ]);
    expect(r.remainder).toBe(0);
  });
});

describe("dunning levels", () => {
  it("falls back to the default L1/L2/L3 sequence", () => {
    expect(normalizeDunningSequences(null)).toEqual(DEFAULT_DUNNING_SEQUENCES);
    expect(normalizeDunningSequences("not json")).toEqual(DEFAULT_DUNNING_SEQUENCES);
    expect(normalizeDunningSequences([])).toEqual(DEFAULT_DUNNING_SEQUENCES);
  });

  it("cleans, dedupes and sorts submitted levels", () => {
    const out = normalizeDunningSequences(
      JSON.stringify([
        { key: "l2", label: "Second", minDaysOverdue: 20, tone: "FIRM" },
        { key: "L2", label: "Dup", minDaysOverdue: 5, tone: "final" },
        { key: "bad key!", label: "x", minDaysOverdue: 1, tone: "firm" },
        { key: "L1", label: "", minDaysOverdue: 3, tone: "weird" },
      ]),
    );
    expect(out).toEqual([
      { key: "L1", label: "L1", minDaysOverdue: 3, tone: "friendly" },
      { key: "L2", label: "Second", minDaysOverdue: 20, tone: "firm" },
    ]);
  });

  it("picks the strictest level reached", () => {
    const levels = [...DEFAULT_DUNNING_SEQUENCES];
    expect(pickDunningLevel(levels, 0)).toBeNull();
    expect(pickDunningLevel(levels, 1)?.key).toBe("L1");
    expect(pickDunningLevel(levels, 14)?.key).toBe("L1");
    expect(pickDunningLevel(levels, 15)?.key).toBe("L2");
    expect(pickDunningLevel(levels, 200)?.key).toBe("L3");
  });

  it("finds a level by key, case-insensitively", () => {
    expect(findDunningLevel(DEFAULT_DUNNING_SEQUENCES, "l3")?.tone).toBe("final");
    expect(findDunningLevel(DEFAULT_DUNNING_SEQUENCES, "L9")).toBeNull();
  });

  it("changes the wording with the tone", () => {
    const v = { customer: "Acme", total: "₹1,000.00", asOf: "22 Nov 2026", count: 2, business: "Justx" };
    const friendly = dunningCopy("friendly", v);
    const final = dunningCopy("final", v);
    expect(friendly.subject).not.toBe(final.subject);
    expect(final.subject).toMatch(/FINAL/);
    expect(friendly.intro).toContain("invoices are");
    expect(dunningCopy("firm", { ...v, count: 1 }).intro).toContain("invoice is");
  });
});

describe("portal helpers", () => {
  it("generates url-safe tokens that pass the shape check", () => {
    const t = newPortalToken();
    expect(isPortalToken(t)).toBe(true);
    expect(newPortalToken()).not.toBe(t);
    expect(isPortalToken("short")).toBe(false);
    expect(isPortalToken("has spaces and !!! chars ......")).toBe(false);
  });

  it("builds an INR UPI intent only for a valid VPA", () => {
    const u = upiIntent({ vpa: "shop@upi", payeeName: "Shop", amount: 1234.5, note: "INV-1" });
    expect(u).toContain("upi://pay?");
    expect(u).toContain("pa=shop%40upi");
    expect(u).toContain("am=1234.50");
    expect(upiIntent({ vpa: "nope" })).toBeNull();
  });
});
