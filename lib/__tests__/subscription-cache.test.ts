/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { SubscriptionInfo } from "@/lib/types/subscription";

function baseSub(over: Partial<SubscriptionInfo> = {}): SubscriptionInfo {
  return {
    businessProfileId: 1,
    planId: "free",
    status: "active",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    paymentProvider: null,
    recordLimit: 28,
    accessMode: "limited",
    isUnlimited: false,
    isPro: false,
    provider: "upi",
    plans: [],
    catalog: [
      { toolId: "amc", name: "AMC", category: "Ops", priceInr: 199, billingInterval: "month", includedFree: false, licensed: true },
      { toolId: "projects", name: "Projects", category: "Ops", priceInr: 199, billingInterval: "month", includedFree: false, licensed: false },
    ],
    licensedToolIds: ["amc"],
    pendingClaim: null,
    ...over,
  };
}

describe("subscription-cache cart sync", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
  });

  it("clears licensed tools from the cart when writing a DB snapshot", async () => {
    sessionStorage.setItem("jbt.tool-cart", JSON.stringify(["amc", "projects"]));
    const { writeSubscriptionSnapshot } = await import("../subscription-cache");
    writeSubscriptionSnapshot(baseSub());
    expect(JSON.parse(sessionStorage.getItem("jbt.tool-cart") ?? "[]")).toEqual(["projects"]);
  });

  it("detects when a pending claim was cleared by the server", async () => {
    const { pendingClaimStale } = await import("../subscription-cache");
    const cached = baseSub({
      pendingClaim: {
        id: 9,
        status: "pending",
        utr: "ABC123456789",
        amountInr: 399,
        createdAt: new Date().toISOString(),
        reviewNote: null,
      },
    });
    const fresh = baseSub({ pendingClaim: null, licensedToolIds: ["amc", "projects"] });
    expect(pendingClaimStale(cached, fresh)).toBe(true);
    expect(pendingClaimStale(fresh, fresh)).toBe(false);
  });
});
