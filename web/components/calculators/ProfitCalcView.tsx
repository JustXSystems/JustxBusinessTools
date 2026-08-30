"use client";

import { useMemo, useState } from "react";
import { CalcLayout, CalcResult } from "@/components/calculators/CalcResult";
import { useProfitParams } from "@/hooks/useCalculatorConfig";
import { calcProfit } from "@/lib/calculators/profit";
import { fmtINR } from "@/lib/format";

export function ProfitCalcView() {
  const params = useProfitParams();
  const [cost, setCost] = useState(params.defaultCost);
  const [sell, setSell] = useState(params.defaultSell);
  const [qty, setQty] = useState(params.defaultQty);

  const result = useMemo(() => calcProfit(cost, sell, qty), [cost, sell, qty]);

  return (
    <CalcLayout
      title="Profit Calculator"
      icon="📈"
      subtitle="Margin, markup, and profit — all at once."
    >
      <div className="panel">
        <div className="field-row2">
          <label className="field">
            <span className="label">Cost Price (₹)</span>
            <input type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="label">Selling Price (₹)</span>
            <input type="number" value={sell} onChange={(e) => setSell(Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span className="label">Quantity</span>
          <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </label>
      </div>
      <div className="panel">
        <CalcResult
          value={`₹${fmtINR(result.totalProfit)}`}
          label={`Total Profit (${result.qty} unit${result.qty !== 1 ? "s" : ""})`}
          items={[
            { value: `₹${fmtINR(result.profitPerUnit)}`, label: "Profit / Unit" },
            { value: `${result.margin.toFixed(1)}%`, label: "Margin" },
            { value: `${result.markup.toFixed(1)}%`, label: "Markup" },
            { value: `₹${fmtINR(result.totalCost)}`, label: "Total Cost" },
          ]}
        />
      </div>
    </CalcLayout>
  );
}
