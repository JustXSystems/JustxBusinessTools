"use client";

import { useMemo, useState } from "react";
import { CalcLayout, CalcResult } from "@/components/calculators/CalcResult";
import { useEmiParams } from "@/hooks/useCalculatorConfig";
import { calcEmi } from "@/lib/calculators/emi";
import { fmtINR } from "@/lib/format";

export function EmiCalcView() {
  const params = useEmiParams();
  const [principal, setPrincipal] = useState(params.defaultPrincipal);
  const [rate, setRate] = useState(params.defaultRateAnnual);
  const [months, setMonths] = useState(params.defaultMonths);

  const result = useMemo(() => calcEmi(principal, rate, months), [principal, rate, months]);

  return (
    <CalcLayout
      title="EMI Calculator"
      icon="🏦"
      subtitle="Monthly instalment, broken down clearly."
    >
      <div className="panel">
        <label className="field">
          <span className="label">Loan Amount (₹)</span>
          <input type="number" value={principal} onChange={(e) => setPrincipal(Number(e.target.value))} />
        </label>
        <div className="field-row2">
          <label className="field">
            <span className="label">Interest Rate (% p.a.)</span>
            <input
              type="number"
              value={rate}
              step={0.1}
              onChange={(e) => setRate(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="label">Tenure (months)</span>
            <input type="number" value={months} onChange={(e) => setMonths(Number(e.target.value))} />
          </label>
        </div>
      </div>
      <div className="panel">
        <CalcResult
          value={`₹${fmtINR(result.emi)}`}
          label="Monthly EMI"
          items={[
            { value: `₹${fmtINR(result.principal)}`, label: "Principal" },
            { value: `₹${fmtINR(result.totalInterest)}`, label: "Total Interest" },
            { value: `₹${fmtINR(result.totalPay)}`, label: "Total Payment" },
            { value: `${result.months} mo.`, label: "Tenure" },
          ]}
        />
      </div>
    </CalcLayout>
  );
}
