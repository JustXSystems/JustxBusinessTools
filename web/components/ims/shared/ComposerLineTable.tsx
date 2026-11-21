"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Input, Segmented } from "@/components/bos";

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

type ViewFilter = "all" | "set" | "empty";

type Props = {
  rows: ComposerLineRow[];
  ariaLabel?: string;
  qtyLabel?: string;
  showRemarks?: boolean;
  /** Show search when there are at least this many rows (default 6). */
  searchFrom?: number;
  allowBulkFill?: boolean;
  allowBulkClear?: boolean;
  emptyLabel?: string;
  /** Optional trailing summary under the table. */
  footer?: ReactNode;
  maxBodyHeight?: string;
};

/**
 * Ultra-compact corporate line grid for DC / Return composers (100+ rows).
 * Advanced controls: filter, view scope, fill/clear, Enter→next qty.
 */
export function ComposerLineTable({
  rows,
  ariaLabel = "Line items",
  qtyLabel = "Qty",
  showRemarks = false,
  searchFrom = 6,
  allowBulkFill = false,
  allowBulkClear = false,
  emptyLabel = "No lines",
  footer,
  maxBodyHeight = "min(58vh, 620px)",
}: Props) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<ViewFilter>("all");
  const qtyRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const showSearch = rows.length >= searchFrom;
  const query = q.trim().toLowerCase();

  const filledCount = useMemo(
    () => rows.filter((r) => (Number(r.qtyValue) || 0) > 0).length,
    [rows],
  );
  const emptyCount = rows.length - filledCount;
  const fillPct = rows.length ? Math.round((filledCount / rows.length) * 100) : 0;

  const filtered = useMemo(() => {
    let list = rows;
    if (query) {
      list = list.filter((r) => `${r.description} ${r.unit ?? ""}`.toLowerCase().includes(query));
    }
    if (view === "set") list = list.filter((r) => (Number(r.qtyValue) || 0) > 0);
    if (view === "empty") list = list.filter((r) => !(Number(r.qtyValue) || 0));
    return list;
  }, [rows, query, view]);

  const editableIds = useMemo(
    () => filtered.filter((r) => !r.readOnly && r.onQtyChange).map((r) => r.id),
    [filtered],
  );

  const fillMax = (scope: "all" | "visible" = "all") => {
    const target = scope === "visible" ? filtered : rows;
    for (const r of target) {
      if (r.readOnly || r.maxQty == null || !r.onQtyChange) continue;
      r.onQtyChange(String(r.maxQty));
    }
  };

  const clearQty = (scope: "all" | "visible" = "all") => {
    const target = scope === "visible" ? filtered : rows;
    for (const r of target) {
      if (r.readOnly || !r.onQtyChange) continue;
      r.onQtyChange("");
    }
  };

  const canFill = allowBulkFill && rows.some((r) => !r.readOnly && r.maxQty != null && r.onQtyChange);
  const canClear = allowBulkClear && rows.some((r) => !r.readOnly && r.onQtyChange);

  const focusQty = (id: string) => {
    const el = qtyRefs.current.get(id);
    if (!el) return;
    el.focus();
    el.select();
  };

  const onQtyKeyDown = (e: KeyboardEvent<HTMLInputElement>, id: string) => {
    const at = editableIds.indexOf(id);
    if (at < 0) return;
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = editableIds[at + 1];
      if (next) focusQty(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = editableIds[at - 1];
      if (prev) focusQty(prev);
    }
  };

  return (
    <div className="ims-compose-lines">
      <div className="ims-compose-cmd">
        <div className="ims-compose-cmd-left">
          <div className="ims-compose-meter" title={`${filledCount} of ${rows.length} lines have quantity`}>
            <span className="ims-compose-meter-track" aria-hidden="true">
              <span className="ims-compose-meter-fill" style={{ width: `${fillPct}%` }} />
            </span>
            <span className="ims-compose-meter-label" aria-live="polite">
              <b>{filledCount}</b>
              <span className="ims-faint">/{rows.length}</span>
              {query || view !== "all" ? <span className="ims-faint"> · {filtered.length} shown</span> : null}
            </span>
          </div>
          {rows.length >= 4 ? (
            <Segmented
              size="sm"
              role="radio"
              aria-label="Line view"
              value={view}
              onChange={setView}
              options={[
                { value: "all", label: "All" },
                { value: "set", label: `Set · ${filledCount}` },
                { value: "empty", label: `Open · ${emptyCount}` },
              ]}
            />
          ) : null}
        </div>
        <div className="ims-compose-cmd-right">
          {showSearch ? (
            <Input
              size="sm"
              className="ims-compose-lines-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter line items"
            />
          ) : null}
          {canFill ? (
            <Button
              size="sm"
              variant="ghost"
              title={query || view !== "all" ? "Fill max on visible rows" : "Fill max on all rows"}
              onClick={() => fillMax(query || view !== "all" ? "visible" : "all")}
            >
              Fill max
            </Button>
          ) : null}
          {canClear ? (
            <Button
              size="sm"
              variant="ghost"
              title={query || view !== "all" ? "Clear visible quantities" : "Clear all quantities"}
              onClick={() => clearQty(query || view !== "all" ? "visible" : "all")}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {!rows.length ? (
        <p className="ims-compose-lines-empty">{emptyLabel}</p>
      ) : !filtered.length ? (
        <p className="ims-compose-lines-empty">
          {view === "set"
            ? "No lines with quantity yet."
            : view === "empty"
              ? "All visible lines already have quantity."
              : `No lines match “${q.trim()}”.`}
        </p>
      ) : (
        <div className="ims-compose-lines-frame" style={{ ["--ims-compose-lines-max-h" as string]: maxBodyHeight }}>
          <table className="ims-compose-lines-table" aria-label={ariaLabel}>
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
                const idx = query || view !== "all" ? rows.findIndex((r) => r.id === row.id) + 1 : i + 1;
                const readOnly = Boolean(row.readOnly || !row.onQtyChange);
                const active = row.active ?? (Number(row.qtyValue) || 0) > 0;
                const over =
                  !readOnly && row.maxQty != null && (Number(row.qtyValue) || 0) > row.maxQty + 1e-9;
                return (
                  <tr
                    key={row.id}
                    className={[active ? "is-active" : "", over ? "is-over" : ""].filter(Boolean).join(" ") || undefined}
                  >
                    <td className="is-idx">{idx}</td>
                    <td className="is-desc">
                      <span className="ims-compose-lines-name" title={row.description}>
                        {row.description || "—"}
                      </span>
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
                            onKeyDown={(e) => onQtyKeyDown(e, row.id)}
                            ref={(el) => {
                              if (el) qtyRefs.current.set(row.id, el);
                              else qtyRefs.current.delete(row.id);
                            }}
                            placeholder="0"
                            aria-label={`Quantity for ${row.description}`}
                            aria-invalid={over || undefined}
                          />
                          {row.unit ? <span className="ims-compose-lines-unit">{row.unit}</span> : null}
                          {row.maxQty != null && !showRemarks ? (
                            <button
                              type="button"
                              className="ims-compose-lines-max"
                              title={`Use max ${row.maxQty}`}
                              onClick={() => row.onQtyChange?.(String(row.maxQty))}
                            >
                              max
                            </button>
                          ) : null}
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
                            placeholder="—"
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
      {canFill || canClear || footer ? (
        <div className="ims-compose-lines-footer">
          {canFill || canClear ? <span className="ims-compose-kbd-hint">Enter / ↓ next · ↑ previous</span> : <span />}
          {footer}
        </div>
      ) : null}
    </div>
  );
}
