"use client";

import Link from "next/link";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Alert, Badge, BlockLabel, Button, FormGrid, Grid, KpiCard, Switch } from "@/components/bos";
import { AdminSection } from "@/components/admin/ui";
import { SelectField, TextareaField, TextField } from "@/components/admin/ui/AdminFields";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { ensureToolsOnHome } from "@/lib/admin-home-tools";
import { api } from "@/lib/api";
import { bumpCommerceRevision } from "@/lib/commerce-revision";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export type SkuState = {
  toolId: string;
  name: string;
  category: string;
  tagline?: string | null;
  description?: string | null;
  priceInr: number;
  annualPriceInr?: number | null;
  billingInterval: string;
  includedFree: boolean;
  available: boolean;
  trialDays?: number;
  accessPolicy?: "soft_cap" | "hard_lock";
  unlicensedRecordLimit?: number | null;
  featured?: boolean;
};

export type BundleState = {
  id: string;
  name: string;
  tagline: string | null;
  description?: string | null;
  priceInr: number;
  listPriceInr: number;
  discountPct: number;
  fixedPriceInr: number | null;
  available: boolean;
  highlighted: boolean;
  toolIds: string[];
};

export type ProfileOption = {
  id: number;
  businessName: string;
  isDefault: boolean;
  organizationId?: number;
  organizationName?: string | null;
};

type FormState = {
  name: string;
  category: string;
  tagline: string;
  description: string;
  priceInr: string;
  annualPriceInr: string;
  billingInterval: "month" | "year";
  includedFree: boolean;
  available: boolean;
  trialDays: string;
  accessPolicy: "soft_cap" | "hard_lock";
  unlicensedRecordLimit: string;
  featured: boolean;
};

function formFromSku(sku: SkuState | null, fallbackName: string, fallbackCategory: string): FormState {
  return {
    name: sku?.name || fallbackName,
    category: sku?.category || fallbackCategory,
    tagline: sku?.tagline ?? "",
    description: sku?.description ?? "",
    priceInr: String(sku?.priceInr ?? 0),
    annualPriceInr: sku?.annualPriceInr == null ? "" : String(sku.annualPriceInr),
    billingInterval: sku?.billingInterval === "year" ? "year" : "month",
    includedFree: Boolean(sku?.includedFree),
    available: sku?.available !== false,
    trialDays: String(sku?.trialDays ?? 0),
    accessPolicy: sku?.accessPolicy === "hard_lock" ? "hard_lock" : "soft_cap",
    unlicensedRecordLimit:
      sku?.unlicensedRecordLimit == null ? "" : String(sku.unlicensedRecordLimit),
    featured: Boolean(sku?.featured),
  };
}

export const ToolPricingPane = forwardRef<
  ToolsSaveHandle,
  {
    toolId: string;
    toolName: string;
    toolCategory: string;
    sku: SkuState | null;
    licensed: boolean;
    periodEnd: string | null;
    recordLimitOverride?: number | null;
    profiles: ProfileOption[];
    businessProfileId: number | null;
    onBusinessProfileChange: (id: number) => void;
    seatCount?: number;
    bundles: BundleState[];
    onReload: () => Promise<void>;
    onMessage: (msg: string, tone?: "success" | "error") => void;
  }
>(function ToolPricingPane(
  {
    toolId,
    toolName,
    toolCategory,
    sku,
    licensed,
    periodEnd,
    recordLimitOverride = null,
    profiles,
    businessProfileId,
    onBusinessProfileChange,
    seatCount,
    bundles,
    onReload,
    onMessage,
  },
  ref,
) {
  const [form, setForm] = useState<FormState>(() => formFromSku(sku, toolName, toolCategory));
  const [saving, setSaving] = useState(false);
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [grantDays, setGrantDays] = useState("30");
  const [syncHome, setSyncHome] = useState(true);
  const [profileLimit, setProfileLimit] = useState(
    recordLimitOverride == null ? "" : String(recordLimitOverride),
  );
  const [personalUsage, setPersonalUsage] = useState<boolean | null>(null);
  const [personalBusy, setPersonalBusy] = useState(false);
  const savedSnap = useRef("");
  const syncedToolIdRef = useRef(toolId);
  const formRef = useRef(form);
  formRef.current = form;
  const savedLimitRef = useRef(recordLimitOverride == null ? "" : String(recordLimitOverride));
  const limitKeyRef = useRef(`${toolId}:${businessProfileId ?? ""}`);
  const profileLimitRef = useRef(profileLimit);
  profileLimitRef.current = profileLimit;

  useEffect(() => {
    const next = formFromSku(sku, toolName, toolCategory);
    const nextSnap = JSON.stringify(next);
    const toolChanged = syncedToolIdRef.current !== toolId;
    if (toolChanged) {
      syncedToolIdRef.current = toolId;
      savedSnap.current = nextSnap;
      setForm(next);
      return;
    }
    const isDirty = savedSnap.current !== "" && JSON.stringify(formRef.current) !== savedSnap.current;
    if (isDirty) return;
    if (nextSnap !== savedSnap.current) {
      savedSnap.current = nextSnap;
      setForm(next);
    }
  }, [sku, toolId, toolName, toolCategory]);

  useEffect(() => {
    let alive = true;
    void api<{ toolPersonalUsage?: Record<string, boolean> }>("/admin/config/tool-personal-usage")
      .then((res) => {
        if (alive) setPersonalUsage(Boolean(res.toolPersonalUsage?.[toolId]));
      })
      .catch(() => {
        if (alive) setPersonalUsage(null);
      });
    return () => {
      alive = false;
    };
  }, [toolId]);

  async function togglePersonalEligibility(next: boolean) {
    setPersonalBusy(true);
    try {
      await api("/admin/config/tool-personal-usage", {
        method: "PUT",
        body: JSON.stringify({ toolId, personalUsage: next }),
      });
      setPersonalUsage(next);
      bumpCommerceRevision();
      onMessage(
        next
          ? `${toolName} enabled for Personal (no-GSTIN) & Business accounts.`
          : `${toolName} restricted to Business (GSTIN) accounts.`,
      );
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Failed to update category access", "error");
    } finally {
      setPersonalBusy(false);
    }
  }

  function applyAnnualPreset(multiplierOrDiscount: "10x" | "15pct" | "20pct" | "clear") {
    const monthly = Math.max(0, Number(form.priceInr || 0));
    if (multiplierOrDiscount === "clear" || monthly <= 0) {
      setForm((f) => ({ ...f, annualPriceInr: "" }));
      return;
    }
    const annual =
      multiplierOrDiscount === "10x"
        ? Math.round(monthly * 10)
        : multiplierOrDiscount === "15pct"
          ? Math.round(monthly * 12 * 0.85)
          : Math.round(monthly * 12 * 0.8);
    setForm((f) => ({ ...f, annualPriceInr: String(annual) }));
  }

  const annualPreview = useMemo(() => {
    const monthly = Math.max(0, Number(form.priceInr || 0));
    if (form.includedFree || monthly <= 0 || form.billingInterval === "year") return null;
    const annual =
      form.annualPriceInr.trim() !== ""
        ? Math.max(0, Number(form.annualPriceInr))
        : Math.round(monthly * 10);
    const fullYear = monthly * 12;
    const savings = Math.max(0, fullYear - annual);
    const pct = fullYear > 0 ? Math.round((savings / fullYear) * 100) : 0;
    const effectiveMo = Math.round(annual / 12);
    return {
      annual,
      savings,
      pct,
      effectiveMo,
      isDerived: form.annualPriceInr.trim() === "",
    };
  }, [form.priceInr, form.annualPriceInr, form.includedFree, form.billingInterval]);

  useEffect(() => {
    const next = recordLimitOverride == null ? "" : String(recordLimitOverride);
    const nextKey = `${toolId}:${businessProfileId ?? ""}`;
    if (limitKeyRef.current !== nextKey) {
      limitKeyRef.current = nextKey;
      savedLimitRef.current = next;
      setProfileLimit(next);
      return;
    }
    const isDirty = profileLimitRef.current !== savedLimitRef.current;
    if (isDirty) return;
    if (next !== savedLimitRef.current) {
      savedLimitRef.current = next;
      setProfileLimit(next);
    }
  }, [recordLimitOverride, toolId, businessProfileId]);

  const dirty = JSON.stringify(form) !== savedSnap.current;

  const packsForTool = useMemo(
    () => bundles.filter((b) => b.id === "all_tools" || b.toolIds.includes(toolId)),
    [bundles, toolId],
  );

  const commercialMode = form.includedFree
    ? "Included free"
    : form.available
      ? "Paid subscription"
      : "Hidden from cart";

  async function saveProduct(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      const body = {
        name: form.name.trim() || toolName,
        category: form.category.trim() || toolCategory,
        tagline: form.tagline.trim() || null,
        description: form.description.trim() || null,
        priceInr: Number(form.priceInr || 0),
        annualPriceInr: form.annualPriceInr.trim() === "" ? null : Number(form.annualPriceInr),
        includedFree: form.includedFree,
        available: form.available,
        trialDays: Number(form.trialDays) || 0,
        accessPolicy: form.accessPolicy,
        unlicensedRecordLimit:
          form.unlicensedRecordLimit.trim() === "" ? null : Number(form.unlicensedRecordLimit),
        featured: form.featured,
        billingInterval: form.billingInterval,
      };
      if (sku) {
        await api(`/admin/skus/${toolId}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/admin/skus", {
          method: "POST",
          body: JSON.stringify({ toolId, ...body }),
        });
      }
      savedSnap.current = JSON.stringify(form);
      onMessage(`${body.name} commercial settings saved.`);
      bumpCommerceRevision();
      await onReload();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Save failed", "error");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function requireProfile(): number {
    if (businessProfileId == null) {
      throw new Error("Select a Business Profile before managing entitlements");
    }
    return businessProfileId;
  }

  async function runLicense(label: string, fn: (profileId: number) => Promise<void>) {
    setLicenseBusy(true);
    try {
      const profileId = requireProfile();
      await fn(profileId);
      onMessage(label);
      await onReload();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "License action failed", "error");
    } finally {
      setLicenseBusy(false);
    }
  }

  async function maybeSyncHome(profileId: number) {
    if (!syncHome) return;
    await ensureToolsOnHome(profileId, [toolId]);
  }

  async function saveRecordLimit() {
    await runLicense(
      profileLimit.trim() === ""
        ? `Cleared record-limit override for ${toolName}.`
        : `Record-limit override set to ${profileLimit} for ${toolName}.`,
      async (profileId) => {
        const recordLimit =
          profileLimit.trim() === "" ? null : Math.max(0, Math.floor(Number(profileLimit)));
        if (recordLimit != null && Number.isNaN(recordLimit)) {
          throw new Error("Record limit must be a number or blank");
        }
        await api("/admin/skus/record-limit", {
          method: "POST",
          body: JSON.stringify({ businessProfileId: profileId, toolId, recordLimit }),
        });
        savedLimitRef.current = recordLimit == null ? "" : String(recordLimit);
      },
    );
  }

  useImperativeHandle(
    ref,
    () => ({
      save: () => saveProduct(),
      isBusy: () => saving,
      isDirty: () => dirty,
      label: () => (sku ? "Save product" : "Publish product"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saving, dirty, sku, form, toolId, toolName, toolCategory],
  );

  const licenseBadge = form.includedFree
    ? "Included free"
    : licensed
      ? `Licensed here${periodEnd ? ` · ${periodEnd.slice(0, 10)}` : ""}`
      : "Not licensed on selected profile";

  return (
    <AdminSection
      title="Product & subscription"
      description={
        <>
          Each tool is a product with its own offer. Operators subscribe to tools; platform record caps apply only when
          unlicensed. Packs live under{" "}
          <Link className="admin-cc-link" href={adminDeepLink.subscriptions()}>
            Plans &amp; entitlements
          </Link>
          .
        </>
      }
      actions={
        <>
          {dirty ? (
            <Badge auto tone="amber">
              Unsaved
            </Badge>
          ) : null}
          <Badge auto tone={form.includedFree ? "neutral" : form.available ? "emerald" : "amber"}>
            {commercialMode}
          </Badge>
        </>
      }
    >
      <div className="admin-cc-form">
        {!sku ? (
          <Alert tone="amber" title="No commercial offer yet">
            Use Publish product in the tab bar to create this SKU.
          </Alert>
        ) : null}

        <Grid cols={4} min={120} gap={8}>
          <KpiCard
            label="List price"
            value={form.includedFree ? "Included" : inr(Number(form.priceInr || 0))}
            interactive={false}
          />
          <KpiCard
            label="This operator"
            value={
              form.includedFree
                ? "Included"
                : licensed
                  ? `Licensed${periodEnd ? ` · ${periodEnd.slice(0, 10)}` : ""}`
                  : "Unlicensed"
            }
            valueTone={!form.includedFree && licensed ? "emerald" : undefined}
            interactive={false}
          />
          <KpiCard
            label="Access policy"
            value={form.accessPolicy === "hard_lock" ? "Hard lock" : "Soft record cap"}
            interactive={false}
          />
          <KpiCard
            label="Trial"
            value={Number(form.trialDays) > 0 ? `${form.trialDays} days` : "None"}
            interactive={false}
          />
        </Grid>

        <form className="admin-cc-form" onSubmit={(e) => void saveProduct(e)}>
          <BlockLabel>Offer identity</BlockLabel>
          <FormGrid>
            <TextField
              label="Product name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <TextField
              label="Category"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
            <TextField
              full
              label="Tagline"
              value={form.tagline}
              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
              placeholder="Short value line for cart / home"
              maxLength={160}
            />
            <TextareaField
              full
              label="Description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Internal / marketing notes"
            />
          </FormGrid>

          <BlockLabel>Pricing</BlockLabel>
          <FormGrid>
            <SelectField
              label="Billing type"
              value={form.includedFree ? "1" : "0"}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  includedFree: e.target.value === "1",
                  priceInr: e.target.value === "1" ? "0" : f.priceInr,
                }))
              }
            >
              <option value="0">Paid subscription</option>
              <option value="1">Included (no charge)</option>
            </SelectField>
            <SelectField
              label="Cart visibility"
              value={form.available ? "1" : "0"}
              onChange={(e) => setForm((f) => ({ ...f, available: e.target.value === "1" }))}
            >
              <option value="1">On sale</option>
              <option value="0">Hidden from cart</option>
            </SelectField>
            <SelectField
              label="Billing interval"
              value={form.billingInterval}
              disabled={form.includedFree}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  billingInterval: e.target.value === "year" ? "year" : "month",
                }))
              }
            >
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </SelectField>
            <TextField
              label={form.billingInterval === "year" ? "Price (INR / year)" : "Price (INR / month)"}
              type="number"
              min={0}
              step="1"
              value={form.priceInr}
              disabled={form.includedFree}
              onChange={(e) => setForm((f) => ({ ...f, priceInr: e.target.value }))}
            />
            <TextField
              label="Annual price (optional)"
              type="number"
              min={0}
              step="1"
              value={form.annualPriceInr}
              disabled={form.includedFree || form.billingInterval === "year"}
              placeholder="Leave blank if unused"
              onChange={(e) => setForm((f) => ({ ...f, annualPriceInr: e.target.value }))}
            />
            <SelectField
              label="Featured in catalog"
              value={form.featured ? "1" : "0"}
              onChange={(e) => setForm((f) => ({ ...f, featured: e.target.value === "1" }))}
            >
              <option value="0">No</option>
              <option value="1">Yes</option>
            </SelectField>
            {personalUsage !== null ? (
              <SelectField
                label="User category eligibility"
                value={personalUsage ? "1" : "0"}
                disabled={personalBusy}
                onChange={(e) => void togglePersonalEligibility(e.target.value === "1")}
              >
                <option value="0">Business (GSTIN) &amp; Enterprise only</option>
                <option value="1">Personal (no-GSTIN) + Business + Enterprise</option>
              </SelectField>
            ) : null}
          </FormGrid>

          {annualPreview ? (
            <div className="admin-cc-actions" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span className="admin-cc-note-text" style={{ margin: 0 }}>
                Annual preview ({annualPreview.isDerived ? "auto 10× default" : "custom"}):{" "}
                <strong>{inr(annualPreview.annual)}/yr</strong> (~{inr(annualPreview.effectiveMo)}/mo · Save{" "}
                {inr(annualPreview.savings)} / {annualPreview.pct}%)
              </span>
              <div className="admin-cc-actions">
                <Button type="button" variant="ghost" size="sm" onClick={() => applyAnnualPreset("10x")}>
                  10× mo (2m free)
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => applyAnnualPreset("15pct")}>
                  15% off
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => applyAnnualPreset("20pct")}>
                  20% off
                </Button>
                {form.annualPriceInr.trim() !== "" ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => applyAnnualPreset("clear")}>
                    Auto
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <BlockLabel>Entitlement controls</BlockLabel>
          <FormGrid>
            <SelectField
              label="Unlicensed access"
              value={form.accessPolicy}
              disabled={form.includedFree}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  accessPolicy: e.target.value as "soft_cap" | "hard_lock",
                }))
              }
            >
              <option value="soft_cap">Soft cap (freemium records)</option>
              <option value="hard_lock">Hard lock (no creates until licensed)</option>
            </SelectField>
            <TextField
              label="Per-tool record limit override"
              type="number"
              min={0}
              step="1"
              value={form.unlicensedRecordLimit}
              disabled={form.includedFree || form.accessPolicy === "hard_lock"}
              placeholder="Platform default"
              onChange={(e) => setForm((f) => ({ ...f, unlicensedRecordLimit: e.target.value }))}
            />
            <TextField
              label="Self-serve trial (days)"
              type="number"
              min={0}
              max={365}
              value={form.trialDays}
              disabled={form.includedFree}
              onChange={(e) => setForm((f) => ({ ...f, trialDays: e.target.value }))}
            />
          </FormGrid>
          <p className="admin-cc-note-text">
            Soft cap uses the platform free limit (or override). Hard lock sets the effective limit to zero until a license
            is active. Trial days are stored on the product for checkout / admin grants.
          </p>
        </form>

        <BlockLabel>Subscription for this Business Profile</BlockLabel>
        <p className="admin-cc-note-text">
          Grant, trial, extend, or revoke this product for the selected profile without leaving Tools. Packs and platform
          Freemium / All Tools modes live under{" "}
          <Link href={adminDeepLink.subscriptions()}>Plans &amp; entitlements</Link>.
          {seatCount != null && seatCount > 0
            ? ` This product currently has ${seatCount} licensed seat(s) across the org.`
            : ""}
        </p>
        <FormGrid>
          <SelectField
            full
            label="Business Profile"
            value={businessProfileId ?? ""}
            disabled={profiles.length === 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v > 0) onBusinessProfileChange(v);
            }}
          >
            <option value="">{profiles.length === 0 ? "No profiles" : "Select a Business Profile…"}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.organizationName ? `${p.organizationName} — ` : ""}
                {p.businessName}
                {p.isDefault ? " (default)" : ""}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Grant / extend days"
            type="number"
            min={1}
            value={grantDays}
            disabled={form.includedFree || businessProfileId == null}
            onChange={(e) => setGrantDays(e.target.value)}
          />
          <TextField
            label="Profile record-limit override"
            type="number"
            min={0}
            step="1"
            value={profileLimit}
            disabled={businessProfileId == null}
            placeholder="Platform / SKU default"
            onChange={(e) => setProfileLimit(e.target.value)}
          />
        </FormGrid>
        <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
          <span className="admin-cc-switch-row" style={{ paddingBottom: 0 }}>
            <Switch
              checked={syncHome}
              disabled={businessProfileId == null}
              onChange={setSyncHome}
              aria-label="Sync home on grant / trial"
            />
            Sync home on grant / trial
          </span>
          <Badge auto tone={form.includedFree ? "neutral" : licensed ? "emerald" : "neutral"}>
            {licenseBadge}
          </Badge>
          {recordLimitOverride != null ? (
            <Badge auto tone="blue">
              Override {recordLimitOverride} records
            </Badge>
          ) : null}
        </div>
        <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
          {form.includedFree ? (
            <Badge auto tone="neutral">
              No license required
            </Badge>
          ) : licensed ? (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={licenseBusy || businessProfileId == null}
                onClick={() =>
                  void runLicense(`Extended ${toolName}.`, async (profileId) => {
                    await api("/admin/skus/extend", {
                      method: "POST",
                      body: JSON.stringify({
                        toolIds: [toolId],
                        days: Math.max(1, Math.floor(Number(grantDays) || 30)),
                        businessProfileId: profileId,
                      }),
                    });
                  })
                }
              >
                Extend
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={licenseBusy || businessProfileId == null}
                onClick={() =>
                  void runLicense(`Revoked ${toolName}.`, async (profileId) => {
                    await api("/admin/skus/revoke", {
                      method: "POST",
                      body: JSON.stringify({
                        toolIds: [toolId],
                        businessProfileId: profileId,
                      }),
                    });
                  })
                }
              >
                Revoke
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={licenseBusy || businessProfileId == null}
                onClick={() =>
                  void runLicense(`Licensed ${toolName}.`, async (profileId) => {
                    await api("/admin/skus/grant", {
                      method: "POST",
                      body: JSON.stringify({
                        toolIds: [toolId],
                        days: Math.max(1, Math.floor(Number(grantDays) || 30)),
                        businessProfileId: profileId,
                      }),
                    });
                    await maybeSyncHome(profileId);
                  })
                }
              >
                Grant
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={licenseBusy || businessProfileId == null}
                onClick={() =>
                  void runLicense(`Trial started for ${toolName}.`, async (profileId) => {
                    await api("/admin/skus/grant", {
                      method: "POST",
                      body: JSON.stringify({
                        toolIds: [toolId],
                        days: Math.max(1, Number(sku?.trialDays) || Number(form.trialDays) || 14),
                        preferTrial: true,
                        businessProfileId: profileId,
                      }),
                    });
                    await maybeSyncHome(profileId);
                  })
                }
              >
                Start trial
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={licenseBusy || businessProfileId == null}
            onClick={() => void saveRecordLimit()}
          >
            Save record limit
          </Button>
          <Link href={adminDeepLink.toolCapabilities(businessProfileId ?? undefined, toolId)}>
            <Button variant="ghost" size="sm">
              Open in Access Fabric
            </Button>
          </Link>
        </div>

        {packsForTool.length > 0 ? (
          <>
            <BlockLabel>Included in packs</BlockLabel>
            <div className="admin-cc-stack">
              {packsForTool.map((b) => (
                <div key={b.id} className="admin-cc-row" style={{ cursor: "default" }}>
                  <div className="admin-cc-row-main">
                    <div className="admin-cc-cell-title">{b.name}</div>
                    <div className="admin-cc-cell-sub">
                      {b.id === "all_tools" ? "All paid tools" : `${b.toolIds.length} tools`} · {inr(b.priceInr)}
                      {b.listPriceInr > b.priceInr ? ` (list ${inr(b.listPriceInr)})` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <Link href={adminDeepLink.subscriptions()}>
                <Button variant="ghost" size="sm">
                  Manage packs
                </Button>
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </AdminSection>
  );
});
