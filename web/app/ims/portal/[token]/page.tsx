"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PaperBrandHead, sellerDetail } from "@/components/ims/shared/DocumentPaper";
import { apiUrl } from "@/lib/api-base";
import { dateLabel, moneyFmt, qtyText } from "@/lib/ims/format";
import "./portal.css";

type PortalLine = { name: string; hsn: string | null; unit: string | null; qty: number; rate: number; discountPct: number; gstRate: number; taxable: number; tax: number; amount: number };

type PortalInvoice = {
  invoiceNo: string;
  docKind: string;
  displayStatus: string;
  invoiceDate: string;
  dueDate: string | null;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  placeOfSupply: string | null;
  intraState: boolean;
  customerPoNo: string | null;
  currencyCode: string;
  fxRate: number;
  fxBaseTotal: number;
  subtotal: number;
  discountTotal: number;
  taxable: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  shippingCharges: number;
  shippingTax: number;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  creditApplied: number;
  advanceApplied: number;
  retentionAmount: number;
  balance: number;
  daysOverdue: number;
  notes: string | null;
  terms: string | null;
  lines: PortalLine[];
};

type PortalInstallment = { seqNo: number; dueOn: string; amount: number; amountPaid: number; balance: number; status: "pending" | "partial" | "paid"; overdue: boolean; label: string | null };

type PortalSeller = {
  name: string;
  gstin: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  msmeRegistered: boolean;
  msmeUdyam: string | null;
};

type Portal = { asOf: string; invoice: PortalInvoice; installments: PortalInstallment[] | null; seller: PortalSeller; upi: { vpa: string; intent: string } | null };

const STATUS_TEXT: Record<string, string> = { unpaid: "Unpaid", partial: "Partly paid", paid: "Paid", overdue: "Overdue" };

function UpiQr({ intent }: { intent: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(async (QRCode) => {
      if (cancelled || !ref.current) return;
      await QRCode.toCanvas(ref.current, intent, { width: 168, margin: 1, errorCorrectionLevel: "M" });
    });
    return () => {
      cancelled = true;
    };
  }, [intent]);
  return <canvas ref={ref} width={168} height={168} aria-label="UPI payment QR code" />;
}

/**
 * Public customer portal for one invoice (magic link). View-only: invoice, balance, payment plan and a UPI QR
 * when the seller has a UPI ID. Nothing here captures a payment.
 */
export default function InvoicePortalPage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [portal, setPortal] = useState<Portal | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(apiUrl(`/api/public/invoice-portal/${encodeURIComponent(token)}`), { cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { portal?: Portal; error?: string };
        if (!r.ok || !data.portal) throw new Error(data.error || "This link is not valid");
        setPortal(data.portal);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (!portal) {
    return (
      <main className="ims-portal">
        <div className="ims-portal-shell">
          <section className="ims-portal-card">
            <h1>{error ? "Invoice unavailable" : "Loading invoice…"}</h1>
            {error ? <p>{error}. Please ask the sender for a fresh link.</p> : null}
          </section>
        </div>
      </main>
    );
  }

  const { invoice: inv, seller, installments, upi } = portal;
  const money = (n: number) => moneyFmt(n, inv.currencyCode);
  const paid = inv.balance <= 0.005;
  const nextDue = installments?.find((i) => i.status !== "paid") ?? null;
  const bank = [
    seller.bankAccountName ? ["Account name", seller.bankAccountName] : null,
    seller.bankAccountNo ? ["Account no.", seller.bankAccountNo] : null,
    seller.bankIfsc ? ["IFSC", seller.bankIfsc] : null,
    seller.bankName ? ["Bank", seller.bankName] : null,
  ].filter((r): r is string[] => Boolean(r));
  const kindLabel = inv.docKind === "debit_note" ? "Debit note" : inv.docKind === "retainer" ? "Retainer invoice" : "Tax invoice";

  return (
    <main className="ims-portal">
      <div className="ims-portal-shell">
        <header className="ims-portal-head">
          <PaperBrandHead name={seller.name} logoUrl={seller.logoUrl} detail={sellerDetail({ address: seller.address, state: seller.state, gstin: seller.gstin, phone: seller.phone, email: seller.email })} />
          <div className="ims-portal-doc">
            <div className="ims-portal-kind">{kindLabel}</div>
            <div className="ims-portal-no">{inv.invoiceNo}</div>
            <div className={`ims-portal-badge${paid ? " is-paid" : inv.daysOverdue > 0 ? " is-overdue" : ""}`}>{paid ? "Paid" : (STATUS_TEXT[inv.displayStatus] ?? inv.displayStatus)}</div>
          </div>
        </header>

        <section className="ims-portal-card ims-portal-due" aria-label="Amount due">
          <div>
            <div className="ims-portal-label">{paid ? "Settled" : "Amount due"}</div>
            <div className="ims-portal-amount">{money(inv.balance)}</div>
            <div className="ims-portal-sub">
              {paid ? "Thank you — this invoice is fully paid." : inv.dueDate ? `Due ${dateLabel(inv.dueDate)}${inv.daysOverdue > 0 ? ` · ${inv.daysOverdue} day${inv.daysOverdue === 1 ? "" : "s"} overdue` : ""}` : "Due on receipt"}
            </div>
            {inv.currencyCode !== "INR" && inv.fxRate !== 1 ? (
              <div className="ims-portal-sub">
                Rate locked at 1 {inv.currencyCode} = {inv.fxRate} · invoice total {moneyFmt(inv.fxBaseTotal, "INR")}
              </div>
            ) : null}
            {nextDue && !paid ? (
              <div className="ims-portal-sub">
                Next installment: {money(nextDue.balance)} by {dateLabel(nextDue.dueOn)}
              </div>
            ) : null}
          </div>
          <div className="ims-portal-actions no-print">
            <button type="button" onClick={() => window.print()}>
              Print / save PDF
            </button>
          </div>
        </section>

        <section className="ims-portal-card ims-portal-meta" aria-label="Invoice details">
          <div>
            <div className="ims-portal-label">Billed to</div>
            <div className="ims-portal-strong">{inv.customerName}</div>
            {inv.customerGstin ? <div>GSTIN {inv.customerGstin}</div> : null}
            {inv.customerAddress ? <div>{inv.customerAddress}</div> : null}
          </div>
          <dl>
            <dt>Invoice date</dt>
            <dd>{dateLabel(inv.invoiceDate)}</dd>
            <dt>Due date</dt>
            <dd>{inv.dueDate ? dateLabel(inv.dueDate) : "On receipt"}</dd>
            {inv.placeOfSupply ? (
              <>
                <dt>Place of supply</dt>
                <dd>{inv.placeOfSupply}</dd>
              </>
            ) : null}
            {inv.customerPoNo ? (
              <>
                <dt>Your PO</dt>
                <dd>{inv.customerPoNo}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {installments?.length ? (
          <section className="ims-portal-card" aria-label="Payment plan">
            <h2>Payment plan</h2>
            <table className="ims-portal-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Due</th>
                  <th className="is-num">Amount</th>
                  <th className="is-num">Paid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((i) => (
                  <tr key={i.seqNo}>
                    <td>{i.seqNo}</td>
                    <td>{dateLabel(i.dueOn)}</td>
                    <td className="is-num">{money(i.amount)}</td>
                    <td className="is-num">{money(i.amountPaid)}</td>
                    <td>{i.status === "paid" ? "Paid" : i.overdue ? "Overdue" : i.status === "partial" ? "Part paid" : "Pending"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section className="ims-portal-card" aria-label="Items">
          <h2>Items</h2>
          <div className="ims-portal-scroll">
            <table className="ims-portal-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th className="is-num">Qty</th>
                  <th className="is-num">Rate</th>
                  <th className="is-num">GST</th>
                  <th className="is-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={`${l.name}-${i}`}>
                    <td>{i + 1}</td>
                    <td>
                      {l.name}
                      {l.hsn ? <small>HSN {l.hsn}</small> : null}
                    </td>
                    <td className="is-num">{qtyText(l.qty, l.unit)}</td>
                    <td className="is-num">{money(l.rate)}</td>
                    <td className="is-num">{l.gstRate}%</td>
                    <td className="is-num">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ims-portal-totals">
            <dt>Taxable value</dt>
            <dd>{money(inv.taxable)}</dd>
            {inv.intraState ? (
              <>
                <dt>CGST</dt>
                <dd>{money(inv.cgst)}</dd>
                <dt>SGST</dt>
                <dd>{money(inv.sgst)}</dd>
              </>
            ) : (
              <>
                <dt>IGST</dt>
                <dd>{money(inv.igst)}</dd>
              </>
            )}
            {inv.roundOff ? (
              <>
                <dt>Round off</dt>
                <dd>{money(inv.roundOff)}</dd>
              </>
            ) : null}
            <dt className="is-strong">Total</dt>
            <dd className="is-strong">{money(inv.grandTotal)}</dd>
            {inv.amountPaid > 0.005 ? (
              <>
                <dt>Received</dt>
                <dd>{money(inv.amountPaid)}</dd>
              </>
            ) : null}
            {inv.creditApplied > 0.005 ? (
              <>
                <dt>Credits applied</dt>
                <dd>{money(inv.creditApplied)}</dd>
              </>
            ) : null}
            {inv.advanceApplied > 0.005 ? (
              <>
                <dt>Advance applied</dt>
                <dd>{money(inv.advanceApplied)}</dd>
              </>
            ) : null}
            <dt className="is-strong">Balance</dt>
            <dd className="is-strong">{money(inv.balance)}</dd>
          </dl>
          {inv.notes ? <p className="ims-portal-note">{inv.notes}</p> : null}
          {inv.terms ? (
            <p className="ims-portal-note">
              <b>Terms &amp; conditions</b>
              <br />
              {inv.terms}
            </p>
          ) : null}
        </section>

        {upi || bank.length ? (
          <section className="ims-portal-card ims-portal-pay" aria-label="How to pay">
            {upi ? (
              <div className="ims-portal-qr">
                <UpiQr intent={upi.intent} />
                <div>
                  <h2>Pay by UPI</h2>
                  <div className="ims-portal-mono">{upi.vpa}</div>
                  <div className="ims-portal-sub">Scan with any UPI app. The amount is filled in for you.</div>
                </div>
              </div>
            ) : null}
            {bank.length ? (
              <div>
                <h2>Bank transfer</h2>
                <dl className="ims-portal-bank">
                  {bank.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd className="ims-portal-mono">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="ims-portal-sub">Please quote {inv.invoiceNo} as the payment reference.</div>
              </div>
            ) : null}
          </section>
        ) : null}

        <footer className="ims-portal-foot">
          Issued by {seller.name}. This page is a private link for {inv.customerName}; payments are made directly to the seller.
        </footer>
      </div>
    </main>
  );
}
