import {
  DEFAULT_COMMERCE_POLICY,
  type BillingCycle,
  type CartQuote,
  type CommercePolicy,
  type UserCategory,
} from "./types/subscription";
import { describeUserCategory, formatInr } from "./subscription-store-helpers";

export type ProformaQuoteInput = {
  quoteNumber?: string;
  issuedAt?: Date;
  validDays?: number;
  policy?: Partial<CommercePolicy>;
  sellerAppName: string;
  sellerLegalName: string;
  customerName: string;
  customerGstin?: string | null;
  userCategory?: UserCategory;
  branchCount?: number;
  billingCycle: BillingCycle;
  quote: Pick<
    CartQuote,
    | "lines"
    | "subtotalInr"
    | "totalInr"
    | "packName"
    | "savingsInr"
    | "annualSavingsInr"
    | "durationDays"
    | "periodEndPreview"
    | "promo"
    | "upi"
  >;
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure GST/Personal Proforma Quotation HTML builder for instant print / Save-as-PDF.
 * - GSTIN accounts (Business / Enterprise): includes SAC 998314 and 18% GST-inclusive tax breakup.
 * - Personal accounts (no GSTIN): clean consumer estimate without GSTIN boilerplate.
 */
export function buildProformaQuoteHtml(input: ProformaQuoteInput): string {
  const policy = { ...DEFAULT_COMMERCE_POLICY, ...(input.policy ?? {}) };
  const issued = input.issuedAt ?? new Date();
  const validDays = Math.max(1, input.validDays ?? policy.proformaValidityDays ?? 7);
  const validUntil = new Date(issued.getTime() + validDays * 86400000);
  const quoteNo =
    input.quoteNumber ||
    `PFQ-${issued.getFullYear()}${String(issued.getMonth() + 1).padStart(2, "0")}${String(
      issued.getDate(),
    ).padStart(2, "0")}-${String(issued.getTime()).slice(-4)}`;

  const hasGstin = Boolean(input.customerGstin && input.customerGstin.trim().length > 0);
  const showGst = hasGstin && policy.gstEnabled && policy.gstRatePct > 0;
  const sacCode = policy.sacCode || "998314";
  const category = describeUserCategory(input.userCategory, input.branchCount ?? 1);
  const durationDays =
    input.quote.durationDays ??
    (input.billingCycle === "year" ? policy.annualDurationDays : policy.monthlyDurationDays);
  const cycleLabel =
    input.billingCycle === "year"
      ? `Annual (${durationDays} days)`
      : `Monthly (${durationDays} days)`;

  const totalInr = Math.max(0, Number(input.quote.totalInr || 0));
  const subtotalInr = Math.max(
    totalInr,
    Number(input.quote.subtotalInr ?? totalInr + (input.quote.promo?.discountInr ?? 0)),
  );
  const gstRate = policy.gstRatePct / 100;
  const taxableValue = showGst
    ? policy.gstPricingMode === "inclusive"
      ? Math.round((totalInr / (1 + gstRate)) * 100) / 100
      : totalInr
    : totalInr;
  const gstAmount = showGst
    ? policy.gstPricingMode === "inclusive"
      ? Math.round((totalInr - taxableValue) * 100) / 100
      : Math.round(totalInr * gstRate * 100) / 100
    : 0;
  const payableTotal =
    showGst && policy.gstPricingMode === "exclusive"
      ? Math.round((totalInr + gstAmount) * 100) / 100
      : totalInr;

  const lineRows = (input.quote.lines ?? [])
    .map(
      (line, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>
          <strong>${esc(line.name)}</strong>
          ${line.category ? `<div class="sub">${esc(line.category)}</div>` : ""}
        </td>
        ${showGst ? `<td class="mono">${esc(sacCode)}</td>` : ""}
        <td>${esc(cycleLabel)}</td>
        <td class="num">${formatInr(line.priceInr || 0)}</td>
      </tr>`,
    )
    .join("");

  const upiVpa = input.quote.upi?.vpa;
  const upiPayee = input.quote.upi?.payeeName || input.sellerLegalName;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(quoteNo)} — Proforma Quotation (${esc(input.sellerAppName)})</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 28px;
      line-height: 1.45;
      font-size: 13px;
    }
    .sheet { max-width: 780px; margin: 0 auto; }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 18px;
      gap: 20px;
    }
    .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.02em; }
    .brand p { margin: 3px 0 0; color: #475569; font-size: 12px; }
    .badge {
      display: inline-block;
      margin-top: 8px;
      padding: 3px 9px;
      border-radius: 999px;
      background: #ecfeff;
      color: #0e7490;
      border: 1px solid #a5f3fc;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .meta { text-align: right; }
    .meta h2 { margin: 0; font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em; color: #0284c7; }
    .meta p { margin: 2px 0; font-size: 12px; color: #334155; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }
    .box {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      background: #f8fafc;
    }
    .box h3 {
      margin: 0 0 6px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
    }
    .box p { margin: 2px 0; font-size: 12.5px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
    th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475569;
      background: #f1f5f9;
      padding: 9px 10px;
      border-bottom: 1px solid #cbd5e1;
    }
    td {
      padding: 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    .sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .totals {
      margin-left: auto;
      width: 320px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      background: #f8fafc;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 12.5px;
    }
    .totals-row.savings { color: #059669; font-weight: 600; }
    .totals-row.grand {
      border-top: 1.5px solid #0f172a;
      margin-top: 8px;
      padding-top: 9px;
      font-size: 15px;
      font-weight: 800;
    }
    .foot {
      margin-top: 22px;
      padding-top: 12px;
      border-top: 1px dashed #cbd5e1;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      font-size: 11.5px;
      color: #475569;
    }
    .print-bar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 16px;
    }
    .print-bar button {
      background: #0f172a;
      color: #fff;
      border: 0;
      border-radius: 8px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    @media print {
      body { padding: 12px; }
      .print-bar { display: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="print-bar">
      <button type="button" onclick="window.print()">Print / Save PDF</button>
    </div>
    <div class="top">
      <div class="brand">
        <h1>${esc(input.sellerAppName)}</h1>
        <p>${esc(input.sellerLegalName)} · SaaS Workspace Subscriptions</p>
        ${policy.sellerGstin ? `<p>Seller GSTIN: <span class="mono">${esc(policy.sellerGstin)}</span></p>` : ""}
        <span class="badge">${esc(category.badge)}</span>
      </div>
      <div class="meta">
        <h2>${hasGstin ? "Proforma Tax Quotation" : "Subscription Estimate"}</h2>
        <p><strong>Quote #:</strong> <span class="mono">${esc(quoteNo)}</span></p>
        <p><strong>Date:</strong> ${esc(formatDateIso(issued))}</p>
        <p><strong>Valid until:</strong> ${esc(formatDateIso(validUntil))}</p>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Prepared For</h3>
        <p><strong>${esc(input.customerName || "Workspace Account")}</strong></p>
        ${
          hasGstin
            ? `<p>GSTIN: <span class="mono">${esc(input.customerGstin)}</span></p>`
            : `<p>Personal / Individual Account (No GSTIN)</p>`
        }
        <p>Tier: ${esc(category.headline)}${(input.branchCount ?? 1) > 1 ? ` · ${input.branchCount} branches` : ""}</p>
      </div>
      <div class="box">
        <h3>Subscription Scope</h3>
        <p><strong>${esc(input.quote.packName || `${input.quote.lines.length} Modular Tool(s)`)}</strong></p>
        <p>Cycle: ${esc(cycleLabel)}</p>
        ${
          input.quote.periodEndPreview
            ? `<p>Estimated coverage through: ${esc(input.quote.periodEndPreview.slice(0, 10))}</p>`
            : ""
        }
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>Tool / Module</th>
          ${showGst ? `<th style="width:85px">SAC</th>` : ""}
          <th style="width:150px">Cycle</th>
          <th class="num" style="width:110px">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>

    <div class="totals">
      ${
        input.quote.savingsInr && input.quote.savingsInr > 0
          ? `<div class="totals-row savings"><span>Pack Bundle Savings</span><span>−${formatInr(input.quote.savingsInr)}</span></div>`
          : ""
      }
      ${
        input.billingCycle === "year" &&
        input.quote.annualSavingsInr &&
        input.quote.annualSavingsInr > 0
          ? `<div class="totals-row savings"><span>Annual Savings (2 mo free)</span><span>−${formatInr(input.quote.annualSavingsInr)}</span></div>`
          : ""
      }
      ${
        input.quote.promo
          ? `<div class="totals-row"><span>Subtotal</span><span>${formatInr(subtotalInr)}</span></div>
             <div class="totals-row savings"><span>Promo ${esc(input.quote.promo.code)} (${esc(input.quote.promo.label)})</span><span>−${formatInr(input.quote.promo.discountInr)}</span></div>`
          : ""
      }
      ${
        showGst
          ? `<div class="totals-row"><span>Taxable Value (SAC ${esc(sacCode)})</span><span>₹${taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
             <div class="totals-row"><span>GST @ ${policy.gstRatePct}% (${policy.gstPricingMode === "exclusive" ? "Exclusive" : "Inclusive"})</span><span>₹${gstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`
          : ""
      }
      <div class="totals-row grand">
        <span>Total Payable</span>
        <span>${formatInr(payableTotal)}</span>
      </div>
    </div>

    <div class="foot">
      <div>
        <strong>Payment Instructions</strong><br />
        ${
          upiVpa
            ? `Pay via UPI to <span class="mono">${esc(upiVpa)}</span> (${esc(upiPayee)}) or Debit/Credit Card inside ${esc(input.sellerAppName)} Checkout.`
            : `Complete payment via UPI or Debit/Credit Card inside ${esc(input.sellerAppName)} Checkout.`
        }
      </div>
      <div style="text-align:right">
        ${esc(policy.proformaFooterNote)}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function openProformaQuotePrint(input: ProformaQuoteInput): boolean {
  if (typeof window === "undefined") return false;
  const win = window.open("", "_blank", "noopener,noreferrer,width=880,height=740");
  if (!win) return false;
  win.document.open();
  win.document.write(buildProformaQuoteHtml(input));
  win.document.close();
  return true;
}
