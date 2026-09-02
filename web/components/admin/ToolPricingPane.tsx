"use client";

import Link from "next/link";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
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

type FormState = {
  name: string;
  category: string;
  tagline: string;
  description: string;
  priceInr: string;
  annualPriceInr: string;
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
    bundles: BundleState[];
    onReload: () => Promise<void>;
    onMessage: (msg: string) => void;
  }
>(function ToolPricingPane(
  { toolId, toolName, toolCategory, sku, licensed, periodEnd, bundles, onReload, onMessage },
  ref,
) {
  const [form, setForm] = useState<FormState>(() => formFromSku(sku, toolName, toolCategory));
  const [grantDays, setGrantDays] = useState("30");
  const [saving, setSaving] = useState(false);
  const savedSnap = useRef("");

  useEffect(() => {
    const next = formFromSku(sku, toolName, toolCategory);
    setForm(next);
    savedSnap.current = JSON.stringify(next);
  }, [sku, toolId, toolName, toolCategory]);

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
        billingInterval: "month",
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
      onMessage(err instanceof Error ? err.message : "Save failed");
      throw err;
    } finally {
      setSaving(false);
    }
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

  async function grant(days: number) {
    setSaving(true);
    try {
      await api("/admin/skus/grant", {
        method: "POST",
        body: JSON.stringify({ toolIds: [toolId], days }),
      });
      onMessage(`${toolName} licensed for ${days} day(s).`);
      await onReload();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setSaving(false);
    }
  }

  async function grantTrial() {
    setSaving(true);
    try {
      await api("/admin/skus/grant", {
        method: "POST",
        body: JSON.stringify({
          toolIds: [toolId],
          days: Number(form.trialDays) || 14,
          preferTrial: true,
        }),
      });
      onMessage(`${toolName} trial license granted.`);
      await onReload();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Trial grant failed");
    } finally {
      setSaving(false);
    }
  }

  async function extend(days: number) {
    setSaving(true);
    try {
      await api("/admin/skus/extend", {
        method: "POST",
        body: JSON.stringify({ toolIds: [toolId], days }),
      });
      onMessage(`${toolName} license extended by ${days} day(s).`);
      await onReload();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Extend failed");
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    try {
      await api("/admin/skus/revoke", {
        method: "POST",
        body: JSON.stringify({ toolIds: [toolId] }),
      });
      onMessage(`${toolName} license revoked.`);
      await onReload();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel admin-card tm-pane tm-product-pane">
      <div className="tm-product-head">
        <div>
          <h2>Product & subscription</h2>
          <p className="muted">
            Each tool is a product with its own offer. Operators subscribe to tools; platform record caps apply only when
            unlicensed. Packs live under{" "}
            <Link href="/admin/subscriptions">Operator access</Link>.
          </p>
        </div>
        <div className="admin-form-row">
          {dirty ? <span className="pill pill-warning">Unsaved</span> : null}
          <span className={`pill ${form.includedFree ? "" : form.available ? "pill-success" : "pill-warning"}`}>
            {commercialMode}
          </span>
        </div>
      </div>

      {!sku ? (
        <p className="muted tm-product-banner">
          No commercial offer yet — use Publish product in the tab bar to create this SKU.
        </p>
      ) : null}

      <dl className="billing-dl billing-dl-row">
        <div>
          <dt>List price</dt>
          <dd>{form.includedFree ? "Included" : inr(Number(form.priceInr || 0))}</dd>
        </div>
        <div>
          <dt>This operator</dt>
          <dd>
            {form.includedFree
              ? "Included"
              : licensed
                ? `Licensed${periodEnd ? ` · ${periodEnd.slice(0, 10)}` : ""}`
                : "Unlicensed"}
          </dd>
        </div>
        <div>
          <dt>Access policy</dt>
          <dd>{form.accessPolicy === "hard_lock" ? "Hard lock" : "Soft record cap"}</dd>
        </div>
        <div>
          <dt>Trial</dt>
          <dd>{Number(form.trialDays) > 0 ? `${form.trialDays} days` : "None"}</dd>
        </div>
      </dl>

      <form className="tm-product-form" onSubmit={(e) => void saveProduct(e)}>
        <h3 className="tm-section-title">Offer identity</h3>
        <div className="admin-form-grid">
          <label className="field">
            <span>Product name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Category</span>
            <input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          </label>
          <label className="field field-span-2">
            <span>Tagline</span>
            <input
              value={form.tagline}
              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
              placeholder="Short value line for cart / home"
              maxLength={160}
            />
          </label>
          <label className="field field-span-2">
            <span>Description</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Internal / marketing notes"
            />
          </label>
        </div>

        <h3 className="tm-section-title">Pricing</h3>
        <div className="admin-form-grid">
          <label className="field">
            <span>Billing type</span>
            <select
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
            </select>
          </label>
          <label className="field">
            <span>Cart visibility</span>
            <select
              value={form.available ? "1" : "0"}
              onChange={(e) => setForm((f) => ({ ...f, available: e.target.value === "1" }))}
            >
              <option value="1">On sale</option>
              <option value="0">Hidden from cart</option>
            </select>
          </label>
          <label className="field">
            <span>Price (INR / month)</span>
            <input
              type="number"
              min={0}
              step="1"
              value={form.priceInr}
              disabled={form.includedFree}
              onChange={(e) => setForm((f) => ({ ...f, priceInr: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Annual price (optional)</span>
            <input
              type="number"
              min={0}
              step="1"
              value={form.annualPriceInr}
              disabled={form.includedFree}
              placeholder="Leave blank if unused"
              onChange={(e) => setForm((f) => ({ ...f, annualPriceInr: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Featured in catalog</span>
            <select
              value={form.featured ? "1" : "0"}
              onChange={(e) => setForm((f) => ({ ...f, featured: e.target.value === "1" }))}
            >
              <option value="0">No</option>
              <option value="1">Yes</option>
            </select>
          </label>
        </div>

        <h3 className="tm-section-title">Entitlement controls</h3>
        <div className="admin-form-grid">
          <label className="field">
            <span>Unlicensed access</span>
            <select
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
            </select>
          </label>
          <label className="field">
            <span>Per-tool record limit override</span>
            <input
              type="number"
              min={0}
              step="1"
              value={form.unlicensedRecordLimit}
              disabled={form.includedFree || form.accessPolicy === "hard_lock"}
              placeholder="Platform default"
              onChange={(e) => setForm((f) => ({ ...f, unlicensedRecordLimit: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Self-serve trial (days)</span>
            <input
              type="number"
              min={0}
              max={365}
              value={form.trialDays}
              disabled={form.includedFree}
              onChange={(e) => setForm((f) => ({ ...f, trialDays: e.target.value }))}
            />
          </label>
        </div>
        <p className="muted tm-hint">
          Soft cap uses the platform free limit (or override). Hard lock sets the effective limit to zero until a license
          is active. Trial days are stored on the product for checkout / admin grants.
        </p>
      </form>

      <div className="tm-license-ops">
        <h3 className="tm-section-title">Operator license</h3>
        <p className="muted">
          Grants entitlement for the active admin organization only. Does not change list price.
        </p>
        <div className="admin-form-grid">
          <label className="field">
            <span>Days</span>
            <input
              type="number"
              min={1}
              value={grantDays}
              disabled={form.includedFree}
              onChange={(e) => setGrantDays(e.target.value)}
            />
          </label>
        </div>
        <div className="admin-form-row">
          {licensed ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving || form.includedFree}
                onClick={() => void extend(Number(grantDays) || 30)}
              >
                Extend license
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving || form.includedFree}
                onClick={() => void revoke()}
              >
                Revoke
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving || form.includedFree}
              onClick={() => void grant(Number(grantDays) || 30)}
            >
              Grant license
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={saving || form.includedFree}
            onClick={() => void grantTrial()}
          >
            Grant trial ({Number(form.trialDays) || 14}d)
          </button>
        </div>
      </div>

      {packsForTool.length > 0 ? (
        <div className="tm-pack-refs">
          <h3 className="tm-section-title">Included in packs</h3>
          <ul className="tm-pack-list">
            {packsForTool.map((b) => (
              <li key={b.id}>
                <strong>{b.name}</strong>
                <span className="muted">
                  {b.id === "all_tools" ? " · all paid tools" : ` · ${b.toolIds.length} tools`} · {inr(b.priceInr)}
                  {b.listPriceInr > b.priceInr ? ` (list ${inr(b.listPriceInr)})` : ""}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/admin/subscriptions" className="btn btn-ghost btn-sm">
            Manage packs
          </Link>
        </div>
      ) : null}
    </section>
  );
});
