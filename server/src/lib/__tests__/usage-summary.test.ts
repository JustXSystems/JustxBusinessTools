import { describe, expect, it } from "vitest";
import { buildWorkspaceUsageTelemetry } from "../usage-summary.js";
import type { ToolSku } from "../tool-skus.js";
import type { ToolLicense } from "../tool-licenses.js";
import type { SubscriptionItem } from "../subscription-items.js";

function makeSku(partial: Partial<ToolSku> & { toolId: string; name: string }): ToolSku {
  return {
    category: "Sales",
    tagline: null,
    description: null,
    priceInr: 149,
    annualPriceInr: null,
    billingInterval: "month",
    includedFree: false,
    available: true,
    sortOrder: 0,
    trialDays: 14,
    accessPolicy: "soft_cap",
    unlicensedRecordLimit: null,
    featured: false,
    ...partial,
  };
}

describe("buildWorkspaceUsageTelemetry", () => {
  it("computes included, licensed, expiring trial, near-limit, at-limit, and hard-locked states", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const skus: ToolSku[] = [
      makeSku({ toolId: "gstcalc", name: "GST Calc", priceInr: 0, includedFree: true }),
      makeSku({ toolId: "quotation", name: "Quotation", accessPolicy: "hard_lock" }),
      makeSku({ toolId: "invoice", name: "Invoice", accessPolicy: "hard_lock" }),
      makeSku({ toolId: "paymenttracker", name: "Payments" }),
      makeSku({ toolId: "vendors", name: "Vendors" }),
      makeSku({ toolId: "amc", name: "AMC" }),
    ];

    const licenses: ToolLicense[] = [
      {
        toolId: "quotation",
        name: "Quotation",
        status: "active",
        periodEnd: "2026-06-04T00:00:00.000Z", // 3 days left -> expiring soon trial
        sourceClaimId: null,
        recordLimitOverride: null,
        businessProfileId: 1,
      },
    ];
    const billingItems: SubscriptionItem[] = [
      {
        toolId: "quotation",
        name: "Quotation",
        unitPriceInr: 0,
        quantity: 1,
        status: "active",
        source: "trial",
        externalRef: "trial:1",
        periodEnd: "2026-06-04T00:00:00.000Z",
        createdAt: null,
        updatedAt: null,
      },
    ];

    const { byTool, summary } = buildWorkspaceUsageTelemetry({
      skus,
      licenses,
      billingItems,
      recordCounts: {
        quotation: 12,
        paymenttracker: 25, // 25/28 -> near_limit
        vendors: 28, // 28/28 -> at_limit
        amc: 5, // 5/28 -> freemium
      },
      freemiumRecordLimit: 28,
      now,
    });

    expect(byTool.gstcalc.status).toBe("included");
    expect(byTool.quotation.status).toBe("expiring_soon");
    expect(byTool.quotation.isTrial).toBe(true);
    expect(byTool.quotation.daysLeft).toBe(3);

    expect(byTool.invoice.status).toBe("hard_locked");
    expect(byTool.invoice.limit).toBe(0);

    expect(byTool.paymenttracker.status).toBe("near_limit");
    expect(byTool.paymenttracker.utilizationPct).toBe(89);

    expect(byTool.vendors.status).toBe("at_limit");
    expect(byTool.vendors.utilizationPct).toBe(100);

    expect(byTool.amc.status).toBe("freemium");

    expect(summary.totalRecords).toBe(70);
    expect(summary.activeToolsUsed).toBe(4);
    expect(summary.trialCount).toBe(1);
    expect(summary.trialsExpiringSoon).toBe(1);
    expect(summary.toolsNearLimit).toBe(1);
    expect(summary.toolsAtLimit).toBe(1);
    expect(summary.hardLockedCount).toBe(1);
  });
});
