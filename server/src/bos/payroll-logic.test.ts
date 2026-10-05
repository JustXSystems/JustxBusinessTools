import { describe, expect, it } from "vitest";
import {
  annualTaxNewRegime,
  computePayslip,
  DEFAULT_PAYROLL_CONFIG,
  lossOfPayDays,
  normalizePayrollConfig,
  professionalTax,
  structureFromCtc,
  type PayrollConfig,
} from "./payroll-logic.js";

const config = (over: Partial<PayrollConfig> = {}): PayrollConfig => ({ ...DEFAULT_PAYROLL_CONFIG, ...over });
const structure = (basic: number, hra: number, special: number, over: { pf?: boolean; pt?: boolean; tdsMonthly?: number | null } = {}) => ({
  basic,
  hra,
  special,
  pf: over.pf ?? true,
  pt: over.pt ?? true,
  tdsMonthly: over.tdsMonthly ?? null,
});
const amount = (lines: ReadonlyArray<{ key: string; amount: number }>, key: string) => lines.find((l) => l.key === key)?.amount;

describe("payroll settings", () => {
  it("starts with statutory deductions off and repairs bad input", () => {
    expect(normalizePayrollConfig(null)).toEqual(DEFAULT_PAYROLL_CONFIG);
    expect(DEFAULT_PAYROLL_CONFIG.pfEnabled || DEFAULT_PAYROLL_CONFIG.esiEnabled || DEFAULT_PAYROLL_CONFIG.ptSlabs.length > 0).toBe(false);
    const c = normalizePayrollConfig({ basicPct: 500, hraPct: -3, pfEnabled: true, ptSlabs: [{ from: 25000, amount: 200 }, { from: "x" }, { from: 15000, amount: 150 }] });
    expect(c.basicPct).toBe(100);
    expect(c.hraPct).toBe(0);
    expect(c.pfEnabled).toBe(true);
    expect(c.ptSlabs).toEqual([
      { from: 15000, amount: 150 },
      { from: 25000, amount: 200 },
    ]);
  });
});

describe("structureFromCtc", () => {
  it("splits CTC ÷ 12 into basic, HRA and special when PF is off", () => {
    expect(structureFromCtc(360000, config())).toEqual({ basic: 15000, hra: 6000, special: 9000 });
  });

  it("keeps the employer's PF share inside the CTC", () => {
    const s = structureFromCtc(360000, config({ pfEnabled: true }));
    expect(s).toEqual({ basic: 14151, hra: 5660, special: 8491 });
    expect(s.basic + s.hra + s.special + Math.round(s.basic * 0.12)).toBe(30000);
  });

  it("caps the employer's PF at 12% of ₹15,000 for higher salaries", () => {
    expect(structureFromCtc(1200000, config({ pfEnabled: true }))).toEqual({ basic: 49100, hra: 19640, special: 29460 });
  });
});

describe("statutory rules", () => {
  it("picks the highest professional-tax slab that the gross reaches", () => {
    const slabs = [
      { from: 15000, amount: 150 },
      { from: 25000, amount: 200 },
    ];
    expect(professionalTax(10000, slabs)).toBe(0);
    expect(professionalTax(20000, slabs)).toBe(150);
    expect(professionalTax(25000, slabs)).toBe(200);
    expect(professionalTax(90000, [])).toBe(0);
  });

  it("estimates new-regime tax with the ₹12 lakh rebate, marginal relief, surcharge and cess", () => {
    expect(annualTaxNewRegime(1000000)).toBe(0);
    expect(annualTaxNewRegime(1275000)).toBe(0);
    expect(annualTaxNewRegime(1285000)).toBe(10400);
    expect(annualTaxNewRegime(1875000)).toBe(166400);
    expect(annualTaxNewRegime(6075000)).toBe(1578720);
  });

  it("counts loss of pay from absences, half days, LOP leave and (optionally) unmarked days", () => {
    const counts = { absent: 2, halfDay: 1, lopLeave: 1.5, unmarked: 3 };
    expect(lossOfPayDays(counts, true)).toBe(4);
    expect(lossOfPayDays(counts, false)).toBe(7);
  });
});

describe("computePayslip", () => {
  it("pays the full structure when nothing statutory applies", () => {
    const p = computePayslip({ structure: structure(15000, 6000, 9000), config: config(), daysInMonth: 30, paidDays: 30 });
    expect(p.gross).toBe(30000);
    expect(p.deductions).toEqual([]);
    expect(p.netPay).toBe(30000);
    expect(p.employerCost).toBe(30000);
    expect(p.tdsEstimated).toBe(true);
  });

  it("prorates for loss of pay and caps the PF wage", () => {
    const p = computePayslip({
      structure: structure(20000, 8000, 12000),
      config: config({ pfEnabled: true, ptSlabs: [{ from: 25000, amount: 200 }] }),
      daysInMonth: 31,
      paidDays: 29,
    });
    expect(amount(p.earnings, "basic")).toBe(18710);
    expect(p.gross).toBe(37420);
    expect(p.pfWage).toBe(15000);
    expect(amount(p.deductions, "pf")).toBe(1800);
    expect(amount(p.deductions, "pt")).toBe(200);
    expect(amount(p.deductions, "tds")).toBeUndefined();
    expect(p.netPay).toBe(35420);
    expect(p.employerCost).toBe(39220);
  });

  it("applies ESI below ₹21,000 gross, rounding contributions up", () => {
    const p = computePayslip({ structure: structure(9000, 3600, 5400, { pf: false }), config: config({ esiEnabled: true, pfEnabled: true }), daysInMonth: 30, paidDays: 30 });
    expect(amount(p.deductions, "esi")).toBe(135);
    expect(amount(p.employer, "esi")).toBe(585);
    expect(amount(p.deductions, "pf")).toBeUndefined();
    expect(p.netPay).toBe(17865);
    expect(p.employerCost).toBe(18585);
    const above = computePayslip({ structure: structure(12000, 4800, 7200), config: config({ esiEnabled: true }), daysInMonth: 30, paidDays: 30 });
    expect(amount(above.deductions, "esi")).toBeUndefined();
  });

  it("keeps a bonus out of the PF and ESI wage", () => {
    const p = computePayslip({ structure: structure(9000, 3600, 5400), config: config({ esiEnabled: true, pfEnabled: true, pfCapWage: false }), daysInMonth: 30, paidDays: 30, bonus: 2000 });
    expect(p.gross).toBe(20000);
    expect(amount(p.deductions, "pf")).toBe(1080);
    expect(p.esiWage).toBe(18000);
    expect(p.employerCost).toBe(21665);
  });

  it("estimates TDS from the structure unless fixed or overridden", () => {
    const high = structure(100000, 40000, 60000);
    expect(amount(computePayslip({ structure: high, config: config(), daysInMonth: 30, paidDays: 30 }).deductions, "tds")).toBe(24375);
    const overridden = computePayslip({ structure: high, config: config(), daysInMonth: 30, paidDays: 30, tdsOverride: 0 });
    expect(amount(overridden.deductions, "tds")).toBeUndefined();
    expect(overridden.tdsEstimated).toBe(false);
  });

  it("never deducts more than the gross", () => {
    const p = computePayslip({ structure: structure(1000, 0, 0, { tdsMonthly: 5000 }), config: config(), daysInMonth: 30, paidDays: 30, otherDeduction: 300 });
    expect(amount(p.deductions, "other")).toBe(300);
    expect(amount(p.deductions, "tds")).toBe(700);
    expect(p.netPay).toBe(0);
  });

  it("pays nothing and deducts nothing for a month with no paid days", () => {
    const p = computePayslip({ structure: structure(20000, 8000, 12000), config: config({ pfEnabled: true, ptSlabs: [{ from: 0, amount: 200 }] }), daysInMonth: 30, paidDays: 0 });
    expect(p.gross).toBe(0);
    expect(p.totalDeductions).toBe(0);
    expect(p.netPay).toBe(0);
  });
});
