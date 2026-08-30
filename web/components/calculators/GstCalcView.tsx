"use client";

import { useMemo, useState } from "react";
import { CalcLayout, CalcResult } from "@/components/calculators/CalcResult";
import { useGstRates } from "@/hooks/useCalculatorConfig";
import { calcGst, type GstMode } from "@/lib/calculators/gst";
import { fmtINR } from "@/lib/format";

export function GstCalcView() {
  const gstRates = useGstRates();
  const [amount, setAmount] = useState(10000);
  const [rate, setRate] = useState(gstRates.includes(18) ? 18 : gstRates[0] ?? 18);
  const [mode, setMode] = useState<GstMode>("add");

  const result = useMemo(() => calcGst(amount, rate, mode), [amount, rate, mode]);

  return (
    <CalcLayout
      title="GST Calculator"
      icon="🧾"
      subtitle="Add or remove GST from any amount instantly."
    >
      <div className="panel">
        <div className="field-row2">
          <label className="field">
            <span className="label">Amount (₹)</span>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="label">GST Rate</span>
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {gstRates.map((r) => (
                <option key={r} value={r}>{r}%</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="label">Calculation Type</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as GstMode)}>
            <option value="add">Add GST (amount is exclusive of GST)</option>
            <option value="remove">Remove GST (amount is inclusive of GST)</option>
          </select>
        </label>
      </div>
      <div className="panel">
        <CalcResult
          value={`₹${fmtINR(result.total)}`}
          label={mode === "add" ? "Total (incl. GST)" : "amount"}
          items={[
            { value: `₹${fmtINR(result.base)}`, label: "Taxable Amount" },
            { value: `₹${fmtINR(result.gstAmt)}`, label: `GST Amount (${result.rate}%)` },
            { value: `₹${fmtINR(result.gstAmt / 2)}`, label: "CGST (if intra-state)" },
            { value: `₹${fmtINR(result.gstAmt / 2)}`, label: "SGST (if intra-state)" },
          ]}
        />
      </div>
    </CalcLayout>
  );
}
