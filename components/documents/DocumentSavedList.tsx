"use client";

import type { DocumentConfig } from "@/config/tools.config";
import type { DocumentListItem } from "@/lib/types/document";
import { fmtDate, fmtINR } from "@/lib/format";

type Props = {
  config: DocumentConfig;
  items: DocumentListItem[];
  loading: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  readOnly?: boolean;
};

export function DocumentSavedList({
  config,
  items,
  loading,
  onOpen,
  onDelete,
  onNew,
  readOnly,
}: Props) {
  if (loading) {
    return (
      <div className="empty-state">
        <div className="es-icon">⏳</div>
        <div className="es-title">Loading…</div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="empty-state">
        <div className="es-icon">📄</div>
        <div className="es-title">Nothing saved yet</div>
        <div className="es-sub">
          Create your first {config.docLabel.toLowerCase()} to see it here.
        </div>
        {!readOnly ? (
          <button type="button" className="btn btn-primary btn-sm mt-16" onClick={onNew}>
            + New
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tracker-list">
      {items.map((d) => (
        <div key={d.id} className="tracker-row">
          <div className="tracker-row-main">
            <div className="tracker-row-title">{d.docNo}</div>
            <div className="tracker-row-sub">{d.partyName} · {fmtDate(d.docDate)}</div>
          </div>
          <div className="tracker-row-meta">
            <div>
              <span className="m-lbl">Amount</span>
              <span className="m-val">₹{fmtINR(d.grandTotal)}</span>
            </div>
            <div>
              <span className="m-lbl">Status</span>
              <span className={`pill pill-${d.status === "sent" ? "success" : "neutral"}`}>
                {d.status}
              </span>
            </div>
          </div>
          <div className="tracker-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpen(d.id)}>
              Open
            </button>
            {!readOnly ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(d.id)}>
                Delete
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
