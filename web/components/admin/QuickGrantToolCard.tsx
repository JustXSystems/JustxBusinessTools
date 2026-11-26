"use client";

import { useEffect, useState } from "react";
import { AdminOrgSelect } from "@/components/admin/AdminOrgSelect";
import { AdminSection } from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import { Button, FormGrid } from "@/components/bos";
import { api } from "@/lib/api";

type SkuOption = {
  toolId: string;
  name: string;
  priceInr: number;
  includedFree?: boolean;
};

type Props = {
  organizationId: number | null;
  onOrganizationChange: (id: number | null) => void;
  onGranted: (message: string) => Promise<void>;
  onError: (message: string) => void;
};

const DAY_PRESETS = [
  { label: "14d trial", days: 14, mode: "trial" as const },
  { label: "30d paid", days: 30, mode: "paid" as const },
  { label: "90d paid", days: 90, mode: "paid" as const },
  { label: "365d annual", days: 365, mode: "paid" as const },
];

export function QuickGrantToolCard({
  organizationId,
  onOrganizationChange,
  onGranted,
  onError,
}: Props) {
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [toolId, setToolId] = useState("");
  const [mode, setMode] = useState<"paid" | "trial">("paid");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ skus?: SkuOption[] }>("/admin/skus")
      .then((res) => {
        const paid = (res.skus ?? []).filter((s) => !s.includedFree);
        setSkus(paid);
        if (paid.length > 0) setToolId((prev) => prev || paid[0].toolId);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !toolId) {
      onError("Select an organization and a tool first");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{
        ok: boolean;
        profileCount: number;
        periodEnd: string | null;
        mrrInr: number;
      }>("/admin/subscriptions/grant-tool", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          toolId,
          mode,
          days: Number(days || 30),
        }),
      });
      const skuName = skus.find((s) => s.toolId === toolId)?.name || toolId;
      await onGranted(
        `Granted ${skuName} (${mode === "trial" ? "trial" : "paid"}, ${days}d) across ${res.profileCount} branch(es). New MRR: ₹${res.mrrInr}.`,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not grant tool license");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminSection
      title="Quick grant or extend tool license"
      description="Grant a paid license, annual extension, or complimentary trial for any single tool across all branches of a workspace."
      actions={
        <div className="admin-cc-actions">
          {DAY_PRESETS.map((p) => (
            <Button
              key={p.label}
              variant={mode === p.mode && Number(days) === p.days ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setMode(p.mode);
                setDays(String(p.days));
              }}
            >
              {p.label}
            </Button>
          ))}
          <Button type="submit" form="quick-grant-tool-form" variant="primary" size="sm" disabled={busy}>
            {busy ? "Granting…" : "Grant license"}
          </Button>
        </div>
      }
    >
      <form id="quick-grant-tool-form" className="admin-cc-form" onSubmit={(e) => void submit(e)}>
        <FormGrid>
          <AdminOrgSelect
            label="Organization"
            value={organizationId}
            onChange={onOrganizationChange}
          />
          <SelectField
            label="Tool SKU"
            value={toolId}
            onChange={(e) => setToolId(e.target.value)}
          >
            {skus.length === 0 ? <option value="">Loading tools…</option> : null}
            {skus.map((s) => (
              <option key={s.toolId} value={s.toolId}>
                {s.name} (₹{s.priceInr}/mo)
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Grant type"
            value={mode}
            onChange={(e) => setMode(e.target.value as "paid" | "trial")}
          >
            <option value="paid">Paid license (stacks remaining days)</option>
            <option value="trial">Free trial (₹0 MRR)</option>
          </SelectField>
          <TextField
            label="Duration (days)"
            type="number"
            min={1}
            max={730}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            required
          />
        </FormGrid>
      </form>
    </AdminSection>
  );
}
