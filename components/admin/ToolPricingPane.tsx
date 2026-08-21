"use client";

import Link from "next/link";
import { api } from "@/lib/api";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export type SkuState = {
  toolId: string;
  name: string;
  category: string;
  priceInr: number;
  billingInterval: string;
  includedFree: boolean;
  available: boolean;
};

export function ToolPricingPane({
  sku,
  licensed,
  periodEnd,
  priceDraft,
  onPriceDraft,
  onReload,
  onMessage,
}: {
  sku: SkuState | null;
  licensed: boolean;
  periodEnd: string | null;
  priceDraft: string;
  onPriceDraft: (v: string) => void;
  onReload: () => Promise<void>;
  onMessage: (msg: string) => void;
}) {
  if (!sku) {
    return (
      <section className="panel admin-card tm-pane">
        <h2>Pricing</h2>
        <p className="muted">No commercial SKU for this tool yet. It is treated as included until a price is published.</p>
      </section>
    );
  }

  const row = sku;

  async function saveSku(patch: Partial<SkuState> & { priceInr?: number }) {
    await api(`/admin/skus/${row.toolId}`, {
      method: "PUT",
      body: JSON.stringify({
        priceInr: patch.priceInr ?? row.priceInr,
        includedFree: patch.includedFree ?? row.includedFree,
        available: patch.available ?? row.available,
        billingInterval: row.billingInterval,
      }),
    });
    onMessage(`${row.name} commercial settings saved.`);
    await onReload();
  }

  async function grant() {
    await api("/admin/skus/grant", {
      method: "POST",
      body: JSON.stringify({ toolIds: [row.toolId], days: 30 }),
    });
    onMessage(`${row.name} licensed for this operator (30 days).`);
    await onReload();
  }

  async function revoke() {
    await api("/admin/skus/revoke", {
      method: "POST",
      body: JSON.stringify({ toolIds: [row.toolId] }),
    });
    onMessage(`${row.name} license revoked.`);
    await onReload();
  }

  return (
    <section className="panel admin-card tm-pane">
      <h2>Pricing</h2>
      <p className="muted">
        Monthly subscription for this tool only. Cart total is the sum of selected SKUs. Record cap for unlicensed tools
        is on <Link href="/admin/subscriptions">Subscriptions</Link>.
      </p>

      <dl className="billing-dl billing-dl-row">
        <div>
          <dt>List price</dt>
          <dd>{sku.includedFree ? "Included" : inr(sku.priceInr)}</dd>
        </div>
        <div>
          <dt>This operator</dt>
          <dd>{licensed ? `Licensed${periodEnd ? ` · ${periodEnd.slice(0, 10)}` : ""}` : "Unlicensed"}</dd>
        </div>
        <div>
          <dt>Cart</dt>
          <dd>{sku.available ? "On sale" : "Hidden from cart"}</dd>
        </div>
      </dl>

      <div className="admin-form-grid">
        <label className="field">
          <span>Billing type</span>
          <select
            value={sku.includedFree ? "1" : "0"}
            onChange={(e) => void saveSku({ includedFree: e.target.value === "1" })}
          >
            <option value="0">Subscription</option>
            <option value="1">Included (no charge)</option>
          </select>
        </label>
        <label className="field">
          <span>On sale in operator cart</span>
          <select
            value={sku.available ? "1" : "0"}
            onChange={(e) => void saveSku({ available: e.target.value === "1" })}
          >
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </label>
        <label className="field">
          <span>Price (INR / month)</span>
          <input
            type="number"
            min={0}
            step="1"
            value={priceDraft}
            disabled={sku.includedFree}
            onChange={(e) => onPriceDraft(e.target.value)}
          />
        </label>
      </div>
      <div className="admin-form-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={sku.includedFree}
          onClick={() => void saveSku({ priceInr: Number(priceDraft || 0) })}
        >
          Save price
        </button>
        {licensed ? (
          <button type="button" className="btn btn-secondary" onClick={() => void revoke()}>
            Revoke license
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={sku.includedFree} onClick={() => void grant()}>
            Grant 30-day license
          </button>
        )}
      </div>
    </section>
  );
}
