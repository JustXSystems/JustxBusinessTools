"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ToolDefinition } from "@/config/tools.config";
import { ToolUsageCounter, UsageLimitBanner } from "@/components/subscription/UsageLimitBanner";
import type { ToolUsage } from "@/lib/types/tool-record";

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
  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">←</Link>
        <div className="tool-header-text">
          <div className="tool-header-title">{tool.icon} {tool.name}</div>
          <div className="tool-header-sub">{tool.desc}</div>
        </div>
        {!tool.subscriptionExempt ? <ToolUsageCounter usage={usage} /> : null}
        {headerActions}
        {onAdd ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onAdd}
            disabled={!canCreate}
            title={!canCreate ? "Free record limit reached" : undefined}
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
