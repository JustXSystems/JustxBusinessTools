export type TaxBracket = [number, number];

export const DEFAULT_NEW_BRACKETS: TaxBracket[] = [
  [800000, 5],
  [1200000, 10],
  [1600000, 15],
  [2000000, 20],
  [2400000, 25],
  [Infinity, 30],
];

export const DEFAULT_OLD_BRACKETS: TaxBracket[] = [
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
  newBrackets: DEFAULT_NEW_BRACKETS,
  oldBrackets: DEFAULT_OLD_BRACKETS,
  newStdDeduction: 75000,
  oldStdDeduction: 50000,
  newRebateThreshold: 1200000,
  oldRebateThreshold: 500000,
  cessRate: 0.04,
};

function slabTax(income: number, brackets: TaxBracket[], start: number): number {
  let tax = 0;
  let prev = start;
  for (const [upto, rate] of brackets) {
    if (income > prev) {
      const taxableInBracket = Math.min(income, upto) - prev;
      tax += taxableInBracket * (rate / 100);
      prev = upto;
    }
  }
  return Math.max(0, tax);
}

export function slabTaxNew(income: number, brackets = DEFAULT_NEW_BRACKETS): number {
  return slabTax(income, brackets, 400000);
}

export function slabTaxOld(income: number, brackets = DEFAULT_OLD_BRACKETS): number {
  return slabTax(income, brackets, 250000);
}

export type TaxCompareResult = {
  newRegimeTax: number;
  oldRegimeTax: number;
  newCess: number;
  oldCess: number;
  newTotal: number;
  oldTotal: number;
  better: "New Regime" | "Old Regime";
};

export function calcTaxCompare(
  income: number,
  deductions: number,
  params: TaxCalcParams = DEFAULT_TAX_PARAMS,
): TaxCompareResult {
  const inc = Number(income) || 0;
  const ded = Number(deductions) || 0;
  const newRegimeTaxable = Math.max(0, inc - params.newStdDeduction);
  const oldRegimeTaxable = Math.max(0, inc - params.oldStdDeduction - ded);

  let newTax = slabTaxNew(newRegimeTaxable, params.newBrackets);
  if (newRegimeTaxable <= params.newRebateThreshold) newTax = 0;
  let oldTax = slabTaxOld(oldRegimeTaxable, params.oldBrackets);
  if (oldRegimeTaxable <= params.oldRebateThreshold) oldTax = 0;

  const newCess = newTax * params.cessRate;
  const oldCess = oldTax * params.cessRate;
  const newTotal = newTax + newCess;
  const oldTotal = oldTax + oldCess;
  const better = newTotal <= oldTotal ? "New Regime" : "Old Regime";

  return {
    newRegimeTax: newTax,
    oldRegimeTax: oldTax,
    newCess,
    oldCess,
    newTotal,
    oldTotal,
    better,
  };
}
