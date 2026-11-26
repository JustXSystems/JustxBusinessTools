"use client";

import { useEffect, useState } from "react";
import { fetchBillingHistory } from "@/lib/api";
import { formatInr } from "@/lib/subscription-store-helpers";
import type { BillingHistoryEntry, BillingHistoryPayload } from "@/lib/types/subscription";
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
) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=760,height=840");
  if (!win) return;
  const dateStr = entry.occurredAt ? entry.occurredAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const cycleLabel = entry.billingCycle === "year" ? "Annual (365 days)" : "Monthly (30 days)";
  const title = account.hasGstin ? "Subscription Tax Receipt" : "Subscription Payment Receipt";
  const toolsHtml =
    entry.toolNames.length > 0
      ? entry.toolNames.map((n) => `<li>${escapeHtml(n)}</li>`).join("")
      : `<li>Workspace subscription charge</li>`;

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
    <p class="label">Subscribed tools</p>
    <ul>${toolsHtml}</ul>
  </div>

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

export function BillingHistoryPanel({ refreshKey }: { refreshKey?: string }) {
  const { appName, legalName } = useBrandCopy();
  const [data, setData] = useState<BillingHistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="billing-history card">
      <div className="sub-lines-head">
        <div>
          <p className="card-label">Billing history &amp; receipts</p>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
            {data?.account.hasGstin
              ? `Business billing ledger · GSTIN ${data.account.gstin}`
              : "Personal payment ledger · printable receipts available"}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading billing history…</p>
      ) : (
        <ul className="sub-history-list">
          {entries.map((entry) => {
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
                    onClick={() => openPrintableReceipt(entry, data.account, { appName, legalName })}
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
