"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type DashboardData = {
  analytics: {
    totals: { creates: number; opens: number; exports: number; limit_blocks: number };
    topTools: Array<{ toolId: string; creates: number; opens: number }>;
    dailyCreates: Array<{ date: string; creates: number }>;
  };
  collections: {
    totalReceivable: number;
    overdueReceivable: number;
    netPosition: number;
    amcRenewalsNext30d: number;
  };
  subscription: { planId: string; status: string; mrrInr: number } | null;
  payments: { collectedInr: number; failedCount: number; failureRate: number };
};

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<DashboardData>("/admin/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="field-error">{error}</p>;
  if (!data) return <p className="muted">Loading dashboard…</p>;

  return (
    <div className="admin-grid">
      <section className="panel admin-card">
        <h2>Usage (30d)</h2>
        <div className="result-grid">
          <div className="result-card">
            <span>Opens</span>
            <strong>{data.analytics.totals.opens}</strong>
          </div>
          <div className="result-card">
            <span>Creates</span>
            <strong>{data.analytics.totals.creates}</strong>
          </div>
          <div className="result-card">
            <span>Exports</span>
            <strong>{data.analytics.totals.exports}</strong>
          </div>
          <div className="result-card">
            <span>Limit blocks</span>
            <strong>{data.analytics.totals.limit_blocks}</strong>
          </div>
        </div>
      </section>

      <section className="panel admin-card">
        <h2>Collections</h2>
        <div className="result-grid">
          <div className="result-card">
            <span>Receivable</span>
            <strong>{inr(data.collections.totalReceivable)}</strong>
          </div>
          <div className="result-card">
            <span>Overdue</span>
            <strong>{inr(data.collections.overdueReceivable)}</strong>
          </div>
          <div className="result-card">
            <span>Net position</span>
            <strong>{inr(data.collections.netPosition)}</strong>
          </div>
          <div className="result-card">
            <span>AMC renewals (30d)</span>
            <strong>{data.collections.amcRenewalsNext30d}</strong>
          </div>
        </div>
      </section>

      <section className="panel admin-card">
        <h2>SaaS subscription</h2>
        {data.subscription ? (
          <ul className="admin-kv">
            <li><span>Plan</span><strong>{data.subscription.planId}</strong></li>
            <li><span>Status</span><strong>{data.subscription.status}</strong></li>
            <li><span>MRR</span><strong>{inr(data.subscription.mrrInr)}</strong></li>
            <li><span>Collected (90d)</span><strong>{inr(data.payments.collectedInr)}</strong></li>
            <li><span>Failed payments</span><strong>{data.payments.failedCount}</strong></li>
          </ul>
        ) : (
          <p className="muted">No org subscription row</p>
        )}
      </section>

      <section className="panel admin-card">
        <h2>Top tools</h2>
        <ul className="admin-list">
          {data.analytics.topTools.map((t) => (
            <li key={t.toolId}>
              <span>{t.toolId}</span>
              <span>{t.creates} creates · {t.opens} opens</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
