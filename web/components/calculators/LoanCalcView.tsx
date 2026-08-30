"use client";

import { useMemo, useState } from "react";
import { CalcLayout, CalcResult } from "@/components/calculators/CalcResult";
import { useLoanParams } from "@/hooks/useCalculatorConfig";
import { calcLoan } from "@/lib/calculators/loan";
import { fmtINR } from "@/lib/format";

export function LoanCalcView() {
  const params = useLoanParams();
  const [principal, setPrincipal] = useState(params.defaultPrincipal);
  const [rate, setRate] = useState(params.defaultRateAnnual);
  const [years, setYears] = useState(params.defaultYears);

  const result = useMemo(() => calcLoan(principal, rate, years), [principal, rate, years]);

  return (
    <CalcLayout
      title="Loan Calculator"
      icon="💳"
      subtitle="See total interest and repayment before you borrow."
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
            <span className="label">Tenure (years)</span>
            <input type="number" value={years} onChange={(e) => setYears(Number(e.target.value))} />
          </label>
        </div>
      </div>
      <div className="panel">
        <CalcResult
          value={`₹${fmtINR(result.totalInterest)}`}
          label="Total Interest Payable"
          items={[
            { value: `₹${fmtINR(result.emi)}`, label: "Monthly EMI" },
            { value: `₹${fmtINR(result.totalPay)}`, label: "Total Repayment" },
            { value: String(result.months), label: "No. of EMIs" },
            { value: `${result.interestPctOfPrincipal.toFixed(1)}%`, label: "Interest / Principal" },
          ]}
        />
      </div>
    </CalcLayout>
  );
}
