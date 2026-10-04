"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Checkbox } from "../primitives/Form";
import { cx } from "../cx";

export type BosColumn<T> = {
  key: string;
  header: ReactNode;
  /** Cell renderer; defaults to `row[key]`. */
  cell?: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Mono, muted cell (dates, IDs). */
  mono?: boolean;
  width?: number | string;
};

export type BosDataTableProps<T> = {
  columns: ReadonlyArray<BosColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  /** Makes rows clickable + keyboard-activatable. */
  onRowClick?: (row: T) => void;
  /** Enables the leading checkbox column. */
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void };
  /** Rendered above the table while anything is selected. */
  bulkActions?: (count: number) => ReactNode;
  empty?: ReactNode;
  compact?: boolean;
  /** Trailing chevron cell for drill-in rows. */
  chevron?: boolean;
  caption?: string;
  className?: string;
};

function readCell<T>(row: T, key: string): ReactNode {
  const v = (row as Record<string, unknown>)[key];
  return v === null || v === undefined ? "" : (v as ReactNode);
}

/**
 * Zebra table with mono blue headers, tabular numerals, optional selection and
 * a bulk-action bar. Wrap long tables horizontally on small screens.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selection,
  bulkActions,
  empty = "Nothing to show yet.",
  compact,
  chevron,
  caption,
  className,
}: BosDataTableProps<T>) {
  const keys = rows.map(rowKey);
  const selectedCount = selection ? keys.filter((k) => selection.selected.has(k)).length : 0;
  const allSelected = selectedCount > 0 && selectedCount === keys.length;
  const colCount = columns.length + (selection ? 1 : 0) + (chevron ? 1 : 0);

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) keys.forEach((k) => next.delete(k));
    else keys.forEach((k) => next.add(k));
    selection.onChange(next);
  };

  const toggleOne = (key: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  };

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row);
    }
  };

  return (
    <div className={className}>
      {selection && bulkActions && selectedCount > 0 ? (
        <div className="bos-bulk-bar" role="region" aria-label="Bulk actions">
          <span>{selectedCount} selected</span>
          <div className="bos-row" style={{ gap: 8 }}>
            {bulkActions(selectedCount)}
          </div>
        </div>
      ) : null}
      <div className="bos-table-wrap">
        <div className="bos-table-scroll">
          <table className={cx("bos-table", compact && "bos-table-compact")}>
            {caption ? <caption className="bos-sr-only">{caption}</caption> : null}
            <thead>
              <tr>
                {selection ? (
                  <th className="is-check">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={selectedCount > 0 && !allSelected}
                      onChange={toggleAll}
                      aria-label="Select all rows"
                    />
                  </th>
                ) : null}
                {columns.map((c) => (
                  <th key={c.key} className={cx(c.align === "right" && "is-num")} style={c.width ? { width: c.width } : undefined} scope="col">
                    {c.header}
                  </th>
                ))}
                {chevron ? <th aria-hidden="true" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="bos-table-empty">
                    {empty}
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => {
                  const key = keys[i];
                  const selected = selection?.selected.has(key) ?? false;
                  return (
                    <tr
                      key={key}
                      className={cx(onRowClick && "is-clickable", selected && "is-selected")}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={onRowClick ? (e) => onRowKey(e, row) : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                    >
                      {selection ? (
                        <td className="is-check" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected} onChange={() => toggleOne(key)} aria-label="Select row" />
                        </td>
                      ) : null}
                      {columns.map((c) => (
                        <td key={c.key} className={cx(c.align === "right" && "is-num", c.mono && "bos-cell-mono")}>
                          {c.cell ? c.cell(row) : readCell(row, c.key)}
                        </td>
                      ))}
                      {chevron ? (
                        <td className="bos-cell-chev" aria-hidden="true">
                          ›
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Pagination({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="bos-pagination">
      <span>{children}</span>
      {actions ? <div className="bos-row" style={{ gap: 8 }}>{actions}</div> : null}
    </div>
  );
}

/** Avatar + name + role cell. */
export function PersonCell({ avatar, name, role }: { avatar: ReactNode; name: ReactNode; role?: ReactNode }) {
  return (
    <div className="bos-person">
      {avatar}
      <div style={{ minWidth: 0 }}>
        <div className="bos-person-name">{name}</div>
        {role ? <div className="bos-person-role">{role}</div> : null}
      </div>
    </div>
  );
}
