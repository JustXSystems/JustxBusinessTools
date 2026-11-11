"use client";

import { Fragment } from "react";
import { dateLabel, inrExact, qtyText, rupeesInWords } from "@/lib/ims/format";
import type { BomBusiness, BomDoc, BomDocLine, BomTotals } from "@/lib/ims/bom";
import { PaperBrandHead, sellerDetail } from "../shared/DocumentPaper";

export type BomPaperModel = {
  business: BomBusiness;
  docNo?: string | null;
  docDate?: string | null;
  status?: string | null;
  title: string;
  capacityLabel: string;
  customerName: string;
  location: string;
  preparedBy?: string | null;
  notes?: string | null;
  marginPct: number;
  taxPct: number;
  lines: ReadonlyArray<Pick<BomDocLine, "section" | "description" | "makeText" | "qty" | "unit" | "rate" | "amount" | "remarks">>;
  totals: BomTotals;
};

export function modelFromDoc(doc: BomDoc, business: BomBusiness): BomPaperModel {
  return {
    business,
    docNo: doc.docNo,
    docDate: doc.docDate,
    status: doc.status,
    title: doc.title || doc.packageName || "Bill of materials",
    capacityLabel: doc.capacityLabel || "",
    customerName: doc.customerName || "",
    location: doc.location || "",
    preparedBy: doc.preparedBy,
    notes: doc.notes,
    marginPct: doc.marginPct,
    taxPct: doc.taxPct,
    lines: doc.lines ?? [],
    totals: {
      materialsTotal: doc.materialsTotal,
      marginAmount: doc.marginAmount,
      taxAmount: doc.taxAmount,
      grandTotal: doc.grandTotal,
    },
  };
}

const BOM_STAMP: Partial<Record<string, { text: string; color: string }>> = {
  draft: { text: "DRAFT", color: "#8A8FA3" },
  cancelled: { text: "CANCELLED", color: "#8A8FA3" },
};

/** Printable commercial BOM sheet — same paper language as tax invoices (`DocumentPaper`). */
export function BomPaper({ model }: { model: BomPaperModel }) {
  const b = model.business;
  const status = (model.status || "").toLowerCase();
  const stamp = BOM_STAMP[status] ?? null;
  const title = status === "draft" ? "DRAFT BOM" : "BILL OF MATERIALS";
  const subtotal = model.totals.materialsTotal + model.totals.marginAmount;

  const sections: Array<{ name: string; lines: BomPaperModel["lines"] }> = [];
  for (const line of model.lines) {
    const last = sections[sections.length - 1];
    if (!last || last.name !== line.section) {
      sections.push({ name: line.section, lines: [line] });
    } else {
      last.lines = [...last.lines, line];
    }
  }

  const meta: Array<{ label: string; value: string }> = [
    { label: "Document no.", value: model.docNo || "Draft" },
    { label: "Document date", value: model.docDate ? dateLabel(model.docDate) : "—" },
    { label: "Package / capacity", value: model.capacityLabel || "—" },
  ];
  if (model.title) meta.push({ label: "Title", value: model.title });
  if (model.preparedBy) meta.push({ label: "Prepared by", value: model.preparedBy });

  return (
    <article className="bos-inv-paper" aria-label="Bill of materials" style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <PaperBrandHead
          name={b.name || "Your business"}
          logoUrl={b.logoUrl}
          detail={sellerDetail({ address: b.address, state: b.state, gstin: b.gstin, phone: b.phone, email: b.email })}
        />
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">{title}</div>
          {stamp ? (
            <span className="ims-paper-stamp" style={{ color: stamp.color }}>
              {stamp.text}
            </span>
          ) : null}
        </div>
      </div>

      <div className="ims-paper-meta">
        {meta.map((m) => (
          <div key={m.label}>
            <b>{m.label}</b>
            {m.value}
          </div>
        ))}
      </div>

      <div className="bos-inv-paper-meta">
        <div>
          <div className="bos-inv-paper-label">Customer</div>
          <div className="bos-inv-paper-value">{model.customerName || "—"}</div>
        </div>
        <div>
          <div className="bos-inv-paper-label">Site / location</div>
          <div className="bos-inv-paper-value">{model.location || "—"}</div>
        </div>
      </div>

      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Make</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sections.length ? (
            sections.map((sec, sIdx) => (
              <Fragment key={`sec-${sIdx}-${sec.name}`}>
                {sections.length > 1 ? (
                  <tr className="ims-bom-section">
                    <td colSpan={6}>{sec.name || `Section ${String.fromCharCode(65 + sIdx)}`}</td>
                  </tr>
                ) : null}
                {sec.lines.map((l, i) => (
                  <tr key={`${sec.name}-${i}-${l.description}`}>
                    <td>{i + 1}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {l.description}
                      {l.remarks ? <small>{l.remarks}</small> : null}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty, l.unit)}</td>
                    <td>{inrExact(l.rate)}</td>
                    <td>{inrExact(l.amount ?? l.qty * l.rate)}</td>
                  </tr>
                ))}
              </Fragment>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="bos-inv-paper-empty">
                No items
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="bos-inv-totals">
        <div className="bos-inv-totals-row">
          <span>Materials total</span>
          <span>{inrExact(model.totals.materialsTotal)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Margin{model.marginPct ? ` (${model.marginPct}%)` : ""}</span>
          <span>{inrExact(model.totals.marginAmount)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Subtotal</span>
          <span>{inrExact(subtotal)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Tax{model.taxPct ? ` (${model.taxPct}%)` : ""}</span>
          <span>{inrExact(model.totals.taxAmount)}</span>
        </div>
        <div className="bos-inv-totals-row is-total">
          <span>Total</span>
          <span>{inrExact(model.totals.grandTotal)}</span>
        </div>
      </div>
      <div className="ims-paper-words">{rupeesInWords(model.totals.grandTotal)}</div>

      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}

      <div className="ims-paper-sign">
        <div />
        <div>
          <div className="ims-paper-sign-line" />
          {model.preparedBy ? `Prepared by ${model.preparedBy}` : `Authorised signatory · ${b.name || "Your business"}`}
        </div>
      </div>
    </article>
  );
}
