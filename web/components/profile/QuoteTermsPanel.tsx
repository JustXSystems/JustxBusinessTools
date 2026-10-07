"use client";

import { useMemo, useState } from "react";
import { BASE_TERMS, quoteTermsForOptions } from "@/lib/quotation-v1/catalog";
import type { EngagementKey } from "@/lib/quotation-v1/types";

type QuoteTerms = Partial<Record<string, string>>;

type Props = {
  value: QuoteTerms;
  disabled?: boolean;
  onChange: (next: QuoteTerms) => void;
};

export function countCustomQuoteTerms(value: QuoteTerms | null | undefined): number {
  return Object.values(value ?? {}).filter((t) => (t ?? "").trim()).length;
}

/** Quotation V1 terms & notes per "For"; blank uses the built-in terms. */
export function QuoteTermsPanel({ value, disabled, onChange }: Props) {
  const options = useMemo(() => quoteTermsForOptions(), []);
  const [selected, setSelected] = useState<EngagementKey>("amc");
  const text = value[selected] ?? "";
  const isCustom = Boolean(text.trim());

  function setText(next: string) {
    if (disabled) return;
    onChange({ ...value, [selected]: next });
  }

  function resetToBuiltIn() {
    if (disabled) return;
    const next = { ...value };
    delete next[selected];
    onChange(next);
  }

  return (
    <div className="quote-terms-panel">
      <p className="section-note" style={{ margin: 0 }}>
        Quotation V1 fills Terms &amp; notes from here when a &quot;For&quot; is picked. Leave a
        &quot;For&quot; blank to use the built-in terms. <code>{"{WARRANTY}"}</code> inserts the
        warranty line for the quotation&apos;s category.
      </p>

      <label className="field">
        <span className="label">For</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value as EngagementKey)}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label} — {o.categories}
              {(value[o.key] ?? "").trim() ? " · customised" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="label">
          Terms &amp; notes {isCustom ? "(customised)" : "(built-in terms in use)"}
        </span>
        <textarea
          rows={9}
          value={text}
          placeholder={BASE_TERMS[selected]}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      {!disabled ? (
        <div className="btn-row quote-terms-actions">
          {isCustom ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={resetToBuiltIn}>
              Reset to built-in terms
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setText(BASE_TERMS[selected])}
            >
              Start from built-in terms
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
