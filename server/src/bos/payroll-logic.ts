/**
 * Pure payroll rules (no I/O): payroll settings, salary split from CTC, loss of pay,
 * PF / ESI / professional tax, a new-regime TDS estimate and the payslip itself.
 * Amounts on a payslip are whole rupees, as on Indian payslips and statutory returns.
 */
import { num, round2 } from "./logic.js";

export const PF_RATE = 0.12;
export const PF_WAGE_CEILING = 15_000;
export const ESI_EMPLOYEE_RATE = 0.0075;
export const ESI_EMPLOYER_RATE = 0.0325;
/** ESI covers employees whose monthly gross is at most this. */
export const ESI_GROSS_LIMIT = 21_000;

export type PtSlab = { from: number; amount: number };

export type PayrollConfig = {
  /** Basic as a share of monthly gross, when splitting a CTC. */
  basicPct: number;
  /** HRA as a share of basic, when splitting a CTC. */
  hraPct: number;
  pfEnabled: boolean;
  /** Restrict the PF wage to the statutory ceiling (₹15,000). */
  pfCapWage: boolean;
  esiEnabled: boolean;
  /** Monthly professional tax by gross pay; the highest slab whose `from` is met applies. Empty = no PT. */
  ptSlabs: PtSlab[];
  /** Working days without an attendance mark are paid (true) or loss of pay (false). */
  unmarkedPaid: boolean;
};

/** Statutory deductions start off: an owner opts in to what applies to their establishment. */
export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  basicPct: 50,
  hraPct: 40,
  pfEnabled: false,
  pfCapWage: true,
  esiEnabled: false,
  ptSlabs: [],
  unmarkedPaid: true,
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const rupee = (n: number) => Math.round(n + Number.EPSILON);

export function normalizePayrollConfig(raw: unknown): PayrollConfig {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PAYROLL_CONFIG;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const slabs = Array.isArray(src.ptSlabs)
    ? (src.ptSlabs as unknown[])
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
        .map((s) => ({ from: Math.max(0, num(s.from, NaN)), amount: Math.max(0, num(s.amount, NaN)) }))
        .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.amount))
        .sort((a, b) => a.from - b.from)
        .slice(0, 12)
    : d.ptSlabs;
  return {
    basicPct: clamp(num(src.basicPct, d.basicPct), 10, 100),
    hraPct: clamp(num(src.hraPct, d.hraPct), 0, 100),
    pfEnabled: bool(src.pfEnabled, d.pfEnabled),
    pfCapWage: bool(src.pfCapWage, d.pfCapWage),
    esiEnabled: bool(src.esiEnabled, d.esiEnabled),
    ptSlabs: slabs,
    unmarkedPaid: bool(src.unmarkedPaid, d.unmarkedPaid),
  };
}

export type SalaryComponents = { basic: number; hra: number; special: number };

/**
 * Monthly components from an annual CTC. CTC covers gross pay plus the employer's PF share,
 * so with PF on the gross is what remains after employer PF on basic.
 */
export function structureFromCtc(ctcAnnual: number, config: PayrollConfig): SalaryComponents {
  const monthly = Math.max(0, num(ctcAnnual)) / 12;
  const b = config.basicPct / 100;
  let gross = monthly;
  if (config.pfEnabled) {
    const uncapped = monthly / (1 + PF_RATE * b);
    gross = config.pfCapWage && uncapped * b > PF_WAGE_CEILING ? monthly - PF_RATE * PF_WAGE_CEILING : uncapped;
  }
  gross = rupee(gross);
  const basic = rupee(gross * b);
  const hra = Math.min(gross - basic, rupee((basic * config.hraPct) / 100));
  return { basic, hra, special: gross - basic - hra };
}

export function professionalTax(gross: number, slabs: ReadonlyArray<PtSlab>): number {
  let amount = 0;
  for (const s of slabs) if (gross >= s.from) amount = s.amount;
  return rupee(amount);
}

const NEW_REGIME_SLABS: ReadonlyArray<[upTo: number, rate: number]> = [
  [400_000, 0],
  [800_000, 0.05],
  [1_200_000, 0.1],
  [1_600_000, 0.15],
  [2_000_000, 0.2],
  [2_400_000, 0.25],
  [Infinity, 0.3],
];
export const STANDARD_DEDUCTION = 75_000;
const REBATE_LIMIT = 1_200_000;

/**
 * Annual income tax on salary under the new regime (slabs from FY 2025-26): ₹75,000 standard
 * deduction, full rebate up to ₹12 lakh taxable with marginal relief above it, surcharge over
 * ₹50 lakh (capped at 25%) and 4% cess. An estimate for monthly TDS, not a tax computation.
 */
export function annualTaxNewRegime(annualSalary: number): number {
  const taxable = Math.max(0, num(annualSalary) - STANDARD_DEDUCTION);
  let tax = 0;
  let floor = 0;
  for (const [upTo, rate] of NEW_REGIME_SLABS) {
    if (taxable <= floor) break;
    tax += (Math.min(taxable, upTo) - floor) * rate;
    floor = upTo;
  }
  if (taxable <= REBATE_LIMIT) return 0;
  tax = Math.min(tax, taxable - REBATE_LIMIT);
  const surcharge = taxable > 20_000_000 ? 0.25 : taxable > 10_000_000 ? 0.15 : taxable > 5_000_000 ? 0.1 : 0;
  return rupee(tax * (1 + surcharge) * 1.04);
}

export type LopCounts = { absent: number; halfDay: number; lopLeave: number; unmarked: number };

/** Loss-of-pay days: absences, ½ per half day, approved LOP leave, and unmarked days if those aren't paid. */
export function lossOfPayDays(c: LopCounts, unmarkedPaid: boolean): number {
  const n = (v: number) => Math.max(0, num(v));
  return round2(n(c.absent) + n(c.halfDay) * 0.5 + n(c.lopLeave) + (unmarkedPaid ? 0 : n(c.unmarked)));
}

export type PayslipLine = { key: string; label: string; amount: number };

export type PayslipInput = {
  structure: SalaryComponents & { pf: boolean; pt: boolean; tdsMonthly: number | null };
  config: PayrollConfig;
  daysInMonth: number;
  /** Days employed in the month minus loss of pay. */
  paidDays: number;
  bonus?: number;
  otherDeduction?: number;
  /** This month's TDS instead of the structure's fixed amount or estimate. */
  tdsOverride?: number | null;
};

export type PayslipCalc = {
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employer: PayslipLine[];
  gross: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  pfWage: number;
  esiWage: number;
  /** True when TDS is the new-regime estimate rather than a fixed or overridden amount. */
  tdsEstimated: boolean;
};

/**
 * One employee's month. Regular components are prorated by paid days; a bonus is paid in full and
 * kept out of the PF and ESI wage. Deductions never exceed gross: TDS, then other deductions, give way.
 */
export function computePayslip(input: PayslipInput): PayslipCalc {
  const { structure: s, config } = input;
  const days = Math.max(1, num(input.daysInMonth, 30));
  const paid = clamp(num(input.paidDays), 0, days);
  const factor = paid / days;
  const basic = rupee(num(s.basic) * factor);
  const hra = rupee(num(s.hra) * factor);
  const special = rupee(num(s.special) * factor);
  const bonus = rupee(Math.max(0, num(input.bonus)));
  const regular = basic + hra + special;
  const gross = regular + bonus;
  const fullGross = num(s.basic) + num(s.hra) + num(s.special);

  const pfOn = config.pfEnabled && s.pf;
  const pfWage = pfOn ? (config.pfCapWage ? Math.min(basic, PF_WAGE_CEILING) : basic) : 0;
  const pfEmployee = rupee(pfWage * PF_RATE);
  const pfEmployer = pfEmployee;

  const esiOn = config.esiEnabled && fullGross > 0 && fullGross <= ESI_GROSS_LIMIT;
  const esiWage = esiOn ? regular : 0;
  const roundUp = (n: number) => (n > 0 ? Math.ceil(n - 1e-9) : 0);
  const esiEmployee = roundUp(esiWage * ESI_EMPLOYEE_RATE);
  const esiEmployer = roundUp(esiWage * ESI_EMPLOYER_RATE);

  const pt = s.pt && paid > 0 ? professionalTax(gross, config.ptSlabs) : 0;
  const statutory = pfEmployee + esiEmployee + pt;
  const room = Math.max(0, gross - statutory);
  const other = Math.min(room, rupee(Math.max(0, num(input.otherDeduction))));

  const override = input.tdsOverride !== null && input.tdsOverride !== undefined;
  const fixed = s.tdsMonthly !== null && s.tdsMonthly !== undefined;
  const tdsWanted = override ? num(input.tdsOverride) : fixed ? num(s.tdsMonthly) : paid > 0 ? annualTaxNewRegime(fullGross * 12) / 12 : 0;
  const tds = Math.min(room - other, rupee(Math.max(0, tdsWanted)));

  const line = (key: string, label: string, amount: number): PayslipLine => ({ key, label, amount });
  const earnings = [line("basic", "Basic", basic), line("hra", "House rent allowance", hra), line("special", "Special allowance", special)];
  if (bonus) earnings.push(line("bonus", "Bonus / incentive", bonus));
  const deductions = [
    ...(pfOn ? [line("pf", "Provident fund (12%)", pfEmployee)] : []),
    ...(esiOn ? [line("esi", "ESI (0.75%)", esiEmployee)] : []),
    ...(pt ? [line("pt", "Professional tax", pt)] : []),
    ...(tds ? [line("tds", "Income tax (TDS)", tds)] : []),
    ...(other ? [line("other", "Other deductions", other)] : []),
  ];
  const employer = [...(pfOn ? [line("pf", "Employer PF (12%)", pfEmployer)] : []), ...(esiOn ? [line("esi", "Employer ESI (3.25%)", esiEmployer)] : [])];
  const totalDeductions = statutory + other + tds;
  return {
    earnings,
    deductions,
    employer,
    gross,
    totalDeductions,
    netPay: gross - totalDeductions,
    employerCost: gross + pfEmployer + esiEmployer,
    pfWage,
    esiWage,
    tdsEstimated: !override && !fixed,
  };
}
