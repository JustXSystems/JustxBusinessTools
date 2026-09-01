import type { SubscriptionInfo } from "@/lib/types/subscription";
import { readToolCart, writeToolCart } from "@/lib/tool-cart";

/** Contingency mirror of last DB-backed subscription fetch — never preferred over a fresh API response while online. */
export const SUBSCRIPTION_CACHE_KEY = "jbt.subscription.snapshot.v1";
export const SUBSCRIPTION_SYNCED_EVENT = "jbt:subscription-synced";

type Snapshot = {
  fetchedAt: number;
  data: SubscriptionInfo;
};

export function readSubscriptionSnapshot(): SubscriptionInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SUBSCRIPTION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    if (!parsed?.data || typeof parsed.data !== "object") return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Persist the latest server payload and align session cart with licensed tools. */
export function writeSubscriptionSnapshot(data: SubscriptionInfo): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: Snapshot = { fetchedAt: Date.now(), data };
    localStorage.setItem(SUBSCRIPTION_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
  syncToolCartWithLicenses(data);
  try {
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_SYNCED_EVENT, { detail: data }));
  } catch {
    /* ignore */
  }
}

export function clearSubscriptionSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SUBSCRIPTION_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Remove cart lines that are already licensed / included on the server.
 * Keeps local cart aligned with DB entitlements after UPI approval.
 */
export function syncToolCartWithLicenses(data: SubscriptionInfo): string[] {
  if (typeof window === "undefined") return [];
  const cart = readToolCart();
  if (cart.length === 0) return cart;

  const licensed = new Set(data.licensedToolIds ?? []);
  for (const sku of data.catalog ?? []) {
    if (sku.licensed || sku.includedFree) licensed.add(sku.toolId);
  }

  const next = cart.filter((id) => !licensed.has(id));
  if (next.length !== cart.length) {
    writeToolCart(next);
  }
  return next;
}

/** True when local snapshot still claims a pending UTR that the fresh DB payload cleared. */
export function pendingClaimStale(
  cached: SubscriptionInfo | null,
  fresh: SubscriptionInfo,
): boolean {
  const wasPending = cached?.pendingClaim?.status === "pending";
  const stillPending = fresh.pendingClaim?.status === "pending";
  return Boolean(wasPending && !stillPending);
}
