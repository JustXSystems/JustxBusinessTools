"use client";

import type { CompanyProfileV1, QuotationV1 } from "@/lib/quotation-v1";
import {
  computeTotals,
  fmtDate,
  fmtDateSlash,
  money,
  numToWordsIndian,
  typeLabel,
} from "@/lib/quotation-v1";
import { publicAssetUrl } from "@/lib/base-path";

type Props = {
  quote: QuotationV1;
  company: CompanyProfileV1;
  showBreakMarkers?: boolean;
};

export function QuoteSheet({ quote: q, company: c, showBreakMarkers }: Props) {
  const t = computeTotals(q, c);
  return (
    <div id="quote-sheet" className="qgv1-sheet" data-show-breaks={showBreakMarkers ? "1" : "0"}>
      {q.status === "approved" ? (
        <div className="qgv1-stamp">
          APPROVED
          <small>{fmtDate(q.approvedAt?.slice(0, 10) || q.date)}</small>
        </div>
      ) : null}
      {q.status === "rejected" ? (
        <div className="qgv1-stamp rejected">
          REJECTED
          <small>{fmtDate(q.rejectedAt?.slice(0, 10) || q.date)}</small>
        </div>
      ) : null}

      <div className="qgv1-qs-head">
        <div className="qgv1-qs-brand">
          {c.logo ? <img className="qgv1-qs-logo" src={publicAssetUrl(c.logo)} alt="" /> : null}
          <div className="name">{c.name}</div>
          {c.tagline ? <div className="tagline">{c.tagline}</div> : null}
          <div className="line">
            {(c.address || "").split("\n").map((l, i) => (
              <span key={i}>
                {l}
                <br />
              </span>
            ))}
            {c.phone ? (
              <>
                Mobile: {c.phone}
                <br />
              </>
            ) : null}
            {c.gstin ? (
              <>
                GSTIN: <b>{c.gstin}</b>
              </>
            ) : null}
          </div>
        </div>
        <div className="qgv1-qs-meta">
          <div className="title">QUOTATION</div>
          <div>
            <b>{typeLabel(q)}</b>
          </div>
          <div>Date: {fmtDate(q.date)}</div>
          <div>Valid Till: {fmtDate(q.validTill)}</div>
          <div>
            Q No: <b className="mono">{q.quoteNo || "(unsaved)"}</b>
          </div>
          <div>Prepared by : {q.preparedBy || "_______________"}</div>
        </div>
      </div>

      <div className="qgv1-qs-parties">
        <div className="qgv1-qs-party">
          <h4>Customer Details</h4>
          <div className="nm">{q.customer.name || "—"}</div>
          <div className="ln">
            {q.customer.company ? (
              <>
                {q.customer.company}
                <br />
              </>
            ) : null}
            {q.customer.address}
            <br />
            State: {q.customer.state}
            {q.customer.gstin ? (
              <>
                <br />
                GSTIN: {q.customer.gstin}
              </>
            ) : null}
          </div>
        </div>
        <div className="qgv1-qs-party">
          <h4>Customer Contact</h4>
          <div className="ln">
            Phone: {q.customer.phone || "—"}
            <br />
            Email: {q.customer.email || "—"}
            <br />
            Tax treatment: {t.interState ? "Inter-state (IGST)" : "Intra-state (CGST+SGST)"}
          </div>
        </div>
      </div>

      <table className="qgv1-qs-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>GST%</th>
            <th>Base Total</th>
            <th>GST Amount</th>
            <th>Total Amount</th>
          </tr>
        </thead>
        <tbody>
          {q.items.map((it, i) => {
            const base = (Number(it.qty) || 0) * (Number(it.rate) || 0);
            const gstAmt = (base * (Number(it.gst) || 0)) / 100;
            return (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>{it.desc}</td>
                <td>{it.qty}</td>
                <td>₹{money(Number(it.rate) || 0)}</td>
                <td>{it.gst}%</td>
                <td>₹{money(base)}</td>
                <td>₹{money(gstAmt)}</td>
                <td>₹{money(base + gstAmt)}</td>
              </tr>
            );
          })}
          {Number(q.extraCharge.amount) ? (
            <tr>
              <td>{q.items.length + 1}</td>
              <td>{q.extraCharge.label}</td>
              <td>—</td>
              <td>₹{money(Number(q.extraCharge.amount) || 0)}</td>
              <td>{q.extraCharge.gst}%</td>
              <td>—</td>
              <td>₹{money(t.exGstAmt)}</td>
              <td>₹{money(t.exTotal)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="qgv1-qs-totals-wrap">
        <div className="qgv1-qs-gst-note">
          <ul>
            <li>
              Note: GST/CGST/SGST/IGST, as applicable, shall be charged extra as per prevailing
              Government regulations.
            </li>
            <li>All pricing are in Indian currency only.</li>
          </ul>
        </div>
        <table className="qgv1-qs-totals">
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="amt">₹{money(t.subtotal)}</td>
            </tr>
            <tr>
              <td>Taxable Value</td>
              <td className="amt">₹{money(t.taxable)}</td>
            </tr>
            <tr>
              <td>Additional Charges</td>
              <td className="amt">₹{money(t.exTotal)}</td>
            </tr>
            {t.interState ? (
              <tr>
                <td>IGST ({t.igstRate.toFixed(2)}%)</td>
                <td className="amt">₹{money(t.igst)}</td>
              </tr>
            ) : (
              <>
                <tr>
                  <td>CGST ({t.cgstRate.toFixed(2)}%)</td>
                  <td className="amt">₹{money(t.cgst)}</td>
                </tr>
                <tr>
                  <td>SGST ({t.sgstRate.toFixed(2)}%)</td>
                  <td className="amt">₹{money(t.sgst)}</td>
                </tr>
              </>
            )}
            <tr>
              <td>Round Off</td>
              <td className="amt">₹{money(t.roundOff)}</td>
            </tr>
            <tr className="grand">
              <td>Grand Total</td>
              <td className="amt">₹{money(t.grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="qgv1-qs-words">Amount in words: {numToWordsIndian(t.grand)}</div>
      <div className="qgv1-sun-rule" />
      <div className="qgv1-qs-notes">
        <b>Terms &amp; Conditions</b>
        <br />
        {q.notes.split("\n").map((l, i) => (
          <span key={i}>
            {l}
            <br />
          </span>
        ))}
      </div>
      <div className="qgv1-qs-callback">
        <b>Thank you for your business with {c.name}!</b>
        <br />
        For any queries, please contact
        <br />
        Phone: {c.phone}
        <br />
        Email: {c.email}
      </div>
      <div className="qgv1-qs-bank">
        <div>
          <b>Date :</b> {fmtDateSlash(q.date)}
          <br />
          <b>Place :</b> {c.place || "Bengaluru"}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>For {c.name}</b>
          <div className="qgv1-qs-sign">Authorized Signatory</div>
        </div>
      </div>
      <div className="qgv1-qs-foot">
        {c.name} · {c.website} · This is a system-generated quotation.
      </div>
    </div>
  );
}
