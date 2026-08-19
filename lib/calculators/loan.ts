import { calcEmi } from "@/lib/calculators/emi";

export type LoanResult = {
  principal: number;
  annualRate: number;
  years: number;
  months: number;
  emi: number;
  totalPay: number;
  totalInterest: number;
  interestPctOfPrincipal: number;
};

export function calcLoan(principal: number, annualRate: number, years: number): LoanResult {
  const p = Number(principal) || 0;
  const annual = Number(annualRate) || 0;
  const y = Number(years) || 1;
  const months = y * 12;
  const emiResult = calcEmi(p, annual, months);
  const interestPctOfPrincipal = p > 0 ? (emiResult.totalInterest / p) * 100 : 0;
  return {
    principal: p,
    annualRate: annual,
    years: y,
    months,
    emi: emiResult.emi,
    totalPay: emiResult.totalPay,
    totalInterest: emiResult.totalInterest,
    interestPctOfPrincipal,
  };
}
