"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { fetchSubscription } from "@/lib/api";
import { addToToolCart } from "@/lib/tool-cart";
import { trackUpgradeClick } from "@/lib/analytics";
import {
  pendingClaimStale,
  readSubscriptionSnapshot,
  writeSubscriptionSnapshot,
} from "@/lib/subscription-cache";
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
  // Live-first: do not seed UI from contingency snapshot (avoids stale UPI/license states).
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const prevRef = useRef<SubscriptionInfo | null>(null);
  const liveConfirmedRef = useRef(false);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const data = await fetchSubscription();
      const prev = prevRef.current;
      // Always trust DB payload over any local snapshot.
      writeSubscriptionSnapshot(data);
      prevRef.current = data;
      liveConfirmedRef.current = true;
      setSubscription(data);

      if (pendingClaimStale(prev, data)) {
        try {
          window.dispatchEvent(
            new CustomEvent("jbt:upi-claim-resolved", {
              detail: {
                previousUtr: prev?.pendingClaim?.utr,
                licensedToolIds: data.licensedToolIds ?? [],
              },
            }),
          );
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      // Contingency only when we have no live session data yet.
      if (!liveConfirmedRef.current) {
        const contingency = readSubscriptionSnapshot();
        if (contingency) {
          prevRef.current = contingency;
          setSubscription(contingency);
        }
      }
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
    const onAuth = () => void refresh();
    const onOnline = () => void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("jbt:auth-context-changed", onAuth);
    window.addEventListener("jbt:data-invalidate", onAuth);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("jbt:auth-context-changed", onAuth);
      window.removeEventListener("jbt:data-invalidate", onAuth);
    };
  }, [refresh]);

  // Poll faster while a UPI claim is pending so admin approval shows up quickly.
  useEffect(() => {
    const pending = subscription?.pendingClaim?.status === "pending";
    const ms = pending ? 5_000 : 30_000;
    const tick = window.setInterval(() => void refresh(), ms);
    return () => window.clearInterval(tick);
  }, [refresh, subscription?.pendingClaim?.status]);

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
