import { describe, expect, it } from "vitest";
import { defaultPayMethodFor, installmentDefaultsFor, payMethodsFor, posPayMethodsFor } from "../finance";
import { GST_RATES, gstRatesFor } from "../format";
import { PREFIX_FIELDS, normalizeGstRateOptions, normalizePaymentTermPresets, parseNumberList, termChipLabel, withOpsSettingsDefaults, withSalesDefaults } from "../settings";

describe("withOpsSettingsDefaults", () => {
  it("fills BOM/DC/RTN prefixes and print/attachment knobs when missing", () => {
    const filled = withOpsSettingsDefaults({});
    expect(filled.bomPrefix).toBe("BOM");
    expect(filled.bomDcPrefix).toBe("DC");
    expect(filled.bomDcReturnPrefix).toBe("RTN");
    expect(filled.printPackMax).toBe(25);
    expect(filled.attachmentMaxBytes).toBe(2 * 1024 * 1024);
    expect(filled.agingBreaks).toEqual([15, 30, 60, 90]);
    expect(filled.arPriority).toEqual({ critical: 91, high: 61, medium: 31 });
    expect(filled.apDueSoonDays).toBe(7);
  });

  it("fills Wave-3 sales / payment defaults when missing", () => {
    const filled = withOpsSettingsDefaults({});
    expect(filled.paymentTermPresets).toEqual([0, 7, 15, 30, 45, 60]);
    expect(filled.defaultRoundToRupee).toBe(true);
    expect(filled.defaultRetentionPct).toBe(0);
    expect(filled.gstRateOptions).toEqual([0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28, 40]);
    expect(filled.payMethods).toEqual(["cash", "upi", "card", "bank", "cheque"]);
    expect(filled.defaultPayMethod).toBe("cash");
    expect(filled.posPayMethods).toEqual(["cash", "upi", "card"]);
    expect(filled.posRoundToRupee).toBe(true);
    expect(filled.defaultInstallmentCount).toBe(3);
    expect(filled.installmentEveryMonths).toBe(1);
    expect(filled.maxInstallments).toBe(60);
  });

  it("preserves explicit Wave-3 values and does not clobber other normalised fields", () => {
    const filled = withOpsSettingsDefaults({
      paymentTermPresets: [10, 20],
      defaultRoundToRupee: false,
      defaultRetentionPct: 5,
      payMethods: ["upi", "bank"],
      defaultPayMethod: "bank",
      posRoundToRupee: false,
      maxInstallments: 12,
      defaultInstallmentCount: 6,
      installmentEveryMonths: 2,
      bomPrefix: "",
    });
    expect(filled.paymentTermPresets).toEqual([10, 20]);
    expect(filled.defaultRoundToRupee).toBe(false);
    expect(filled.defaultRetentionPct).toBe(5);
    expect(filled.payMethods).toEqual(["upi", "bank"]);
    expect(filled.defaultPayMethod).toBe("bank");
    expect(filled.posRoundToRupee).toBe(false);
    expect(filled.maxInstallments).toBe(12);
    expect(filled.defaultInstallmentCount).toBe(6);
    expect(filled.installmentEveryMonths).toBe(2);
    expect(filled.bomPrefix).toBe("BOM");
  });

  it("clamps print pack and attachment size", () => {
    expect(withOpsSettingsDefaults({ printPackMax: 0 }).printPackMax).toBe(25);
    expect(withOpsSettingsDefaults({ printPackMax: 999 }).printPackMax).toBe(200);
    expect(withOpsSettingsDefaults({ attachmentMaxBytes: 100 }).attachmentMaxBytes).toBe(256 * 1024);
    expect(withOpsSettingsDefaults({ attachmentMaxBytes: 50 * 1024 * 1024 }).attachmentMaxBytes).toBe(20 * 1024 * 1024);
  });

  it("preserves explicit values", () => {
    const filled = withOpsSettingsDefaults({
      bomPrefix: "BOQ",
      bomDcPrefix: "CHLN",
      bomDcReturnPrefix: "BRET",
      printPackMax: 10,
      attachmentMaxBytes: 5 * 1024 * 1024,
    });
    expect(filled.bomPrefix).toBe("BOQ");
    expect(filled.bomDcPrefix).toBe("CHLN");
    expect(filled.bomDcReturnPrefix).toBe("BRET");
    expect(filled.printPackMax).toBe(10);
    expect(filled.attachmentMaxBytes).toBe(5 * 1024 * 1024);
  });
});

describe("PREFIX_FIELDS", () => {
  it("includes BOM / DC / return numbering keys", () => {
    const keys = PREFIX_FIELDS.map((f) => f.key);
    expect(keys).toContain("bomPrefix");
    expect(keys).toContain("bomDcPrefix");
    expect(keys).toContain("bomDcReturnPrefix");
  });
});

describe("Wave-3 helpers", () => {
  it("normalises term presets and GST options like the server", () => {
    expect(normalizePaymentTermPresets([30, 7, 7, 999, -1])).toEqual([7, 30]);
    expect(normalizePaymentTermPresets([])).toEqual([0, 7, 15, 30, 45, 60]);
    expect(normalizeGstRateOptions([18, 5, 5, 0])).toEqual([0, 5, 18]);
    expect(normalizeGstRateOptions(null)).toEqual([...GST_RATES]);
  });

  it("parses comma / space separated number lists", () => {
    expect(parseNumberList("0, 7  15,30,")).toEqual([0, 7, 15, 30]);
    expect(parseNumberList("a, 5")).toEqual([5]);
  });

  it("labels term chips", () => {
    expect(termChipLabel(0)).toBe("On receipt");
    expect(termChipLabel(45)).toBe("45 days");
  });

  it("gstRatesFor merges in-use rates into the tenant list", () => {
    expect(gstRatesFor({ gstRateOptions: [18, 5] }, [12, 5])).toEqual([5, 12, 18]);
    expect(gstRatesFor(undefined)).toEqual([...GST_RATES]);
    expect(gstRatesFor({ gstRateOptions: [] })).toEqual([...GST_RATES]);
  });

  it("method helpers only expose built-ins and keep the default valid", () => {
    expect(payMethodsFor({ payMethods: ["upi", "crypto", "cash"] })).toEqual(["upi", "cash"]);
    expect(payMethodsFor(null)).toEqual(["cash", "upi", "card", "bank", "cheque"]);
    expect(defaultPayMethodFor({ payMethods: ["upi", "card"], defaultPayMethod: "bank" })).toBe("upi");
    expect(defaultPayMethodFor({ payMethods: ["upi", "card", "cash"], defaultPayMethod: "card" })).toBe("card");
    expect(posPayMethodsFor({ posPayMethods: ["card", "bank"] })).toEqual(["card"]);
    expect(posPayMethodsFor({ posPayMethods: ["bank"] })).toEqual(["cash", "upi", "card"]);
  });

  it("installment defaults clamp to the ceiling", () => {
    expect(installmentDefaultsFor(null)).toEqual({ defaultInstallmentCount: 3, installmentEveryMonths: 1, maxInstallments: 60 });
    expect(installmentDefaultsFor({ maxInstallments: 4, defaultInstallmentCount: 10, installmentEveryMonths: 99 })).toEqual({ defaultInstallmentCount: 4, installmentEveryMonths: 12, maxInstallments: 4 });
  });

  it("withSalesDefaults leaves unrelated fields alone", () => {
    const out = withSalesDefaults({ bomPrefix: "X" });
    expect(out.bomPrefix).toBe("X");
    expect(out.maxInstallments).toBe(60);
  });
});