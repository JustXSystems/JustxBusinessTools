"use client";

import { useMemo, useState } from "react";
import { CalcLayout, CalcResult } from "@/components/calculators/CalcResult";
import { useTdsSections } from "@/hooks/useCalculatorConfig";
import { calcTds } from "@/lib/calculators/tds";
import { fmtINR } from "@/lib/format";

export function TdsCalcView() {
  const tdsSections = useTdsSections();
  const [sectionIdx, setSectionIdx] = useState(0);
  const [amount, setAmount] = useState(50000);
  const [rate, setRate] = useState(tdsSections[0]?.rate ?? 0);

  const result = useMemo(() => calcTds(amount, rate), [amount, rate]);

  function onSectionChange(idx: number) {
    setSectionIdx(idx);
    setRate(tdsSections[idx]?.rate ?? 0);
  }

  return (
    <CalcLayout title="TDS Calculator" icon="📉" subtitle="Work out TDS deduction by section.">
      <div className="panel">
        <label className="field">
          <span className="label">TDS Section</span>
          <select
            value={sectionIdx}
            onChange={(e) => onSectionChange(Number(e.target.value))}
          >
            {tdsSections.map((s, i) => (
              <option key={s.code} value={i}>{s.code} ({s.rate}%)</option>
            ))}
          </select>
        </label>
        <div className="field-row2">
          <label className="field">
            <span className="label">Bill / Payment Amount (₹)</span>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="label">TDS Rate (%)</span>
            <input type="number" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
          </label>
        </div>
      </div>
      <div className="panel">
        <CalcResult
          value={`₹${fmtINR(result.tds)}`}
          label="TDS to Deduct"
          items={[
            { value: `₹${fmtINR(result.gross)}`, label: "Gross Amount" },
            { value: `₹${fmtINR(result.net)}`, label: "Net Payable" },
          ]}
        />
      </div>
    </CalcLayout>
  );
}
