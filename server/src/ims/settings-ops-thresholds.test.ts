import { describe, expect, it } from "vitest";
import {
  AUDIT_RULES,
  BANK_MATCH_DEFAULTS,
  DEFAULT_AUDIT_RULE_SETTINGS,
  DEFAULT_AUDIT_SEVERITY_AMOUNT,
  DEFAULT_BANK_MATCH_SETTINGS,
  DEFAULT_REORDER_FALLBACK_FACTOR,
  asObject,
  auditSeverityByAmount,
  autoMatchBank,
  boundedNumber,
  invoiceGstIssues,
  normalizeAuditRules,
  normalizeAuditSeverityAmount,
  normalizeBankMatchDefaults,
  normalizeReorderFallbackFactor,
  reorderQty,
  resolveAuditRules,
  scoreBankMatch,
  suggestBankMatches,
  type AuditInvoice,
  type BankCandidate,
  type BankTxnInput,
} from "./logic.js";
import { DEFAULT_COMMON_CURRENCIES, DEFAULT_DUNNING_FIRM_PAY_WITHIN_DAYS, dunningCopy, normalizeCommonCurrencies, normalizeDunningFirmPayWithinDays } from "./wave6-logic.js";

describe("helpers", () => {
  it("asObject accepts objects and JSON strings, rejects arrays / junk", () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    expect(asObject('{"a":2}')).toEqual({ a: 2 });
    expect(asObject("[1]")).toBeNull();
    expect(asObject([1])).toBeNull();
    expect(asObject("nope")).toBeNull();
    expect(asObject(null)).toBeNull();
  });

  it("boundedNumber clamps, floors ints, keeps zero and falls back on junk", () => {
    expect(boundedNumber(5, 1, 10, 3)).toBe(5);
    expect(boundedNumber(99, 1, 10, 3)).toBe(10);
    expect(boundedNumber(-4, 1, 10, 3)).toBe(1);
    expect(boundedNumber("7.9", 1, 10, 3, true)).toBe(7);
    expect(boundedNumber(1.234, 0, 10, 3)).toBe(1.23);
    expect(boundedNumber(0, 0, 10, 3)).toBe(0);
    expect(boundedNumber(null, 1, 10, 3)).toBe(3);
    expect(boundedNumber("", 1, 10, 3)).toBe(3);
    expect(boundedNumber("abc", 1, 10, 3)).toBe(3);
    expect(boundedNumber(true, 1, 10, 3)).toBe(3);
  });
});

describe("reorder fallback factor", () => {
  it("defaults to 2 and clamps to 1–20", () => {
    expect(DEFAULT_REORDER_FALLBACK_FACTOR).toBe(2);
    expect(normalizeReorderFallbackFactor(undefined)).toBe(2);
    expect(normalizeReorderFallbackFactor(null)).toBe(2);
    expect(normalizeReorderFallbackFactor("")).toBe(2);
    expect(normalizeReorderFallbackFactor("x")).toBe(2);
    expect(normalizeReorderFallbackFactor(0)).toBe(2);
    expect(normalizeReorderFallbackFactor(-3)).toBe(2);
    expect(normalizeReorderFallbackFactor(0.5)).toBe(1);
    expect(normalizeReorderFallbackFactor(3.456)).toBe(3.46);
    expect(normalizeReorderFallbackFactor(500)).toBe(20);
    expect(normalizeReorderFallbackFactor("4")).toBe(4);
  });

  it("reorderQty keeps the historical 2× min unless told otherwise", () => {
    expect(reorderQty({ current: 2, min: 5 })).toBe(8);
    expect(reorderQty({ current: 2, min: 5 }, 3)).toBe(13);
    expect(reorderQty({ current: 2, min: 5 }, 1.5)).toBe(5.5);
    // garbage factors fall back to 2
    expect(reorderQty({ current: 2, min: 5 }, Number.NaN)).toBe(8);
    expect(reorderQty({ current: 2, min: 5 }, 0)).toBe(8);
  });

  it("max stock and an explicit reorder qty still win over the factor", () => {
    expect(reorderQty({ current: 2, min: 5, max: 20 }, 10)).toBe(18);
    expect(reorderQty({ current: 2, min: 5, reorderQty: 24 }, 10)).toBe(24);
    expect(reorderQty({ current: 0, min: 0 }, 5)).toBe(1);
  });
});

describe("bank match defaults", () => {
  it("mirror BANK_MATCH_DEFAULTS", () => {
    expect(DEFAULT_BANK_MATCH_SETTINGS).toEqual({ windowDays: 5, autoScore: 75, amountTolerance: 0.5 });
    expect(DEFAULT_BANK_MATCH_SETTINGS.autoScore).toBe(BANK_MATCH_DEFAULTS.minAutoScore);
  });

  it("falls back per field and clamps", () => {
    expect(normalizeBankMatchDefaults(null)).toEqual(DEFAULT_BANK_MATCH_SETTINGS);
    expect(normalizeBankMatchDefaults({})).toEqual(DEFAULT_BANK_MATCH_SETTINGS);
    expect(normalizeBankMatchDefaults([])).toEqual(DEFAULT_BANK_MATCH_SETTINGS);
    expect(normalizeBankMatchDefaults({ windowDays: 0, autoScore: 10, amountTolerance: 99 })).toEqual({ windowDays: 1, autoScore: 50, amountTolerance: 10 });
    expect(normalizeBankMatchDefaults({ windowDays: 400, autoScore: 500 })).toEqual({ windowDays: 30, autoScore: 100, amountTolerance: 0.5 });
    expect(normalizeBankMatchDefaults({ windowDays: 7.9, autoScore: "88", amountTolerance: 1.234 })).toEqual({ windowDays: 7, autoScore: 88, amountTolerance: 1.23 });
  });

  it("keeps a zero tolerance (exact amounts only) and parses a JSON column", () => {
    expect(normalizeBankMatchDefaults({ amountTolerance: 0 }).amountTolerance).toBe(0);
    expect(normalizeBankMatchDefaults('{"windowDays":9,"autoScore":80,"amountTolerance":0.25}')).toEqual({ windowDays: 9, autoScore: 80, amountTolerance: 0.25 });
    expect(normalizeBankMatchDefaults("not json")).toEqual(DEFAULT_BANK_MATCH_SETTINGS);
  });

  describe("drives the matcher", () => {
    const txn: BankTxnInput & { id: string } = { id: "t1", date: "2026-04-01", description: "NEFT", amount: 5000, direction: "in", reference: null };
    const cand: BankCandidate = { id: "p1", type: "payment", direction: "in", amount: 5000, date: "2026-04-01", label: "Receipt", reference: null, partyName: null };

    it("amount tolerance widens or tightens the amount rule", () => {
      expect(scoreBankMatch(txn, { ...cand, amount: 5003 })).toBeNull();
      expect(scoreBankMatch(txn, { ...cand, amount: 5003 }, 5, 5)).not.toBeNull();
      expect(scoreBankMatch(txn, { ...cand, amount: 5000.4 })).not.toBeNull();
      expect(scoreBankMatch(txn, { ...cand, amount: 5000.4 }, 5, 0)).toBeNull();
    });

    it("window controls how far apart dates may be", () => {
      const far = { ...cand, date: "2026-04-12" };
      expect(scoreBankMatch(txn, far)).toBeNull();
      expect(scoreBankMatch(txn, far, 12)).not.toBeNull();
      expect(suggestBankMatches(txn, [far], 3, 12)).toHaveLength(1);
      expect(suggestBankMatches(txn, [far], 3, 12, 0)).toHaveLength(1);
      expect(suggestBankMatches(txn, [{ ...far, amount: 5003 }], 3, 12, 0)).toHaveLength(0);
    });

    it("auto-match honours the tenant min score", () => {
      // same date, no reference / party → score 80
      expect(scoreBankMatch(txn, cand)?.score).toBe(80);
      expect(autoMatchBank([txn], [cand])).toHaveLength(1);
      expect(autoMatchBank([txn], [cand], { minScore: 90 })).toEqual([]);
      expect(autoMatchBank([txn], [cand], { minScore: 80 })).toHaveLength(1);
      expect(autoMatchBank([txn], [{ ...cand, amount: 5003 }], { amountTolerance: 5 })).toHaveLength(1);
      // 9 days apart: outside the default 5-day window, inside a 10-day one (score 62)
      const late = { ...cand, date: "2026-04-10" };
      expect(autoMatchBank([txn], [late], { minScore: 60 })).toEqual([]);
      expect(autoMatchBank([txn], [late], { windowDays: 10, minScore: 60 })).toHaveLength(1);
      expect(autoMatchBank([txn], [late], { windowDays: 10 })).toEqual([]);
    });
  });
});

describe("audit rule settings", () => {
  it("defaults mirror AUDIT_RULES", () => {
    expect(DEFAULT_AUDIT_RULE_SETTINGS).toEqual({
      overdueArDays: 90,
      overdueApDays: 30,
      largeAdjustment: 25_000,
      largeWriteOff: 10_000,
      gstTolerance: 1,
      unreconciledDays: 7,
      b2cLargeLimit: 100_000,
    });
    expect(normalizeAuditRules(null)).toEqual(DEFAULT_AUDIT_RULE_SETTINGS);
    expect(normalizeAuditRules({})).toEqual(DEFAULT_AUDIT_RULE_SETTINGS);
    expect(resolveAuditRules(null)).toEqual({ ...AUDIT_RULES });
  });

  it("clamps each threshold and falls back per field", () => {
    const out = normalizeAuditRules({
      overdueArDays: 0,
      overdueApDays: 99999,
      largeAdjustment: -5,
      largeWriteOff: 5e10,
      gstTolerance: 500,
      unreconciledDays: 999,
      b2cLargeLimit: "250000",
    });
    expect(out).toEqual({ overdueArDays: 1, overdueApDays: 3650, largeAdjustment: 1, largeWriteOff: 1e9, gstTolerance: 100, unreconciledDays: 365, b2cLargeLimit: 250_000 });
    expect(normalizeAuditRules({ overdueArDays: 45, gstTolerance: "x" })).toEqual({ ...DEFAULT_AUDIT_RULE_SETTINGS, overdueArDays: 45 });
  });

  it("allows zero tolerance and same-day reconciliation, floors whole-day fields", () => {
    expect(normalizeAuditRules({ gstTolerance: 0, unreconciledDays: 0 })).toMatchObject({ gstTolerance: 0, unreconciledDays: 0 });
    expect(normalizeAuditRules({ overdueArDays: 60.9 }).overdueArDays).toBe(60);
  });

  it("parses a JSON column string", () => {
    expect(normalizeAuditRules('{"overdueApDays":14}')).toEqual({ ...DEFAULT_AUDIT_RULE_SETTINGS, overdueApDays: 14 });
    expect(normalizeAuditRules("{broken")).toEqual(DEFAULT_AUDIT_RULE_SETTINGS);
  });

  it("resolveAuditRules maps settings keys onto the AUDIT_RULES shape", () => {
    expect(
      resolveAuditRules({ overdueArDays: 120, overdueApDays: 45, largeAdjustment: 50_000, largeWriteOff: 20_000, gstTolerance: 2, unreconciledDays: 3, b2cLargeLimit: 250_000 }),
    ).toEqual({
      overdueReceivableDays: 120,
      overduePayableDays: 45,
      largeAdjustmentValue: 50_000,
      largeWriteOffValue: 20_000,
      gstTolerance: 2,
      unreconciledAfterDays: 3,
      b2cLargeLimit: 250_000,
    });
  });

  describe("invoiceGstIssues thresholds", () => {
    const inv: AuditInvoice = {
      id: "i1",
      invoiceNo: "INV-1",
      date: "2026-04-10",
      customerName: "Buyer",
      customerGstin: null,
      partyGstin: null,
      intraState: false,
      lines: [],
      taxTotal: 27_000,
      cgst: 0,
      sgst: 0,
      igst: 27_000,
      grandTotal: 150_000,
    };
    const keys = (tolerance?: number, limit?: number) => invoiceGstIssues(inv, tolerance, limit).map((x) => x.key.split(":")[0]);

    it("flags a large B2C sale above the configured limit only", () => {
      expect(keys()).toEqual(["gst-b2cl"]);
      expect(keys(1, 100_000)).toEqual(["gst-b2cl"]);
      expect(keys(1, 200_000)).toEqual([]);
      expect(keys(1, 149_999)).toEqual(["gst-b2cl"]);
    });

    it("GST tolerance decides whether a small tax difference is flagged", () => {
      const withLines: AuditInvoice = { ...inv, lines: [{ name: "Widget", qty: 1, rate: 1000, gstRate: 18, hsn: "8471" }], taxTotal: 182, igst: 182, grandTotal: 1182 };
      expect(invoiceGstIssues(withLines).map((x) => x.key.split(":")[0])).toContain("gst-tax");
      expect(invoiceGstIssues(withLines, 5).map((x) => x.key.split(":")[0])).not.toContain("gst-tax");
    });
  });
});

describe("audit severity amounts", () => {
  it("defaults to 5 lakh / 1 lakh and classifies amounts", () => {
    expect(DEFAULT_AUDIT_SEVERITY_AMOUNT).toEqual({ critical: 500_000, high: 100_000 });
    expect(normalizeAuditSeverityAmount(null)).toEqual({ critical: 500_000, high: 100_000 });
    expect(auditSeverityByAmount(499_999)).toBe("high");
    expect(auditSeverityByAmount(500_000)).toBe("critical");
    expect(auditSeverityByAmount(100_000)).toBe("high");
    expect(auditSeverityByAmount(99_999.99)).toBe("medium");
  });

  it("honours tenant cut-offs", () => {
    const t = normalizeAuditSeverityAmount({ critical: 200_000, high: 50_000 });
    expect(auditSeverityByAmount(60_000, t)).toBe("high");
    expect(auditSeverityByAmount(250_000, t)).toBe("critical");
    expect(auditSeverityByAmount(10_000, t)).toBe("medium");
  });

  it("keeps critical strictly above high and in range", () => {
    expect(normalizeAuditSeverityAmount({ critical: 1000, high: 5000 })).toEqual({ critical: 5001, high: 5000 });
    expect(normalizeAuditSeverityAmount({ critical: 5000, high: 5000 })).toEqual({ critical: 5001, high: 5000 });
    expect(normalizeAuditSeverityAmount({ high: 900_000 })).toEqual({ critical: 900_001, high: 900_000 });
    expect(normalizeAuditSeverityAmount({ high: 0, critical: 0 })).toEqual({ critical: 2, high: 1 });
    expect(normalizeAuditSeverityAmount({ high: 5e10, critical: 5e10 })).toEqual({ critical: 1e9, high: 1e9 - 1 });
    expect(normalizeAuditSeverityAmount('{"critical":300000,"high":75000}')).toEqual({ critical: 300_000, high: 75_000 });
  });
});

describe("dunning firm pay-within days", () => {
  it("defaults to 7 and clamps to 1–90", () => {
    expect(DEFAULT_DUNNING_FIRM_PAY_WITHIN_DAYS).toBe(7);
    expect(normalizeDunningFirmPayWithinDays(undefined)).toBe(7);
    expect(normalizeDunningFirmPayWithinDays(null)).toBe(7);
    expect(normalizeDunningFirmPayWithinDays("")).toBe(7);
    expect(normalizeDunningFirmPayWithinDays("abc")).toBe(7);
    expect(normalizeDunningFirmPayWithinDays(0)).toBe(1);
    expect(normalizeDunningFirmPayWithinDays(-5)).toBe(1);
    expect(normalizeDunningFirmPayWithinDays(14.8)).toBe(14);
    expect(normalizeDunningFirmPayWithinDays(365)).toBe(90);
  });

  it("firm letters quote the configured window; other tones are unchanged", () => {
    const v = { customer: "Acme", total: "₹1,000.00", asOf: "22 Nov 2026", count: 2, business: "Justx" };
    expect(dunningCopy("firm", v).intro).toContain("within the next 7 days.");
    expect(dunningCopy("firm", { ...v, payWithinDays: 14 }).intro).toContain("within the next 14 days.");
    expect(dunningCopy("firm", { ...v, payWithinDays: 1 }).intro).toContain("within the next day.");
    expect(dunningCopy("firm", { ...v, payWithinDays: 9999 }).intro).toContain("within the next 90 days.");
    expect(dunningCopy("friendly", { ...v, payWithinDays: 14 })).toEqual(dunningCopy("friendly", v));
    expect(dunningCopy("final", { ...v, payWithinDays: 14 })).toEqual(dunningCopy("final", v));
  });
});

describe("common currencies", () => {
  it("defaults to INR, USD, EUR, AED, GBP", () => {
    expect(DEFAULT_COMMON_CURRENCIES).toEqual(["INR", "USD", "EUR", "AED", "GBP"]);
    expect(normalizeCommonCurrencies(undefined)).toEqual(["INR", "USD", "EUR", "AED", "GBP"]);
    expect(normalizeCommonCurrencies(null)).toEqual(["INR", "USD", "EUR", "AED", "GBP"]);
    expect(normalizeCommonCurrencies([])).toEqual(["INR", "USD", "EUR", "AED", "GBP"]);
    expect(normalizeCommonCurrencies(["x", "12", "TOOLONG"])).toEqual(["INR", "USD", "EUR", "AED", "GBP"]);
  });

  it("upper-cases, drops invalid codes and duplicates, keeps order", () => {
    expect(normalizeCommonCurrencies(["usd", " eur ", "USD", "bad!", "jpy"])).toEqual(["USD", "EUR", "JPY"]);
  });

  it("caps at 12 and parses a JSON column", () => {
    const many = Array.from({ length: 30 }, (_, i) => `A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    expect(normalizeCommonCurrencies(many)).toHaveLength(12);
    expect(normalizeCommonCurrencies('["sgd","chf"]')).toEqual(["SGD", "CHF"]);
    expect(normalizeCommonCurrencies("not json")).toEqual(["INR", "USD", "EUR", "AED", "GBP"]);
  });

  it("returns a fresh copy of the defaults", () => {
    const a = normalizeCommonCurrencies(null);
    a.push("XXX");
    expect(normalizeCommonCurrencies(null)).toHaveLength(5);
  });
});
