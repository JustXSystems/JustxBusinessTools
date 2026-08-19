"use client";

import type { TrackerConfig } from "@/config/tools.config";
import type { TrackerRow } from "@/lib/types/tool-record";
import { displayMetaValue } from "@/lib/format";

type Props = {
  config: TrackerConfig;
  rows: TrackerRow[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
};

export function ToolRecordTable({ config, rows, onEdit, onDelete, readOnly }: Props) {
  return (
    <div className="tracker-list">
      {rows.map((row) => {
        const title = String(row[config.titleField] ?? "Untitled");
        const sub = config.subtitleFields
          .map((f) => row[f])
          .filter(Boolean)
          .join(" · ");

        const metas = config.metaFields.map((m) => (
          <div key={m.key}>
            <span className="m-lbl">{m.label}</span>
            <span className="m-val">{displayMetaValue(row[m.key], m)}</span>
          </div>
        ));

        const statusVal = config.statusField ? row[config.statusField] : null;
        const statusClass =
          statusVal && config.statusColors?.[String(statusVal)]
            ? config.statusColors[String(statusVal)]
            : "neutral";

        return (
          <div key={row.id} className="tracker-row">
            <div className="tracker-row-main">
              <div className="tracker-row-title">{title}</div>
              {sub ? <div className="tracker-row-sub">{sub}</div> : null}
            </div>
            <div className="tracker-row-meta">
              {metas}
              {statusVal ? (
                <div>
                  <span className={`pill pill-${statusClass}`}>{String(statusVal)}</span>
                </div>
              ) : null}
            </div>
            <div className="tracker-actions">
              {!readOnly ? (
                <>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(row.id)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(row.id)}>
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
