"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Grid,
  KpiCard,
  type BosColumn,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
} from "@/components/admin/ui";
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
  profile: "Business Profile",
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

function formatCreated(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminApprovalsPage() {
  return (
    <Suspense fallback={<AdminPageSkeleton cards={5} />}>
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
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ items: InboxItem[]; summary: Summary }>("/admin/approvals/inbox");
      setItems(data.items);
      setSummary(data.summary);
      setError("");
      setLoaded(true);
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

  if (!loaded) {
    if (error) {
      return (
        <AdminPage section="Overview" title="Approvals" sub="Pending reviews">
          <AdminErrorState message={error} onRetry={reload} />
        </AdminPage>
      );
    }
    return <AdminPageSkeleton cards={5} />;
  }

  const tabOptions: ReadonlyArray<{ value: ApprovalsKind | "all"; label: string }> = [
    { value: "all", label: `All (${summary.total})` },
    { value: "profile", label: `Business Profiles (${summary.profiles})` },
    { value: "user", label: `Users (${summary.users})` },
    { value: "payment_op", label: `Payment desk (${summary.paymentOps})` },
    { value: "upi_claim", label: `UPI claims (${summary.upiClaims})` },
  ];

  const columns: ReadonlyArray<BosColumn<InboxItem>> = [
    {
      key: "item",
      header: "Request",
      cell: (item) => (
        <div>
          <div className="admin-cc-cell-title">{item.title}</div>
          <div className="admin-cc-cell-sub">{item.subtitle}</div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Type",
      cell: (item) => (
        <Badge auto tone="blue">
          {KIND_LABEL[item.kind]}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (item) => (
        <Badge auto tone="amber">
          {item.status}
        </Badge>
      ),
    },
    { key: "createdAt", header: "Submitted", mono: true, cell: (item) => formatCreated(item.createdAt) },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (item) => {
        const approveKey = `${item.kind}:${item.id}:approve`;
        const rejectKey = `${item.kind}:${item.id}:reject`;
        return (
          <div className="admin-cc-actions">
            <Link href={KIND_HUB[item.kind]}>
              <Button variant="secondary" size="sm">
                Open
              </Button>
            </Link>
            <Button
              variant="primary"
              size="sm"
              disabled={busyKey === approveKey}
              onClick={() => void act(item, "approve")}
            >
              Approve
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busyKey === rejectKey}
              onClick={() => void act(item, "reject")}
            >
              Reject
            </Button>
          </div>
        );
      },
    },
  ];

  const kpiButton = (
    kind: ApprovalsKind | "all",
    label: string,
    value: number,
    chip: { color: "blue" | "amber" | "mint" | "lavender" | "rose" | "sage"; glyph: string },
    sub?: string,
  ) => (
    <button
      type="button"
      className={`admin-cc-kpi-btn${kindFilter === kind ? " is-selected" : ""}`}
      aria-pressed={kindFilter === kind}
      onClick={() => setKind(kind)}
    >
      <KpiCard
        label={label}
        value={value}
        chip={chip}
        delta={sub ?? (value ? "Needs review" : "Clear")}
        deltaTone={value ? "warn" : "muted"}
      />
    </button>
  );

  return (
    <AdminPage
      section="Overview"
      title="Approvals"
      sub="Pending reviews"
      toolbar={
        <>
          <Badge auto tone={summary.total ? "amber" : "emerald"}>
            {summary.total ? `${summary.total} pending` : "All clear"}
          </Badge>
          <AdminTabs
            aria-label="Approval type"
            options={tabOptions}
            value={kindFilter}
            onChange={setKind}
          />
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void reload()}>
            Refresh
          </Button>
        </>
      }
    >
      <Alert tone="amber" title="Review policy">
        Pending business profiles (Justxsystems soft review — Owners can already use JBT), join requests, payment-desk items, and UPI
        claims. Rejecting a business as Justxsystems admin suspends all users on that org and ends their sessions.
      </Alert>

      <Grid cols={5} min={140} gap={12}>
        {kpiButton("all", "Total", summary.total, { color: "blue", glyph: "◎" })}
        {kpiButton("profile", "Business Profiles", summary.profiles, { color: "lavender", glyph: "▣" })}
        {kpiButton("user", "Users", summary.users, { color: "mint", glyph: "👤" }, summary.users ? "Registrations & joins" : "Clear")}
        {kpiButton("payment_op", "Payment desk", summary.paymentOps, { color: "rose", glyph: "₹" })}
        {kpiButton("upi_claim", "UPI claims", summary.upiClaims, { color: "amber", glyph: "◈" })}
      </Grid>

      {error ? <AdminErrorState title="Action or refresh failed" message={error} onRetry={reload} /> : null}
      {message ? <Alert tone="emerald" title={message} /> : null}

      <AdminSection
        title={kindFilter === "all" ? "Pending queue" : `${KIND_LABEL[kindFilter]} queue`}
        description={
          kindFilter === "all"
            ? `${visible.length} items awaiting a decision.`
            : `Showing ${KIND_LABEL[kindFilter]} only.`
        }
        actions={
          kindFilter !== "all" ? (
            <Link href={KIND_HUB[kindFilter]}>
              <Button variant="ghost" size="sm">
                Open {KIND_LABEL[kindFilter].toLowerCase()} workspace →
              </Button>
            </Link>
          ) : null
        }
      >
        {visible.length === 0 ? (
          <AdminEmpty title={kindFilter === "all" ? "Nothing pending" : `No pending ${KIND_LABEL[kindFilter].toLowerCase()} items`} icon="check">
            {kindFilter === "all" ? "You're clear." : "Try another approval type."}
          </AdminEmpty>
        ) : (
          <div className="admin-cc-scroll" style={{ maxHeight: 640 }}>
            <DataTable
              caption="Pending approvals"
              columns={columns}
              rows={visible}
              rowKey={(item) => `${item.kind}-${item.id}`}
            />
          </div>
        )}
      </AdminSection>
    </AdminPage>
  );
}
