"use client";

import Link from "next/link";
import type { ToolDefinition } from "@/config/tools.config";
import { useSubscription } from "@/hooks/useSubscription";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const { subscription, isToolLicensed } = useSubscription();
  const sku = subscription?.catalog?.find((s) => s.toolId === tool.id);
  const licensed = isToolLicensed(tool.id);

  return (
    <Link href={tool.route} className="tool-card">
      <div className="tool-icon">{tool.icon}</div>
      <div className="tool-name">{tool.name}</div>
      {sku && !sku.includedFree ? (
        <div className="tool-card-sku">{licensed ? "Licensed" : `${inr(sku.priceInr)}/mo`}</div>
      ) : null}
    </Link>
  );
}
