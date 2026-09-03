/**
 * Canonical admin deep-link builders (server + mirrored on web).
 * Keep query param names stable: filter, tab, user, id, kind, status, op.
 */

export const adminDeepLink = {
  approvals: (kind?: "profile" | "user" | "payment_op" | "upi_claim") =>
    kind ? `/admin/approvals?kind=${kind}` : "/admin/approvals",

  users: () => "/admin/team",
  userPending: (userId?: number) =>
    userId != null && userId > 0
      ? `/admin/team?filter=pending&user=${userId}`
      : "/admin/team?filter=pending",

  profiles: () => "/admin/profiles",
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
  analytics: () => "/admin/analytics",
  gateways: (filter?: "unhealthy" | "enabled" | "live" | "off" | "test") =>
    filter ? `/admin/gateways?filter=${filter}` : "/admin/gateways",
  audit: () => "/admin/audit",
  subscriptions: () => "/admin/subscriptions",
  ops: () => "/admin/ops",
} as const;
