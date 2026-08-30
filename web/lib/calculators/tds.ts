export type TdsResult = {
  gross: number;
  rate: number;
  tds: number;
  net: number;
};

export function calcTds(amount: number, rate: number): TdsResult {
  const gross = Number(amount) || 0;
  const r = Number(rate) || 0;
  const tds = gross * (r / 100);
  const net = gross - tds;
  return { gross, rate: r, tds, net };
}
