"use client";

import { useSubscriptionContext } from "@/components/subscription/SubscriptionProvider";

export function useSubscription() {
  return useSubscriptionContext();
}
