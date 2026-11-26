"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/components/common/ToastProvider";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { BillingStepper } from "@/components/subscription/BillingStepper";
import { BillingHistoryPanel } from "@/components/subscription/BillingHistoryPanel";
import { StoreCartDock } from "@/components/subscription/StoreCartDock";
import { useSubscription } from "@/hooks/useSubscription";
import { cancelProSubscription, fetchCartQuote, startToolTrial } from "@/lib/api";
import { catalogPriceFingerprint } from "@/lib/commerce-revision";
import { groupItemsByKey } from "@/lib/group-items";
import { isPersonalAccount } from "@/lib/personal-account";
import { SUBSCRIPTION_SYNCED_EVENT } from "@/lib/subscription-cache";
import {
  describeToolUsage,
  describeUserCategory,
  filterStoreCatalog,
  filterStorePacks,
  formatInr,
  resolveClientPackPrice,
  resolveClientSkuPrice,
  type CatalogScope,
  type StoreFilterChip,
} from "@/lib/subscription-store-helpers";
import {
  addToToolCart,
  clearToolCart,
  readActivePack,
  readBillingCycle,
  readToolCart,
  removeFromToolCart,
  setPackCart,
  writeBillingCycle,
  writeToolCart,
} from "@/lib/tool-cart";
import type {
  BillingCycle,
  CartQuote,
  ProductPack,
  ToolCatalogSku,
  UserCategory,
} from "@/lib/types/subscription";
import { useBrandCopy } from "@/lib/use-brand-copy";

const FILTER_CHIPS: Array<{ id: StoreFilterChip; label: string }> = [
  { id: "all", label: "All tools" },
  { id: "active", label: "Active & trials" },
  { id: "trial_ready", label: "Free trial available" },
  { id: "usage_alerts", label: "Usage alerts" },
  { id: "paid", label: "Paid add-ons" },
  { id: "included", label: "Included free" },
];

export default function SubscriptionPage() {
  const { user } = useAuth();
  const { config } = usePlatformConfig();
  const { appName } = useBrandCopy();
  const groupProducts = config?.toolGrouping?.enabled !== false;
  const { subscription, loading, error, isToolLicensed, refresh } = useSubscription();
  const { showToast } = useToast();

  const [cart, setCart] = useState<string[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelingToolId, setCancelingToolId] = useState<string | null>(null);
  const [trialBusy, setTrialBusy] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterChip, setFilterChip] = useState<StoreFilterChip>("all");
  const [scope, setScope] = useState<CatalogScope>("personal");

  const catalog = subscription?.catalog ?? [];
  const packs = subscription?.packs ?? [];
  const pending = subscription?.pendingClaim;
  const usageSummary = subscription?.usageSummary;

  const userCategory: UserCategory = useMemo(() => {
    if (subscription?.userCategory) return subscription.userCategory;
    if (isPersonalAccount(user, subscription?.gstin)) return "individual";
    return (subscription?.branchCount ?? user?.branches?.length ?? 1) >= 2
      ? "enterprise"
      : "business";
  }, [subscription?.userCategory, subscription?.gstin, subscription?.branchCount, user]);

  const isIndividual = userCategory === "individual";
  const effectiveScope: CatalogScope = isIndividual ? scope : "all";
  const categoryMeta = useMemo(
    () => describeUserCategory(userCategory, subscription?.branchCount ?? user?.branches?.length ?? 1),
    [userCategory, subscription?.branchCount, user?.branches?.length],
  );

  const priceFingerprint = useMemo(
    () => catalogPriceFingerprint(catalog, packs),
    [catalog, packs],
  );

  // Always pull latest catalog & telemetry when opening the storefront.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const stored = readToolCart();
    setBillingCycle(readBillingCycle());
    const params = new URLSearchParams(window.location.search);
    const addParam = params.get("add");
    const cycleParam = params.get("cycle");
    if (cycleParam === "year" || cycleParam === "month") {
      setBillingCycle(writeBillingCycle(cycleParam));
    }
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
      setBillingCycle(readBillingCycle());
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
      catalog
        .filter((s) => !s.includedFree && s.priceInr > 0 && (!s.licensed || s.canConvertOrRenew))
        .map((s) => s.toolId),
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

  const loadQuote = useCallback(
    async (ids: string[], packId: string | null, cycle: BillingCycle) => {
      if (ids.length === 0 && !packId) {
        setQuote(null);
        setQuoteError("");
        return;
      }
      try {
        const data = await fetchCartQuote(ids, packId || undefined, cycle);
        setQuote(data);
        setQuoteError("");
      } catch (err) {
        setQuote(null);
        setQuoteError(err instanceof Error ? err.message : "Could not price the cart");
      }
    },
    [],
  );

  useEffect(() => {
    void loadQuote(payableIds, activePack, billingCycle);
  }, [payableIds, activePack, billingCycle, priceFingerprint, loadQuote]);

  const filteredCatalog = useMemo(
    () =>
      filterStoreCatalog(catalog, {
        query: searchQuery,
        chip: filterChip,
        userCategory,
        scope: effectiveScope,
      }),
    [catalog, searchQuery, filterChip, userCategory, effectiveScope],
  );

  const visiblePacks = useMemo(
    () => filterStorePacks(packs, { userCategory, scope: effectiveScope }),
    [packs, userCategory, effectiveScope],
  );

  const groups = useMemo(
    () => groupItemsByKey(filteredCatalog, (s) => s.category || "General", groupProducts, "Products"),
    [filteredCatalog, groupProducts],
  );

  const licensedCount = catalog.filter((s) => s.licensed && !s.includedFree).length;
  const includedCount = catalog.filter((s) => s.includedFree).length;
  const alertCount =
    (usageSummary?.toolsNearLimit ?? 0) +
    (usageSummary?.toolsAtLimit ?? 0) +
    (usageSummary?.trialsExpiringSoon ?? 0);

  function handleCycleChange(next: BillingCycle) {
    setBillingCycle(writeBillingCycle(next));
  }

  function toggle(sku: ToolCatalogSku) {
    if (sku.includedFree || (sku.licensed && !sku.canConvertOrRenew)) return;
    if (isIndividual && sku.personalUsage === false) {
      showToast("Add a Business GSTIN in Profile to subscribe to business-only tools");
      return;
    }
    const next = cart.includes(sku.toolId) ? removeFromToolCart(sku.toolId) : addToToolCart(sku.toolId);
    setCart(next);
    setActivePack(null);
  }

  function addPack(pack: ProductPack) {
    const remaining = pack.toolIds.filter((id) => {
      const sku = catalog.find((s) => s.toolId === id);
      return sku && !sku.includedFree && sku.priceInr > 0 && (!sku.licensed || sku.canConvertOrRenew);
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

  function applyRecommendedPack(packId: string) {
    const pack = packs.find((p) => p.id === packId);
    if (pack) addPack(pack);
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

  const eligibleTrialTools = useMemo(
    () =>
      filteredCatalog.filter(
        (s) => s.trialEligible && !(isIndividual && s.personalUsage === false),
      ),
    [filteredCatalog, isIndividual],
  );

  async function handleStartAllTrials() {
    if (eligibleTrialTools.length === 0) return;
    setTrialBusy("__all__");
    try {
      const res = await startToolTrial(eligibleTrialTools.map((s) => s.toolId));
      showToast(
        `Started free trials for ${res.granted.length} tool${res.granted.length === 1 ? "" : "s"}`,
      );
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start trials");
    } finally {
      setTrialBusy(null);
    }
  }

  async function handleCancelSingleTool(toolId: string, toolName: string) {
    setCancelingToolId(toolId);
    try {
      await cancelProSubscription([toolId]);
      showToast(`Cancelled license for ${toolName}`);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not cancel license");
    } finally {
      setCancelingToolId(null);
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

  const dueNow = quote
    ? quote.totalInr
    : payableIds.reduce((sum, id) => {
        const sku = catalog.find((s) => s.toolId === id);
        return sum + (sku ? resolveClientSkuPrice(sku, billingCycle).priceInr : 0);
      }, 0);

  const cartLines = payableIds
    .map((id) => {
      const sku = catalog.find((s) => s.toolId === id);
      const line = quote?.lines.find((l) => l.toolId === id);
      if (!sku) return null;
      const displayPrice =
        activePack && line
          ? line.priceInr
          : line?.priceInr ?? resolveClientSkuPrice(sku, billingCycle).priceInr;
      return { id, name: sku.name, priceLabel: formatInr(displayPrice) };
    })
    .filter(Boolean) as { id: string; name: string; priceLabel: string }[];

  const coverageLabel = quote?.periodEndPreview
    ? `${quote.durationDays ?? (billingCycle === "year" ? 365 : 30)} days · until ${quote.periodEndPreview.slice(0, 10)}`
    : billingCycle === "year"
      ? "365 days coverage"
      : "30 days coverage";

  return (
    <div className="billing-page billing-store">
      <StoreCartDock
        itemCount={payableIds.length}
        totalLabel={formatInr(dueNow)}
        billingCycle={billingCycle}
        onBillingCycleChange={handleCycleChange}
        packLabel={activePack && quote?.packName ? quote.packName : null}
        savingsLabel={
          quote?.savingsInr && quote.savingsInr > 0
            ? `Pack savings ${formatInr(quote.savingsInr)}`
            : null
        }
        annualSavingsLabel={
          billingCycle === "year" && quote?.annualSavingsInr && quote.annualSavingsInr > 0
            ? `Annual savings ${formatInr(quote.annualSavingsInr)} (2 months free)`
            : null
        }
        coverageLabel={coverageLabel}
        recommendedPack={!activePack ? quote?.recommendedPack : null}
        onApplyRecommendedPack={applyRecommendedPack}
        lines={cartLines}
        quoteError={quoteError}
        canCheckout={Boolean(quote && payableIds.length > 0)}
        onRemove={(id) => {
          const next = removeFromToolCart(id);
          setCart(next);
          setActivePack(null);
        }}
        onClear={() => {
          clearToolCart();
          setCart([]);
          setActivePack(null);
        }}
      />

      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">Plans, Usage &amp; Subscriptions</div>
          <div className="tool-header-sub">
            Intelligent modular pricing tailored to your workspace category — start trials with zero MRR impact.
          </div>
        </div>
      </div>

      {loading ? <p className="muted">Loading catalog &amp; live telemetry…</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {subscription ? (
        <>
          <BillingStepper
            current={pending?.status === "pending" ? 3 : 1}
            pending={pending?.status === "pending"}
          />

          {/* Futuristic User Category & Billing Cycle Command Ribbon */}
          <section className={`sub-hero sub-hero-${categoryMeta.tone}`}>
            <div className="sub-hero-main">
              <div className="sub-hero-badges">
                <span className={`sub-tier-pill is-${categoryMeta.tone}`}>{categoryMeta.badge}</span>
                {subscription.gstin ? (
                  <span className="sub-gstin-pill">GSTIN {subscription.gstin}</span>
                ) : null}
                {pending?.status === "pending" ? (
                  <span className="pill pill-warning">UPI verification pending</span>
                ) : null}
              </div>
              <h2>{categoryMeta.headline}</h2>
              <p className="sub-hero-desc">{categoryMeta.description}</p>
              {isIndividual ? (
                <div className="sub-hero-upgrade-nudge">
                  <Link href="/profile" className="btn btn-secondary btn-sm">
                    Add Business GSTIN to unlock all business tools →
                  </Link>
                </div>
              ) : null}
            </div>

            <div className="sub-cycle-box">
              <span className="sub-cycle-label">Billing frequency</span>
              <div className="sub-cycle-toggle" role="group" aria-label="Billing frequency">
                <button
                  type="button"
                  className={billingCycle === "month" ? "is-active" : ""}
                  onClick={() => handleCycleChange("month")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={billingCycle === "year" ? "is-active" : ""}
                  onClick={() => handleCycleChange("year")}
                >
                  Yearly <em className="sub-save-badge">Save 17%</em>
                </button>
              </div>
              <span className="sub-cycle-hint">
                {billingCycle === "year"
                  ? "Annual billing grants 365 days & saves 2 months"
                  : "Flexible 30-day cycles · switch to yearly anytime"}
              </span>
            </div>
          </section>

          {pending?.status === "pending" ? (
            <div className="billing-pending">
              <p className="billing-pending-kicker">Payment under review</p>
              <h3>
                UTR {pending.utr} ({formatInr(pending.amountInr)}
                {pending.billingCycle === "year" ? " · Yearly" : " · Monthly"}) is with {appName} accounts
              </h3>
              <p className="muted">
                You can review the order on the checkout page. Licenses activate automatically after verification.
              </p>
              <Link href="/subscription/checkout" className="btn btn-primary btn-sm">
                View checkout
              </Link>
            </div>
          ) : null}

          {/* Live Usage & Quota Command Center */}
          <section className="billing-account card sub-telemetry-card">
            <div className="billing-account-head">
              <div>
                <p className="card-label">Live workspace usage &amp; entitlements</p>
                <p className="card-value">
                  {licensedCount} active license{licensedCount === 1 ? "" : "s"}
                  {includedCount ? ` · ${includedCount} included` : ""}
                </p>
              </div>
              <span
                className={
                  pending?.status === "pending"
                    ? "pill pill-warning"
                    : licensedCount
                      ? "pill pill-success"
                      : "pill"
                }
              >
                {pending?.status === "pending"
                  ? "Payment under review"
                  : licensedCount
                    ? "Subscribed"
                    : "Freemium"}
              </span>
            </div>

            <div className="sub-kpi-grid">
              <div className="sub-kpi-tile">
                <span className="sub-kpi-label">Active tools / Records</span>
                <strong className="sub-kpi-value">
                  {usageSummary?.activeToolsUsed ?? 0} tools
                </strong>
                <span className="sub-kpi-sub">
                  {usageSummary?.totalRecords ?? 0} total saved records
                </span>
              </div>
              <div className="sub-kpi-tile">
                <span className="sub-kpi-label">Active trials</span>
                <strong className="sub-kpi-value">{usageSummary?.trialCount ?? 0}</strong>
                <span className="sub-kpi-sub">
                  {(usageSummary?.trialsExpiringSoon ?? 0) > 0
                    ? `${usageSummary!.trialsExpiringSoon} expiring within 7d`
                    : "Zero MRR while trialing"}
                </span>
              </div>
              <div className={`sub-kpi-tile${alertCount > 0 ? " is-alert" : ""}`}>
                <span className="sub-kpi-label">Quota &amp; renewal alerts</span>
                <strong className="sub-kpi-value">{alertCount}</strong>
                <span className="sub-kpi-sub">
                  {alertCount > 0 ? (
                    <button
                      type="button"
                      className="sub-inline-link"
                      onClick={() => setFilterChip("usage_alerts")}
                    >
                      Filter alert tools →
                    </button>
                  ) : (
                    `Freemium cap: ${subscription.recordLimit ?? 28} records/tool`
                  )}
                </span>
              </div>
              <div className="sub-kpi-tile">
                <span className="sub-kpi-label">Current monthly spend</span>
                <strong className="sub-kpi-value">{formatInr(subscription.mrrInr ?? 0)}</strong>
                <span className="sub-kpi-sub">
                  {subscription.mrrInr
                    ? `~${formatInr((subscription.mrrInr ?? 0) * 10)}/yr with annual`
                    : "Pay only for tools you license"}
                </span>
              </div>
            </div>

            {(subscription.billingItems?.length ?? 0) > 0 ? (
              <div className="billing-lines">
                <div className="sub-lines-head">
                  <p className="card-label">Active licenses &amp; trials</p>
                  {licensedCount > 1 ? (
                    <button
                      type="button"
                      className="btn btn-destructive btn-sm"
                      disabled={busy}
                      onClick={() => void handleCancelLicenses()}
                    >
                      Cancel all paid
                    </button>
                  ) : null}
                </div>
                <ul className="billing-line-list sub-active-list">
                  {subscription.billingItems!.map((item) => {
                    const usage = subscription.usageByTool?.[item.toolId];
                    const isTrial = item.source === "trial";
                    const expiring = usage?.daysLeft != null && usage.daysLeft <= 7;
                    return (
                      <li key={item.toolId} className="sub-active-row">
                        <div className="sub-active-info">
                          <div className="sub-active-title">
                            <strong>{item.name}</strong>
                            <span
                              className={`sub-status-chip ${
                                expiring ? "is-amber" : isTrial ? "is-cyan" : "is-emerald"
                              }`}
                            >
                              {isTrial
                                ? `Trial${usage?.daysLeft != null ? ` · ${usage.daysLeft}d left` : ""}`
                                : expiring
                                  ? `Renew in ${usage?.daysLeft}d`
                                  : "Active"}
                            </span>
                          </div>
                          <span className="sub-active-meta">
                            {isTrial
                              ? `₹0 during trial · ends ${item.periodEnd?.slice(0, 10) ?? "—"}`
                              : `${formatInr(item.unitPriceInr)}/mo${
                                  (item.quantity ?? 1) > 1 ? ` × ${item.quantity} seats` : ""
                                }${item.periodEnd ? ` · until ${item.periodEnd.slice(0, 10)}` : ""}`}
                            {item.source && !isTrial ? ` · ${item.source}` : ""}
                            {usage ? ` · ${usage.recordCount} records` : ""}
                          </span>
                        </div>
                        <div className="sub-active-actions">
                          {isTrial || expiring ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                const sku = catalog.find((s) => s.toolId === item.toolId);
                                if (sku) {
                                  if (!cart.includes(sku.toolId)) {
                                    setCart(addToToolCart(sku.toolId));
                                    setActivePack(null);
                                  }
                                  showToast(
                                    `${sku.name} added to cart for ${isTrial ? "paid conversion" : "early renewal"}`,
                                  );
                                }
                              }}
                            >
                              {isTrial ? "Convert to paid" : "Renew now"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={cancelingToolId === item.toolId}
                            onClick={() => void handleCancelSingleTool(item.toolId, item.name)}
                          >
                            {cancelingToolId === item.toolId ? "Cancelling…" : "Cancel"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </section>

          {/* Auto-Save Bundle Intelligence Banner */}
          {!activePack && quote?.recommendedPack ? (
            <section className="sub-autosave-banner">
              <div>
                <p className="sub-autosave-kicker">Smart Bundle Optimizer</p>
                <h3>
                  {quote.recommendedPack.reason === "cheaper"
                    ? `Save ${formatInr(quote.recommendedPack.savingsInr)}${billingCycle === "year" ? "/yr" : "/mo"} with ${quote.recommendedPack.packName}`
                    : `Unlock ${quote.recommendedPack.extraToolCount} extra tool${quote.recommendedPack.extraToolCount === 1 ? "" : "s"} with ${quote.recommendedPack.packName}`}
                </h3>
                <p className="muted">
                  Your current cart is {formatInr(quote.recommendedPack.cartPriceInr)}
                  {billingCycle === "year" ? "/yr" : "/mo"}. Switch to {quote.recommendedPack.packName} for{" "}
                  <strong>
                    {formatInr(quote.recommendedPack.packPriceInr)}
                    {billingCycle === "year" ? "/yr" : "/mo"}
                  </strong>
                  .
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => applyRecommendedPack(quote.recommendedPack!.packId)}
              >
                Switch to {quote.recommendedPack.packName}
              </button>
            </section>
          ) : null}

          {/* Product Packs */}
          {visiblePacks.length > 0 ? (
            <section className="store-packs">
              <div className="sub-section-head">
                <div>
                  <h2 className="billing-section-title">Product packs</h2>
                  <p className="muted">
                    Curated bundles auto-prorated for tools you do not already license.
                  </p>
                </div>
              </div>
              <div className="store-packs-grid">
                {visiblePacks.map((pack) => {
                  const remaining = pack.toolIds.filter((id) => {
                    const sku = catalog.find((s) => s.toolId === id);
                    return sku && !sku.includedFree && !sku.licensed && sku.priceInr > 0;
                  });
                  const selected = activePack === pack.id;
                  const priced = resolveClientPackPrice(pack, billingCycle);
                  const blockedForPersonal = isIndividual && !pack.personalCompatible;
                  return (
                    <article
                      key={pack.id}
                      className={`store-pack${selected ? " is-selected" : ""}${pack.highlighted ? " is-featured" : ""}`}
                    >
                      <div className="store-pack-top">
                        <div>
                          <div className="store-pack-title-row">
                            <strong>{pack.name}</strong>
                            {pack.highlighted ? (
                              <span className="sub-status-chip is-cyan">Popular</span>
                            ) : null}
                          </div>
                          {pack.tagline ? (
                            <p className="muted store-pack-tagline">{pack.tagline}</p>
                          ) : null}
                        </div>
                        <div className="store-pack-price">
                          <strong>
                            {formatInr(priced.priceInr)}
                            <small>{priced.periodSuffix}</small>
                          </strong>
                          {priced.savingsInr > 0 ? (
                            <em>Save {formatInr(priced.savingsInr)}</em>
                          ) : null}
                        </div>
                      </div>
                      <p className="store-pack-meta">
                        {remaining.length} of {pack.toolCount} tools available
                        {pack.discountPct > 0 ? ` · ${pack.discountPct}% pack discount` : ""}
                        {billingCycle === "year" ? " · 365 days" : ""}
                      </p>
                      {blockedForPersonal ? (
                        <Link href="/profile" className="btn btn-secondary btn-sm">
                          Requires Business GSTIN
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className={selected ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
                          disabled={remaining.length === 0}
                          onClick={() => addPack(pack)}
                        >
                          {remaining.length === 0
                            ? "Fully licensed"
                            : selected
                              ? "Pack in cart"
                              : "Add pack"}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Searchable, Category-Aware Futuristic Catalog */}
          <div className="store-layout">
            <div className="store-catalog">
              <div className="sub-catalog-head">
                <div>
                  <h2 className="billing-section-title">Tool catalog</h2>
                  <p className="muted">
                    Pick individual tools à la carte, start a free trial, or track real-time record usage.
                  </p>
                </div>
                <div className="sub-catalog-head-actions">
                  {eligibleTrialTools.length >= 2 ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={trialBusy === "__all__"}
                      onClick={() => void handleStartAllTrials()}
                    >
                      {trialBusy === "__all__"
                        ? "Starting trials…"
                        : `Start all ${eligibleTrialTools.length} free trials`}
                    </button>
                  ) : null}
                  {isIndividual ? (
                    <div className="sub-scope-toggle" role="group" aria-label="Account catalog scope">
                      <button
                        type="button"
                        className={scope === "personal" ? "is-active" : ""}
                        onClick={() => setScope("personal")}
                      >
                        Personal tools
                      </button>
                      <button
                        type="button"
                        className={scope === "all" ? "is-active" : ""}
                        onClick={() => setScope("all")}
                      >
                        Preview business suite
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="sub-controls-bar">
                <div className="sub-search-wrap">
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search tools by name, category, or capability…"
                    aria-label="Search subscription catalog"
                  />
                </div>
                <div className="sub-filter-chips" role="tablist" aria-label="Filter tools">
                  {FILTER_CHIPS.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      role="tab"
                      aria-selected={filterChip === chip.id}
                      className={`sub-filter-chip${filterChip === chip.id ? " is-active" : ""}`}
                      onClick={() => setFilterChip(chip.id)}
                    >
                      {chip.label}
                      {chip.id === "usage_alerts" && alertCount > 0 ? (
                        <span className="sub-chip-count">{alertCount}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              {groups.length === 0 ? (
                <div className="sub-empty-filter card">
                  <p>
                    <strong>No tools match this filter.</strong>
                  </p>
                  <p className="muted">Try clearing your search or switching back to All tools.</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearchQuery("");
                      setFilterChip("all");
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              ) : (
                groups.map(([category, tools]) => (
                  <section key={category} className="store-category">
                    {groupProducts ? <h3>{category}</h3> : null}
                    <div className="store-grid">
                      {tools.map((sku) => {
                        const inCart = cart.includes(sku.toolId);
                        const priced = resolveClientSkuPrice(sku, billingCycle);
                        const usageMeta = describeToolUsage(sku.usage);
                        const businessLockedForPersonal = isIndividual && sku.personalUsage === false;
                        return (
                          <article
                            key={sku.toolId}
                            className={`store-sku${sku.licensed ? " is-licensed" : ""}${inCart ? " is-cart" : ""}${sku.featured ? " is-featured" : ""}${usageMeta?.urgent ? " is-urgent" : ""}`}
                          >
                            <div className="store-sku-top">
                              <div className="store-sku-title-col">
                                <strong>{sku.name}</strong>
                                {sku.tagline ? (
                                  <span className="store-sku-tagline">{sku.tagline}</span>
                                ) : null}
                              </div>
                              {sku.includedFree ? (
                                <span className="pill">Included</span>
                              ) : sku.licensed || isToolLicensed(sku.toolId) ? (
                                <span className="pill pill-success">
                                  {sku.usage?.isTrial ? "Trial" : "Licensed"}
                                </span>
                              ) : (
                                <span className="store-sku-price">
                                  {formatInr(priced.priceInr)}
                                  <em>{priced.periodSuffix}</em>
                                  {billingCycle === "year" && priced.annualSavingsPct > 0 ? (
                                    <span className="store-sku-save-tag">
                                      -{priced.annualSavingsPct}%
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </div>

                            {usageMeta ? (
                              <div className={`store-sku-usage is-${usageMeta.tone}`}>
                                <div className="store-sku-usage-row">
                                  <span>{usageMeta.label}</span>
                                  {sku.accessPolicy === "hard_lock" && !sku.licensed && !sku.includedFree ? (
                                    <span className="store-sku-policy">Pro-only</span>
                                  ) : null}
                                </div>
                                {usageMeta.pct != null && !sku.licensed && !sku.includedFree && sku.usage?.limit ? (
                                  <div className="store-sku-meter" aria-hidden>
                                    <span style={{ width: `${Math.min(100, usageMeta.pct)}%` }} />
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {businessLockedForPersonal ? (
                              <div className="store-sku-actions">
                                <Link href="/profile" className="btn btn-secondary btn-sm">
                                  Add GSTIN to unlock
                                </Link>
                              </div>
                            ) : !sku.includedFree && (!sku.licensed || sku.canConvertOrRenew) ? (
                              <div className="store-sku-actions">
                                {!sku.licensed && sku.trialEligible ? (
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    disabled={trialBusy === sku.toolId}
                                    onClick={() => void handleTrial(sku)}
                                  >
                                    {trialBusy === sku.toolId
                                      ? "Starting…"
                                      : `Start ${sku.trialDays}d trial`}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={
                                    inCart
                                      ? "btn btn-destructive btn-sm"
                                      : sku.canConvertOrRenew
                                        ? "btn btn-primary btn-sm"
                                        : "btn btn-secondary btn-sm"
                                  }
                                  onClick={() => toggle(sku)}
                                >
                                  {inCart
                                    ? "Remove"
                                    : sku.canConvertOrRenew
                                      ? sku.usage?.isTrial
                                        ? `Convert · ${formatInr(priced.priceInr)}${priced.periodSuffix}`
                                        : `Renew · ${formatInr(priced.priceInr)}${priced.periodSuffix}`
                                      : "Add to cart"}
                                </button>
                              </div>
                            ) : (
                              <p className="muted store-sku-note">
                                {sku.includedFree
                                  ? "No subscription required"
                                  : sku.usage?.isTrial
                                    ? `Trial active · ends ${sku.usage.periodEnd?.slice(0, 10) ?? "soon"}`
                                    : "Unlimited on this workspace"}
                              </p>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>
          </div>

          <BillingHistoryPanel refreshKey={subscription.serverTime} />
        </>
      ) : null}
    </div>
  );
}
