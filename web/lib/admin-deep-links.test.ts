import { describe, expect, it } from "vitest";
import { adminDeepLink } from "@/lib/admin-deep-links";

describe("adminDeepLink tool capabilities", () => {
  it("points IMS modules at Access Fabric", () => {
    expect(adminDeepLink.imsModules(12)).toBe("/admin/profiles?id=12&tab=fabric&focus=ims");
    expect(adminDeepLink.imsModules()).toBe("/admin/profiles?tab=fabric&focus=ims");
  });

  it("builds toolCapabilities with focus", () => {
    expect(adminDeepLink.toolCapabilities(5, "imsdealer")).toBe(
      "/admin/profiles?id=5&tab=fabric&focus=ims",
    );
    expect(adminDeepLink.toolCapabilities(5, "bos")).toBe(
      "/admin/profiles?id=5&tab=fabric&focus=bos",
    );
  });

  it("builds user and renewals destinations", () => {
    expect(adminDeepLink.users(9)).toBe("/admin/team?user=9");
    expect(adminDeepLink.users()).toBe("/admin/team");
    expect(adminDeepLink.subscriptionsRenewals()).toBe("/admin/subscriptions#renewals");
    expect(adminDeepLink.delivery()).toBe("/admin/ops#delivery");
    expect(adminDeepLink.experiencePublicHome()).toBe("/admin/experience?tab=public-home");
    expect(adminDeepLink.analyticsTool("invoice")).toBe("/admin/analytics/tools/invoice");
  });

  it("builds tools pricing with profile", () => {
    expect(adminDeepLink.toolsPricing("imsdealer", 3)).toBe(
      "/admin/tools?tool=imsdealer&tab=pricing&profile=3",
    );
  });

  it("builds failure and limit-block destinations", () => {
    expect(adminDeepLink.paymentSaasFailed()).toBe("/admin/payments?tab=saas&txnStatus=failed");
    expect(adminDeepLink.analytics("limit_blocks")).toBe("/admin/analytics?focus=limit_blocks");
    expect(adminDeepLink.upiClaimPending()).toBe("/admin/payments?tab=upi&status=pending");
    expect(adminDeepLink.paymentOpPending()).toBe("/admin/payments?tab=ops&filter=pending");
    expect(adminDeepLink.approvals("profile")).toBe("/admin/approvals?kind=profile");
  });
});
