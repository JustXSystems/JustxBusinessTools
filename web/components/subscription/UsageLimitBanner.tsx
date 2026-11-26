"use client";

import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { useSubscription } from "@/hooks/useSubscription";
import { formatInr, resolveClientSkuPrice } from "@/lib/subscription-store-helpers";
import { DEFAULT_COMMERCE_POLICY } from "@/lib/types/subscription";
import type { ToolUsage } from "@/lib/types/tool-record";
import { useBrandCopy } from "@/lib/use-brand-copy";

export function ToolUsageCounter({
  usage,
  licensed = false,
}: {
  usage: ToolUsage | null;
  licensed?: boolean;
}) {
  if (!usage) return null;
  if (usage.limit === null || licensed) {
    return <span className="usage-counter usage-counter-pro">Licensed · unlimited</span>;
  }
  if (usage.limit === 0) {
    return <span className="usage-counter">License required</span>;
  }
  const pct = Math.min(100, Math.round((usage.recordCount / Math.max(1, usage.limit)) * 100));
  return (
    <span className="usage-counter" title={`${pct}% of freemium quota used`}>
      {usage.recordCount} / {usage.limit} records ({pct}%)
    </span>
  );
}

export function UsageLimitBanner({
  usage,
  atLimit,
  nearLimit,
}: {
  usage: ToolUsage | null;
  atLimit: boolean;
  nearLimit: boolean;
}) {
  const { openUpgrade, isToolLicensed, subscription, startTrial } = useSubscription();
  const { showToast } = useToast();
  const { appName } = useBrandCopy();
  const [busy, setBusy] = useState(false);

  if (!usage || isToolLicensed(usage.toolId) || usage.limit === null) return null;
  if (!atLimit && !nearLimit) return null;

  const sku = subscription?.catalog?.find((s) => s.toolId === usage.toolId);
  const policy = subscription?.commercePolicy ?? DEFAULT_COMMERCE_POLICY;
  const nudgeCycle = policy.annualEnabled ? policy.defaultCheckoutCycleFromNudge : "month";
  const trialEligible = Boolean(sku?.trialEligible && (sku.trialDays ?? 0) > 0);
  const priced = sku ? resolveClientSkuPrice(sku, "month") : null;
  const pricedYearly = sku ? resolveClientSkuPrice(sku, "year") : null;
  const limit = usage.limit;
  const hardLocked = limit === 0;
  const pct = hardLocked ? 100 : Math.min(100, Math.round((usage.recordCount / Math.max(1, limit)) * 100));
  const priceHint =
    priced && priced.priceInr > 0 ? ` · ${formatInr(priced.priceInr)}/mo` : "";
  const annualCheckoutHref = `/subscription/checkout?tool=${encodeURIComponent(usage.toolId)}&cycle=${nudgeCycle}`;
  const yearlySaveHint =
    nudgeCycle === "year"
      ? pricedYearly && pricedYearly.annualSavingsInr > 0
        ? `Yearly (${formatInr(pricedYearly.priceInr)}/yr · save ${formatInr(pricedYearly.annualSavingsInr)})`
        : "Subscribe yearly (−17%)"
      : `Subscribe${priceHint}`;

  async function onTrial() {
    setBusy(true);
    try {
      await startTrial(usage!.toolId);
      showToast(`${sku?.trialDays ?? 14}-day trial started`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start trial");
    } finally {
      setBusy(false);
    }
  }

  if (atLimit) {
    return (
      <div className="usage-banner usage-banner-limit">
        <div className="usage-banner-copy">
          <span>
            {hardLocked
              ? "This tool requires an active license or free trial before you can create records."
              : `You have reached the freemium limit of ${limit} records for this tool (${pct}%).`}
            {subscription?.pendingClaim?.status === "pending"
              ? ` Your UPI payment is waiting for ${appName} verification.`
              : trialEligible
                ? ` Start a ${sku!.trialDays}-day free trial or subscribe${priceHint} (save 17% yearly).`
                : ` Delete a record or subscribe${priceHint} for unlimited records.`}
          </span>
          {!hardLocked ? (
            <div className="usage-banner-meter" aria-hidden>
              <span style={{ width: `${pct}%` }} />
            </div>
          ) : null}
        </div>
        <div className="usage-banner-actions">
          {subscription?.pendingClaim?.status === "pending" ? (
            <button type="button" className="usage-banner-cta" onClick={() => openUpgrade(usage.toolId)}>
              View payment
            </button>
          ) : trialEligible ? (
            <>
              <button
                type="button"
                className="usage-banner-cta"
                disabled={busy}
                onClick={() => void onTrial()}
              >
                Start {sku!.trialDays}-day trial
              </button>
              <Link href={annualCheckoutHref} className="usage-banner-cta usage-banner-cta-secondary">
                {yearlySaveHint}
              </Link>
            </>
          ) : (
            <>
              <Link href={annualCheckoutHref} className="usage-banner-cta">
                {yearlySaveHint}
              </Link>
              <button
                type="button"
                className="usage-banner-cta usage-banner-cta-secondary"
                onClick={() => openUpgrade(usage.toolId)}
              >
                Monthly{priceHint}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="usage-banner usage-banner-warn">
      <div className="usage-banner-copy">
        <span>
          {usage.recordCount} of {limit} records used ({pct}%) — only {Math.max(0, limit - usage.recordCount)} left
          before upgrade is needed.
        </span>
        <div className="usage-banner-meter" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="usage-banner-actions">
        {trialEligible ? (
          <button
            type="button"
            className="usage-banner-cta"
            disabled={busy}
            onClick={() => void onTrial()}
          >
            Start {sku!.trialDays}-day trial
          </button>
        ) : null}
        <Link href={annualCheckoutHref} className="usage-banner-cta">
          {yearlySaveHint}
        </Link>
        <button
          type="button"
          className="usage-banner-cta usage-banner-cta-secondary"
          onClick={() => openUpgrade(usage.toolId)}
        >
          Monthly{priceHint}
        </button>
      </div>
    </div>
  );
}
