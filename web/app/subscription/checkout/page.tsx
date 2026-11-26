"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { BillingStepper } from "@/components/subscription/BillingStepper";
import { CardPayMethod } from "@/components/subscription/CardPayMethod";
import { UpiPayMethod } from "@/components/subscription/UpiPayMethod";
import { useSubscription } from "@/hooks/useSubscription";
import { fetchCartQuote } from "@/lib/api";
import { catalogPriceFingerprint } from "@/lib/commerce-revision";
import {
  clearToolCart,
  readActivePack,
  readBillingCycle,
  readToolCart,
  setPackCart,
  writeBillingCycle,
} from "@/lib/tool-cart";
import { formatInr } from "@/lib/subscription-store-helpers";
import type { BillingCycle, CartQuote } from "@/lib/types/subscription";
import { useBrandCopy } from "@/lib/use-brand-copy";

type PayMethod = "upi" | "debit" | "credit";

export default function SubscriptionCheckoutPage() {
  const router = useRouter();
  const { appName, legalName } = useBrandCopy();
  const { subscription, loading, error, refresh } = useSubscription();
  const { showToast } = useToast();
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoting, setQuoting] = useState(true);
  const [method, setMethod] = useState<PayMethod>("upi");
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");

  const catalog = subscription?.catalog ?? [];
  const packs = subscription?.packs ?? [];
  const pending = subscription?.pendingClaim;
  const gateways = subscription?.gateways ?? [];
  const priceFingerprint = useMemo(
    () => catalogPriceFingerprint(catalog, packs),
    [catalog, packs],
  );

  useEffect(() => {
    setBillingCycle(readBillingCycle());
  }, []);

  const loadQuote = useCallback(async (cycleOverride?: BillingCycle) => {
    const ids = readToolCart();
    const packId = readActivePack();
    const cycle = cycleOverride ?? readBillingCycle();
    setBundleId(packId);
    if (ids.length === 0 && !packId) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    setQuoting(true);
    try {
      const data = await fetchCartQuote(ids, packId || undefined, cycle);
      setQuote(data);
      setQuoteError("");
    } catch (err) {
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : "Could not load this order");
    } finally {
      setQuoting(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void loadQuote(billingCycle);
  }, [loadQuote, priceFingerprint, billingCycle]);

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
    if (loading || quoting) return;
    if (pending?.status === "pending") return;
    if (quote || quoteError) return;
    if (readToolCart().length === 0) {
      router.replace("/subscription");
    }
  }, [loading, quoting, pending, quote, quoteError, router]);

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

          {pending?.status !== "pending" ? (
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

          {!bundleId && quote?.recommendedPack && pending?.status !== "pending" ? (
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
