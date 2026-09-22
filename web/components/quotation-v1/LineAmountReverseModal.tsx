"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  lineInclusiveTotal,
  money,
  reverseLineFromInclusiveTotal,
  sanitizeNumStr,
  type QuoteItem,
} from "@/lib/quotation-v1";

type Props = {
  open: boolean;
  item: QuoteItem | null;
  onClose: () => void;
  onApply: (next: { rate: number | string; gst: number | string }) => void;
};

const GST_PRESETS = [0, 5, 12, 18, 28];

export function LineAmountReverseModal({ open, item, onClose, onApply }: Props) {
  const titleId = useId();
  const totalRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [totalStr, setTotalStr] = useState("");
  const [gstStr, setGstStr] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !item) return;
    setTotalStr(String(lineInclusiveTotal(item)));
    setGstStr(String(item.gst ?? ""));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      totalRef.current?.focus();
      totalRef.current?.select();
    }, 40);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open, item]);

  const preview = useMemo(() => {
    if (!item) return null;
    const total = Number(totalStr);
    const gst = Number(gstStr);
    if (totalStr.trim() === "" || !Number.isFinite(total)) return null;
    return reverseLineFromInclusiveTotal({
      inclusiveTotal: total,
      gstPercent: Number.isFinite(gst) ? gst : 0,
      qty: Number(item.qty) || 0,
      discountPercent: Number(item.discount) || 0,
    });
  }, [item, totalStr, gstStr]);

  if (!open || !item || !mounted) return null;

  const qty = Number(item.qty) || 0;
  const canApply = Boolean(preview && preview.ok);

  function apply() {
    if (!preview || !preview.ok) return;
    onApply({
      rate: preview.rate,
      gst: gstStr.trim() === "" ? 0 : Number(gstStr) || 0,
    });
    onClose();
  }

  return createPortal(
    <div
      className="modal-overlay qgv1-rev-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && canApply) {
          e.preventDefault();
          apply();
        }
      }}
    >
      <div
        className="modal-box qgv1-rev-modal"
        style={{ ["--modal-max-width" as string]: "440px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qgv1-rev-head">
          <div>
            <p className="qgv1-rev-kicker">Line intelligence</p>
            <h3 className="modal-title" id={titleId}>
              Reverse calculate rate
            </h3>
          </div>
          <button type="button" className="qgv1-rev-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="qgv1-rev-lede">
          Enter the <strong>GST-inclusive</strong> total you want for this line. We’ll derive the
          unit rate from qty{qty ? ` (${qty})` : ""} and GST %.
        </p>

        {item.desc ? (
          <div className="qgv1-rev-item" title={item.desc}>
            <span className="qgv1-rev-item-label">Item</span>
            <span className="qgv1-rev-item-name">{item.desc}</span>
          </div>
        ) : null}

        <div className="qgv1-rev-grid">
          <label className="field">
            <span>Total amount (incl. GST) *</span>
            <div className="qgv1-rev-rupee">
              <span aria-hidden>₹</span>
              <input
                ref={totalRef}
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                value={totalStr}
                placeholder="e.g. 11800"
                onChange={(e) => setTotalStr(sanitizeNumStr(e.target.value))}
              />
            </div>
          </label>
          <label className="field">
            <span>GST %</span>
            <input
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              value={gstStr}
              placeholder="18"
              onChange={(e) => setGstStr(sanitizeNumStr(e.target.value))}
            />
          </label>
        </div>

        <div className="qgv1-rev-presets" role="group" aria-label="Common GST rates">
          {GST_PRESETS.map((g) => (
            <button
              key={g}
              type="button"
              className={
                String(Number(gstStr)) === String(g)
                  ? "qgv1-rev-preset is-on"
                  : "qgv1-rev-preset"
              }
              onClick={() => setGstStr(String(g))}
            >
              {g}%
            </button>
          ))}
        </div>

        <div className="qgv1-rev-preview" aria-live="polite">
          {preview?.ok ? (
            <>
              <div className="qgv1-rev-preview-main">
                <span>Computed rate</span>
                <strong>₹{money(preview.rate)}</strong>
              </div>
              <div className="qgv1-rev-preview-row">
                <span>Taxable</span>
                <span>₹{money(preview.taxable)}</span>
              </div>
              <div className="qgv1-rev-preview-row">
                <span>GST amount</span>
                <span>₹{money(preview.gstAmount)}</span>
              </div>
              <div className="qgv1-rev-preview-row is-total">
                <span>Inclusive total</span>
                <span>₹{money(preview.inclusiveTotal)}</span>
              </div>
            </>
          ) : (
            <p className="qgv1-rev-preview-empty">
              {preview && !preview.ok
                ? preview.error
                : "Enter a total to preview the reverse calculation."}
            </p>
          )}
        </div>

        <div className="modal-btns qgv1-rev-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canApply}
            onClick={apply}
          >
            Apply to line
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
