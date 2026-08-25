"use client";

import { useCallback, useState } from "react";
import { fetchToolUsage } from "@/lib/api";
import type { ToolUsage } from "@/lib/types/tool-record";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

export function useUsageLimit(toolId: string, subscriptionExempt: boolean) {
  const [usage, setUsage] = useState<ToolUsage | null>(null);
  const [loading, setLoading] = useState(!subscriptionExempt);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (subscriptionExempt) {
      setUsage(null);
      setLoading(false);
      return;
    }
    setError("");
    try {
      const data = await fetchToolUsage(toolId);
      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, [toolId, subscriptionExempt]);

  useLiveRefresh(refresh, { intervalMs: 60_000, enabled: !subscriptionExempt });

  return {
    usage,
    loading,
    error,
    refresh,
    atLimit: subscriptionExempt ? false : usage?.atLimit ?? false,
    nearLimit: subscriptionExempt ? false : usage?.nearLimit ?? false,
    canCreate: subscriptionExempt || !usage?.atLimit,
  };
}
