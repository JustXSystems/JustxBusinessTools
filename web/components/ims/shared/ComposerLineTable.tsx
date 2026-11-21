"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button, Input } from "@/components/bos";

export type ComposerLineRow = {
  id: string;
  description: string;
  /** Secondary text under the description (SKU, returnable qty, etc.). */
  meta?: ReactNode;
  unit?: string | null;
  qtyValue: string;
  onQtyChange?: (value: string) => void;
  /** When set, “Fill max” uses this number. */
  maxQty?: number;
  remarksValue?: string;
  onRemarksChange?: (value: string) => void;
  /** Soft highlight when the line has a positive qty entered. */
  active?: boolean;
  readOnly?: boolean;
};

type Props = {
  rows: ComposerLineRow[];
  ariaLabel?: string;
  qtyLabel?: string;
  showRemarks?: boolean;
  /** Show search when there are at least this many rows (default 8). */
  searchFrom?: number;
  allowBulkFill?: boolean;
  allowBulkClear?: boolean;
  emptyLabel?: string;
  /** Optional trailing summary under the table. */
  footer?: ReactNode;
  maxBodyHeight?: string;
};

/**
 * Dense, scrollable line-item table for DC / Return composers (100+ rows).
 * Sticky header, filter, bulk fill/clear, compact corporate grid.
 */
export function ComposerLineTable({
  rows,
  ariaLabel = "Line items",
  qtyLabel = "Qty",
  showRemarks = false,
  searchFrom = 8,
  allowBulkFill = false,
  allowBulkClear = false,
  emptyLabel = "No lines",
  footer,
  maxBodyHeight = "min(52vh, 560px)",
}: Props) {
  const [q, setQ] = useState("");
  const showSearch = rows.length >= searchFrom;
  const query = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return rows;
    return rows.filter((r) => {
      const hay = `${r.description} ${r.unit ?? ""}`.toLowerCase();
      return hay.includes(query);
    });
  }, [rows, query]);

  const filled = useMemo(
    () => rows.filter((r) => (Number(r.qtyValue) || 0) > 0).length,
    [rows],
  );

  const fillMax = () => {
    for (const r of rows) {
      if (r.readOnly || r.maxQty == null || !r.onQtyChange) continue;
      r.onQtyChange(String(r.maxQty));
    }
  };

  const clearQty = () => {
    for (const r of rows) {
      if (r.readOnly || !r.onQtyChange) continue;
      r.onQtyChange("");
    }
  };

  const canFill = allowBulkFill && rows.some((r) => !r.readOnly && r.maxQty != null && r.onQtyChange);
  const canClear = allowBulkClear && rows.some((r) => !r.readOnly && r.onQtyChange);

  return (
    <div className="ims-compose-lines">
      <div className="ims-compose-lines-toolbar">
        <div className="ims-compose-lines-stats" aria-live="polite">
          <span className="ims-compose-lines-count">
            {filled > 0 ? (
              <>
                <b>{filled}</b> of {rows.length} with qty
              </>
            ) : (
              <>
                <b>{rows.length}</b> line{rows.length === 1 ? "" : "s"}
              </>
            )}
          </span>
          {query && filtered.length !== rows.length ? (
            <span className="ims-faint"> · showing {filtered.length}</span>
          ) : null}
        </div>
        <div className="ims-compose-lines-actions">
          {showSearch ? (
            <Input
              size="sm"
              className="ims-compose-lines-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter lines…"
              aria-label="Filter line items"
            />
          ) : null}
          {canFill ? (
            <Button size="sm" variant="ghost" onClick={fillMax}>
              Fill max
            </Button>
          ) : null}
          {canClear ? (
            <Button size="sm" variant="ghost" onClick={clearQty}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {!rows.length ? (
        <p className="ims-compose-lines-empty">{emptyLabel}</p>
      ) : !filtered.length ? (
        <p className="ims-compose-lines-empty">No lines match “{q.trim()}”.</p>
      ) : (
        <div className="ims-compose-lines-frame" style={{ ["--ims-compose-lines-max-h" as string]: maxBodyHeight }}>
          <table className="ims-compose-lines-table">
            <thead>
              <tr>
                <th className="is-idx" scope="col">
                  #
                </th>
                <th scope="col">Description</th>
                <th className="is-qty" scope="col">
                  {qtyLabel}
                </th>
                {showRemarks ? (
                  <th className="is-remarks" scope="col">
                    Remarks
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const idx = query ? rows.findIndex((r) => r.id === row.id) + 1 : i + 1;
                const readOnly = Boolean(row.readOnly || !row.onQtyChange);
                const active = row.active ?? (Number(row.qtyValue) || 0) > 0;
                return (
                  <tr key={row.id} className={active ? "is-active" : undefined}>
                    <td className="is-idx">{idx}</td>
                    <td className="is-desc">
                      <span className="ims-compose-lines-name">{row.description || "—"}</span>
                      {row.meta ? <span className="ims-compose-lines-meta">{row.meta}</span> : null}
                    </td>
                    <td className="is-qty" data-label={qtyLabel}>
                      {readOnly ? (
                        <span className="ims-compose-lines-qty-text">
                          {row.qtyValue || "—"}
                          {row.unit ? <small>{row.unit}</small> : null}
                        </span>
                      ) : (
                        <div className="ims-compose-lines-qty-cell">
                          <Input
                            size="sm"
                            className="ims-compose-lines-qty"
                            inputMode="decimal"
                            value={row.qtyValue}
                            onChange={(e) => row.onQtyChange?.(e.target.value)}
                            placeholder="0"
                            aria-label={`Quantity for ${row.description}`}
                          />
                          {row.unit ? <span className="ims-compose-lines-unit">{row.unit}</span> : null}
                        </div>
                      )}
                    </td>
                    {showRemarks ? (
                      <td className="is-remarks" data-label="Remarks">
                        {row.onRemarksChange ? (
                          <Input
                            size="sm"
                            className="ims-compose-lines-remarks"
                            value={row.remarksValue ?? ""}
                            onChange={(e) => row.onRemarksChange?.(e.target.value)}
                            placeholder="Optional"
                            aria-label={`Remarks for ${row.description}`}
                          />
                        ) : (
                          <span className="ims-compose-lines-meta">{row.remarksValue || "—"}</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {footer ? <div className="ims-compose-lines-footer">{footer}</div> : null}
    </div>
  );
}
