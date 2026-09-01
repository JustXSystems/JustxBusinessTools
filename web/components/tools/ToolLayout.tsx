"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ToolDefinition } from "@/config/tools.config";
import { ToolUsageCounter, UsageLimitBanner } from "@/components/subscription/UsageLimitBanner";
import { useSubscription } from "@/hooks/useSubscription";
import type { ToolUsage } from "@/lib/types/tool-record";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

type Props = {
  tool: ToolDefinition;
  usage: ToolUsage | null;
  atLimit: boolean;
  nearLimit: boolean;
  canCreate: boolean;
  onAdd?: () => void;
  addLabel?: string;
  headerActions?: ReactNode;
  children: ReactNode;
};

export function ToolLayout({
  tool,
  usage,
  atLimit,
  nearLimit,
  canCreate,
  onAdd,
  addLabel = "+ Add",
  headerActions,
  children,
}: Props) {
  const { subscription, isToolLicensed, openUpgrade } = useSubscription();
  const sku = subscription?.catalog?.find((s) => s.toolId === tool.id);
  const licensed = isToolLicensed(tool.id);
  const showSubscribe =
    !tool.subscriptionExempt && Boolean(sku && !sku.includedFree && sku.priceInr > 0 && !licensed);

  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">
            {tool.icon} {tool.name}
          </div>
          <div className="tool-header-sub">{tool.desc}</div>
        </div>
        {!tool.subscriptionExempt ? <ToolUsageCounter usage={usage} licensed={licensed} /> : null}
        {showSubscribe && sku ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => openUpgrade(tool.id)}
          >
            Subscribe · {inr(sku.priceInr)}/mo
          </button>
        ) : null}
        {headerActions}
        {onAdd ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onAdd}
            disabled={!canCreate}
            title={!canCreate ? "Subscribe to unlock more records" : undefined}
          >
            {addLabel}
          </button>
        ) : null}
      </div>

      <UsageLimitBanner usage={usage} atLimit={atLimit} nearLimit={nearLimit} />
      {children}
    </div>
  );
}
