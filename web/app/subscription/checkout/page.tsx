"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { BillingStepper } from "@/components/subscription/BillingStepper";
import { CardPayMethod } from "@/components/subscription/CardPayMethod";
import { UpiPayMethod } from "@/components/subscription/UpiPayMethod";
import { useSubscription } from "@/hooks/useSubscription";
import { fetchCartQuote } from "@/lib/api";
import { clearToolCart, readActivePack, readToolCart } from "@/lib/tool-cart";
import type { CartQuote } from "@/lib/types/subscription";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

type PayMethod = "upi" | "debit" | "credit";

export default function SubscriptionCheckoutPage() {
  const router = useRouter();
  const { subscription, loading, error, refresh } = useSubscription();
  const { showToast } = useToast();
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoting, setQuoting] = useState(true);
  const [method, setMethod] = useState<PayMethod>("upi");
  const [bundleId, setBundleId] = useState<string | null>(null);

  const catalog = subscription?.catalog ?? [];
  const pending = subscription?.pendingClaim;
  const gateways = subscription?.gateways ?? [];

  const loadQuote = useCallback(async () => {
    const ids = readToolCart();
    const packId = readActivePack();
    setBundleId(packId);
    if (ids.length === 0 && !packId) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    setQuoting(true);
    try {
      const data = await fetchCartQuote(ids, packId || undefined);
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
    void loadQuote();
  }, [loadQuote, catalog.length]);

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

  async function onPaid() {
    clearToolCart();
    await refresh();
    router.push("/subscription");
  }

  const amount = quote?.totalInr ?? pending?.amountInr ?? 0;
  const lines =
    quote?.lines ??
    (pending?.toolIds ?? []).map((id) => {
      const sku = catalog.find((s) => s.toolId === id);
      return {
        toolId: id,
        name: sku?.name ?? id,
        category: sku?.category ?? "",
        priceInr: 0,
        billingInterval: "month",
      };
    });
  const toolIds = lines.map((l) => l.toolId);
  const step: 2 | 3 = pending?.status === "pending" ? 3 : 2;

  return (
    <div className="billing-page billing-checkout-page">
      <div className="tool-header">
        <Link href="/subscription" className="back-btn" aria-label="Back to catalog">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">Checkout</div>
          <div className="tool-header-sub">Secure payment to JustXSystems · UPI is the default settlement method</div>
        </div>
      </div>

      <BillingStepper current={step} pending={pending?.status === "pending"} />

      {loading || quoting ? <p className="muted">Loading checkout…</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {quoteError ? <div className="error-banner">{quoteError}</div> : null}

      <div className="co-layout">
        <aside className="co-summary card">
          <p className="card-label">Order summary</p>
          <h2>{quote?.packName ? quote.packName : "Monthly subscription"}</h2>
          {quote?.savingsInr && quote.savingsInr > 0 ? (
            <p className="muted">Pack savings {inr(quote.savingsInr)}</p>
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
                  <strong>{line.priceInr ? inr(line.priceInr) : "—"}</strong>
                </li>
              ))}
            </ul>
          )}
          <div className="store-cart-total">
            <span>Amount payable</span>
            <strong>{inr(amount)}</strong>
          </div>
          <dl className="billing-dl">
            <div>
              <dt>Billing cycle</dt>
              <dd>{quote?.billingInterval === "year" ? "Yearly" : "Monthly"}</dd>
            </div>
            <div>
              <dt>Merchant</dt>
              <dd>{quote?.upi?.payeeName || subscription?.upi?.payeeName || "JustXSystems LLP"}</dd>
            </div>
          </dl>
          <Link href="/subscription" className="btn btn-ghost btn-sm">
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
