export type ProfitResult = {
  cost: number;
  sell: number;
  qty: number;
  profitPerUnit: number;
  totalProfit: number;
  margin: number;
  markup: number;
  totalCost: number;
};

export function calcProfit(cost: number, sell: number, qty: number): ProfitResult {
  const c = Number(cost) || 0;
  const s = Number(sell) || 0;
  const q = Number(qty) || 1;
  const profitPerUnit = s - c;
  const totalProfit = profitPerUnit * q;
  const margin = s > 0 ? (profitPerUnit / s) * 100 : 0;
  const markup = c > 0 ? (profitPerUnit / c) * 100 : 0;
  return {
    cost: c,
    sell: s,
    qty: q,
    profitPerUnit,
    totalProfit,
    margin,
    markup,
    totalCost: c * q,
  };
}
