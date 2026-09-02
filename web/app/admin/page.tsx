"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

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
  inbox?: {
    profiles: number;
    users: number;
    deskOps: number;
    upiClaims: number;
    upiAmountInr: number;
    renewalsSoon: number;
    total: number;
  };
};

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api<DashboardData>("/admin/dashboard");
      setData(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    }
  }, []);

  useLiveRefresh(load, { intervalMs: 30_000 });

  if (error && !data) return <p className="field-error">{error}</p>;
  if (!data) return <p className="muted">Loading dashboard…</p>;

  const inbox = data.inbox ?? {
    profiles: 0,
    users: 0,
    deskOps: 0,
    upiClaims: 0,
    upiAmountInr: 0,
    renewalsSoon: 0,
    total: 0,
  };

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <h2>Command center</h2>
        <p className="muted">Pending work across approvals, payments, and renewals — then usage and cash.</p>
        <div className="analytics-kpis">
          <Link href="/admin/approvals" className="result-card">
            <span>Approvals inbox</span>
            <strong>{inbox.total}</strong>
            <span className="analytics-delta">
              {inbox.profiles} branches · {inbox.users} users · {inbox.deskOps} desk · {inbox.upiClaims} UPI
            </span>
          </Link>
          <Link href="/admin/payments?tab=upi" className="result-card">
            <span>UPI pending</span>
            <strong>{inbox.upiClaims}</strong>
            <span className="analytics-delta">{inr(inbox.upiAmountInr)}</span>
          </Link>
          <Link href="/admin/subscriptions" className="result-card">
            <span>Renewals ≤14d</span>
            <strong>{inbox.renewalsSoon}</strong>
            <span className="analytics-delta">Open plans &amp; run notice job</span>
          </Link>
          <Link href="/admin/experience" className="result-card">
            <span>Experience</span>
            <strong>Theme</strong>
            <span className="analytics-delta">Preview · branding · import/export</span>
          </Link>
        </div>
      </section>

      <div className="admin-page-scroll">
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
          <div className="analytics-toolbar">
            <h2>SaaS subscription</h2>
            <Link href="/admin/payments" className="btn btn-ghost btn-sm">
              Payments
            </Link>
          </div>
          {data.subscription ? (
            <ul className="admin-kv">
              <li>
                <span>Plan</span>
                <strong>{data.subscription.planId}</strong>
              </li>
              <li>
                <span>Status</span>
                <strong>{data.subscription.status}</strong>
              </li>
              <li>
                <span>MRR</span>
                <strong>{inr(data.subscription.mrrInr)}</strong>
              </li>
              <li>
                <span>Collected (90d)</span>
                <strong>{inr(data.payments.collectedInr)}</strong>
              </li>
              <li>
                <span>Failed payments</span>
                <strong>{data.payments.failedCount}</strong>
              </li>
            </ul>
          ) : (
            <p className="muted">No org subscription row</p>
          )}
        </section>

        <section className="panel admin-card">
          <div className="analytics-toolbar">
            <h2>Top tools</h2>
            <Link href="/admin/tools" className="btn btn-ghost btn-sm">
              Manage
            </Link>
          </div>
          <ul className="admin-list">
            {data.analytics.topTools.map((t) => (
              <li key={t.toolId}>
                <span>{t.toolId}</span>
                <span>
                  {t.creates} creates · {t.opens} opens
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      </div>
    </div>
  );
}
