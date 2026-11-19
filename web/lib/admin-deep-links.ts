/**
 * Canonical admin deep links (keep in sync with server/src/lib/admin/deep-links.ts).
 */

export type ApprovalsKind = "profile" | "user" | "payment_op" | "upi_claim";

export const adminDeepLink = {
  approvals: (kind?: ApprovalsKind) =>
    kind ? `/admin/approvals?kind=${kind}` : "/admin/approvals",

  users: () => "/admin/team",
  userPending: (userId?: number) =>
    userId != null && userId > 0
      ? `/admin/team?filter=pending&user=${userId}`
      : "/admin/team?filter=pending",

  profiles: () => "/admin/profiles",
  /** Platform Impersonate gate — optional profile preselect + Operator landing. */
  enterAs: (profileId?: number, role?: "owner" | "admin" | "staff" | "viewer") => {
    const params = new URLSearchParams();
    if (profileId != null && profileId > 0) params.set("profile", String(profileId));
    if (role) params.set("role", role);
    const qs = params.toString();
    return qs ? `/enter?${qs}` : "/enter";
  },
  profileAccess: (id?: number, tab: "fabric" | "home" | "people" | "licenses" = "fabric") => {
    const normalized = tab === "licenses" ? "fabric" : tab;
    return id != null && id > 0
      ? `/admin/profiles?id=${id}&tab=${normalized}`
      : `/admin/profiles?tab=${normalized}`;
  },
  profilePending: (id?: number) =>
    id != null && id > 0
      ? `/admin/profiles?filter=pending&id=${id}`
      : "/admin/profiles?filter=pending",

  payments: () => "/admin/payments",
  paymentCollections: () => "/admin/payments?tab=collections",
  paymentSaas: () => "/admin/payments?tab=saas",
  paymentOps: () => "/admin/payments?tab=ops",
  paymentOpPending: (opId?: number) =>
    opId != null && opId > 0
      ? `/admin/payments?tab=ops&filter=pending&op=${opId}`
      : "/admin/payments?tab=ops&filter=pending",

  upi: () => "/admin/payments?tab=upi",
  upiClaimPending: (claimId?: number) =>
    claimId != null && claimId > 0
      ? `/admin/payments?tab=upi&status=pending&claim=${claimId}`
      : "/admin/payments?tab=upi&status=pending",

  experienceBranding: () => "/admin/experience?tab=branding",
  experienceTheme: () => "/admin/experience?tab=theme",
  tools: () => "/admin/tools",
  toolsPricing: () => "/admin/tools?tab=pricing",
  /** Profile-first tool capabilities (IMS modules and future ceilings). */
  imsModules: (profileId?: number) =>
    profileId != null && profileId > 0
      ? `/admin/profiles?id=${profileId}&tab=fabric&focus=ims`
      : "/admin/profiles?tab=fabric&focus=ims",
  toolCapabilities: (profileId?: number, toolId?: string) => {
    const params = new URLSearchParams();
    if (profileId != null && profileId > 0) params.set("id", String(profileId));
    params.set("tab", "fabric");
    params.set("focus", toolId && toolId !== "imsdealer" ? toolId : "ims");
    return `/admin/profiles?${params.toString()}`;
  },
  analytics: () => "/admin/analytics",
  gateways: (filter?: "unhealthy" | "enabled" | "live" | "off" | "test") =>
    filter ? `/admin/gateways?filter=${filter}` : "/admin/gateways",
  audit: () => "/admin/audit",
  integrations: () => "/admin/integrations",
  subscriptions: () => "/admin/subscriptions",
  ops: () => "/admin/ops",
} as const;
