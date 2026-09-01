"use client";

import { useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
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
  if (usage.limit === 0) {
    return <span className="usage-counter">License required</span>;
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
  const { openUpgrade, isToolLicensed, subscription, startTrial } = useSubscription();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  if (!usage || isToolLicensed(usage.toolId) || usage.limit === null) return null;
  if (!atLimit && !nearLimit) return null;

  const sku = subscription?.catalog?.find((s) => s.toolId === usage.toolId);
  const trialEligible = Boolean(sku?.trialEligible && (sku.trialDays ?? 0) > 0);
  const limit = usage.limit;
  const hardLocked = limit === 0;

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
        <span>
          {hardLocked
            ? "This tool requires a license before you can create records."
            : `You have reached the limit of ${limit} records for this tool.`}
          {subscription?.pendingClaim?.status === "pending"
            ? " Your UPI payment is waiting for JustXSystems verification."
            : trialEligible
              ? " Start a free trial or subscribe for unlimited records."
              : " Delete a record or subscribe to this tool for unlimited records."}
        </span>
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
              <button type="button" className="usage-banner-cta usage-banner-cta-secondary" onClick={() => openUpgrade(usage.toolId)}>
                Subscribe
              </button>
            </>
          ) : (
            <button type="button" className="usage-banner-cta" onClick={() => openUpgrade(usage.toolId)}>
              Subscribe to this tool
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="usage-banner usage-banner-warn">
      <span>
        {usage.recordCount} of {limit} records used — only {limit - usage.recordCount} left until you
        subscribe.
      </span>
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
        <button type="button" className="usage-banner-cta" onClick={() => openUpgrade(usage.toolId)}>
          Subscribe
        </button>
      </div>
    </div>
  );
}
