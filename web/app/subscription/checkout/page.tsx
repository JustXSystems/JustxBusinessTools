"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { BillingStepper } from "@/components/subscription/BillingStepper";
import { CardPayMethod } from "@/components/subscription/CardPayMethod";
import { UpiPayMethod } from "@/components/subscription/UpiPayMethod";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/components/auth/AuthProvider";
import { fetchCartQuote } from "@/lib/api";
import { catalogPriceFingerprint } from "@/lib/commerce-revision";
import { openProformaQuotePrint } from "@/lib/proforma-quote";
import {
  clearToolCart,
  readActivePack,
  readBillingCycle,
  readToolCart,
  setPackCart,
  writeBillingCycle,
  writeToolCart,
} from "@/lib/tool-cart";
import { formatInr } from "@/lib/subscription-store-helpers";
import {
  DEFAULT_COMMERCE_POLICY,
  type BillingCycle,
  type CartQuote,
} from "@/lib/types/subscription";
import { useBrandCopy } from "@/lib/use-brand-copy";

type PayMethod = "upi" | "debit" | "credit";

export default function SubscriptionCheckoutPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { appName, legalName } = useBrandCopy();
  const { subscription, loading, error, refresh } = useSubscription();
  const { showToast } = useToast();
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoting, setQuoting] = useState(true);
  const [method, setMethod] = useState<PayMethod>("upi");
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState("");
  const [hydratedParams, setHydratedParams] = useState(false);

  const catalog = subscription?.catalog ?? [];
  const packs = subscription?.packs ?? [];
  const pending = subscription?.pendingClaim;
  const gateways = subscription?.gateways ?? [];
  const policy = subscription?.commercePolicy ?? DEFAULT_COMMERCE_POLICY;
  const priceFingerprint = useMemo(
    () => catalogPriceFingerprint(catalog, packs),
    [catalog, packs],
  );

  // Hydrate deep-link parameters (?tool=..., ?tools=a,b, ?pack=..., ?cycle=year|month, ?promo=CODE)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cycleParam = params.get("cycle");
    const initialCycle: BillingCycle =
      cycleParam === "year" || cycleParam === "month"
        ? writeBillingCycle(cycleParam)
        : readBillingCycle();
    setBillingCycle(initialCycle);

    const singleTool = params.get("tool")?.trim();
    const multiTools = params.get("tools")?.trim();
    const packParam = params.get("pack")?.trim();
    if (packParam) {
      setPackCart(packParam, []);
      setBundleId(packParam);
    } else if (singleTool || multiTools) {
      const ids = Array.from(
        new Set(
          [
            ...(singleTool ? [singleTool] : []),
            ...(multiTools ? multiTools.split(",") : []),
          ]
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      );
      if (ids.length > 0) {
        writeToolCart(ids);
        setBundleId(null);
      }
    }

    const promoParam =
      params.get("promo")?.trim().toUpperCase() ||
      (typeof window !== "undefined" ? sessionStorage.getItem("jbt_promo_code") || "" : "");
    if (promoParam) {
      setPromoInput(promoParam);
      setAppliedPromo(promoParam);
    }
    setHydratedParams(true);
  }, []);

  const loadQuote = useCallback(async (cycleOverride?: BillingCycle, promoOverride?: string) => {
    const ids = readToolCart();
    const packId = readActivePack();
    const cycle = cycleOverride ?? readBillingCycle();
    const promo = promoOverride ?? appliedPromo;
    setBundleId(packId);
    if (ids.length === 0 && !packId) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    setQuoting(true);
    try {
      const data = await fetchCartQuote(ids, packId || undefined, cycle, promo || undefined);
      setQuote(data);
      setQuoteError("");
    } catch (err) {
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : "Could not load this order");
    } finally {
      setQuoting(false);
    }
  }, [appliedPromo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hydratedParams) return;
    void loadQuote(billingCycle, appliedPromo);
  }, [hydratedParams, loadQuote, priceFingerprint, billingCycle, appliedPromo]);

  useEffect(() => {
    const onResolved = () => {
      clearToolCart();
      showToast("Payment verified — licenses are active");
      void refresh().then(() => router.replace("/subscription"));
    };
    window.addEventListener("jbt:upi-claim-resolved", onResolved);
    return () => window.removeEventListener("jbt:upi-claim-resolved", onResolved);
  }, [refresh, router, showToast]);

  useEffect(() => {
    if (!hydratedParams || loading || quoting) return;
    if (pending?.status === "pending") return;
    if (quote || quoteError) return;
    if (readToolCart().length === 0 && !readActivePack()) {
      router.replace("/subscription");
    }
  }, [hydratedParams, loading, quoting, pending, quote, quoteError, router]);

  function handleCycleSwitch(next: BillingCycle) {
    const saved = writeBillingCycle(next);
    setBillingCycle(saved);
  }

  function applyRecommendedPack(packId: string) {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;
    const remaining = pack.toolIds.filter((id) => {
      const sku = catalog.find((s) => s.toolId === id);
      return sku && !sku.includedFree && !sku.licensed && sku.priceInr > 0;
    });
    if (remaining.length === 0) return;
    setPackCart(pack.id, remaining);
    setBundleId(pack.id);
    showToast(`Switched order to ${pack.name}`);
    void loadQuote(billingCycle);
  }

  async function onPaid() {
    clearToolCart();
    try {
      sessionStorage.removeItem("jbt_promo_code");
    } catch {
      /* ignore */
    }
    await refresh();
    router.push("/subscription");
  }

  const effectiveCycle: BillingCycle =
    quote?.billingCycle ?? pending?.billingCycle ?? billingCycle;
  const amount = quote?.totalInr ?? pending?.amountInr ?? 0;
  const lines =
    quote?.lines ??
    (pending?.toolIds ?? []).map((id) => {
      const sku = catalog.find((s) => s.toolId === id);
      return {
        toolId: id,
        name: sku?.name ?? id,
        category: sku?.category ?? "",
        priceInr: sku?.priceInr ?? 0,
        billingInterval: effectiveCycle,
      };
    });
  const toolIds = lines.map((l) => l.toolId);
  const step: 2 | 3 = pending?.status === "pending" ? 3 : 2;
  const durationDays = quote?.durationDays ?? (effectiveCycle === "year" ? 365 : 30);

  return (
    <div className="billing-page billing-checkout-page">
      <div className="tool-header">
        <Link href="/subscription" className="back-btn" aria-label="Back to catalog">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">Checkout</div>
          <div className="tool-header-sub">
            Secure settlement to {appName} · instant cycle control &amp; verified activation
          </div>
        </div>
      </div>

      <BillingStepper current={step} pending={pending?.status === "pending"} />

      {loading || quoting ? <p className="muted">Loading checkout…</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {quoteError ? <div className="error-banner">{quoteError}</div> : null}

      <div className="co-layout">
        <aside className="co-summary card">
          <p className="card-label">Order summary</p>
          <h2>
            {quote?.packName
              ? quote.packName
              : effectiveCycle === "year"
                ? "Annual subscription"
                : "Monthly subscription"}
          </h2>

          {policy.annualEnabled && pending?.status !== "pending" ? (
            <div className="co-cycle-switch" role="group" aria-label="Checkout billing cycle">
              <button
                type="button"
                className={billingCycle === "month" ? "is-active" : ""}
                onClick={() => handleCycleSwitch("month")}
              >
                Monthly (30d)
              </button>
              <button
                type="button"
                className={billingCycle === "year" ? "is-active" : ""}
                onClick={() => handleCycleSwitch("year")}
              >
                Yearly (365d) <span>Save 17%</span>
              </button>
            </div>
          ) : null}

          {quote?.savingsInr && quote.savingsInr > 0 ? (
            <p className="store-cart-savings">Pack savings {formatInr(quote.savingsInr)}</p>
          ) : null}
          {effectiveCycle === "year" && quote?.annualSavingsInr && quote.annualSavingsInr > 0 ? (
            <p className="store-cart-savings">
              Annual savings {formatInr(quote.annualSavingsInr)} (2 months free)
            </p>
          ) : null}

          {lines.length === 0 ? (
            <p className="muted">No tools in this order.</p>
          ) : (
            <ul className="billing-line-items">
              {lines.map((line) => (
                <li key={line.toolId}>
                  <span>
                    {line.name}
                    {line.category ? <em>{line.category}</em> : null}
                  </span>
                  <strong>{line.priceInr ? formatInr(line.priceInr) : "—"}</strong>
                </li>
              ))}
            </ul>
          )}

          {policy.autoSavePackNudgeEnabled &&
          !bundleId &&
          quote?.recommendedPack &&
          pending?.status !== "pending" ? (
            <div className="store-cart-autosave">
              <p className="store-cart-autosave-kicker">Auto-Save Pack Available</p>
              <p className="store-cart-autosave-copy">
                {quote.recommendedPack.reason === "cheaper"
                  ? `Switch to ${quote.recommendedPack.packName} and save ${formatInr(quote.recommendedPack.savingsInr)}`
                  : `Switch to ${quote.recommendedPack.packName} for ${formatInr(quote.recommendedPack.packPriceInr)} (+${quote.recommendedPack.extraToolCount} extra tool${quote.recommendedPack.extraToolCount === 1 ? "" : "s"})`}
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => applyRecommendedPack(quote.recommendedPack!.packId)}
              >
                Switch to {quote.recommendedPack.packName}
              </button>
            </div>
          ) : null}

          {policy.promosEnabled && pending?.status !== "pending" ? (
            <form
              className="co-promo-box"
              onSubmit={(e) => {
                e.preventDefault();
                const code = promoInput.trim().toUpperCase();
                setAppliedPromo(code);
              }}
            >
              <input
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                placeholder="Promo code (e.g. ANNUAL20)"
                aria-label="Promo code"
              />
              {appliedPromo ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setPromoInput("");
                    setAppliedPromo("");
                    try {
                      sessionStorage.removeItem("jbt_promo_code");
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  Clear
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-secondary btn-sm"
                  disabled={!promoInput.trim()}
                >
                  Apply
                </button>
              )}
            </form>
          ) : null}

          {policy.promosEnabled &&
          policy.showFeaturedPromoChips &&
          pending?.status !== "pending" &&
          quote?.availablePromos &&
          quote.availablePromos.length > 0 ? (
            <div className="co-promo-chips" aria-label="Eligible promo offers">
              <span className="co-promo-chips-label">Eligible offers:</span>
              {quote.availablePromos.map((offer) => {
                const isApplied = quote.promo?.code === offer.code;
                return (
                  <button
                    key={offer.code}
                    type="button"
                    className={`co-promo-chip${isApplied ? " is-applied" : ""}`}
                    onClick={() => {
                      setPromoInput(offer.code);
                      setAppliedPromo(offer.code);
                    }}
                  >
                    <strong>{offer.code}</strong>
                    <span>
                      {isApplied ? "Applied" : `Save ${formatInr(offer.discountInr)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {quote?.categoryDiscountInr && quote.categoryDiscountInr > 0 ? (
            <p className="store-cart-savings">
              Tier discount ({quote.categoryDiscountPct}%): −{formatInr(quote.categoryDiscountInr)}
            </p>
          ) : null}
          {quote?.promo ? (
            <>
              <div className="store-cart-subtotal">
                <span className="muted">Subtotal</span>
                <span>{formatInr(quote.subtotalInr ?? amount + quote.promo.discountInr)}</span>
              </div>
              <p className="store-cart-savings">
                Promo {quote.promo.code} ({quote.promo.label}): −{formatInr(quote.promo.discountInr)}
              </p>
            </>
          ) : null}
          {quote?.promoError ? <p className="field-error">{quote.promoError}</p> : null}

          <div className="store-cart-total">
            <span>Amount payable</span>
            <strong>{formatInr(amount)}</strong>
          </div>
          <dl className="billing-dl">
            <div>
              <dt>Billing cycle</dt>
              <dd>
                {effectiveCycle === "year" ? "Yearly" : "Monthly"} ({durationDays} days)
              </dd>
            </div>
            {quote?.periodEndPreview ? (
              <div>
                <dt>Coverage until</dt>
                <dd>{quote.periodEndPreview.slice(0, 10)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Account type</dt>
              <dd>
                {subscription?.hasGstin
                  ? `Business · GSTIN ${subscription.gstin}`
                  : "Personal workspace"}
              </dd>
            </div>
            <div>
              <dt>Merchant</dt>
              <dd>{quote?.upi?.payeeName || subscription?.upi?.payeeName || legalName}</dd>
            </div>
          </dl>
          {policy.proformaQuoteEnabled && quote && lines.length > 0 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ width: "100%", marginTop: 12 }}
              onClick={() => {
                const opened = openProformaQuotePrint({
                  sellerAppName: appName,
                  sellerLegalName: legalName,
                  customerName:
                    user?.organizationName || user?.name || user?.email || "Workspace Account",
                  customerGstin: subscription?.gstin ?? null,
                  userCategory: subscription?.userCategory,
                  branchCount: subscription?.branchCount ?? user?.branches?.length ?? 1,
                  billingCycle: effectiveCycle,
                  policy,
                  quote,
                });
                if (!opened) showToast("Allow pop-ups to print or save the Proforma Quote PDF");
              }}
            >
              Download Proforma Quote PDF
            </button>
          ) : null}
          <p className="muted co-tax-note">
            {subscription?.hasGstin
              ? "GSTIN is attached to this workspace for business billing records."
              : "Personal subscription receipt. Need GST billing? Add GSTIN in Profile anytime."}
          </p>
          <Link href="/subscription" className="btn btn-secondary btn-sm">
            ← Edit tools
          </Link>
        </aside>

        <section className="co-pay card">
          <p className="card-label">Payment method</p>
          <h2>How would you like to pay?</h2>
          <div className="co-method-tabs" role="tablist" aria-label="Payment methods">
            <button
              type="button"
              role="tab"
              aria-selected={method === "upi"}
              className={method === "upi" ? "is-active" : ""}
              onClick={() => setMethod("upi")}
            >
              <strong>UPI</strong>
              <span>Recommended</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === "debit"}
              className={method === "debit" ? "is-active" : ""}
              onClick={() => setMethod("debit")}
            >
              <strong>Debit card</strong>
              <span>Via PG</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === "credit"}
              className={method === "credit" ? "is-active" : ""}
              onClick={() => setMethod("credit")}
            >
              <strong>Credit card</strong>
              <span>Via PG</span>
            </button>
          </div>

          {method === "upi" ? (
            <UpiPayMethod
              toolIds={toolIds}
              amountInr={amount}
              billingCycle={effectiveCycle}
              promoCode={quote?.promo?.code}
              bundleId={bundleId || quote?.bundleId}
              upi={quote?.upi ?? subscription?.upi}
              pendingClaim={pending}
              onDone={onPaid}
              onToast={showToast}
            />
          ) : (
            <CardPayMethod
              kind={method}
              toolIds={toolIds}
              amountInr={amount}
              billingCycle={effectiveCycle}
              promoCode={quote?.promo?.code}
              bundleId={bundleId || quote?.bundleId}
              gateways={gateways}
              onDone={onPaid}
              onToast={showToast}
            />
          )}
        </section>
      </div>
    </div>
  );
}
