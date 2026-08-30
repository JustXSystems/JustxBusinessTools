"use client";

import { useMemo, useState } from "react";
import { CalcLayout, CalcResult } from "@/components/calculators/CalcResult";
import { useSolarRoiParams } from "@/hooks/useCalculatorConfig";
import { calcSolarRoi } from "@/lib/calculators/solar-roi";
import { fmtINR } from "@/lib/format";

export function SolarRoiCalcView() {
  const params = useSolarRoiParams();
  const [cost, setCost] = useState(params.defaultCost);
  const [systemSize, setSystemSize] = useState(params.defaultSizeKw);
  const [billBefore, setBillBefore] = useState(params.defaultBillBefore);
  const [billAfter, setBillAfter] = useState(params.defaultBillAfter);
  const [life, setLife] = useState(params.defaultLifeYears);

  const result = useMemo(
    () => calcSolarRoi(cost, billBefore, billAfter, life),
    [cost, billBefore, billAfter, life],
  );

  const paybackLabel =
    result.paybackYears > 0 ? `${result.paybackYears.toFixed(1)} yrs` : "—";

  return (
    <CalcLayout
      title="Solar ROI Calculator"
      icon="☀️"
      subtitle="Payback period and lifetime savings."
    >
      <div className="panel">
        <div className="field-row2">
          <label className="field">
            <span className="label">System Cost (₹)</span>
            <input type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="label">System Size (kW)</span>
            <input type="number" value={systemSize} onChange={(e) => setSystemSize(Number(e.target.value))} />
          </label>
        </div>
        <div className="field-row2">
          <label className="field">
            <span className="label">Monthly Electricity Bill Before (₹)</span>
            <input type="number" value={billBefore} onChange={(e) => setBillBefore(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="label">Monthly Electricity Bill After (₹)</span>
            <input type="number" value={billAfter} onChange={(e) => setBillAfter(Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span className="label">Expected System Life (years)</span>
          <input type="number" value={life} onChange={(e) => setLife(Number(e.target.value))} />
        </label>
      </div>
      <div className="panel">
        <CalcResult
          value={paybackLabel}
          label="Payback Period"
          items={[
            { value: `₹${fmtINR(result.monthlySaving)}`, label: "Monthly Saving" },
            { value: `₹${fmtINR(result.annualSaving)}`, label: "Annual Saving" },
            {
              value: `₹${fmtINR(result.lifetimeSavings)}`,
              label: `Lifetime Savings (${result.lifeYears}y)`,
            },
            { value: `${result.annualReturnPct.toFixed(1)}%`, label: "Annual Return" },
          ]}
        />
      </div>
    </CalcLayout>
  );
}
