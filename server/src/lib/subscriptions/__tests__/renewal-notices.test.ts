import { describe, expect, it } from "vitest";
import { buildRenewalNotificationCopy } from "../renewal-notices.js";

describe("renewal-notices copy & deep links", () => {
  it("builds trial-ending urgent copy with 1-click yearly checkout deep link", () => {
    const out = buildRenewalNotificationCopy({
      organizationId: 7,
      organizationName: "Acme Steel",
      planId: "trial:invoice",
      planName: "Invoice & Billing (Trial)",
      toolId: "invoice",
      toolName: "Invoice & Billing",
      isTrial: true,
      periodEnd: "2026-11-28",
      daysLeft: 2,
      mrrInr: 0,
    });

    expect(out.kind).toBe("trial_ending");
    expect(out.severity).toBe("urgent");
    expect(out.href).toBe("/subscription/checkout?tool=invoice&cycle=year");
    expect(out.title).toContain("Invoice & Billing trial ends in 2 day(s)");
    expect(out.dedupeKey).toBe("trial_end:7:invoice:2026-11-28");
  });

  it("builds per-tool paid renewal copy with stacking reminder", () => {
    const out = buildRenewalNotificationCopy({
      organizationId: 9,
      organizationName: "Solo Studio",
      planId: "tool:ims",
      planName: "Inventory",
      toolId: "ims",
      toolName: "Inventory",
      isTrial: false,
      periodEnd: "2026-12-03",
      daysLeft: 7,
      mrrInr: 499,
    });

    expect(out.kind).toBe("renewal");
    expect(out.severity).toBe("attention");
    expect(out.href).toBe("/subscription/checkout?tool=ims&cycle=year");
    expect(out.body).toMatch(/stack remaining days/i);
  });

  it("builds org-level renewal copy pointing to annual storefront", () => {
    const out = buildRenewalNotificationCopy({
      organizationId: 3,
      organizationName: "MultiBranch Corp",
      planId: "pro",
      planName: "All Tools Pack",
      periodEnd: "2026-11-26",
      daysLeft: 0,
      mrrInr: 2999,
    });

    expect(out.kind).toBe("renewal");
    expect(out.severity).toBe("urgent");
    expect(out.href).toBe("/subscription?cycle=year");
    expect(out.title).toBe("Renewal due today");
  });
});
