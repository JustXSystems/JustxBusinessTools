import { describe, expect, it } from "vitest";
import { moneyFmt } from "../format";
import {
  DEFAULT_DUNNING_LEVELS,
  addMonthsISO,
  dunningCopy,
  fxPreview,
  installmentGap,
  isForeignCurrency,
  normalizeCurrencyCode,
  pickDunningLevel,
  splitInstallments,
} from "../finance";

describe("fxPreview", () => {
  it("forces rate 1 in the base currency", () => {
    expect(fxPreview({ currencyCode: "INR", fxRate: 83, baseCurrency: "INR", grandTotal: 118 })).toEqual({ currencyCode: "INR", fxRate: 1, fxBaseTotal: 118, foreign: false });
  });

  it("converts foreign totals with the locked rate", () => {
    const r = fxPreview({ currencyCode: "usd", fxRate: 83.2, baseCurrency: "INR", grandTotal: 100.1 });
    expect(r.foreign).toBe(true);
    expect(r.currencyCode).toBe("USD");
    expect(r.fxBaseTotal).toBe(8328.32);
  });

  it("normalizes codes", () => {
    expect(normalizeCurrencyCode("eur")).toBe("EUR");
    expect(normalizeCurrencyCode("e1")).toBe("INR");
    expect(isForeignCurrency("USD")).toBe(true);
    expect(isForeignCurrency("inr")).toBe(false);
  });
});

describe("moneyFmt", () => {
  it("keeps the INR path on the rupee formatter", () => {
    expect(moneyFmt(1234.5, "INR")).toContain("1,234.50");
    expect(moneyFmt(1234.5)).toContain("1,234.50");
    expect(moneyFmt(1234.5, "INR")).not.toContain("INR");
  });

  it("prefixes foreign amounts with the currency code", () => {
    expect(moneyFmt(1234.5, "usd")).toBe("USD 1,234.50");
    expect(moneyFmt(0, "EUR")).toBe("EUR 0.00");
  });
});

describe("splitInstallments", () => {
  it("splits to the paisa with the last installment absorbing rounding", () => {
    const plan = splitInstallments(1000, 3, "2026-12-15");
    expect(plan.map((p) => p.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(installmentGap(plan, 1000)).toBe(0);
  });

  it("steps monthly and clamps to month end", () => {
    expect(splitInstallments(300, 3, "2026-01-31").map((p) => p.dueOn)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(addMonthsISO("2026-11-22", 3)).toBe("2027-02-22");
    expect(addMonthsISO("2026-12-31", 2)).toBe("2027-02-28");
  });

  it("reports the gap when amounts are edited", () => {
    expect(installmentGap([{ amount: 400 }, { amount: 500 }], 1000)).toBe(100);
  });
});

describe("dunning helpers", () => {
  it("picks the strictest level reached", () => {
    expect(pickDunningLevel(DEFAULT_DUNNING_LEVELS, 0)).toBeNull();
    expect(pickDunningLevel(DEFAULT_DUNNING_LEVELS, 3)?.key).toBe("L1");
    expect(pickDunningLevel(DEFAULT_DUNNING_LEVELS, 20)?.key).toBe("L2");
    expect(pickDunningLevel(DEFAULT_DUNNING_LEVELS, 45)?.key).toBe("L3");
  });

  it("changes subject and body by tone", () => {
    const v = { total: "₹500.00", asOf: "22 Nov 2026", count: 1 };
    expect(dunningCopy("friendly", v).subject).toMatch(/friendly/i);
    expect(dunningCopy("firm", v).subject).toMatch(/Second reminder/);
    expect(dunningCopy("final", v).subject).toMatch(/FINAL/);
    expect(dunningCopy("final", v).intro).toContain("invoice is");
  });
});
