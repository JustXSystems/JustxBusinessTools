"use client";

import Link from "next/link";
import { useSubscription } from "@/hooks/useSubscription";
import { formatInr } from "@/lib/subscription-store-helpers";
import { DEFAULT_COMMERCE_POLICY } from "@/lib/types/subscription";

/**
 * Proactive home telemetry ribbon: surfaces actionable subscription states
 * (pending UPI verification, expiring trials/licenses, or tools near record caps)
 * without cluttering the dashboard when everything is healthy.
 */
export function SubscriptionStatusStrip() {
  const { subscription, openUpgrade } = useSubscription();
  if (!subscription) return null;
  const policy = subscription.commercePolicy ?? DEFAULT_COMMERCE_POLICY;
  if (!policy.showHomeSubscriptionStrip) return null;
  const nudgeCycle = policy.annualEnabled ? policy.defaultCheckoutCycleFromNudge : "month";

  const pending = subscription.pendingClaim;
  if (pending?.status === "pending") {
    return (
      <div className="home-sub-strip is-cyan" role="status">
        <div className="home-sub-strip-copy">
          <span className="home-sub-strip-badge">Verification pending</span>
          <strong>
            UTR {pending.utr} ({formatInr(pending.amountInr)}
            {pending.billingCycle === "year" ? " · Yearly" : " · Monthly"})
          </strong>
          <span>Your licenses will activate automatically once accounts confirms the UPI credit.</span>
        </div>
        <Link href="/subscription/checkout" className="btn btn-secondary btn-sm">
          View status →
        </Link>
      </div>
    );
  }

  const catalog = subscription.catalog ?? [];
  const expiringTool = catalog.find((s) => s.usage?.status === "expiring_soon");
  if (expiringTool?.usage) {
    const isTrial = expiringTool.usage.isTrial;
    return (
      <div className="home-sub-strip is-amber" role="status">
        <div className="home-sub-strip-copy">
          <span className="home-sub-strip-badge">
            {isTrial ? "Trial ending soon" : "Renewal due"}
          </span>
          <strong>
            {expiringTool.name} · {expiringTool.usage.daysLeft ?? 0}d left
          </strong>
          <span>
            {isTrial
              ? "Convert to a paid subscription now to keep uninterrupted access — save 17% on annual."
              : "Renew early to extend your active license without downtime."}
          </span>
        </div>
        <div className="home-sub-strip-actions">
          <Link
            href={`/subscription/checkout?tool=${encodeURIComponent(expiringTool.toolId)}&cycle=${nudgeCycle}`}
            className="btn btn-primary btn-sm"
          >
            {nudgeCycle === "year"
              ? isTrial
                ? "Convert yearly (-17%)"
                : "Renew yearly (-17%)"
              : isTrial
                ? "Convert to paid"
                : "Renew now"}
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => openUpgrade(expiringTool.toolId)}
          >
            Monthly / store
          </button>
        </div>
      </div>
    );
  }

  const summary = subscription.usageSummary;
  const limitAlerts = (summary?.toolsAtLimit ?? 0) + (summary?.toolsNearLimit ?? 0);
  if (limitAlerts > 0) {
    const firstAlert = catalog.find(
      (s) => s.usage?.status === "at_limit" || s.usage?.status === "near_limit",
    );
    return (
      <div className="home-sub-strip is-amber" role="status">
        <div className="home-sub-strip-copy">
          <span className="home-sub-strip-badge">Usage alert</span>
          <strong>
            {limitAlerts === 1 && firstAlert
              ? `${firstAlert.name} is ${firstAlert.usage?.atLimit ? "at" : "near"} its free record limit`
              : `${limitAlerts} tools are near or at their free record cap`}
          </strong>
          <span>Start a free trial or unlock unlimited records &amp; exports on your workspace.</span>
        </div>
        <div className="home-sub-strip-actions">
          {firstAlert ? (
            <Link
              href={`/subscription/checkout?tool=${encodeURIComponent(firstAlert.toolId)}&cycle=${nudgeCycle}`}
              className="btn btn-primary btn-sm"
            >
              Upgrade {firstAlert.name}
            </Link>
          ) : null}
          <Link href="/subscription" className="btn btn-secondary btn-sm">
            View usage →
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
