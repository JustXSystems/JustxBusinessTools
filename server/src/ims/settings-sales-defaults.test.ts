import { describe, expect, it } from "vitest";
import {
  DEFAULT_GST_RATE_OPTIONS,
  DEFAULT_PAYMENT_TERM_PRESETS,
  GST_SLABS,
  normalizeDefaultPayMethod,
  normalizeGstRateOptions,
  normalizeInstallmentDefaults,
  normalizePayMethods,
  normalizePaymentTermPresets,
  normalizePosPayMethods,
} from "./logic.js";
import { validateInstallments } from "./wave6-logic.js";

describe("normalizePaymentTermPresets", () => {
  it("defaults when missing or empty", () => {
    expect(normalizePaymentTermPresets(null)).toEqual([0, 7, 15, 30, 45, 60]);
    expect(normalizePaymentTermPresets([])).toEqual([...DEFAULT_PAYMENT_TERM_PRESETS]);
    expect(normalizePaymentTermPresets(["x", -5, 9999])).toEqual([...DEFAULT_PAYMENT_TERM_PRESETS]);
  });

  it("sorts, dedupes, floors and caps at 12", () => {
    expect(normalizePaymentTermPresets([30, 7, 7, 15.9, 0])).toEqual([0, 7, 15, 30]);
    expect(normalizePaymentTermPresets(Array.from({ length: 20 }, (_, i) => i))).toHaveLength(12);
  });

  it("parses a JSON string column", () => {
    expect(normalizePaymentTermPresets("[10, 20]")).toEqual([10, 20]);
    expect(normalizePaymentTermPresets("not json")).toEqual([...DEFAULT_PAYMENT_TERM_PRESETS]);
  });
});

describe("normalizeGstRateOptions", () => {
  it("defaults to the standard slabs", () => {
    expect(normalizeGstRateOptions(undefined)).toEqual([...GST_SLABS]);
    expect(DEFAULT_GST_RATE_OPTIONS).toEqual(GST_SLABS);
  });

  it("keeps a custom list sorted, unique and in range", () => {
    expect(normalizeGstRateOptions([18, 5, 5, 0, 101, -1, 12.345])).toEqual([0, 5, 12.35, 18]);
  });
});

describe("pay methods", () => {
  it("keeps only built-in methods, in order", () => {
    expect(normalizePayMethods(["upi", "crypto", "cash", "upi"])).toEqual(["upi", "cash"]);
    expect(normalizePayMethods([])).toEqual(["cash", "upi", "card", "bank", "cheque"]);
    expect(normalizePayMethods(null)).toEqual(["cash", "upi", "card", "bank", "cheque"]);
  });

  it("restricts counter methods to cash / upi / card", () => {
    expect(normalizePosPayMethods(["card", "bank", "cash"])).toEqual(["card", "cash"]);
    expect(normalizePosPayMethods(["bank"])).toEqual(["cash", "upi", "card"]);
  });

  it("default must be enabled, else cash, else first enabled", () => {
    expect(normalizeDefaultPayMethod("upi", ["cash", "upi"])).toBe("upi");
    expect(normalizeDefaultPayMethod("bank", ["cash", "upi"])).toBe("cash");
    expect(normalizeDefaultPayMethod("cash", ["upi", "card"])).toBe("upi");
    expect(normalizeDefaultPayMethod("nope")).toBe("cash");
  });
});

describe("normalizeInstallmentDefaults", () => {
  it("falls back to 3 / 1 / 60", () => {
    expect(normalizeInstallmentDefaults({})).toEqual({ defaultInstallmentCount: 3, installmentEveryMonths: 1, maxInstallments: 60 });
    expect(normalizeInstallmentDefaults(null)).toEqual({ defaultInstallmentCount: 3, installmentEveryMonths: 1, maxInstallments: 60 });
  });

  it("clamps max to 60, count to max and cadence to 12", () => {
    expect(normalizeInstallmentDefaults({ maxInstallments: 500, defaultInstallmentCount: 90, installmentEveryMonths: 40 })).toEqual({
      maxInstallments: 60,
      defaultInstallmentCount: 60,
      installmentEveryMonths: 12,
    });
    expect(normalizeInstallmentDefaults({ maxInstallments: 2, defaultInstallmentCount: 6 })).toMatchObject({ maxInstallments: 2, defaultInstallmentCount: 2 });
  });
});

describe("validateInstallments with a tenant max", () => {
  const items = [
    { dueOn: "2026-12-01", amount: 50 },
    { dueOn: "2027-01-01", amount: 50 },
    { dueOn: "2027-02-01", amount: 0.01 },
  ];

  it("rejects plans above the tenant ceiling", () => {
    const r = validateInstallments(items, 100.01, 2);
    expect(r).toEqual({ ok: false, error: "A plan can have at most 2 installments" });
  });

  it("never exceeds the hard 60 ceiling", () => {
    const many = Array.from({ length: 61 }, (_, i) => ({ dueOn: "2026-12-01", amount: 1 + i * 0 }));
    expect(validateInstallments(many, 61, 500)).toEqual({ ok: false, error: "A plan can have at most 60 installments" });
  });

  it("accepts a valid plan within the ceiling", () => {
    expect(validateInstallments(items, 100.01, 3).ok).toBe(true);
  });
});
