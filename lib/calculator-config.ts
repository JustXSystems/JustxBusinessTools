import type { PlatformToolDefinition } from "@/components/config/ConfigProvider";
import {
  DEFAULT_COMMISSION_PARAMS,
  DEFAULT_EMI_PARAMS,
  DEFAULT_LOAN_PARAMS,
  DEFAULT_PROFIT_PARAMS,
  DEFAULT_SOLAR_ROI_PARAMS,
  type CommissionCalcParams,
  type EmiCalcParams,
  type LoanCalcParams,
  type ProfitCalcParams,
  type SolarRoiParams,
} from "@jbt/shared";
import { GST_RATES } from "@/lib/calculators/gst";
import { TDS_SECTIONS, type TdsSection } from "@/lib/calculators/tds-sections";
import {
  DEFAULT_TAX_PARAMS,
  type TaxBracket,
  type TaxCalcParams,
} from "@/lib/calculators/tax";

function numOr<T extends number>(value: unknown, fallback: T): T {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? (parsed as T) : fallback;
}

export function resolveGstRates(override: PlatformToolDefinition | undefined): number[] {
  if (!override?.definition) return [...GST_RATES];
  const rates = override.definition.gstRates;
  if (!Array.isArray(rates)) return [...GST_RATES];
  const parsed = rates.map((r) => Number(r)).filter((n) => Number.isFinite(n));
  return parsed.length ? parsed : [...GST_RATES];
}

export function resolveTdsSections(override: PlatformToolDefinition | undefined): TdsSection[] {
  if (!override?.definition) return TDS_SECTIONS;
  const sections = override.definition.tdsSections;
  if (!Array.isArray(sections)) return TDS_SECTIONS;
  const parsed = sections
    .map((s) => {
      const row = s as { code?: string; rate?: number };
      if (!row.code) return null;
      return { code: String(row.code), rate: Number(row.rate) || 0 };
    })
    .filter(Boolean) as TdsSection[];
  return parsed.length ? parsed : TDS_SECTIONS;
}

function parseBrackets(raw: unknown): TaxBracket[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed: TaxBracket[] = [];
  for (const row of raw) {
    const item = row as { upto?: number; rate?: number };
    const upto = Number(item.upto);
    const rate = Number(item.rate);
    if (!Number.isFinite(upto) || !Number.isFinite(rate)) continue;
    parsed.push([upto, rate]);
  }
  return parsed.length ? parsed : null;
}

export function resolveTaxParams(override: PlatformToolDefinition | undefined): TaxCalcParams {
  if (!override?.definition) return DEFAULT_TAX_PARAMS;

  const def = override.definition;
  const newBrackets = parseBrackets(def.newTaxBrackets) ?? DEFAULT_TAX_PARAMS.newBrackets;
  const oldBrackets = parseBrackets(def.oldTaxBrackets) ?? DEFAULT_TAX_PARAMS.oldBrackets;

  return {
    newBrackets,
    oldBrackets,
    newStdDeduction: Number(def.newStdDeduction) || DEFAULT_TAX_PARAMS.newStdDeduction,
    oldStdDeduction: Number(def.oldStdDeduction) || DEFAULT_TAX_PARAMS.oldStdDeduction,
    newRebateThreshold: Number(def.newRebateThreshold) || DEFAULT_TAX_PARAMS.newRebateThreshold,
    oldRebateThreshold: Number(def.oldRebateThreshold) || DEFAULT_TAX_PARAMS.oldRebateThreshold,
    cessRate: Number(def.cessRate) || DEFAULT_TAX_PARAMS.cessRate,
  };
}

export function resolveProfitParams(
  override: PlatformToolDefinition | undefined,
): ProfitCalcParams {
  const def = override?.definition;
  if (!def) return { ...DEFAULT_PROFIT_PARAMS };
  return {
    defaultCost: numOr(def.defaultCost, DEFAULT_PROFIT_PARAMS.defaultCost),
    defaultSell: numOr(def.defaultSell, DEFAULT_PROFIT_PARAMS.defaultSell),
    defaultQty: numOr(def.defaultQty, DEFAULT_PROFIT_PARAMS.defaultQty),
  };
}

export function resolveEmiParams(override: PlatformToolDefinition | undefined): EmiCalcParams {
  const def = override?.definition;
  if (!def) return { ...DEFAULT_EMI_PARAMS };
  return {
    defaultPrincipal: numOr(def.defaultPrincipal, DEFAULT_EMI_PARAMS.defaultPrincipal),
    defaultRateAnnual: numOr(def.defaultRateAnnual, DEFAULT_EMI_PARAMS.defaultRateAnnual),
    defaultMonths: numOr(def.defaultMonths, DEFAULT_EMI_PARAMS.defaultMonths),
  };
}

export function resolveLoanParams(override: PlatformToolDefinition | undefined): LoanCalcParams {
  const def = override?.definition;
  if (!def) return { ...DEFAULT_LOAN_PARAMS };
  return {
    defaultPrincipal: numOr(def.defaultPrincipal, DEFAULT_LOAN_PARAMS.defaultPrincipal),
    defaultRateAnnual: numOr(def.defaultRateAnnual, DEFAULT_LOAN_PARAMS.defaultRateAnnual),
    defaultYears: numOr(def.defaultYears, DEFAULT_LOAN_PARAMS.defaultYears),
  };
}

export function resolveSolarRoiParams(
  override: PlatformToolDefinition | undefined,
): SolarRoiParams {
  const def = override?.definition;
  if (!def) return { ...DEFAULT_SOLAR_ROI_PARAMS };
  return {
    defaultCost: numOr(def.defaultCost, DEFAULT_SOLAR_ROI_PARAMS.defaultCost),
    defaultSizeKw: numOr(def.defaultSizeKw, DEFAULT_SOLAR_ROI_PARAMS.defaultSizeKw),
    defaultBillBefore: numOr(def.defaultBillBefore, DEFAULT_SOLAR_ROI_PARAMS.defaultBillBefore),
    defaultBillAfter: numOr(def.defaultBillAfter, DEFAULT_SOLAR_ROI_PARAMS.defaultBillAfter),
    defaultLifeYears: numOr(def.defaultLifeYears, DEFAULT_SOLAR_ROI_PARAMS.defaultLifeYears),
  };
}

export function resolveCommissionParams(
  override: PlatformToolDefinition | undefined,
): CommissionCalcParams {
  const def = override?.definition;
  if (!def) return { ...DEFAULT_COMMISSION_PARAMS };
  return {
    defaultSale: numOr(def.defaultSale, DEFAULT_COMMISSION_PARAMS.defaultSale),
    defaultRatePct: numOr(def.defaultRatePct, DEFAULT_COMMISSION_PARAMS.defaultRatePct),
    defaultTdsPct: numOr(def.defaultTdsPct, DEFAULT_COMMISSION_PARAMS.defaultTdsPct),
  };
}
