"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";

type InboxItem = {
  kind: "profile" | "user" | "payment_op" | "upi_claim";
  id: string;
  title: string;
  subtitle: string;
  status: string;
  createdAt: string | null;
  href: string;
};

type Summary = {
  total: number;
  profiles: number;
  users: number;
  paymentOps: number;
  upiClaims: number;
};

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  profile: "Branch",
  user: "User",
  payment_op: "Payment desk",
  upi_claim: "UPI claim",
};

export default function AdminApprovalsPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    profiles: 0,
    users: 0,
    paymentOps: 0,
    upiClaims: 0,
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ items: InboxItem[]; summary: Summary }>("/admin/approvals/inbox");
      setItems(data.items);
      setSummary(data.summary);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inbox");
    }
  }, []);

  useLiveRefresh(reload, { intervalMs: 20_000 });

  async function act(item: InboxItem, action: "approve" | "reject") {
    const key = `${item.kind}:${item.id}:${action}`;
    setBusyKey(key);
    setError("");
    setMessage("");
    try {
      if (item.kind === "profile") {
        await api(`/admin/profiles/${item.id}/${action}`, {
          method: "POST",
          body: action === "reject" ? JSON.stringify({ note: "Rejected from Approvals inbox" }) : undefined,
        });
      } else if (item.kind === "user") {
        await api(`/admin/team/${item.id}/${action}`, {
          method: "POST",
          body: action === "reject" ? JSON.stringify({ note: "Rejected from Approvals inbox" }) : undefined,
        });
      } else if (item.kind === "payment_op") {
        await api(`/admin/payments/ops/${item.id}/${action}`, { method: "POST" });
      } else if (item.kind === "upi_claim") {
        await api(`/admin/payments/upi/claims/${item.id}/${action}`, {
          method: "POST",
          body: action === "reject" ? JSON.stringify({ note: "Rejected from Approvals inbox" }) : undefined,
        });
      }
      setMessage(`${KIND_LABEL[item.kind]} ${action === "approve" ? "approved" : "rejected"}.`);
      invalidateAdminData("admin-approvals");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <h2>Approvals inbox</h2>
        <p className="muted">
          Pending branches, users, payment-desk items, and UPI claims in one place. Open detail pages for full context.
        </p>
      </section>

      <div className="analytics-kpis">
        <div className="result-card">
          <span>Total</span>
          <strong>{summary.total}</strong>
        </div>
        <div className="result-card">
          <span>Branches</span>
          <strong>{summary.profiles}</strong>
        </div>
        <div className="result-card">
          <span>Users</span>
          <strong>{summary.users}</strong>
        </div>
        <div className="result-card">
          <span>Payment desk</span>
          <strong>{summary.paymentOps}</strong>
        </div>
        <div className="result-card">
          <span>UPI claims</span>
          <strong>{summary.upiClaims}</strong>
        </div>
      </div>

      {error ? <p className="field-error">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <section className="panel admin-card">
        {items.length === 0 ? (
          <p className="muted">Nothing pending. You&apos;re clear.</p>
        ) : (
          <div className="tracker-list">
            {items.map((item) => {
              const approveKey = `${item.kind}:${item.id}:approve`;
              const rejectKey = `${item.kind}:${item.id}:reject`;
              return (
                <div key={`${item.kind}-${item.id}`} className="tracker-row">
                  <div className="tracker-row-main">
                    <span className="tracker-row-title">{item.title}</span>
                    <span className="tracker-row-sub">{item.subtitle}</span>
                  </div>
                  <div className="tracker-row-meta">
                    <span>
                      <span className="m-lbl">Type</span>
                      <span className="m-val">{KIND_LABEL[item.kind]}</span>
                    </span>
                    <span className="pill pill-warning">{item.status}</span>
                  </div>
                  <div className="tracker-actions">
                    <Link href={item.href} className="btn btn-ghost btn-sm">
                      Open
                    </Link>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyKey === approveKey}
                      onClick={() => void act(item, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey === rejectKey}
                      onClick={() => void act(item, "reject")}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
