"use client";

import { useSubscription } from "@/hooks/useSubscription";
import type { ToolUsage } from "@/lib/types/tool-record";

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
  return (
    <span className="usage-counter">
      {usage.recordCount} / {usage.limit} records
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
  const { openUpgrade, isToolLicensed, subscription } = useSubscription();

  if (!usage || isToolLicensed(usage.toolId) || usage.limit === null) return null;
  if (!atLimit && !nearLimit) return null;

  const limit = usage.limit;

  if (atLimit) {
    return (
      <div className="usage-banner usage-banner-limit">
        <span>
          You have reached the limit of {limit} records for this tool.
          {subscription?.pendingClaim?.status === "pending"
            ? " Your UPI payment is waiting for JustXSystems verification."
            : " Delete a record or subscribe to this tool for unlimited records."}
        </span>
        <button type="button" className="usage-banner-cta" onClick={() => openUpgrade(usage.toolId)}>
          {subscription?.pendingClaim?.status === "pending" ? "View payment" : "Subscribe to this tool"}
        </button>
      </div>
    );
  }

  return (
    <div className="usage-banner usage-banner-warn">
      <span>
        {usage.recordCount} of {limit} records used — only {limit - usage.recordCount} left until you
        subscribe.
      </span>
      <button type="button" className="usage-banner-cta" onClick={() => openUpgrade(usage.toolId)}>
        Subscribe
      </button>
    </div>
  );
}
