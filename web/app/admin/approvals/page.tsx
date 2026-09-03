"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { adminDeepLink, type ApprovalsKind } from "@/lib/admin-deep-links";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";

type InboxItem = {
  kind: ApprovalsKind;
  id: string;
  title: string;
  subtitle: string;
  status: string;
  createdAt: string | null;
  href: string;
  role?: string | null;
};

type Summary = {
  total: number;
  profiles: number;
  users: number;
  paymentOps: number;
  upiClaims: number;
};

const KIND_LABEL: Record<ApprovalsKind, string> = {
  profile: "Branch",
  user: "User",
  payment_op: "Payment desk",
  upi_claim: "UPI claim",
};

const KIND_HUB: Record<ApprovalsKind, string> = {
  profile: adminDeepLink.profilePending(),
  user: adminDeepLink.userPending(),
  payment_op: adminDeepLink.paymentOpPending(),
  upi_claim: adminDeepLink.upiClaimPending(),
};

function parseKind(raw: string | null): ApprovalsKind | "all" {
  if (raw === "profile" || raw === "user" || raw === "payment_op" || raw === "upi_claim") return raw;
  return "all";
}

export default function AdminApprovalsPage() {
  return (
    <Suspense fallback={<div className="admin-page"><p className="muted">Loading approvals…</p></div>}>
      <AdminApprovalsInner />
    </Suspense>
  );
}

function AdminApprovalsInner() {
  const search = useSearchParams();
  const router = useRouter();
  const kindFilter = useMemo(() => parseKind(search.get("kind")), [search]);

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

  const visible = useMemo(
    () => (kindFilter === "all" ? items : items.filter((i) => i.kind === kindFilter)),
    [items, kindFilter],
  );

  function setKind(next: ApprovalsKind | "all") {
    router.replace(next === "all" ? adminDeepLink.approvals() : adminDeepLink.approvals(next));
  }

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
        const body =
          action === "reject"
            ? JSON.stringify({ note: "Rejected from Approvals inbox" })
            : item.role === "owner"
              ? undefined
              : JSON.stringify({ role: "staff" });
        await api(`/admin/team/${item.id}/${action}`, {
          method: "POST",
          body,
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
          Pending branches, user registrations / join requests, payment-desk items, and UPI claims. Counts match the
          Dashboard Approvals card. Filter by type below, or open the dedicated screen to manage details.
        </p>
      </section>

      <div className="analytics-kpis">
        <button type="button" className={`result-card${kindFilter === "all" ? " is-selected" : ""}`} onClick={() => setKind("all")}>
          <span>Total</span>
          <strong>{summary.total}</strong>
        </button>
        <button
          type="button"
          className={`result-card${kindFilter === "profile" ? " is-selected" : ""}${summary.profiles ? " dash-kpi-alert" : ""}`}
          onClick={() => setKind("profile")}
        >
          <span>Branches</span>
          <strong>{summary.profiles}</strong>
        </button>
        <button
          type="button"
          className={`result-card${kindFilter === "user" ? " is-selected" : ""}${summary.users ? " dash-kpi-alert" : ""}`}
          onClick={() => setKind("user")}
        >
          <span>Users</span>
          <strong>{summary.users}</strong>
          <span className="analytics-delta">Registrations &amp; joins</span>
        </button>
        <button
          type="button"
          className={`result-card${kindFilter === "payment_op" ? " is-selected" : ""}${summary.paymentOps ? " dash-kpi-alert" : ""}`}
          onClick={() => setKind("payment_op")}
        >
          <span>Payment desk</span>
          <strong>{summary.paymentOps}</strong>
        </button>
        <button
          type="button"
          className={`result-card${kindFilter === "upi_claim" ? " is-selected" : ""}${summary.upiClaims ? " dash-kpi-alert" : ""}`}
          onClick={() => setKind("upi_claim")}
        >
          <span>UPI claims</span>
          <strong>{summary.upiClaims}</strong>
        </button>
      </div>

      {kindFilter !== "all" ? (
        <p className="muted">
          Showing {KIND_LABEL[kindFilter]} only.{" "}
          <Link href={KIND_HUB[kindFilter]}>Open {KIND_LABEL[kindFilter].toLowerCase()} workspace →</Link>
        </p>
      ) : null}

      {error ? <p className="field-error">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <div className="admin-page-scroll">
        <section className="panel admin-card">
          {visible.length === 0 ? (
            <p className="muted">
              {kindFilter === "all"
                ? "Nothing pending. You're clear."
                : `No pending ${KIND_LABEL[kindFilter].toLowerCase()} items.`}
            </p>
          ) : (
            <div className="tracker-list admin-scroll-list">
              {visible.map((item) => {
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
    </div>
  );
}
