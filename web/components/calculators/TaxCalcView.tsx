"use client";

import { useMemo, useState } from "react";
import { CalcLayout, CalcResult } from "@/components/calculators/CalcResult";
import { useTaxParams } from "@/hooks/useCalculatorConfig";
import { calcTaxCompare } from "@/lib/calculators/tax";
import { fmtINR } from "@/lib/format";

export function TaxCalcView() {
  const taxParams = useTaxParams();
  const [income, setIncome] = useState(1200000);
  const [deductions, setDeductions] = useState(150000);

  const result = useMemo(
    () => calcTaxCompare(income, deductions, taxParams),
    [income, deductions, taxParams],
  );

  return (
    <CalcLayout
      title="Tax Calculator"
      icon="💼"
      subtitle="Rough estimate of income tax — old vs new regime."
      footer={
        <p className="section-note">
          This is a simplified estimate for planning purposes only, based on FY2025-26 slabs.
          Please confirm with a tax professional for filing.
        </p>
      }
    >
      <div className="panel">
        <label className="field">
          <span className="label">Annual Income (₹)</span>
          <input type="number" value={income} onChange={(e) => setIncome(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="label">Deductions (80C, 80D, etc. — old regime only)</span>
          <input type="number" value={deductions} onChange={(e) => setDeductions(Number(e.target.value))} />
        </label>
      </div>
      <div className="panel">
        <CalcResult
          value={result.better}
          label="Looks like the better option here"
          items={[
            { label: "New regime (tax + cess)", value: `₹${fmtINR(result.newTotal)}` },
            { label: "Old regime (tax + cess)", value: `₹${fmtINR(result.oldTotal)}` },
            { label: "New regime tax", value: `₹${fmtINR(result.newRegimeTax)}` },
            { label: "Old regime tax", value: `₹${fmtINR(result.oldRegimeTax)}` },
          ]}
        />
      </div>
    </CalcLayout>
  );
}
