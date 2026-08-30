export type EmiResult = {
  principal: number;
  annualRate: number;
  months: number;
  emi: number;
  totalPay: number;
  totalInterest: number;
};

export function calcEmi(principal: number, annualRate: number, months: number): EmiResult {
  const p = Number(principal) || 0;
  const annual = Number(annualRate) || 0;
  const n = Number(months) || 1;
  const r = annual / 12 / 100;
  let emi: number;
  if (r === 0) emi = p / n;
  else emi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const totalPay = emi * n;
  const totalInterest = totalPay - p;
  return { principal: p, annualRate: annual, months: n, emi, totalPay, totalInterest };
}
