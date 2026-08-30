/** Default calculator parameters — merged with admin `tool_definitions` at runtime. */

export const DEFAULT_GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;

export const DEFAULT_TDS_SECTIONS = [
  { code: "194C - Contractor (Individual/HUF)", rate: 1 },
  { code: "194C - Contractor (Others)", rate: 2 },
  { code: "194J - Professional/Technical Fees", rate: 10 },
  { code: "194I - Rent (Plant/Machinery)", rate: 2 },
  { code: "194I - Rent (Land/Building)", rate: 10 },
  { code: "194H - Commission/Brokerage", rate: 5 },
  { code: "194Q - Purchase of Goods", rate: 0.1 },
  { code: "Custom Rate", rate: 0 },
] as const;

export type TaxBracket = [number, number];

export const DEFAULT_NEW_TAX_BRACKETS: TaxBracket[] = [
  [800000, 5],
  [1200000, 10],
  [1600000, 15],
  [2000000, 20],
  [2400000, 25],
  [Infinity, 30],
];

export const DEFAULT_OLD_TAX_BRACKETS: TaxBracket[] = [
  [500000, 5],
  [1000000, 20],
  [Infinity, 30],
];

export type TaxCalcParams = {
  newBrackets: TaxBracket[];
  oldBrackets: TaxBracket[];
  newStdDeduction: number;
  oldStdDeduction: number;
  newRebateThreshold: number;
  oldRebateThreshold: number;
  cessRate: number;
};

export const DEFAULT_TAX_PARAMS: TaxCalcParams = {
  newBrackets: DEFAULT_NEW_TAX_BRACKETS,
  oldBrackets: DEFAULT_OLD_TAX_BRACKETS,
  newStdDeduction: 75000,
  oldStdDeduction: 50000,
  newRebateThreshold: 1200000,
  oldRebateThreshold: 500000,
  cessRate: 0.04,
};

export type ProfitCalcParams = {
  defaultCost: number;
  defaultSell: number;
  defaultQty: number;
};

export const DEFAULT_PROFIT_PARAMS: ProfitCalcParams = {
  defaultCost: 1000,
  defaultSell: 1500,
  defaultQty: 1,
};

export type EmiCalcParams = {
  defaultPrincipal: number;
  defaultRateAnnual: number;
  defaultMonths: number;
};

export const DEFAULT_EMI_PARAMS: EmiCalcParams = {
  defaultPrincipal: 500000,
  defaultRateAnnual: 10.5,
  defaultMonths: 60,
};

export type LoanCalcParams = {
  defaultPrincipal: number;
  defaultRateAnnual: number;
  defaultYears: number;
};

export const DEFAULT_LOAN_PARAMS: LoanCalcParams = {
  defaultPrincipal: 1000000,
  defaultRateAnnual: 9,
  defaultYears: 5,
};

export type SolarRoiParams = {
  defaultCost: number;
  defaultSizeKw: number;
  defaultBillBefore: number;
  defaultBillAfter: number;
  defaultLifeYears: number;
};

export const DEFAULT_SOLAR_ROI_PARAMS: SolarRoiParams = {
  defaultCost: 250000,
  defaultSizeKw: 5,
  defaultBillBefore: 8000,
  defaultBillAfter: 1500,
  defaultLifeYears: 25,
};

export type CommissionCalcParams = {
  defaultSale: number;
  defaultRatePct: number;
  defaultTdsPct: number;
};

export const DEFAULT_COMMISSION_PARAMS: CommissionCalcParams = {
  defaultSale: 100000,
  defaultRatePct: 5,
  defaultTdsPct: 5,
};

/** Registry of calculator tool ids and their config keys in tool_definitions. */
export const CALCULATOR_TOOL_IDS = [
  "gstcalc",
  "tdscalc",
  "taxcalc",
  "profitcalc",
  "emicalc",
  "loancalc",
  "solarroi",
  "dealercommission",
] as const;

export type CalculatorToolId = (typeof CALCULATOR_TOOL_IDS)[number];
