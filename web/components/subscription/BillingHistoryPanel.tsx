"use client";

import { useEffect, useState } from "react";
import { fetchBillingHistory } from "@/lib/api";
import { formatInr } from "@/lib/subscription-store-helpers";
import {
  DEFAULT_COMMERCE_POLICY,
  type BillingHistoryEntry,
  type BillingHistoryPayload,
  type CommercePolicy,
} from "@/lib/types/subscription";
import { useBrandCopy } from "@/lib/use-brand-copy";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openPrintableReceipt(
  entry: BillingHistoryEntry,
  account: BillingHistoryPayload["account"],
  brand: { appName: string; legalName: string },
  policyInput?: Partial<CommercePolicy>,
) {
  const policy = { ...DEFAULT_COMMERCE_POLICY, ...(policyInput ?? {}) };
  const win = window.open("", "_blank", "noopener,noreferrer,width=760,height=840");
  if (!win) return;
  const dateStr = entry.occurredAt ? entry.occurredAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const cycleLabel =
    entry.billingCycle === "year"
      ? `Annual (${policy.annualDurationDays} days)`
      : `Monthly (${policy.monthlyDurationDays} days)`;
  const showGst = account.hasGstin && policy.gstEnabled && policy.gstRatePct > 0;
  const title = showGst ? "Subscription Tax Receipt" : "Subscription Payment Receipt";
  const toolsHtml =
    entry.toolNames.length > 0
      ? entry.toolNames.map((n) => `<li>${escapeHtml(n)}</li>`).join("")
      : `<li>Workspace subscription charge</li>`;
  const gstRate = policy.gstRatePct / 100;
  const taxableValue = showGst
    ? Math.round((entry.amountInr / (1 + gstRate)) * 100) / 100
    : entry.amountInr;
  const gstAmount = showGst ? Math.round((entry.amountInr - taxableValue) * 100) / 100 : 0;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} — ${escapeHtml(entry.reference)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 32px; line-height: 1.5; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 22px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .sub { color: #475569; font-size: 13px; margin: 0; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; background: #dcfce7; color: #166534; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 22px; }
    .box { border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; }
    .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin: 0 0 6px; }
    ul { margin: 6px 0 0; padding-left: 18px; }
    .total { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 18px; font-weight: 700; margin-top: 18px; }
    .foot { margin-top: 28px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    .actions { margin-top: 20px; }
    @media print { .actions { display: none; } body { margin: 16px; } }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${escapeHtml(brand.appName)}</h1>
      <p class="sub">${escapeHtml(brand.legalName)}</p>
      ${policy.sellerGstin ? `<p class="sub">Seller GSTIN: <code>${escapeHtml(policy.sellerGstin)}</code></p>` : ""}
    </div>
    <div style="text-align:right">
      <div class="badge">${escapeHtml(entry.status)}</div>
      <p class="sub" style="margin-top:6px"><strong>${escapeHtml(title)}</strong></p>
      <p class="sub">Date: ${escapeHtml(dateStr)}</p>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <p class="label">Billed to</p>
      <div><strong>${escapeHtml(account.businessName || entry.payerName || "Workspace Subscriber")}</strong></div>
      ${account.hasGstin && account.gstin ? `<div>GSTIN: <code>${escapeHtml(account.gstin)}</code></div>` : `<div>Personal Account (No GSTIN)</div>`}
      ${entry.payerEmail ? `<div>${escapeHtml(entry.payerEmail)}</div>` : ""}
    </div>
    <div class="box">
      <p class="label">Payment reference</p>
      <div>Reference / UTR: <strong>${escapeHtml(entry.reference)}</strong></div>
      <div>Method: ${escapeHtml(entry.provider.toUpperCase())}</div>
      <div>Billing cycle: ${escapeHtml(cycleLabel)}</div>
    </div>
  </div>

  <div class="box">
    <p class="label">Subscribed tools${showGst ? ` · SAC ${escapeHtml(policy.sacCode)}` : ""}</p>
    <ul>${toolsHtml}</ul>
  </div>

  ${
    showGst
      ? `<div class="box" style="margin-top:14px">
           <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>Taxable Value (SAC ${escapeHtml(policy.sacCode)})</span><span>₹${taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
           <div style="display:flex;justify-content:space-between;font-size:13px"><span>GST @ ${policy.gstRatePct}% (Inclusive)</span><span>₹${gstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
         </div>`
      : ""
  }

  <div class="total">
    <span>Total Paid</span>
    <span>${escapeHtml(formatInr(entry.amountInr))}</span>
  </div>

  <p class="foot">This computer-generated payment receipt confirms subscription settlement with ${escapeHtml(brand.legalName)}.</p>
  <div class="actions">
    <button onclick="window.print()" style="padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer">Print / Save as PDF</button>
  </div>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}

export function BillingHistoryPanel({
  refreshKey,
  policy,
}: {
  refreshKey?: string;
  policy?: CommercePolicy;
}) {
  const { appName, legalName } = useBrandCopy();
  const [data, setData] = useState<BillingHistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "paid" | "pending">("all");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchBillingHistory()
      .then((res) => {
        if (alive) setData(res);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const entries = data?.entries ?? [];
  if (!loading && entries.length === 0) return null;

  const isPaid = (s: string) => s === "approved" || s === "success";
  const totalPaidInr = entries
    .filter((e) => isPaid(e.status))
    .reduce((sum, e) => sum + Number(e.amountInr || 0), 0);
  const visible = entries.filter((e) => {
    if (filter === "paid") return isPaid(e.status);
    if (filter === "pending") return !isPaid(e.status);
    return true;
  });

  return (
    <section className="billing-history card">
      <div className="sub-lines-head">
        <div>
          <p className="card-label">Billing history &amp; receipts</p>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
            {data?.account.hasGstin
              ? `Business billing ledger · GSTIN ${data.account.gstin}`
              : "Personal payment ledger · printable receipts available"}
            {totalPaidInr > 0 ? ` · Total paid: ${formatInr(totalPaidInr)}` : ""}
          </p>
        </div>
        {entries.length > 1 ? (
          <div className="sub-filter-chips" role="tablist" aria-label="Filter billing history">
            {(
              [
                ["all", `All (${entries.length})`],
                ["paid", "Paid"],
                ["pending", "Pending / Other"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                className={`sub-filter-chip${filter === id ? " is-active" : ""}`}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="muted">Loading billing history…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No billing records match this filter.</p>
      ) : (
        <ul className="sub-history-list">
          {visible.map((entry) => {
            const approved = entry.status === "approved" || entry.status === "success";
            const rejected = entry.status === "rejected" || entry.status === "failed";
            return (
              <li key={entry.id} className="sub-history-row">
                <div className="sub-history-main">
                  <div className="sub-active-title">
                    <strong>{formatInr(entry.amountInr)}</strong>
                    <span
                      className={`sub-status-chip ${
                        approved ? "is-emerald" : rejected ? "is-amber" : "is-cyan"
                      }`}
                    >
                      {entry.status}
                    </span>
                    <span className="sub-status-chip is-cyan">
                      {entry.billingCycle === "year" ? "Yearly · 365d" : "Monthly · 30d"}
                    </span>
                  </div>
                  <span className="sub-active-meta">
                    {entry.provider.toUpperCase()} · Ref {entry.reference} · {entry.occurredAt.slice(0, 10)}
                    {entry.toolNames.length > 0 ? ` · ${entry.toolNames.join(", ")}` : ""}
                  </span>
                  {entry.reviewNote ? (
                    <span className="sub-active-meta">Note: {entry.reviewNote}</span>
                  ) : null}
                </div>
                {approved && data ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openPrintableReceipt(entry, data.account, { appName, legalName }, policy)}
                  >
                    Receipt / PDF
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
