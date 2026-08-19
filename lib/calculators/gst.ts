export type GstMode = "add" | "remove";

export type GstResult = {
  base: number;
  gstAmt: number;
  total: number;
  rate: number;
  mode: GstMode;
};

export function calcGst(amount: number, rate: number, mode: GstMode): GstResult {
  const amt = Number(amount) || 0;
  const r = Number(rate) || 0;
  let base: number;
  let gstAmt: number;
  let total: number;
  if (mode === "add") {
    base = amt;
    gstAmt = base * (r / 100);
    total = base + gstAmt;
  } else {
    total = amt;
    base = total / (1 + r / 100);
    gstAmt = total - base;
  }
  return { base, gstAmt, total, rate: r, mode };
}

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;
