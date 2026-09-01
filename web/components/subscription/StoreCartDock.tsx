"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export type StoreCartLine = {
  id: string;
  name: string;
  priceLabel: string;
};

type Props = {
  itemCount: number;
  totalLabel: string;
  packLabel?: string | null;
  savingsLabel?: string | null;
  lines: StoreCartLine[];
  quoteError?: string;
  canCheckout: boolean;
  emptyHint?: string;
  onRemove?: (id: string) => void;
  onClear?: () => void;
};

/**
 * Fixed top-right commerce cart — collapsed summary + expandable panel.
 * Corporate SaaS pattern (does not steal layout from the catalog).
 */
export function StoreCartDock({
  itemCount,
  totalLabel,
  packLabel,
  savingsLabel,
  lines,
  quoteError,
  canCheckout,
  emptyHint = "Select tools or a pack to build a monthly subscription.",
  onRemove,
  onClear,
}: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const prevCount = useRef(itemCount);

  useEffect(() => {
    if (itemCount > prevCount.current) setOpen(true);
    if (itemCount === 0) setOpen(false);
    prevCount.current = itemCount;
  }, [itemCount]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`store-cart-dock${open ? " is-open" : ""}${itemCount > 0 ? " has-items" : ""}`}
    >
      <button
        type="button"
        className="store-cart-fab"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="store-cart-fab-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 6h15l-1.5 9h-12L6 6Zm0 0L5 3H2"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="9" cy="20" r="1.2" fill="currentColor" />
            <circle cx="18" cy="20" r="1.2" fill="currentColor" />
          </svg>
        </span>
        <span className="store-cart-fab-copy">
          <strong>Cart</strong>
          <em>
            {itemCount === 0
              ? "Empty"
              : `${itemCount} item${itemCount === 1 ? "" : "s"} · ${totalLabel}`}
          </em>
        </span>
        {itemCount > 0 ? <span className="store-cart-fab-badge">{itemCount}</span> : null}
      </button>

      <div
        id={panelId}
        className="store-cart-panel"
        role="region"
        aria-label="Subscription cart"
        hidden={!open}
      >
        <div className="store-cart-panel-head">
          <div>
            <p className="store-cart-panel-kicker">Order summary</p>
            <h2>Cart</h2>
          </div>
          <button type="button" className="store-cart-panel-close" aria-label="Close cart" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>

        {packLabel ? <p className="store-cart-pack">{packLabel} pricing</p> : null}

        {itemCount === 0 ? (
          <p className="muted store-cart-empty">{emptyHint}</p>
        ) : (
          <ul className="billing-line-items store-cart-lines">
            {lines.map((line) => (
              <li key={line.id}>
                <span>{line.name}</span>
                <span className="store-cart-line-meta">
                  <strong>{line.priceLabel}</strong>
                  {onRemove ? (
                    <button type="button" className="store-cart-line-remove" onClick={() => onRemove(line.id)}>
                      Remove
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {savingsLabel ? <p className="store-cart-savings">{savingsLabel}</p> : null}

        <div className="store-cart-total">
          <span>Due now</span>
          <strong>{totalLabel}</strong>
        </div>

        {quoteError ? <p className="field-error">{quoteError}</p> : null}

        <div className="store-cart-panel-actions">
          {canCheckout ? (
            <Link className="btn btn-primary" href="/subscription/checkout" onClick={() => setOpen(false)}>
              Proceed to checkout
            </Link>
          ) : (
            <button type="button" className="btn btn-primary" disabled>
              Proceed to checkout
            </button>
          )}
          {itemCount > 0 && onClear ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
              Clear cart
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
