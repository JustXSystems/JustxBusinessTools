"use client";

import { Fragment, useEffect, useState } from "react";
import { publicAssetUrl } from "@/lib/base-path";
import { inrExact, qtyText } from "@/lib/ims/format";
import type { BomBusiness, BomDoc, BomDocLine, BomTotals } from "@/lib/ims/bom";

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

/** Printable commercial BOM sheet (not a GST tax invoice). */
export function BomPaper({ model }: { model: BomPaperModel }) {
  const b = model.business;
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setLogoFailed(false);
  }, [b.logoUrl]);
  const logoSrc = !logoFailed && b.logoUrl ? publicAssetUrl(b.logoUrl) : "";
  const sections: Array<{ name: string; lines: BomPaperModel["lines"]; start: number }> = [];
  let idx = 0;
  for (const line of model.lines) {
    const last = sections[sections.length - 1];
    if (!last || last.name !== line.section) {
      sections.push({ name: line.section, lines: [line], start: 0 });
    } else {
      last.lines = [...last.lines, line];
    }
  }
  for (const s of sections) {
    s.start = idx;
    idx += s.lines.length;
  }

  const status = (model.status || "").toLowerCase();
  const watermark = status === "draft" ? "DRAFT" : status === "cancelled" ? "CANCELLED" : null;

  return (
    <article className="ims-bom-paper bos-inv-paper" aria-label="Bill of materials">
      {watermark ? <div className="ims-bom-paper-watermark" aria-hidden="true">{watermark}</div> : null}
      <header className="ims-bom-paper-brand-block">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant logo from /api/files
          <img
            className="ims-bom-paper-logo"
            src={logoSrc}
            alt=""
            onError={() => setLogoFailed(true)}
          />
        ) : null}
        <div className="ims-bom-paper-brand">{b.name || "Your business"}</div>
        <div className="ims-bom-paper-brand-meta">
          {[b.address, b.state, b.gstin ? `GSTIN ${b.gstin}` : null, b.phone, b.email].filter(Boolean).join(" · ")}
        </div>
      </header>

      <div className="ims-bom-paper-title-row">
        <div className="ims-bom-paper-title">BILL OF MATERIALS</div>
        <div className="ims-bom-paper-capacity">
          {model.capacityLabel ? (
            <>
              <span style={{ opacity: 0.7, fontWeight: 600 }}>Package / capacity: </span>
              {model.capacityLabel}
            </>
          ) : (
            <span style={{ opacity: 0.55 }}>Package / capacity</span>
          )}
        </div>
      </div>

      <div className="ims-bom-paper-meta">
        <div>
          <b>Customer</b>
          {model.customerName || "—"}
        </div>
        <div>
          <b>Location / site</b>
          {model.location || "—"}
        </div>
        <div>
          <b>Document</b>
          {model.docNo || "Draft"}
          {model.docDate ? ` · ${model.docDate}` : ""}
        </div>
        <div>
          <b>Title</b>
          {model.title || "—"}
        </div>
      </div>

      <table className="ims-bom-paper-table">
        <thead>
          <tr>
            <th className="ctr" style={{ width: 40 }}>
              #
            </th>
            <th>Item description</th>
            <th style={{ width: "16%" }}>Make / brand</th>
            <th className="ctr" style={{ width: 54 }}>
              Qty
            </th>
            <th className="ctr" style={{ width: 54 }}>
              Unit
            </th>
            <th className="num" style={{ width: 78 }}>
              Rate
            </th>
            <th className="num" style={{ width: 84 }}>
              Total
            </th>
            <th style={{ width: "12%" }}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {sections.length ? (
            sections.map((sec, sIdx) => (
              <Fragment key={`sec-${sIdx}-${sec.name}`}>
                <tr className="ims-bom-section-row">
                  <td className="ctr">{String.fromCharCode(64 + (sIdx + 1))}</td>
                  <td colSpan={7}>{sec.name}</td>
                </tr>
                {sec.lines.map((l, i) => (
                  <tr key={`${sec.name}-${i}-${l.description}`}>
                    <td className="ctr">{i + 1}</td>
                    <td style={{ whiteSpace: "normal" }}>{l.description}</td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td className="ctr">{qtyText(l.qty)}</td>
                    <td className="ctr">{l.unit}</td>
                    <td className="num">{inrExact(l.rate)}</td>
                    <td className="num">{inrExact(l.amount ?? l.qty * l.rate)}</td>
                    <td style={{ whiteSpace: "normal" }}>{l.remarks || ""}</td>
                  </tr>
                ))}
              </Fragment>
            ))
          ) : (
            <tr>
              <td colSpan={8} style={{ textAlign: "center", opacity: 0.6 }}>
                No lines yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="ims-bom-paper-totals">
        <div className="ims-bom-paper-totals-row is-accent">
          <span>Materials total</span>
          <span>{inrExact(model.totals.materialsTotal)}</span>
        </div>
        <div className="ims-bom-paper-totals-row">
          <span>Margin {model.marginPct ? `${model.marginPct}%` : ""}</span>
          <span>{inrExact(model.totals.marginAmount)}</span>
        </div>
        <div className="ims-bom-paper-totals-row">
          <span>Subtotal</span>
          <span>{inrExact(model.totals.materialsTotal + model.totals.marginAmount)}</span>
        </div>
        <div className="ims-bom-paper-totals-row">
          <span>Tax {model.taxPct ? `${model.taxPct}%` : ""}</span>
          <span>{inrExact(model.totals.taxAmount)}</span>
        </div>
        <div className="ims-bom-paper-totals-row is-accent">
          <span>Grand total</span>
          <span>{inrExact(model.totals.grandTotal)}</span>
        </div>
      </div>

      {model.notes ? <div className="ims-bom-paper-notes">{model.notes}</div> : null}
      {model.preparedBy ? (
        <div className="ims-bom-paper-notes" style={{ textAlign: "right" }}>
          Prepared by {model.preparedBy}
        </div>
      ) : null}
    </article>
  );
}
