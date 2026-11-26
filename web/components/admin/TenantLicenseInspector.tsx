"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminEmpty, AdminSection } from "@/components/admin/ui";
import { Badge, Button, DataTable, type BosColumn } from "@/components/bos";
import { api } from "@/lib/api";

type TenantLicenseRow = {
  toolId: string;
  toolName: string;
  priceInr: number;
  branchCount: number;
  periodEnd: string | null;
  daysLeft: number | null;
  isTrial: boolean;
  source: string;
};

type Props = {
  organizationId: number;
  organizationName: string;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
};

export function TenantLicenseInspector({
  organizationId,
  organizationName,
  onClose,
  onChanged,
  onError,
}: Props) {
  const [licenses, setLicenses] = useState<TenantLicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTool, setBusyTool] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ licenses?: TenantLicenseRow[] }>(
        `/admin/subscriptions/tenants/${organizationId}/licenses`,
      );
      setLicenses(res.licenses ?? []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not load tenant licenses");
    } finally {
      setLoading(false);
    }
  }, [organizationId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function extendTool(row: TenantLicenseRow, days: number) {
    setBusyTool(row.toolId);
    try {
      const res = await api<{ mrrInr: number }>("/admin/subscriptions/grant-tool", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          toolId: row.toolId,
          mode: "paid",
          days,
        }),
      });
      await load();
      await onChanged(
        `Extended ${row.toolName} for ${organizationName || `Org ${organizationId}`} by +${days}d. New MRR: ₹${res.mrrInr}.`,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not extend license");
    } finally {
      setBusyTool(null);
    }
  }

  async function revokeTool(row: TenantLicenseRow) {
    setBusyTool(row.toolId);
    try {
      const res = await api<{ mrrInr: number }>("/admin/subscriptions/revoke-tool", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          toolId: row.toolId,
        }),
      });
      await load();
      await onChanged(
        `Revoked ${row.toolName} from ${organizationName || `Org ${organizationId}`}. New MRR: ₹${res.mrrInr}.`,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not revoke license");
    } finally {
      setBusyTool(null);
    }
  }

  const columns: ReadonlyArray<BosColumn<TenantLicenseRow>> = [
    {
      key: "tool",
      header: "Tool",
      cell: (r) => (
        <div>
          <div className="admin-cc-cell-title">{r.toolName}</div>
          <div className="admin-cc-cell-sub">
            {r.toolId} · {r.branchCount} branch{r.branchCount === 1 ? "" : "es"} · via {r.source}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Type",
      cell: (r) => (
        <Badge auto tone={r.isTrial ? "lavender" : "emerald"}>
          {r.isTrial ? "Trial (₹0)" : `Paid · ₹${r.priceInr}/mo`}
        </Badge>
      ),
    },
    {
      key: "expiry",
      header: "Ends",
      mono: true,
      cell: (r) =>
        r.periodEnd ? (
          <span>
            {r.periodEnd}{" "}
            {r.daysLeft != null ? (
              <Badge auto tone={r.daysLeft <= 7 ? "amber" : "neutral"}>
                {r.daysLeft}d
              </Badge>
            ) : null}
          </span>
        ) : (
          "No expiry"
        ),
    },
    {
      key: "actions",
      header: "Operations",
      align: "right",
      cell: (r) => {
        const busy = busyTool === r.toolId;
        return (
          <div className="admin-cc-actions">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void extendTool(r, 30)}>
              +30d
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void extendTool(r, 365)}>
              +365d
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void revokeTool(r)}
            >
              Revoke
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <AdminSection
      title={`Active licenses — ${organizationName || `Org ${organizationId}`}`}
      description="Inspect per-tool paid and trial entitlements across all branches, extend by 30d/365d, or revoke individually."
      actions={
        <div className="admin-cc-actions">
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Reload
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close inspector
          </Button>
        </div>
      }
    >
      {loading ? (
        <p className="muted">Loading tenant licenses…</p>
      ) : licenses.length === 0 ? (
        <AdminEmpty title="No active tool licenses" icon="lock">
          This workspace is currently on Freemium with no active paid or trial tool licenses. Use Quick Grant below to
          activate any tool.
        </AdminEmpty>
      ) : (
        <DataTable
          caption={`Active tool licenses for ${organizationName}`}
          columns={columns}
          rows={licenses}
          rowKey={(r) => r.toolId}
        />
      )}
    </AdminSection>
  );
}
