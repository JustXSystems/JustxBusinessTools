"use client";

import { useState } from "react";
import Link from "next/link";
import type { ToolDefinition } from "@/config/tools.config";
import { useToast } from "@/components/common/ToastProvider";
import { useSubscription } from "@/hooks/useSubscription";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const { subscription, isToolLicensed, openUpgrade, startTrial } = useSubscription();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const sku = subscription?.catalog?.find((s) => s.toolId === tool.id);
  const licensed = isToolLicensed(tool.id);
  const paidOffer = sku && !sku.includedFree && sku.priceInr > 0;
  const trialEligible = Boolean(sku?.trialEligible && (sku.trialDays ?? 0) > 0);

  async function onTrial() {
    setBusy(true);
    try {
      await startTrial(tool.id);
      showToast(`${sku?.trialDays ?? 14}-day trial started for ${tool.name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start trial");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`tool-card${paidOffer && !licensed ? " tool-card-paywall" : ""}`}>
      <Link href={tool.route} className="tool-card-main">
        <div className="tool-icon">{tool.icon}</div>
        <div className="tool-name">{tool.name}</div>
        {sku?.tagline ? <div className="tool-card-tagline">{sku.tagline}</div> : null}
      </Link>
      {paidOffer ? (
        licensed ? (
          <div className="tool-card-sku is-licensed">Licensed</div>
        ) : trialEligible ? (
          <div className="tool-card-cta-stack">
            <button
              type="button"
              className="tool-card-subscribe"
              disabled={busy}
              onClick={() => void onTrial()}
            >
              Start {sku!.trialDays}-day trial
            </button>
            <button type="button" className="tool-card-subscribe-secondary" onClick={() => openUpgrade(tool.id)}>
              Subscribe · {inr(sku!.priceInr)}/mo
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="tool-card-subscribe"
            onClick={() => openUpgrade(tool.id)}
          >
            Subscribe · {inr(sku!.priceInr)}/mo
          </button>
        )
      ) : null}
    </article>
  );
}
