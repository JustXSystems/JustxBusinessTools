"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { UpiPaymentsPanel } from "@/components/admin/UpiPaymentsPanel";
import { api } from "@/lib/api";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";

type Tab = "overview" | "saas" | "collections" | "ops" | "upi";
type TxnStatus = "all" | "success" | "failed" | "pending";
type OpsFilter = "all" | "pending" | "approved" | "rejected";

type Subscription = {
  planId: string;
  status: string;
  mrrInr: number;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  provider?: string | null;
};

type Transaction = {
  id: number;
  type: string;
  status: string;
  amountInr: number;
  provider: string;
  occurredAt: string;
  errorCode?: string | null;
  errorMessage: string | null;
};

type Invoice = {
  invoiceNo: string;
  status: string;
  amountInr: number;
  periodStart?: string | null;
  periodEnd?: string | null;
};

type SaasPayload = {
  subscription: Subscription | null;
  billingItems?: Array<{
    toolId: string;
    name: string;
    unitPriceInr: number;
    periodEnd: string | null;
    source: string | null;
  }>;
  summary: { collectedInr: number; successCount: number; failedCount: number; failureRate: number };
  transactions: Transaction[];
  invoices: Invoice[];
};

type CollectionsPayload = {
  summary: {
    totalReceivable: number;
    totalPayable: number;
    netPosition: number;
    overdueReceivable: number;
    pendingReceivable: number;
    invoicedTotal: number;
    amcRenewalsNext30d: number;
  };
  aging: Array<{ label: string; count: number; amount: number }>;
};

type PaymentOp = {
  id: number;
  kind: string;
  party: string;
  amountInr: number;
  status: string;
  approvalStatus: string;
  dueDate: string | null;
  reference?: string | null;
  notes?: string | null;
  createdAt?: string;
};

type OverviewPending = {
  deskOps: number;
  upiClaims: number;
  upiAmountInr: number;
  total: number;
};

const RANGES = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "6 months" },
] as const;

const emptyOpForm = { party: "", amountInr: "", kind: "receivable", dueDate: "", reference: "", notes: "" };

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number) {
  return `${Math.round(n * 1000) / 10}%`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10);
}

function fmtWhen(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

function statusPill(status: string) {
  const s = status.toLowerCase();
  if (s === "success" || s === "paid" || s === "approved" || s === "cleared" || s === "active") return "pill pill-success";
  if (s === "pending" || s === "open" || s === "draft") return "pill pill-warning";
  if (s === "failed" || s === "rejected" || s === "overdue" || s === "canceled" || s === "cancelled") return "pill pill-danger";
  return "pill";
}

function exportCsv(saas: SaasPayload | null, collections: CollectionsPayload | null, ops: PaymentOp[]) {
  const lines = [
    "section,field,value",
    saas ? `saas,collected,${saas.summary.collectedInr}` : "",
    saas ? `saas,success,${saas.summary.successCount}` : "",
    saas ? `saas,failed,${saas.summary.failedCount}` : "",
    collections ? `ar,receivable,${collections.summary.totalReceivable}` : "",
    collections ? `ar,payable,${collections.summary.totalPayable}` : "",
    collections ? `ar,overdue,${collections.summary.overdueReceivable}` : "",
    collections ? `ar,net,${collections.summary.netPosition}` : "",
    "",
    "txn_id,type,status,amount,provider,occurred_at",
    ...(saas?.transactions ?? []).map(
      (t) => `${t.id},${t.type},${t.status},${t.amountInr},${t.provider},${t.occurredAt}`,
    ),
    "",
    "op_id,party,kind,amount,status,approval,due",
    ...ops.map((o) => `${o.id},${o.party},${o.kind},${o.amountInr},${o.status},${o.approvalStatus},${o.dueDate ?? ""}`),
  ].filter(Boolean);
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jbt-payments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminPaymentsPage() {
  return (
    <Suspense
      fallback={
        <div className="admin-page">
          <p className="muted">Loading payments…</p>
        </div>
      }
    >
      <AdminPaymentsInner />
    </Suspense>
  );
}

function AdminPaymentsInner() {
  const searchParams = useSearchParams();
  const tabFromUrl = useMemo((): Tab => {
    const t = searchParams.get("tab");
    if (t === "saas" || t === "collections" || t === "ops" || t === "upi" || t === "overview") return t;
    return "overview";
  }, [searchParams]);
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const [days, setDays] = useState(90);
  const [saas, setSaas] = useState<SaasPayload | null>(null);
  const [collections, setCollections] = useState<CollectionsPayload | null>(null);
  const [ops, setOps] = useState<PaymentOp[]>([]);
  const [pendingSummary, setPendingSummary] = useState<OverviewPending>({
    deskOps: 0,
    upiClaims: 0,
    upiAmountInr: 0,
    total: 0,
  });
  const [opForm, setOpForm] = useState(emptyOpForm);
  const [txnQuery, setTxnQuery] = useState("");
  const [txnStatus, setTxnStatus] = useState<TxnStatus>("all");
  const [opsFilter, setOpsFilter] = useState<OpsFilter>("all");
  const [opsQuery, setOpsQuery] = useState("");
  const [selectedOpId, setSelectedOpId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | "create" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setTab(tabFromUrl);
  }, [tabFromUrl]);

  const loadOps = useCallback(async () => {
    const d = await api<{ ops: PaymentOp[] }>("/admin/payments/ops");
    setOps(d.ops);
    return d.ops;
  }, []);

  const load = useCallback(
    async (range: number) => {
      setError("");
      try {
        const [s, c, overview] = await Promise.all([
          api<SaasPayload>(`/admin/payments/saas?days=${range}`),
          api<CollectionsPayload>("/admin/payments/collections"),
          api<{ pending: OverviewPending }>(`/admin/payments/overview?days=${range}`),
          loadOps(),
        ]);
        setSaas(s);
        setCollections(c);
        setPendingSummary(overview.pending);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load payments");
      } finally {
        setLoading(false);
      }
    },
    [loadOps],
  );

  useLiveRefresh(() => load(days), { intervalMs: 30_000, deps: [days] });

  const pendingOps = useMemo(() => ops.filter((o) => o.approvalStatus === "pending"), [ops]);
  const selectedOp = ops.find((o) => o.id === selectedOpId) ?? null;

  const filteredTxns = useMemo(() => {
    const q = txnQuery.trim().toLowerCase();
    return (saas?.transactions ?? []).filter((t) => {
      if (txnStatus !== "all" && t.status !== txnStatus) return false;
      if (!q) return true;
      return `${t.type} ${t.status} ${t.provider} ${t.errorMessage ?? ""} ${t.id}`.toLowerCase().includes(q);
    });
  }, [saas, txnQuery, txnStatus]);

  const filteredOps = useMemo(() => {
    const q = opsQuery.trim().toLowerCase();
    return ops.filter((o) => {
      if (opsFilter !== "all" && o.approvalStatus !== opsFilter) return false;
      if (!q) return true;
      return `${o.party} ${o.kind} ${o.status} ${o.reference ?? ""} ${o.notes ?? ""}`.toLowerCase().includes(q);
    });
  }, [ops, opsFilter, opsQuery]);

  const agingMax = Math.max(1, ...(collections?.aging.map((b) => b.amount) ?? [1]));
  const ar = collections?.summary.totalReceivable ?? 0;
  const ap = collections?.summary.totalPayable ?? 0;
  const cashTotal = Math.max(1, ar + ap);

  async function createOp(e: React.FormEvent) {
    e.preventDefault();
    setBusyId("create");
    setMessage("");
    try {
      await api("/admin/payments/ops", {
        method: "POST",
        body: JSON.stringify({
          party: opForm.party,
          amountInr: Number(opForm.amountInr),
          kind: opForm.kind,
          dueDate: opForm.dueDate || null,
          reference: opForm.reference || null,
          notes: opForm.notes || null,
        }),
      });
      const next = await loadOps();
      setOpForm(emptyOpForm);
      setMessage("Logged on the payment desk. Approval is pending.");
      invalidateAdminData("admin-payments");
      if (next[0]) setSelectedOpId(next[0].id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not log payment");
    } finally {
      setBusyId(null);
    }
  }

  async function reviewOp(id: number, action: "approve" | "reject") {
    setBusyId(id);
    try {
      await api(`/admin/payments/ops/${id}/${action}`, { method: "POST" });
      invalidateAdminData("admin-payments");
      await loadOps();
      setMessage(action === "approve" ? "Approved and marked cleared." : "Rejected.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Payments</h2>
            <p className="muted">
              SaaS billing, collections (AR/AP), and a desk for approvals — one cash view for the organization.
            </p>
          </div>
          <div className="admin-form-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(days)} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => exportCsv(saas, collections, ops)}
              disabled={!saas && !collections}
            >
              Export CSV
            </button>
            <Link href="/admin/upi" className="btn btn-ghost btn-sm">
              UPI verify
            </Link>
            <Link href="/admin/gateways" className="btn btn-ghost btn-sm">
              Gateways
            </Link>
          </div>
        </div>

        <div className="analytics-range" role="tablist" aria-label="Billing window">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="tab"
              aria-selected={days === r.value}
              className={days === r.value ? "active" : ""}
              onClick={() => setDays(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="analytics-kpis">
          <button type="button" className={`result-card ${tab === "saas" ? "is-selected" : ""}`} onClick={() => setTab("saas")}>
            <span>Collected ({days}d)</span>
            <strong>{inr(saas?.summary.collectedInr ?? 0)}</strong>
            <span className="analytics-delta">{saas?.summary.successCount ?? 0} successful charges</span>
          </button>
          <button type="button" className={`result-card ${tab === "saas" ? "is-selected" : ""}`} onClick={() => setTab("saas")}>
            <span>Failure rate</span>
            <strong>{pct(saas?.summary.failureRate ?? 0)}</strong>
            <span className={`analytics-delta ${(saas?.summary.failedCount ?? 0) > 0 ? "is-down" : "is-up"}`}>
              {saas?.summary.failedCount ?? 0} failed
            </span>
          </button>
          <button
            type="button"
            className={`result-card ${tab === "collections" ? "is-selected" : ""}`}
            onClick={() => setTab("collections")}
          >
            <span>Receivable</span>
            <strong>{inr(ar)}</strong>
            <span className="analytics-delta">Pending {inr(collections?.summary.pendingReceivable ?? 0)}</span>
          </button>
          <button
            type="button"
            className={`result-card ${tab === "collections" ? "is-selected" : ""}`}
            onClick={() => setTab("collections")}
          >
            <span>Overdue</span>
            <strong>{inr(collections?.summary.overdueReceivable ?? 0)}</strong>
            <span className={`analytics-delta ${(collections?.summary.overdueReceivable ?? 0) > 0 ? "is-down" : ""}`}>
              AMC renewals {collections?.summary.amcRenewalsNext30d ?? 0}
            </span>
          </button>
          <button
            type="button"
            className={`result-card ${tab === "collections" ? "is-selected" : ""}`}
            onClick={() => setTab("collections")}
          >
            <span>Net position</span>
            <strong>{inr(collections?.summary.netPosition ?? 0)}</strong>
            <span className="analytics-delta">Payables {inr(ap)}</span>
          </button>
          <button type="button" className={`result-card ${tab === "upi" ? "is-selected" : ""}`} onClick={() => setTab("upi")}>
            <span>UPI pending</span>
            <strong>{pendingSummary.upiClaims}</strong>
            <span className="analytics-delta">{inr(pendingSummary.upiAmountInr)} awaiting verify</span>
          </button>
          <button type="button" className={`result-card ${tab === "ops" ? "is-selected" : ""}`} onClick={() => setTab("ops")}>
            <span>Desk pending</span>
            <strong>{pendingOps.length || pendingSummary.deskOps}</strong>
            <span className="analytics-delta">{ops.length} logged items</span>
          </button>
        </div>
      </section>

      {error ? <p className="field-error">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <div className="admin-tabs" role="tablist">
        {(
          [
            ["overview", "Overview"],
            ["saas", "SaaS billing"],
            ["collections", "Collections"],
            ["ops", "Payment desk"],
            ["upi", "UPI QR"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
            {id === "ops" && pendingOps.length ? ` (${pendingOps.length})` : ""}
            {id === "upi" && pendingSummary.upiClaims ? ` (${pendingSummary.upiClaims})` : ""}
          </button>
        ))}
      </div>

      {loading && !saas ? <p className="muted">Loading payments…</p> : null}

      {tab === "upi" ? <UpiPaymentsPanel /> : null}

      {tab === "overview" && saas && collections ? (
        <div className="admin-split payments-split">
          <div className="admin-pane-stack">
            <section className="panel admin-card">
              <h2>Subscription health</h2>
              {saas.subscription ? (
                <>
                  <ul className="admin-kv">
                    <li>
                      <span>Plan</span>
                      <strong>{saas.subscription.planId}</strong>
                    </li>
                    <li>
                      <span>Status</span>
                      <span className={statusPill(saas.subscription.status)}>{saas.subscription.status}</span>
                    </li>
                    <li>
                      <span>MRR</span>
                      <strong>{inr(saas.subscription.mrrInr)}</strong>
                    </li>
                    <li>
                      <span>Period</span>
                      <strong>
                        {fmtDate(saas.subscription.currentPeriodStart)} → {fmtDate(saas.subscription.currentPeriodEnd)}
                      </strong>
                    </li>
                    <li>
                      <span>Provider</span>
                      <strong>{saas.subscription.provider || "—"}</strong>
                    </li>
                  </ul>
                  {(saas.billingItems?.length ?? 0) > 0 ? (
                    <div className="billing-lines" style={{ marginTop: 12 }}>
                      <p className="muted">Line items</p>
                      <ul className="billing-line-list">
                        {saas.billingItems!.map((item) => (
                          <li key={item.toolId}>
                            <strong>{item.name}</strong>
                            <span>
                              {inr(item.unitPriceInr)}/mo
                              {item.periodEnd ? ` · ${item.periodEnd.slice(0, 10)}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="pay-meter">
                    <div className="pay-meter-head">
                      <span>Charge success</span>
                      <strong>{pct(1 - saas.summary.failureRate)}</strong>
                    </div>
                    <div className="usage-bar">
                      <span style={{ width: `${Math.max(4, (1 - saas.summary.failureRate) * 100)}%` }} />
                    </div>
                  </div>
                </>
              ) : (
                <p className="muted">No active subscription. Configure plans under Subscriptions.</p>
              )}
            </section>

            <section className="panel admin-card">
              <h2>Cash mix</h2>
              <p className="muted">Receivables vs payables from Payment Tracker.</p>
              <div className="pay-mix" aria-hidden>
                <span className="pay-mix-ar" style={{ flex: ar || 1 }} />
                <span className="pay-mix-ap" style={{ flex: ap || 1 }} />
              </div>
              <div className="chart-legend">
                <span>
                  <i className="seg-create" /> AR {inr(ar)} ({Math.round((ar / cashTotal) * 100)}%)
                </span>
                <span>
                  <i className="seg-export" /> AP {inr(ap)} ({Math.round((ap / cashTotal) * 100)}%)
                </span>
              </div>
            </section>
          </div>

          <div className="admin-pane-stack">
            <section className="panel admin-card">
              <h2>Receivable aging</h2>
              {collections.aging.every((b) => b.count === 0) ? (
                <p className="muted">No open receivables in aging buckets.</p>
              ) : (
                <ul className="funnel">
                  {collections.aging.map((b) => (
                    <li key={b.label}>
                      <span>{b.label}</span>
                      <em>{b.count} items</em>
                      <strong>{inr(b.amount)}</strong>
                      <div className="funnel-bar" style={{ width: `${Math.max(6, (b.amount / agingMax) * 100)}%` }} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted">
                Source: <Link href="/tools/paymenttracker">Payment Tracker</Link>
              </p>
            </section>

            <section className="panel admin-card">
              <h2>Needs attention</h2>
              <ul className="admin-kv">
                <li>
                  <span>UPI claims</span>
                  <strong>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab("upi")}>
                      {pendingSummary.upiClaims} · {inr(pendingSummary.upiAmountInr)}
                    </button>
                  </strong>
                </li>
                <li>
                  <span>Payment desk</span>
                  <strong>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab("ops")}>
                      {pendingOps.length || pendingSummary.deskOps} pending
                    </button>
                  </strong>
                </li>
              </ul>
              {pendingOps.length === 0 ? (
                <p className="muted">No pending desk approvals.</p>
              ) : (
                <div className="tracker-list">
                  {pendingOps.slice(0, 6).map((op) => (
                    <button
                      type="button"
                      key={op.id}
                      className="tracker-row admin-member-row"
                      onClick={() => {
                        setSelectedOpId(op.id);
                        setTab("ops");
                      }}
                    >
                      <div>
                        <strong>{op.party}</strong>
                        <span className="muted">
                          {op.kind} · due {op.dueDate ?? "—"}
                        </span>
                      </div>
                      <strong>{inr(op.amountInr)}</strong>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {tab === "saas" && saas ? (
        <div className="admin-split payments-split">
          <section className="panel admin-card admin-pane">
            <h2>Charges</h2>
            <div className="admin-form-row">
              <input
                value={txnQuery}
                onChange={(e) => setTxnQuery(e.target.value)}
                placeholder="Search type, provider, error"
                aria-label="Search transactions"
              />
              <div className="admin-tabs">
                {(["all", "success", "failed", "pending"] as TxnStatus[]).map((s) => (
                  <button key={s} type="button" className={txnStatus === s ? "active" : ""} onClick={() => setTxnStatus(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="tracker-list">
              {filteredTxns.length === 0 ? (
                <p className="muted">No transactions in this window.</p>
              ) : (
                filteredTxns.map((t) => (
                  <div key={t.id} className="tracker-row">
                    <div>
                      <strong>
                        {t.type.replace(/_/g, " ")} · {inr(t.amountInr)}
                      </strong>
                      <span className="muted">
                        {fmtWhen(t.occurredAt)} · {t.provider}
                      </span>
                      {t.errorMessage ? (
                        <span className="field-error">
                          {t.errorCode ? `${t.errorCode}: ` : ""}
                          {t.errorMessage}
                        </span>
                      ) : null}
                    </div>
                    <span className={statusPill(t.status)}>{t.status}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="admin-pane-stack">
            <section className="panel admin-card">
              <h2>Plan</h2>
              {saas.subscription ? (
                <ul className="admin-kv">
                  <li>
                    <span>Plan</span>
                    <strong>{saas.subscription.planId}</strong>
                  </li>
                  <li>
                    <span>Status</span>
                    <span className={statusPill(saas.subscription.status)}>{saas.subscription.status}</span>
                  </li>
                  <li>
                    <span>MRR</span>
                    <strong>{inr(saas.subscription.mrrInr)}</strong>
                  </li>
                  <li>
                    <span>Collected</span>
                    <strong>{inr(saas.summary.collectedInr)}</strong>
                  </li>
                </ul>
              ) : (
                <p className="muted">No subscription</p>
              )}
              <p className="muted">
                Manage plans in <Link href="/admin/subscriptions">Subscriptions</Link>.
              </p>
            </section>
            <section className="panel admin-card">
              <h2>Invoices</h2>
              {saas.invoices.length === 0 ? (
                <p className="muted">No billing invoices yet.</p>
              ) : (
                <ul className="admin-list">
                  {saas.invoices.map((inv) => (
                    <li key={inv.invoiceNo}>
                      <span>
                        {inv.invoiceNo}
                        <em className="muted">
                          {" "}
                          {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                        </em>
                      </span>
                      <span>
                        {inr(inv.amountInr)} <span className={statusPill(inv.status)}>{inv.status}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {tab === "collections" && collections ? (
        <div className="admin-split payments-split">
          <section className="panel admin-card admin-pane">
            <h2>AR / AP</h2>
            <div className="result-grid">
              <div className="result-card">
                <span>Receivable</span>
                <strong>{inr(collections.summary.totalReceivable)}</strong>
              </div>
              <div className="result-card">
                <span>Payable</span>
                <strong>{inr(collections.summary.totalPayable)}</strong>
              </div>
              <div className="result-card">
                <span>Overdue</span>
                <strong>{inr(collections.summary.overdueReceivable)}</strong>
              </div>
              <div className="result-card">
                <span>Invoiced</span>
                <strong>{inr(collections.summary.invoicedTotal)}</strong>
              </div>
            </div>
            <div className="pay-mix" style={{ marginTop: 16 }}>
              <span className="pay-mix-ar" style={{ flex: ar || 1 }} />
              <span className="pay-mix-ap" style={{ flex: ap || 1 }} />
            </div>
            <p className="muted">
              Net {inr(collections.summary.netPosition)} · pending receipts {inr(collections.summary.pendingReceivable)} · AMC
              renewals in 30d: {collections.summary.amcRenewalsNext30d}
            </p>
            <p className="muted">
              Edit source records in <Link href="/tools/paymenttracker">Payment Tracker</Link>.
            </p>
          </section>
          <section className="panel admin-card admin-pane">
            <h2>Aging (open receivables)</h2>
            <ul className="funnel">
              {collections.aging.map((b) => (
                <li key={b.label}>
                  <span>{b.label}</span>
                  <em>{b.count} items</em>
                  <strong>{inr(b.amount)}</strong>
                  <div className="funnel-bar" style={{ width: `${Math.max(6, (b.amount / agingMax) * 100)}%` }} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "ops" ? (
        <div className="admin-split payments-split">
          <section className="panel admin-card admin-pane">
            <h2>Queue</h2>
            <div className="admin-form-row">
              <input
                value={opsQuery}
                onChange={(e) => setOpsQuery(e.target.value)}
                placeholder="Search party, reference, notes"
                aria-label="Search payment desk"
              />
              <div className="admin-tabs">
                {(["all", "pending", "approved", "rejected"] as OpsFilter[]).map((f) => (
                  <button key={f} type="button" className={opsFilter === f ? "active" : ""} onClick={() => setOpsFilter(f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="tracker-list">
              {filteredOps.length === 0 ? (
                <p className="muted">Nothing in this filter.</p>
              ) : (
                filteredOps.map((op) => (
                  <button
                    type="button"
                    key={op.id}
                    className={`tracker-row admin-member-row ${selectedOpId === op.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedOpId(op.id)}
                  >
                    <div>
                      <strong>{op.party}</strong>
                      <span className="muted">
                        {op.kind} · {op.status} · due {op.dueDate ?? "—"}
                      </span>
                    </div>
                    <div className="admin-form-row">
                      <strong>{inr(op.amountInr)}</strong>
                      <span className={statusPill(op.approvalStatus)}>{op.approvalStatus}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <div className="admin-pane-stack">
            {selectedOp ? (
              <section className="panel admin-card">
                <h2>{selectedOp.party}</h2>
                <ul className="admin-kv">
                  <li>
                    <span>Kind</span>
                    <strong>{selectedOp.kind}</strong>
                  </li>
                  <li>
                    <span>Amount</span>
                    <strong>{inr(selectedOp.amountInr)}</strong>
                  </li>
                  <li>
                    <span>Status</span>
                    <span className={statusPill(selectedOp.status)}>{selectedOp.status}</span>
                  </li>
                  <li>
                    <span>Approval</span>
                    <span className={statusPill(selectedOp.approvalStatus)}>{selectedOp.approvalStatus}</span>
                  </li>
                  <li>
                    <span>Due</span>
                    <strong>{selectedOp.dueDate ?? "—"}</strong>
                  </li>
                  <li>
                    <span>Reference</span>
                    <strong>{selectedOp.reference || "—"}</strong>
                  </li>
                </ul>
                {selectedOp.notes ? <p className="muted">{selectedOp.notes}</p> : null}
                {selectedOp.approvalStatus === "pending" ? (
                  <div className="admin-form-row" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyId === selectedOp.id}
                      onClick={() => void reviewOp(selectedOp.id, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busyId === selectedOp.id}
                      onClick={() => void reviewOp(selectedOp.id, "reject")}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <p className="muted">This item is already {selectedOp.approvalStatus}.</p>
                )}
              </section>
            ) : (
              <section className="panel admin-card">
                <h2>Review</h2>
                <p className="muted">Select a logged payment to approve payouts or collections.</p>
              </section>
            )}

            <section className="panel admin-card">
              <h2>Log payment</h2>
              <p className="muted">Creates a desk item with pending approval.</p>
              <form className="admin-form-grid" onSubmit={createOp}>
                <label className="field">
                  <span>Party</span>
                  <input
                    value={opForm.party}
                    onChange={(e) => setOpForm({ ...opForm, party: e.target.value })}
                    required
                    placeholder="Customer or vendor"
                  />
                </label>
                <label className="field">
                  <span>Amount (INR)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={opForm.amountInr}
                    onChange={(e) => setOpForm({ ...opForm, amountInr: e.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>Kind</span>
                  <select value={opForm.kind} onChange={(e) => setOpForm({ ...opForm, kind: e.target.value })}>
                    <option value="receivable">Receivable</option>
                    <option value="payable">Payable</option>
                    <option value="saas">SaaS</option>
                  </select>
                </label>
                <label className="field">
                  <span>Due date</span>
                  <input
                    type="date"
                    value={opForm.dueDate}
                    onChange={(e) => setOpForm({ ...opForm, dueDate: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Reference</span>
                  <input
                    value={opForm.reference}
                    onChange={(e) => setOpForm({ ...opForm, reference: e.target.value })}
                    placeholder="Invoice / UTR"
                  />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <input
                    value={opForm.notes}
                    onChange={(e) => setOpForm({ ...opForm, notes: e.target.value })}
                    placeholder="Optional"
                  />
                </label>
                <button type="submit" className="btn btn-primary" disabled={busyId === "create"}>
                  {busyId === "create" ? "Logging…" : "Log payment"}
                </button>
              </form>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
