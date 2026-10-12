"use client";

import type { ReactNode } from "react";
import { inrExact, qtyText, rupeesInWords, type ImsLine, type ImsTotals } from "@/lib/ims/format";

export type PaperParty = { label: string; name: string; gstin?: string | null; address?: string | null; state?: string | null; phone?: string | null; email?: string | null };

/**
 * Printable GST document (purchase order, tax invoice, bill, credit note) on the kit's
 * `.bos-inv-paper`, so `usePrint()` prints exactly this sheet.
 */
export function DocumentPaper({
  title,
  seller,
  party,
  shipTo,
  meta,
  totals,
  intraState,
  notes,
  terms,
  stamp,
  footer,
  showReceived,
}: {
  title: string;
  seller: PaperParty;
  party: PaperParty;
  shipTo?: PaperParty | null;
  meta: ReadonlyArray<{ label: string; value: ReactNode }>;
  totals: ImsTotals;
  intraState: boolean;
  notes?: string | null;
  terms?: string | null;
  stamp?: { text: string; color: string } | null;
  footer?: ReactNode;
  showReceived?: boolean;
}) {
  const lines: ImsLine[] = totals.lines;
  const block = (p: PaperParty) => (
    <div>
      <div className="bos-inv-paper-label">{p.label}</div>
      <div className="bos-inv-paper-value">{p.name || "—"}</div>
      <div className="ims-paper-sub">
        {[p.address, p.state, p.gstin ? `GSTIN ${p.gstin}` : null, p.phone, p.email].filter(Boolean).join("\n")}
      </div>
    </div>
  );
  return (
    <article className="bos-inv-paper" aria-label={title} style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <div>
          <div className="bos-inv-paper-brand">{seller.name || "Your business"}</div>
          <div className="ims-paper-seller">{[seller.address, seller.state, seller.gstin ? `GSTIN ${seller.gstin}` : null, seller.phone, seller.email].filter(Boolean).join("\n")}</div>
        </div>
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
        {block(party)}
        {shipTo ? block(shipTo) : <div />}
      </div>

      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>HSN</th>
            <th>Qty</th>
            {showReceived ? <th>Recd.</th> : null}
            <th>Rate</th>
            <th>Disc</th>
            <th>GST</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.length ? (
            lines.map((l, i) => (
              <tr key={`${l.itemId ?? l.name}-${i}`}>
                <td>{i + 1}</td>
                <td style={{ whiteSpace: "normal" }}>
                  {l.name}
                  {l.sku ? <small>{l.sku}</small> : null}
                </td>
                <td>{l.hsn || "—"}</td>
                <td>{qtyText(l.qty, l.unit)}</td>
                {showReceived ? <td>{qtyText(l.receivedQty ?? 0)}</td> : null}
                <td>{inrExact(l.rate)}</td>
                <td>{l.discountPct ? `${l.discountPct}%` : "—"}</td>
                <td>{l.gstRate}%</td>
                <td>{inrExact(l.amount)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={showReceived ? 9 : 8} className="bos-inv-paper-empty">
                No items
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="bos-inv-totals">
        <div className="bos-inv-totals-row">
          <span>Taxable value</span>
          <span>{inrExact(totals.taxable)}</span>
        </div>
        {intraState ? (
          <>
            <div className="bos-inv-totals-row">
              <span>CGST</span>
              <span>{inrExact(totals.cgst)}</span>
            </div>
            <div className="bos-inv-totals-row">
              <span>SGST</span>
              <span>{inrExact(totals.sgst)}</span>
            </div>
          </>
        ) : (
          <div className="bos-inv-totals-row">
            <span>IGST</span>
            <span>{inrExact(totals.igst)}</span>
          </div>
        )}
        {totals.roundOff ? (
          <div className="bos-inv-totals-row">
            <span>Round off</span>
            <span>{inrExact(totals.roundOff)}</span>
          </div>
        ) : null}
        <div className="bos-inv-totals-row is-total">
          <span>Total</span>
          <span>{inrExact(totals.grandTotal)}</span>
        </div>
      </div>
      <div className="ims-paper-words">{rupeesInWords(totals.grandTotal)}</div>

      {notes ? <div className="bos-inv-notes">{notes}</div> : null}
      {terms ? (
        <div className="bos-inv-notes">
          <strong>Terms &amp; conditions</strong>
          {"\n"}
          {terms}
        </div>
      ) : null}
      {footer ? <div className="bos-inv-notes">{footer}</div> : null}
      <div className="ims-paper-sign">
        <div />
        <div>
          <div className="ims-paper-sign-line" />
          Authorised signatory · {seller.name}
        </div>
      </div>
    </article>
  );
}
