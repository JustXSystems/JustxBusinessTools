export type SolarRoiResult = {
  cost: number;
  monthlySaving: number;
  annualSaving: number;
  paybackYears: number;
  lifetimeSavings: number;
  annualReturnPct: number;
  lifeYears: number;
};

export function calcSolarRoi(
  cost: number,
  billBefore: number,
  billAfter: number,
  lifeYears: number,
): SolarRoiResult {
  const c = Number(cost) || 0;
  const before = Number(billBefore) || 0;
  const after = Number(billAfter) || 0;
  const life = Number(lifeYears) || 25;
  const monthlySaving = Math.max(0, before - after);
  const annualSaving = monthlySaving * 12;
  const paybackYears = annualSaving > 0 ? c / annualSaving : 0;
  const lifetimeSavings = annualSaving * life - c;
  const annualReturnPct = c > 0 ? (annualSaving / c) * 100 : 0;
  return {
    cost: c,
    monthlySaving,
    annualSaving,
    paybackYears,
    lifetimeSavings,
    annualReturnPct,
    lifeYears: life,
  };
}
