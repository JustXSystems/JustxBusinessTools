"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminOrgSelect } from "@/components/admin/AdminOrgSelect";
import { UpiPaymentsPanel } from "@/components/admin/UpiPaymentsPanel";
import type { PaymentsActionHandle } from "@/components/admin/payments-actions";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
  useAdminConfirm,
} from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  FormGrid,
  Grid,
  KpiCard,
  ProgressBar,
  SearchInput,
  cx,
  type BosBadgeTone,
  type BosColumn,
} from "@/components/bos";
import { adminDeepLink } from "@/lib/admin-deep-links";
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

const TXN_STATUSES: ReadonlyArray<TxnStatus> = ["all", "success", "failed", "pending"];
const OPS_FILTERS: ReadonlyArray<OpsFilter> = ["all", "pending", "approved", "rejected"];

const emptyOpForm = {
  party: "",
  amountInr: "",
  kind: "receivable",
  dueDate: "",
  reference: "",
  notes: "",
  organizationId: null as number | null,
};

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
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}`);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16).replace("T", " ");
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status: string): BosBadgeTone {
  const s = status.toLowerCase();
  if (s === "success" || s === "paid" || s === "approved" || s === "cleared" || s === "active") return "emerald";
  if (s === "pending" || s === "open" || s === "draft") return "amber";
  if (s === "failed" || s === "rejected" || s === "overdue" || s === "canceled" || s === "cancelled") return "coral";
  return "neutral";
}

function parseTxnStatus(raw: string | null): TxnStatus {
  return raw === "success" || raw === "failed" || raw === "pending" ? raw : "all";
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
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
    <Suspense fallback={<AdminPageSkeleton cards={7} />}>
      <AdminPaymentsInner />
    </Suspense>
  );
}

function AdminPaymentsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const upiSaveRef = useRef<PaymentsActionHandle>(null);
  const opFormRef = useRef<HTMLFormElement>(null);
  const opDetailRef = useRef<HTMLDivElement>(null);
  const upiWrapRef = useRef<HTMLDivElement>(null);
  const scrolledOp = useRef<number | null>(null);
  const scrolledClaim = useRef<number | null>(null);
  const { confirm, dialog: confirmDialog } = useAdminConfirm();
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
  const [txnStatus, setTxnStatus] = useState<TxnStatus>(() => parseTxnStatus(searchParams.get("txnStatus")));
  const [opsFilter, setOpsFilter] = useState<OpsFilter>(() => {
    const f = searchParams.get("filter");
    if (f === "pending" || f === "approved" || f === "rejected") return f;
    return "all";
  });
  const [opsQuery, setOpsQuery] = useState("");
  const [selectedOpId, setSelectedOpId] = useState<number | null>(() => {
    const n = Number(searchParams.get("op"));
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [busyId, setBusyId] = useState<number | "create" | null>(null);
  const [tabBusy, setTabBusy] = useState(false);
  const [upiReady, setUpiReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");

  function say(text: string, tone: "ok" | "error" = "ok") {
    setMessageTone(tone);
    setMessage(text);
  }

  const focusOpId = useMemo(() => {
    const n = Number(searchParams.get("op"));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);
  const filterFromUrl = useMemo((): OpsFilter => {
    const f = searchParams.get("filter");
    if (f === "pending" || f === "approved" || f === "rejected") return f;
    return "all";
  }, [searchParams]);

  const txnStatusFromUrl = useMemo(
    () => parseTxnStatus(searchParams.get("txnStatus")),
    [searchParams],
  );
  const focusClaimId = useMemo(() => {
    const n = Number(searchParams.get("claim"));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);

  useEffect(() => {
    if (tab === "upi") setUpiReady(true);
  }, [tab]);

  useEffect(() => {
    setTab(tabFromUrl);
  }, [tabFromUrl]);

  useEffect(() => {
    if (tabFromUrl === "ops") setOpsFilter(filterFromUrl);
  }, [tabFromUrl, filterFromUrl]);

  // ?tab=saas&txnStatus=failed (deep link from dashboard failures) pre-filters the charge list.
  useEffect(() => {
    if (tabFromUrl === "saas") setTxnStatus(txnStatusFromUrl);
  }, [tabFromUrl, txnStatusFromUrl]);

  // Deep-linked payment-desk op: scroll its detail card into view once the queue has loaded.
  useEffect(() => {
    if (tab !== "ops" || !focusOpId || selectedOpId !== focusOpId) return;
    if (scrolledOp.current === focusOpId) return;
    const el = opDetailRef.current;
    if (!el) return;
    scrolledOp.current = focusOpId;
    const raf = window.requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(raf);
  }, [tab, focusOpId, selectedOpId, ops]);

  // Deep-linked UPI claim: bring the panel (and its selected claim row, once loaded) into view.
  useEffect(() => {
    if (tab !== "upi" || !focusClaimId || scrolledClaim.current === focusClaimId) return;
    const wrap = upiWrapRef.current;
    if (!wrap) return;
    scrolledClaim.current = focusClaimId;
    const raf = window.requestAnimationFrame(() => wrap.scrollIntoView({ behavior: "smooth", block: "start" }));
    const t = window.setTimeout(() => {
      wrap.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 700);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [tab, focusClaimId, upiReady]);

  function selectTab(
    next: Tab,
    extras?: { filter?: OpsFilter; op?: number | null; txnStatus?: TxnStatus },
  ) {
    setTab(next);
    const params = new URLSearchParams();
    params.set("tab", next);
    if (next === "saas") {
      const s = extras?.txnStatus ?? txnStatus;
      if (s !== "all") params.set("txnStatus", s);
    }
    if (next === "ops") {
      const f = extras?.filter ?? opsFilter;
      if (f && f !== "all") params.set("filter", f);
      const op = extras?.op !== undefined ? extras.op : selectedOpId;
      if (op) params.set("op", String(op));
    }
    if (next === "upi") {
      const status = searchParams.get("status");
      const claim = searchParams.get("claim");
      if (status) params.set("status", status);
      if (claim) params.set("claim", claim);
    }
    router.replace(`/admin/payments?${params.toString()}`);
  }

  const loadOps = useCallback(async () => {
    const d = await api<{ ops: PaymentOp[] }>("/admin/payments/ops");
    setOps(d.ops);
    setSelectedOpId((cur) => {
      if (focusOpId && d.ops.some((o) => o.id === focusOpId)) return focusOpId;
      if (cur && d.ops.some((o) => o.id === cur)) return cur;
      const pending = d.ops.find((o) => o.approvalStatus === "pending");
      return pending?.id ?? d.ops[0]?.id ?? null;
    });
    return d.ops;
  }, [focusOpId]);

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
    if (opForm.organizationId == null) {
      say("Select an organization before logging a payment", "error");
      return;
    }
    setBusyId("create");
    setTabBusy(true);
    setMessage("");
    try {
      await api("/admin/payments/ops", {
        method: "POST",
        body: JSON.stringify({
          organizationId: opForm.organizationId,
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
      say("Logged on the payment desk. Approval is pending.");
      invalidateAdminData("admin-payments");
      if (next[0]) setSelectedOpId(next[0].id);
      setOpsFilter("pending");
    } catch (err) {
      say(err instanceof Error ? err.message : "Could not log payment", "error");
    } finally {
      setBusyId(null);
      setTabBusy(false);
    }
  }

  function confirmReview(op: PaymentOp, action: "approve" | "reject") {
    const what = (
      <>
        <strong>{op.party}</strong> · {op.kind} · {inr(op.amountInr)}
      </>
    );
    if (action === "approve") {
      confirm({
        title: "Approve this payment desk item?",
        description: (
          <>
            {what}. Approving marks it cleared and removes it from the pending queue. This can&apos;t be undone from
            this page.
          </>
        ),
        confirmLabel: "Approve",
        tone: "primary",
        onConfirm: () => reviewOp(op.id, "approve"),
      });
      return;
    }
    confirm({
      title: "Reject this payment desk item?",
      description: (
        <>
          {what}. Rejecting closes it without clearing — nothing is marked paid or collected. This can&apos;t be undone
          from this page.
        </>
      ),
      confirmLabel: "Reject",
      onConfirm: () => reviewOp(op.id, "reject"),
    });
  }

  async function reviewOp(id: number, action: "approve" | "reject") {
    setBusyId(id);
    try {
      await api(`/admin/payments/ops/${id}/${action}`, { method: "POST" });
      invalidateAdminData("admin-payments");
      await loadOps();
      say(action === "approve" ? "Approved and marked cleared." : "Rejected.");
    } catch (err) {
      say(err instanceof Error ? err.message : "Review failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  /** Overview primary: jump straight to the next item that needs a decision (desk first, then UPI). */
  function clearNextPending() {
    const next = pendingOps[0];
    if (next) {
      setOpsFilter("pending");
      setSelectedOpId(next.id);
      selectTab("ops", { filter: "pending", op: next.id });
      return;
    }
    if (pendingSummary.upiClaims > 0) {
      selectTab("upi");
      return;
    }
    if (pendingSummary.deskOps > 0) {
      setOpsFilter("pending");
      selectTab("ops", { filter: "pending", op: null });
    }
  }

  async function runTabPrimary() {
    if (tab === "overview") {
      clearNextPending();
      return;
    }
    if (tab === "upi") {
      const handle = upiSaveRef.current;
      if (!handle) return;
      setTabBusy(true);
      try {
        await handle.save();
      } catch {
        /* panel shows message */
      } finally {
        setTabBusy(false);
      }
      return;
    }
    if (tab === "ops") {
      opFormRef.current?.requestSubmit();
      return;
    }
    if (tab === "saas" || tab === "collections") {
      exportCsv(saas, collections, ops);
    }
  }

  const nothingPending =
    pendingOps.length === 0 && pendingSummary.upiClaims === 0 && pendingSummary.deskOps === 0;

  const tabPrimaryLabel =
    tab === "upi"
      ? tabBusy
        ? "Saving…"
        : "Save UPI settings"
      : tab === "ops"
        ? busyId === "create"
          ? "Logging…"
          : "Log payment"
        : tab === "overview"
          ? "Clear next pending"
          : "Export CSV";

  const tabPrimaryDisabled =
    tabBusy ||
    busyId === "create" ||
    (tab === "overview" && nothingPending) ||
    ((tab === "saas" || tab === "collections") && !saas && !collections);

  // The UPI pane is self-contained, so a failed billing load must not block it.
  if (loading && !saas && !collections && tab !== "upi") return <AdminPageSkeleton cards={7} />;

  if (!saas && !collections && tab !== "upi") {
    return (
      <AdminPage title="Payments" section="Revenue" sub="SaaS billing · collections · payment desk">
        <AdminErrorState message={error || "Could not load payments"} onRetry={() => void load(days)} />
      </AdminPage>
    );
  }

  const tabOptions: ReadonlyArray<{ value: Tab; label: string }> = [
    { value: "overview", label: "Overview" },
    { value: "saas", label: "SaaS billing" },
    { value: "collections", label: "Collections" },
    { value: "ops", label: `Payment desk${pendingOps.length ? ` (${pendingOps.length})` : ""}` },
    { value: "upi", label: `UPI QR${pendingSummary.upiClaims ? ` (${pendingSummary.upiClaims})` : ""}` },
  ];

  const kpi = (opts: {
    label: string;
    value: string | number;
    delta: string;
    deltaTone: "up" | "down" | "warn" | "info" | "muted";
    chip: { color: "blue" | "amber" | "mint" | "lavender" | "rose" | "sage"; glyph: string };
    selected: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      className={cx("admin-cc-kpi-btn", opts.selected && "is-selected")}
      aria-pressed={opts.selected}
      onClick={opts.onClick}
    >
      <KpiCard
        label={opts.label}
        value={opts.value}
        chip={opts.chip}
        delta={opts.delta}
        deltaTone={opts.deltaTone}
      />
    </button>
  );

  const txnColumns: ReadonlyArray<BosColumn<Transaction>> = [
    {
      key: "charge",
      header: "Charge",
      cell: (t) => (
        <div>
          <div className="admin-cc-cell-title">{t.type.replace(/_/g, " ")}</div>
          <div className="admin-cc-cell-sub">
            {fmtWhen(t.occurredAt)} · {t.provider}
          </div>
          {t.errorMessage ? (
            <div className="admin-cc-cell-sub" style={{ color: "var(--bos-coral-600)" }}>
              {t.errorCode ? `${t.errorCode}: ` : ""}
              {t.errorMessage}
            </div>
          ) : null}
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (t) => inr(t.amountInr) },
    {
      key: "status",
      header: "Status",
      cell: (t) => (
        <Badge auto tone={statusTone(t.status)}>
          {t.status}
        </Badge>
      ),
    },
  ];

  const invoiceColumns: ReadonlyArray<BosColumn<Invoice>> = [
    {
      key: "invoice",
      header: "Invoice",
      cell: (inv) => (
        <div>
          <div className="admin-cc-cell-title">{inv.invoiceNo}</div>
          <div className="admin-cc-cell-sub">
            {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
          </div>
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (inv) => inr(inv.amountInr) },
    {
      key: "status",
      header: "Status",
      cell: (inv) => (
        <Badge auto tone={statusTone(inv.status)}>
          {inv.status}
        </Badge>
      ),
    },
  ];

  const agingRows = (rows: CollectionsPayload["aging"]) => (
    <div className="admin-cc-stack">
      {rows.map((b) => (
        <div key={b.label} className="admin-cc-funnel-row">
          <span>{b.label}</span>
          <ProgressBar
            value={Math.max(6, (b.amount / agingMax) * 100)}
            tone={b.count ? "amber" : "blue"}
            label={`${b.label} aging`}
          />
          <span className="admin-cc-funnel-meta">
            {b.count} items · {inr(b.amount)}
          </span>
        </div>
      ))}
    </div>
  );

  const mixBar = (
    <>
      <ProgressBar value={(ar / cashTotal) * 100} tone="emerald" label="Receivable share of cash mix" size="lg" />
      <div className="admin-cc-mix-legend">
        <Badge auto tone="emerald">
          AR {inr(ar)} ({Math.round((ar / cashTotal) * 100)}%)
        </Badge>
        <Badge auto tone="neutral">
          AP {inr(ap)} ({Math.round((ap / cashTotal) * 100)}%)
        </Badge>
      </div>
    </>
  );

  const kvItem = (label: string, value: React.ReactNode) => (
    <li>
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  );

  return (
    <AdminPage
      title="Payments"
      section="Revenue"
      sub="SaaS billing · collections (AR/AP) · payment desk"
      toolbar={
        <>
          <Badge auto tone={pendingSummary.total ? "amber" : "emerald"}>
            {pendingSummary.total ? `${pendingSummary.total} pending` : "All clear"}
          </Badge>
          <AdminTabs
            aria-label="Payments section"
            options={tabOptions}
            value={tab}
            onChange={(next) => selectTab(next)}
          />
          <Button
            variant={tab === "upi" || tab === "ops" || tab === "overview" ? "primary" : "secondary"}
            size="sm"
            icon={tab === "saas" || tab === "collections" ? "download" : undefined}
            disabled={Boolean(tabPrimaryDisabled)}
            title={tab === "overview" && nothingPending ? "Nothing waiting for a decision" : undefined}
            onClick={() => void runTabPrimary()}
          >
            {tabPrimaryLabel}
          </Button>
          {tab === "overview" ? (
            <Button
              variant="ghost"
              size="sm"
              icon="download"
              disabled={!saas && !collections}
              onClick={() => exportCsv(saas, collections, ops)}
            >
              Export CSV
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void load(days)} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </>
      }
    >
      <div className="admin-cc-filters">
        <AdminTabs
          aria-label="Billing window"
          options={RANGES.map((r) => ({ value: String(r.value), label: r.label }))}
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
        />
        <Link href={adminDeepLink.gateways()}>
          <Button variant="secondary" size="sm">
            Gateways
          </Button>
        </Link>
        <Link href={adminDeepLink.subscriptions()}>
          <Button variant="secondary" size="sm">
            Plans
          </Button>
        </Link>
      </div>

      <Grid cols={4} min={140} gap={12}>
        {kpi({
          label: `Collected (${days}d)`,
          value: inr(saas?.summary.collectedInr ?? 0),
          delta: `${saas?.summary.successCount ?? 0} successful charges`,
          deltaTone: "muted",
          chip: { color: "mint", glyph: "₹" },
          selected: tab === "saas" && txnStatus !== "failed",
          onClick: () => selectTab("saas"),
        })}
        {kpi({
          label: "Failure rate",
          value: pct(saas?.summary.failureRate ?? 0),
          delta: `${saas?.summary.failedCount ?? 0} failed — click to review`,
          deltaTone: (saas?.summary.failedCount ?? 0) > 0 ? "down" : "up",
          chip: { color: "rose", glyph: "!" },
          selected: tab === "saas" && txnStatus === "failed",
          onClick: () => {
            setTxnStatus("failed");
            selectTab("saas", { txnStatus: "failed" });
          },
        })}
        {kpi({
          label: "Receivable",
          value: inr(ar),
          delta: `Pending ${inr(collections?.summary.pendingReceivable ?? 0)}`,
          deltaTone: "muted",
          chip: { color: "blue", glyph: "◎" },
          selected: tab === "collections",
          onClick: () => selectTab("collections"),
        })}
        {kpi({
          label: "Overdue",
          value: inr(collections?.summary.overdueReceivable ?? 0),
          delta: `AMC renewals ${collections?.summary.amcRenewalsNext30d ?? 0}`,
          deltaTone: (collections?.summary.overdueReceivable ?? 0) > 0 ? "down" : "muted",
          chip: { color: "amber", glyph: "◈" },
          selected: tab === "collections",
          onClick: () => selectTab("collections"),
        })}
        {kpi({
          label: "Net position",
          value: inr(collections?.summary.netPosition ?? 0),
          delta: `Payables ${inr(ap)}`,
          deltaTone: "muted",
          chip: { color: "lavender", glyph: "▣" },
          selected: tab === "collections",
          onClick: () => selectTab("collections"),
        })}
        {kpi({
          label: "UPI pending",
          value: pendingSummary.upiClaims,
          delta: `${inr(pendingSummary.upiAmountInr)} awaiting verify`,
          deltaTone: pendingSummary.upiClaims ? "warn" : "muted",
          chip: { color: "sage", glyph: "◈" },
          selected: tab === "upi",
          onClick: () => selectTab("upi"),
        })}
        {kpi({
          label: "Desk pending",
          value: pendingOps.length || pendingSummary.deskOps,
          delta: `${ops.length} logged items`,
          deltaTone: pendingOps.length || pendingSummary.deskOps ? "warn" : "muted",
          chip: { color: "amber", glyph: "◈" },
          selected: tab === "ops",
          onClick: () => {
            setOpsFilter("pending");
            selectTab("ops");
          },
        })}
      </Grid>

      {error ? <AdminErrorState title="Refresh failed" message={error} onRetry={() => void load(days)} /> : null}
      {message ? <Alert tone={messageTone === "error" ? "coral" : "emerald"} title={message} /> : null}

      {upiReady ? (
        <div ref={upiWrapRef} hidden={tab !== "upi"} className="admin-cc-hidden">
          <UpiPaymentsPanel
            ref={upiSaveRef}
            initialStatus={searchParams.get("status") || "pending"}
            focusClaimId={focusClaimId}
          />
        </div>
      ) : null}

      {tab === "overview" && saas && collections ? (
        <div className="admin-cc-two">
          <div className="admin-cc-split-stack">
            <AdminSection title="Subscription health">
              {saas.subscription ? (
                <>
                  <ul className="admin-cc-kv">
                    {kvItem("Plan", saas.subscription.planId)}
                    {kvItem(
                      "Status",
                      <Badge auto tone={statusTone(saas.subscription.status)}>
                        {saas.subscription.status}
                      </Badge>,
                    )}
                    {kvItem("MRR", inr(saas.subscription.mrrInr))}
                    {kvItem(
                      "Period",
                      <>
                        {fmtDate(saas.subscription.currentPeriodStart)} → {fmtDate(saas.subscription.currentPeriodEnd)}
                      </>,
                    )}
                    {kvItem("Provider", saas.subscription.provider || "—")}
                  </ul>
                  {(saas.billingItems?.length ?? 0) > 0 ? (
                    <>
                      <div className="admin-cc-subhead">Line items</div>
                      <ul className="admin-cc-verify-list">
                        {saas.billingItems!.map((item) => (
                          <li key={item.toolId}>
                            <strong>{item.name}</strong>
                            <span className="admin-cc-cell-sub">
                              {inr(item.unitPriceInr)}/mo
                              {item.periodEnd ? ` · ${item.periodEnd.slice(0, 10)}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <div className="admin-cc-subhead">Charge success · {pct(1 - saas.summary.failureRate)}</div>
                  <ProgressBar
                    value={Math.max(4, (1 - saas.summary.failureRate) * 100)}
                    tone="emerald"
                    label="Charge success"
                  />
                </>
              ) : (
                <AdminEmpty title="No active subscription" icon="wallet">
                  Configure plans under Subscriptions.
                </AdminEmpty>
              )}
            </AdminSection>

            <AdminSection title="Cash mix" description="Receivables vs payables from Payment Tracker.">
              {mixBar}
            </AdminSection>
          </div>

          <div className="admin-cc-split-stack">
            <AdminSection
              title="Receivable aging"
              actions={
                <Link href="/tools/paymenttracker">
                  <Button variant="ghost" size="sm">
                    Payment Tracker →
                  </Button>
                </Link>
              }
            >
              {collections.aging.every((b) => b.count === 0) ? (
                <AdminEmpty title="No open receivables" icon="check">
                  No open receivables in aging buckets.
                </AdminEmpty>
              ) : (
                agingRows(collections.aging)
              )}
            </AdminSection>

            <AdminSection title="Needs attention">
              <ul className="admin-cc-attention-list">
                <li className="admin-cc-attention-item">
                  <div className="admin-cc-attention-main">
                    <div>
                      <strong>UPI claims</strong>
                      <p>{inr(pendingSummary.upiAmountInr)} awaiting verification</p>
                    </div>
                  </div>
                  <span className="admin-cc-attention-count">{pendingSummary.upiClaims}</span>
                  <Button variant="secondary" size="sm" onClick={() => selectTab("upi")}>
                    Review
                  </Button>
                </li>
                <li className="admin-cc-attention-item">
                  <div className="admin-cc-attention-main">
                    <div>
                      <strong>Payment desk</strong>
                      <p>Logged receivables and payables awaiting approval</p>
                    </div>
                  </div>
                  <span className="admin-cc-attention-count">{pendingOps.length || pendingSummary.deskOps}</span>
                  <Button variant="secondary" size="sm" onClick={() => selectTab("ops")}>
                    Review
                  </Button>
                </li>
              </ul>
              {pendingOps.length === 0 ? (
                <p className="admin-cc-note">No pending desk approvals.</p>
              ) : (
                <div className="admin-cc-dir-list" style={{ maxHeight: 320 }}>
                  {pendingOps.slice(0, 6).map((op) => (
                    <button
                      type="button"
                      key={op.id}
                      className="admin-cc-row"
                      onClick={() => {
                        setSelectedOpId(op.id);
                        selectTab("ops", { op: op.id });
                      }}
                    >
                      <div className="admin-cc-row-main">
                        <div className="admin-cc-cell-title">{op.party}</div>
                        <div className="admin-cc-cell-sub">
                          {op.kind} · due {op.dueDate ?? "—"}
                        </div>
                      </div>
                      <strong>{inr(op.amountInr)}</strong>
                    </button>
                  ))}
                </div>
              )}
            </AdminSection>
          </div>
        </div>
      ) : null}

      {tab === "saas" && saas ? (
        <div className="admin-cc-two">
          <AdminSection title="Charges" description={`${filteredTxns.length} of ${saas.transactions.length} in this window`}>
            <div className="admin-cc-stack">
              <div className="admin-cc-filters">
                <SearchInput
                  value={txnQuery}
                  onChange={(e) => setTxnQuery(e.target.value)}
                  placeholder="Search type, provider, error"
                  aria-label="Search transactions"
                />
                <AdminTabs
                  aria-label="Charge status"
                  options={TXN_STATUSES.map((s) => ({ value: s, label: cap(s) }))}
                  value={txnStatus}
                  onChange={(s) => {
                    setTxnStatus(s);
                    selectTab("saas", { txnStatus: s });
                  }}
                />
              </div>
              {filteredTxns.length === 0 ? (
                <AdminEmpty title="No transactions" icon="receipt">
                  No transactions in this window.
                </AdminEmpty>
              ) : (
                <div className="admin-cc-scroll" style={{ maxHeight: 640 }}>
                  <DataTable
                    caption="SaaS charges"
                    columns={txnColumns}
                    rows={filteredTxns}
                    rowKey={(t) => String(t.id)}
                  />
                </div>
              )}
            </div>
          </AdminSection>

          <div className="admin-cc-split-stack">
            <AdminSection
              title="Plan"
              actions={
                <Link href={adminDeepLink.subscriptions()}>
                  <Button variant="ghost" size="sm">
                    Plans &amp; entitlements →
                  </Button>
                </Link>
              }
            >
              {saas.subscription ? (
                <ul className="admin-cc-kv">
                  {kvItem("Plan", saas.subscription.planId)}
                  {kvItem(
                    "Status",
                    <Badge auto tone={statusTone(saas.subscription.status)}>
                      {saas.subscription.status}
                    </Badge>,
                  )}
                  {kvItem("MRR", inr(saas.subscription.mrrInr))}
                  {kvItem("Collected", inr(saas.summary.collectedInr))}
                </ul>
              ) : (
                <AdminEmpty title="No subscription" icon="wallet" />
              )}
            </AdminSection>

            <AdminSection title="Invoices">
              {saas.invoices.length === 0 ? (
                <AdminEmpty title="No billing invoices yet" icon="receipt" />
              ) : (
                <div className="admin-cc-scroll" style={{ maxHeight: 420 }}>
                  <DataTable
                    compact
                    caption="Billing invoices"
                    columns={invoiceColumns}
                    rows={saas.invoices}
                    rowKey={(inv) => inv.invoiceNo}
                  />
                </div>
              )}
            </AdminSection>
          </div>
        </div>
      ) : null}

      {tab === "collections" && collections ? (
        <div className="admin-cc-two">
          <AdminSection
            title="AR / AP"
            actions={
              <Link href="/tools/paymenttracker">
                <Button variant="ghost" size="sm">
                  Payment Tracker →
                </Button>
              </Link>
            }
          >
            <Grid cols={2} min={140} gap={12}>
              <KpiCard interactive={false} label="Receivable" value={inr(collections.summary.totalReceivable)} />
              <KpiCard interactive={false} label="Payable" value={inr(collections.summary.totalPayable)} />
              <KpiCard
                interactive={false}
                label="Overdue"
                value={inr(collections.summary.overdueReceivable)}
                valueTone={collections.summary.overdueReceivable > 0 ? "coral" : undefined}
              />
              <KpiCard interactive={false} label="Invoiced" value={inr(collections.summary.invoicedTotal)} />
            </Grid>
            <div style={{ marginTop: 16 }}>{mixBar}</div>
            <p className="admin-cc-note">
              Net {inr(collections.summary.netPosition)} · pending receipts {inr(collections.summary.pendingReceivable)} ·
              AMC renewals in 30d: {collections.summary.amcRenewalsNext30d}
            </p>
            <p className="admin-cc-note">
              Edit source records in{" "}
              <Link className="admin-cc-link" href="/tools/paymenttracker">
                Payment Tracker
              </Link>
              .
            </p>
          </AdminSection>

          <AdminSection title="Aging (open receivables)">{agingRows(collections.aging)}</AdminSection>
        </div>
      ) : null}

      {tab === "ops" ? (
        <div className="admin-cc-split">
          <AdminSection title="Queue" description={`${filteredOps.length} of ${ops.length} items`}>
            <div className="admin-cc-stack">
              <SearchInput
                value={opsQuery}
                onChange={(e) => setOpsQuery(e.target.value)}
                placeholder="Search party, reference, notes"
                aria-label="Search payment desk"
              />
              <AdminTabs
                aria-label="Approval filter"
                options={OPS_FILTERS.map((f) => ({ value: f, label: cap(f) }))}
                value={opsFilter}
                onChange={(f) => {
                  setOpsFilter(f);
                  selectTab("ops", { filter: f, op: selectedOpId });
                }}
              />
            </div>
            <div className="admin-cc-dir-list">
              {filteredOps.length === 0 ? (
                <AdminEmpty title="Nothing in this filter" icon="check" />
              ) : (
                filteredOps.map((op) => {
                  const active = selectedOpId === op.id;
                  return (
                    <button
                      type="button"
                      key={op.id}
                      className={cx("admin-cc-row", active && "is-selected")}
                      aria-pressed={active}
                      onClick={() => setSelectedOpId(op.id)}
                    >
                      <div className="admin-cc-row-main">
                        <div className="admin-cc-cell-title">{op.party}</div>
                        <div className="admin-cc-cell-sub">
                          {op.kind} · {op.status} · due {op.dueDate ?? "—"}
                        </div>
                      </div>
                      <div className="admin-cc-row-badges">
                        <Badge auto tone="neutral">
                          {inr(op.amountInr)}
                        </Badge>
                        <Badge auto tone={statusTone(op.approvalStatus)}>
                          {op.approvalStatus}
                        </Badge>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </AdminSection>

          <div className="admin-cc-split-stack">
            {selectedOp ? (
              <div ref={opDetailRef}>
              <AdminSection
                title={selectedOp.party}
                actions={
                  <Badge auto tone={statusTone(selectedOp.approvalStatus)}>
                    {selectedOp.approvalStatus}
                  </Badge>
                }
              >
                <ul className="admin-cc-kv">
                  {kvItem("Kind", selectedOp.kind)}
                  {kvItem("Amount", inr(selectedOp.amountInr))}
                  {kvItem(
                    "Status",
                    <Badge auto tone={statusTone(selectedOp.status)}>
                      {selectedOp.status}
                    </Badge>,
                  )}
                  {kvItem(
                    "Approval",
                    <Badge auto tone={statusTone(selectedOp.approvalStatus)}>
                      {selectedOp.approvalStatus}
                    </Badge>,
                  )}
                  {kvItem("Due", selectedOp.dueDate ?? "—")}
                  {kvItem("Reference", selectedOp.reference || "—")}
                </ul>
                {selectedOp.notes ? <p className="admin-cc-note-text">{selectedOp.notes}</p> : null}
                {selectedOp.approvalStatus === "pending" ? (
                  <div className="admin-cc-form-actions" style={{ marginTop: 12 }}>
                    <Button
                      variant="primary"
                      disabled={busyId === selectedOp.id}
                      onClick={() => confirmReview(selectedOp, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busyId === selectedOp.id}
                      onClick={() => confirmReview(selectedOp, "reject")}
                    >
                      Reject
                    </Button>
                  </div>
                ) : (
                  <p className="admin-cc-note-text" style={{ marginTop: 12 }}>
                    This item is already {selectedOp.approvalStatus}.
                  </p>
                )}
              </AdminSection>
              </div>
            ) : (
              <AdminSection title="Review">
                <AdminEmpty title="Nothing selected" icon="receipt">
                  Select a logged payment to approve payouts or collections.
                </AdminEmpty>
              </AdminSection>
            )}

            <AdminSection
              title="Log payment"
              description="Fill the fields, then use Log payment in the toolbar (creates a pending desk item)."
            >
              <form ref={opFormRef} className="admin-cc-form" onSubmit={createOp} id="payment-desk-log-form">
                <FormGrid>
                  <AdminOrgSelect
                    full
                    value={opForm.organizationId}
                    onChange={(organizationId) => setOpForm({ ...opForm, organizationId })}
                  />
                  <TextField
                    label="Party"
                    value={opForm.party}
                    onChange={(e) => setOpForm({ ...opForm, party: e.target.value })}
                    required
                    placeholder="Customer or vendor"
                  />
                  <TextField
                    label="Amount (INR)"
                    type="number"
                    min={0}
                    step="0.01"
                    value={opForm.amountInr}
                    onChange={(e) => setOpForm({ ...opForm, amountInr: e.target.value })}
                    required
                  />
                  <SelectField
                    label="Kind"
                    value={opForm.kind}
                    onChange={(e) => setOpForm({ ...opForm, kind: e.target.value })}
                  >
                    <option value="receivable">Receivable</option>
                    <option value="payable">Payable</option>
                    <option value="saas">SaaS</option>
                  </SelectField>
                  <TextField
                    label="Due date"
                    type="date"
                    value={opForm.dueDate}
                    onChange={(e) => setOpForm({ ...opForm, dueDate: e.target.value })}
                  />
                  <TextField
                    label="Reference"
                    value={opForm.reference}
                    onChange={(e) => setOpForm({ ...opForm, reference: e.target.value })}
                    placeholder="Invoice / UTR"
                  />
                  <TextField
                    label="Notes"
                    value={opForm.notes}
                    onChange={(e) => setOpForm({ ...opForm, notes: e.target.value })}
                    placeholder="Optional"
                  />
                </FormGrid>
              </form>
            </AdminSection>
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </AdminPage>
  );
}
