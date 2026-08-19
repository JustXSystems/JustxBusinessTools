export type CommissionResult = {
  sale: number;
  rate: number;
  tdsRate: number;
  commission: number;
  tds: number;
  net: number;
};

export function calcCommission(sale: number, rate: number, tdsRate: number): CommissionResult {
  const s = Number(sale) || 0;
  const r = Number(rate) || 0;
  const tdsR = Number(tdsRate) || 0;
  const commission = s * (r / 100);
  const tds = commission * (tdsR / 100);
  const net = commission - tds;
  return { sale: s, rate: r, tdsRate: tdsR, commission, tds, net };
}
