"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { BillingStepper } from "@/components/subscription/BillingStepper";
import { useSubscription } from "@/hooks/useSubscription";
import { cancelProSubscription, fetchCartQuote, startToolTrial } from "@/lib/api";
import {
  addToToolCart,
  clearToolCart,
  readActivePack,
  readToolCart,
  removeFromToolCart,
  setPackCart,
  writeToolCart,
} from "@/lib/tool-cart";
import { SUBSCRIPTION_SYNCED_EVENT } from "@/lib/subscription-cache";
import type { CartQuote, ProductPack, ToolCatalogSku } from "@/lib/types/subscription";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function groupCatalog(items: ToolCatalogSku[]) {
  const map = new Map<string, ToolCatalogSku[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries());
}

export default function SubscriptionPage() {
  const { subscription, loading, error, isToolLicensed, refresh } = useSubscription();
  const { showToast } = useToast();
  const [cart, setCart] = useState<string[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [trialBusy, setTrialBusy] = useState<string | null>(null);

  const catalog = subscription?.catalog ?? [];
  const packs = subscription?.packs ?? [];
  const pending = subscription?.pendingClaim;

  useEffect(() => {
    const stored = readToolCart();
    const params = new URLSearchParams(window.location.search);
    const addParam = params.get("add");
    if (addParam) {
      setCart(addToToolCart(addParam));
      setActivePack(null);
      return;
    }
    setCart(stored);
    setActivePack(readActivePack());
  }, []);

  useEffect(() => {
    const onSync = () => {
      setCart(readToolCart());
      setActivePack(readActivePack());
    };
    const onResolved = () => {
      setCart(readToolCart());
      setActivePack(readActivePack());
      showToast("Payment verified — tool licenses are now active");
      void refresh();
    };
    window.addEventListener("jbt-cart-change", onSync);
    window.addEventListener(SUBSCRIPTION_SYNCED_EVENT, onSync);
    window.addEventListener("jbt:upi-claim-resolved", onResolved);
    return () => {
      window.removeEventListener("jbt-cart-change", onSync);
      window.removeEventListener(SUBSCRIPTION_SYNCED_EVENT, onSync);
      window.removeEventListener("jbt:upi-claim-resolved", onResolved);
    };
  }, [refresh, showToast]);

  const payableIds = useMemo(() => {
    if (catalog.length === 0) return cart;
    const allowed = new Set(
      catalog.filter((s) => !s.includedFree && !s.licensed && s.priceInr > 0).map((s) => s.toolId),
    );
    return cart.filter((id) => allowed.has(id));
  }, [cart, catalog]);

  useEffect(() => {
    if (catalog.length === 0) return;
    if (payableIds.length !== cart.length) {
      writeToolCart(payableIds);
      setCart(payableIds);
      if (payableIds.length === 0) setActivePack(null);
    }
  }, [catalog.length, payableIds, cart.length]);

  const loadQuote = useCallback(async (ids: string[], packId: string | null) => {
    if (ids.length === 0 && !packId) {
      setQuote(null);
      setQuoteError("");
      return;
    }
    try {
      const data = await fetchCartQuote(ids, packId || undefined);
      setQuote(data);
      setQuoteError("");
    } catch (err) {
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : "Could not price the cart");
    }
  }, []);

  useEffect(() => {
    void loadQuote(payableIds, activePack);
  }, [payableIds, activePack, loadQuote]);

  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const licensedCount = catalog.filter((s) => s.licensed && !s.includedFree).length;
  const includedCount = catalog.filter((s) => s.includedFree).length;

  function toggle(sku: ToolCatalogSku) {
    if (sku.licensed || sku.includedFree) return;
    const next = cart.includes(sku.toolId) ? removeFromToolCart(sku.toolId) : addToToolCart(sku.toolId);
    setCart(next);
    setActivePack(null);
  }

  function addPack(pack: ProductPack) {
    const remaining = pack.toolIds.filter((id) => {
      const sku = catalog.find((s) => s.toolId === id);
      return sku && !sku.includedFree && !sku.licensed && sku.priceInr > 0;
    });
    if (remaining.length === 0) {
      showToast("Every tool in this pack is already licensed");
      return;
    }
    const next = setPackCart(pack.id, remaining);
    setCart(next);
    setActivePack(pack.id);
    showToast(`${pack.name} added — pack pricing applied at checkout`);
  }

  async function handleTrial(sku: ToolCatalogSku) {
    if (!sku.trialEligible) return;
    setTrialBusy(sku.toolId);
    try {
      await startToolTrial(sku.toolId);
      showToast(`${sku.trialDays}-day trial started for ${sku.name}`);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start trial");
    } finally {
      setTrialBusy(null);
    }
  }

  async function handleCancelLicenses() {
    setBusy(true);
    try {
      await cancelProSubscription();
      clearToolCart();
      setCart([]);
      setActivePack(null);
      showToast("Paid tool licenses cancelled");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="billing-page billing-store">
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">Subscribe to tools</div>
          <div className="tool-header-sub">
            Choose tools or a pack. Trials unlock access without charging MRR until you subscribe.
          </div>
        </div>
      </div>

      {loading ? <p className="muted">Loading catalog…</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {subscription ? (
        <>
          <BillingStepper current={pending?.status === "pending" ? 3 : 1} pending={pending?.status === "pending"} />

          {pending?.status === "pending" ? (
            <div className="billing-pending">
              <p className="billing-pending-kicker">Payment under review</p>
              <h3>UTR {pending.utr} is with JustXSystems accounts</h3>
              <p className="muted">You can review the order on the checkout page. Tools license after verification.</p>
              <Link href="/subscription/checkout" className="btn btn-primary btn-sm">
                View checkout
              </Link>
            </div>
          ) : null}
          <section className="billing-account card">
            <div className="billing-account-head">
              <div>
                <p className="card-label">Workspace entitlement</p>
                <p className="card-value">
                  {licensedCount} licensed tool{licensedCount === 1 ? "" : "s"}
                  {includedCount ? ` · ${includedCount} included` : ""}
                </p>
              </div>
              <span className={pending?.status === "pending" ? "pill pill-warning" : licensedCount ? "pill pill-success" : "pill"}>
                {pending?.status === "pending"
                  ? "Payment under review"
                  : licensedCount
                    ? "Subscribed"
                    : "Freemium"}
              </span>
            </div>
            <dl className="billing-dl billing-dl-row">
              <div>
                <dt>Unlicensed tools</dt>
                <dd>
                  {subscription.recordLimit != null
                    ? `${subscription.recordLimit} saved records each`
                    : "Limited records"}
                </dd>
              </div>
              <div>
                <dt>Licensed tools</dt>
                <dd>Unlimited records · CSV / Excel</dd>
              </div>
              <div>
                <dt>MRR</dt>
                <dd>{inr(subscription.mrrInr ?? 0)}</dd>
              </div>
            </dl>
            {(subscription.billingItems?.length ?? 0) > 0 ? (
              <div className="billing-lines">
                <p className="card-label">Active subscriptions</p>
                <ul className="billing-line-list">
                  {subscription.billingItems!.map((item) => (
                    <li key={item.toolId}>
                      <strong>{item.name}</strong>
                      <span>
                        {item.source === "trial"
                          ? `Trial · until ${item.periodEnd?.slice(0, 10) ?? "—"}`
                          : `${inr(item.unitPriceInr)}/mo${item.periodEnd ? ` · until ${item.periodEnd.slice(0, 10)}` : ""}`}
                        {item.source && item.source !== "trial" ? ` · ${item.source}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {licensedCount > 0 ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void handleCancelLicenses()}>
                Cancel paid licenses
              </button>
            ) : null}
          </section>

          {packs.length > 0 ? (
            <section className="store-packs">
              <h2 className="billing-section-title">Product packs</h2>
              <p className="muted">Bundles apply pack pricing at checkout for tools you do not already license.</p>
              <div className="store-packs-grid">
                {packs.map((pack) => {
                  const remaining = pack.toolIds.filter((id) => {
                    const sku = catalog.find((s) => s.toolId === id);
                    return sku && !sku.includedFree && !sku.licensed && sku.priceInr > 0;
                  });
                  const selected = activePack === pack.id;
                  return (
                    <article key={pack.id} className={`store-pack${selected ? " is-selected" : ""}${pack.highlighted ? " is-featured" : ""}`}>
                      <div className="store-pack-top">
                        <div>
                          <strong>{pack.name}</strong>
                          {pack.tagline ? <p className="muted store-pack-tagline">{pack.tagline}</p> : null}
                        </div>
                        <div className="store-pack-price">
                          <strong>{inr(pack.priceInr)}</strong>
                          {pack.savingsInr > 0 ? <em>Save {inr(pack.savingsInr)}</em> : null}
                        </div>
                      </div>
                      <p className="store-pack-meta">
                        {remaining.length} of {pack.toolCount} tools available
                        {pack.discountPct > 0 ? ` · ${pack.discountPct}% off` : ""}
                      </p>
                      <button
                        type="button"
                        className={selected ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
                        disabled={remaining.length === 0}
                        onClick={() => addPack(pack)}
                      >
                        {remaining.length === 0 ? "Fully licensed" : selected ? "Pack in cart" : "Add pack"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="store-layout">
            <div className="store-catalog">
              <h2 className="billing-section-title">Tool catalog</h2>
              <p className="muted">Add paid tools à la carte, or start a trial where offered.</p>
              {groups.map(([category, tools]) => (
                <section key={category} className="store-category">
                  <h3>{category}</h3>
                  <div className="store-grid">
                    {tools.map((sku) => {
                      const inCart = cart.includes(sku.toolId);
                      return (
                        <article key={sku.toolId} className={`store-sku${sku.licensed ? " is-licensed" : ""}${inCart ? " is-cart" : ""}`}>
                          <div className="store-sku-top">
                            <strong>{sku.name}</strong>
                            {sku.includedFree ? (
                              <span className="pill">Included</span>
                            ) : sku.licensed || isToolLicensed(sku.toolId) ? (
                              <span className="pill pill-success">Licensed</span>
                            ) : (
                              <span className="store-sku-price">
                                {inr(sku.priceInr)}
                                <em>/{sku.billingInterval}</em>
                              </span>
                            )}
                          </div>
                          {!sku.includedFree && !sku.licensed ? (
                            <div className="store-sku-actions">
                              {sku.trialEligible ? (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={trialBusy === sku.toolId}
                                  onClick={() => void handleTrial(sku)}
                                >
                                  Start {sku.trialDays}-day trial
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={inCart ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"}
                                onClick={() => toggle(sku)}
                              >
                                {inCart ? "Remove" : "Add to cart"}
                              </button>
                            </div>
                          ) : (
                            <p className="muted store-sku-note">
                              {sku.includedFree ? "No subscription required" : "Unlimited on this workspace"}
                            </p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <aside className="store-cart card">
              <h2>Cart</h2>
              {activePack && quote?.packName ? (
                <p className="store-cart-pack">{quote.packName} pricing</p>
              ) : null}
              {payableIds.length === 0 ? (
                <p className="muted">Select tools or a pack to build a monthly subscription.</p>
              ) : (
                <ul className="billing-line-items">
                  {payableIds.map((id) => {
                    const sku = catalog.find((s) => s.toolId === id);
                    const line = quote?.lines.find((l) => l.toolId === id);
                    if (!sku) return null;
                    return (
                      <li key={id}>
                        <span>{sku.name}</span>
                        <strong>{inr(line?.priceInr ?? sku.priceInr)}</strong>
                      </li>
                    );
                  })}
                </ul>
              )}
              {quote?.savingsInr && quote.savingsInr > 0 ? (
                <p className="store-cart-savings">Pack savings {inr(quote.savingsInr)}</p>
              ) : null}
              <div className="store-cart-total">
                <span>Due now</span>
                <strong>{inr(quote?.totalInr ?? 0)}</strong>
              </div>
              {quoteError ? <p className="field-error">{quoteError}</p> : null}
              {quote && payableIds.length > 0 ? (
                <Link className="btn btn-primary" href="/subscription/checkout">
                  Checkout
                </Link>
              ) : (
                <button type="button" className="btn btn-primary" disabled>
                  Checkout
                </button>
              )}
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}
