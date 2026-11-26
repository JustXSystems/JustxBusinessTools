"use client";

import { useEffect, useState } from "react";
import { AdminEmpty, AdminSection } from "@/components/admin/ui";
import { SelectField, SwitchField, TextField } from "@/components/admin/ui/AdminFields";
import { Badge, Button, DataTable, FormGrid, type BosColumn } from "@/components/bos";
import { api } from "@/lib/api";

type PromoRow = {
  code: string;
  description: string | null;
  discountType: "percent" | "flat_inr";
  discountValue: number;
  userCategory: "all" | "individual" | "business" | "enterprise";
  billingCycle: "all" | "month" | "year";
  minAmountInr: number;
  maxRedemptions: number | null;
  redemptionsCount: number;
  expiresAt: string | null;
  active: boolean;
};

const EMPTY_FORM = {
  code: "",
  description: "",
  discountType: "percent" as "percent" | "flat_inr",
  discountValue: "15",
  userCategory: "all" as "all" | "individual" | "business" | "enterprise",
  billingCycle: "all" as "all" | "month" | "year",
  minAmountInr: "0",
  maxRedemptions: "",
  expiresAt: "",
  active: true,
};

export function PromoCodesPanel({
  onMessage,
  onError,
}: {
  onMessage: (msg: string) => void;
  onError?: (msg: string) => void;
}) {
  const fail = onError ?? onMessage;
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const res = await api<{ promos: PromoRow[] }>("/admin/subscriptions/promos");
    setPromos(res.promos ?? []);
  }

  useEffect(() => {
    void reload().catch((e) => fail(e instanceof Error ? e.message : "Could not load promo codes"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/admin/subscriptions/promos", {
        method: "POST",
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          description: form.description.trim() || null,
          discountType: form.discountType,
          discountValue: Number(form.discountValue || 0),
          userCategory: form.userCategory,
          billingCycle: form.billingCycle,
          minAmountInr: Number(form.minAmountInr || 0),
          maxRedemptions: form.maxRedemptions.trim() ? Number(form.maxRedemptions) : null,
          expiresAt: form.expiresAt.trim() || null,
          active: form.active,
        }),
      });
      onMessage(`Promo code ${form.code.trim().toUpperCase()} saved.`);
      setForm(EMPTY_FORM);
      await reload();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not save promo code");
    } finally {
      setSaving(false);
    }
  }

  async function remove(code: string) {
    setSaving(true);
    try {
      await api(`/admin/subscriptions/promos/${encodeURIComponent(code)}`, { method: "DELETE" });
      onMessage(`Deleted promo code ${code}.`);
      await reload();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  function edit(p: PromoRow) {
    setForm({
      code: p.code,
      description: p.description ?? "",
      discountType: p.discountType,
      discountValue: String(p.discountValue),
      userCategory: p.userCategory,
      billingCycle: p.billingCycle,
      minAmountInr: String(p.minAmountInr),
      maxRedemptions: p.maxRedemptions == null ? "" : String(p.maxRedemptions),
      expiresAt: p.expiresAt ? p.expiresAt.slice(0, 10) : "",
      active: p.active,
    });
  }

  const columns: ReadonlyArray<BosColumn<PromoRow>> = [
    {
      key: "code",
      header: "Code",
      cell: (p) => (
        <div>
          <div className="admin-cc-cell-title">{p.code}</div>
          {p.description ? <div className="admin-cc-cell-sub">{p.description}</div> : null}
        </div>
      ),
    },
    {
      key: "discount",
      header: "Offer",
      cell: (p) => (
        <Badge auto tone="emerald">
          {p.discountType === "percent" ? `${p.discountValue}% off` : `₹${p.discountValue} off`}
        </Badge>
      ),
    },
    {
      key: "scope",
      header: "Target",
      cell: (p) => (
        <div className="admin-cc-cell-sub">
          {p.userCategory === "all" ? "All users" : p.userCategory} ·{" "}
          {p.billingCycle === "all" ? "Any cycle" : p.billingCycle === "year" ? "Yearly" : "Monthly"}
          {p.minAmountInr > 0 ? ` · min ₹${p.minAmountInr}` : ""}
        </div>
      ),
    },
    {
      key: "uses",
      header: "Uses",
      mono: true,
      cell: (p) => `${p.redemptionsCount}${p.maxRedemptions != null ? ` / ${p.maxRedemptions}` : ""}`,
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <Badge auto tone={p.active ? "emerald" : "neutral"}>
          {p.active ? "Active" : "Paused"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (p) => (
        <div className="admin-cc-actions">
          <Button variant="ghost" size="sm" onClick={() => edit(p)}>
            Edit
          </Button>
          <Button variant="destructive" size="sm" disabled={saving} onClick={() => void remove(p.code)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="admin-cc-stack">
      <AdminSection
        title="Create or update promo code"
        description="Target discounts to Personal, Business, or Enterprise users and Monthly or Yearly billing."
        actions={
          <Button type="submit" form="promo-code-form" variant="primary" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save promo"}
          </Button>
        }
      >
        <form id="promo-code-form" className="admin-cc-form" onSubmit={(e) => void save(e)}>
          <FormGrid>
            <TextField
              label="Code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="e.g. ANNUAL20"
              required
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Launch or seasonal campaign"
            />
            <SelectField
              label="Discount type"
              value={form.discountType}
              onChange={(e) =>
                setForm({ ...form, discountType: e.target.value as "percent" | "flat_inr" })
              }
            >
              <option value="percent">Percentage (%)</option>
              <option value="flat_inr">Flat INR (₹)</option>
            </SelectField>
            <TextField
              label={form.discountType === "percent" ? "Discount %" : "Discount (INR)"}
              type="number"
              min={1}
              max={form.discountType === "percent" ? 100 : undefined}
              value={form.discountValue}
              onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
              required
            />
            <SelectField
              label="User category"
              value={form.userCategory}
              onChange={(e) =>
                setForm({
                  ...form,
                  userCategory: e.target.value as "all" | "individual" | "business" | "enterprise",
                })
              }
            >
              <option value="all">All categories</option>
              <option value="individual">Personal (no-GSTIN) only</option>
              <option value="business">Business (GSTIN) only</option>
              <option value="enterprise">Enterprise (Multi-Branch) only</option>
            </SelectField>
            <SelectField
              label="Billing cycle"
              value={form.billingCycle}
              onChange={(e) =>
                setForm({ ...form, billingCycle: e.target.value as "all" | "month" | "year" })
              }
            >
              <option value="all">Monthly &amp; Yearly</option>
              <option value="month">Monthly only</option>
              <option value="year">Yearly only</option>
            </SelectField>
            <TextField
              label="Min order (INR)"
              type="number"
              min={0}
              value={form.minAmountInr}
              onChange={(e) => setForm({ ...form, minAmountInr: e.target.value })}
            />
            <TextField
              label="Max redemptions (optional)"
              type="number"
              min={1}
              value={form.maxRedemptions}
              placeholder="Unlimited"
              onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
            />
            <TextField
              label="Expires on (optional)"
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
            <SwitchField
              label="Active"
              checked={form.active}
              onChange={(active) => setForm({ ...form, active })}
            />
          </FormGrid>
        </form>
      </AdminSection>

      <AdminSection title="Configured promo codes" description="Active and historical discount codes.">
        {promos.length === 0 ? (
          <AdminEmpty title="No promo codes yet" icon="sparkle">
            Create your first campaign code above to offer category or annual discounts at checkout.
          </AdminEmpty>
        ) : (
          <DataTable
            caption="Promo codes"
            columns={columns}
            rows={promos}
            rowKey={(p) => p.code}
          />
        )}
      </AdminSection>
    </div>
  );
}
