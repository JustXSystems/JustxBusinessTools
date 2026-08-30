"use client";

import { useMemo, useState } from "react";
import { CalcLayout, CalcResult } from "@/components/calculators/CalcResult";
import { useCommissionParams } from "@/hooks/useCalculatorConfig";
import { calcCommission } from "@/lib/calculators/commission";
import { fmtINR } from "@/lib/format";

export function CommissionCalcView() {
  const params = useCommissionParams();
  const [sale, setSale] = useState(params.defaultSale);
  const [rate, setRate] = useState(params.defaultRatePct);
  const [tdsRate, setTdsRate] = useState(params.defaultTdsPct);

  const result = useMemo(() => calcCommission(sale, rate, tdsRate), [sale, rate, tdsRate]);

  return (
    <CalcLayout
      title="Commission Calculator"
      icon="🤝"
      subtitle="Work out dealer / agent commission quickly."
    >
      <div className="panel">
        <div className="field-row2">
          <label className="field">
            <span className="label">Sale Value (₹)</span>
            <input type="number" value={sale} onChange={(e) => setSale(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="label">Commission Rate (%)</span>
            <input
              type="number"
              value={rate}
              step={0.1}
              onChange={(e) => setRate(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="field">
          <span className="label">TDS on Commission (%, if applicable)</span>
          <input
            type="number"
            value={tdsRate}
            step={0.1}
            onChange={(e) => setTdsRate(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="panel">
        <CalcResult
          value={`₹${fmtINR(result.net)}`}
          label="Net Commission Payable"
          items={[
            { value: `₹${fmtINR(result.commission)}`, label: "Gross Commission" },
            { value: `₹${fmtINR(result.tds)}`, label: "TDS Deducted" },
          ]}
        />
      </div>
    </CalcLayout>
  );
}
