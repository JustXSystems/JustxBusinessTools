"use client";

import Link from "next/link";
import type { ToolDefinition } from "@/config/tools.config";
import { useSubscription } from "@/hooks/useSubscription";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const { subscription, isToolLicensed, openUpgrade } = useSubscription();
  const sku = subscription?.catalog?.find((s) => s.toolId === tool.id);
  const licensed = isToolLicensed(tool.id);
  const paidOffer = sku && !sku.includedFree && sku.priceInr > 0;

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
        ) : (
          <button
            type="button"
            className="tool-card-subscribe"
            onClick={() => openUpgrade(tool.id)}
          >
            Subscribe · {inr(sku.priceInr)}/mo
          </button>
        )
      ) : null}
    </article>
  );
}
