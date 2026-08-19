"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { fetchSubscription } from "@/lib/api";
import { addToToolCart } from "@/lib/tool-cart";
import { trackUpgradeClick } from "@/lib/analytics";
import type { SubscriptionInfo } from "@/lib/types/subscription";

type SubscriptionContextValue = {
  subscription: SubscriptionInfo | null;
  loading: boolean;
  error: string;
  isUnlimited: boolean;
  isPro: boolean;
  licensedToolIds: string[];
  isToolLicensed: (toolId: string) => boolean;
  refresh: () => Promise<void>;
  openUpgrade: (toolId?: string) => void;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function useSubscriptionContext(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error("useSubscription must be used within SubscriptionProvider");
  }
  return ctx;
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const data = await fetchSubscription();
      setSubscription(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subscription");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const tick = window.setInterval(() => void refresh(), 20_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(tick);
    };
  }, [refresh]);

  const licensedToolIds = subscription?.licensedToolIds ?? [];
  const isUnlimited = subscription?.isUnlimited ?? subscription?.isPro ?? false;

  const isToolLicensed = useCallback(
    (toolId: string) => {
      if (isUnlimited) return true;
      const sku = subscription?.catalog?.find((s) => s.toolId === toolId);
      if (sku?.licensed || sku?.includedFree) return true;
      return licensedToolIds.includes(toolId);
    },
    [isUnlimited, licensedToolIds, subscription?.catalog],
  );

  const openUpgrade = useCallback(
    (toolId?: string) => {
      trackUpgradeClick();
      if (toolId) addToToolCart(toolId);
      router.push(toolId ? `/subscription?add=${encodeURIComponent(toolId)}` : "/subscription");
    },
    [router],
  );

  const value = useMemo(
    () => ({
      subscription,
      loading,
      error,
      isUnlimited,
      isPro: isUnlimited,
      licensedToolIds,
      isToolLicensed,
      refresh,
      openUpgrade,
    }),
    [subscription, loading, error, isUnlimited, licensedToolIds, isToolLicensed, refresh, openUpgrade],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}
