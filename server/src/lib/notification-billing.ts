import { publishNotification, publishNotificationAsync } from "./notification-publish.js";
import type { NotificationEventType } from "./notification-events.js";

function toolListLabel(toolIds: string[]): string {
  if (!toolIds.length) return "selected tools";
  if (toolIds.length <= 3) return toolIds.join(", ");
  return `${toolIds.slice(0, 3).join(", ")} +${toolIds.length - 3} more`;
}

/** Subscription / plan lifecycle. */
export function notifySubscriptionActivated(input: {
  organizationId: number;
  profileId?: number | null;
  planId: string;
  planName?: string;
  provider?: string | null;
}): void {
  const name = input.planName || input.planId;
  publishNotificationAsync({
    eventType: "billing.subscription_activated",
    title: "Subscription activated",
    body: `${name} is now active${input.provider ? ` via ${input.provider}` : ""}.`,
    organizationId: input.organizationId,
    businessProfileId: input.profileId ?? null,
    href: "/admin/subscriptions",
    entityType: "org_subscription",
    entityId: String(input.organizationId),
    dedupeKey: `sub-activated:${input.organizationId}:${input.planId}:${Date.now()}`,
    meta: { planId: input.planId, provider: input.provider },
    expiresInHours: 336,
  });
}

export function notifySubscriptionCancelled(input: {
  organizationId: number;
  profileId?: number | null;
  provider?: string | null;
}): void {
  publishNotificationAsync({
    eventType: "billing.subscription_cancelled",
    title: "Subscription cancelled",
    body: `Paid access was cancelled${input.provider ? ` (${input.provider})` : ""}. Workspace reverted to limited mode.`,
    organizationId: input.organizationId,
    businessProfileId: input.profileId ?? null,
    href: "/admin/subscriptions",
    entityType: "org_subscription",
    entityId: String(input.organizationId),
    dedupeKey: `sub-cancelled:${input.organizationId}:${Date.now()}`,
    severity: "attention",
    expiresInHours: 336,
  });
}

export async function notifySubscriptionAssigned(input: {
  organizationId: number;
  planId: string;
  planName?: string;
  trialDays?: number;
}): Promise<void> {
  const trial =
    input.trialDays && input.trialDays > 0 ? ` (trial ${input.trialDays} day(s))` : "";
  await publishNotification({
    eventType: "billing.subscription_assigned",
    title: "Plan assigned by admin",
    body: `${input.planName || input.planId}${trial} applied to the organization.`,
    organizationId: input.organizationId,
    businessProfileId: null,
    href: "/admin/subscriptions",
    entityType: "org_subscription",
    entityId: String(input.organizationId),
    actorRole: "admin",
    dedupeKey: `sub-assign:${input.organizationId}:${input.planId}:${Date.now()}`,
    expiresInHours: 336,
  });
}

export function notifySubscriptionExpired(input: {
  organizationId: number;
  planName?: string;
  periodEnd: string;
}): void {
  publishNotificationAsync({
    eventType: "billing.subscription_expired",
    title: "Subscription period ended",
    body: `${input.planName || "Plan"} ended on ${input.periodEnd}. Renew to restore paid tools.`,
    organizationId: input.organizationId,
    businessProfileId: null,
    href: "/admin/subscriptions",
    entityType: "org_subscription",
    entityId: String(input.organizationId),
    dedupeKey: `sub-expired:${input.organizationId}:${input.periodEnd}`,
    severity: "critical",
    dueAt: input.periodEnd,
    expiresInHours: 720,
  });
}

export function notifyPaymentOutcome(input: {
  organizationId: number;
  success: boolean;
  amountInr: number;
  provider?: string | null;
  reference?: string | null;
  errorMessage?: string | null;
}): void {
  const eventType: NotificationEventType = input.success
    ? "billing.payment_received"
    : "billing.payment_failed";
  publishNotificationAsync({
    eventType,
    title: input.success ? "Payment received" : "Payment failed",
    body: input.success
      ? `₹${input.amountInr.toFixed(2)} cleared${input.provider ? ` via ${input.provider}` : ""}${input.reference ? ` · ${input.reference}` : ""}.`
      : `Charge of ₹${input.amountInr.toFixed(2)} failed${input.errorMessage ? `: ${input.errorMessage}` : "."}`,
    organizationId: input.organizationId,
    businessProfileId: null,
    href: "/admin/payments",
    entityType: "payment_transaction",
    entityId: input.reference ?? String(input.organizationId),
    dedupeKey: `pay:${input.success ? "ok" : "fail"}:${input.organizationId}:${input.reference ?? Date.now()}`,
    severity: input.success ? "info" : "urgent",
    expiresInHours: 336,
  });
}

export function notifyLicensesGranted(input: {
  organizationId: number;
  toolIds: string[];
  periodEnd?: Date | null;
  source?: string;
}): void {
  if (!input.toolIds.length) return;
  const end = input.periodEnd ? input.periodEnd.toISOString().slice(0, 10) : null;
  publishNotificationAsync({
    eventType: "billing.license_granted",
    title: "Tool licenses activated",
    body: `${toolListLabel(input.toolIds)} unlocked${end ? ` until ${end}` : ""}${input.source ? ` (${input.source})` : ""}.`,
    organizationId: input.organizationId,
    businessProfileId: null,
    href: "/",
    entityType: "org_tool_licenses",
    entityId: String(input.organizationId),
    dedupeKey: `lic-grant:${input.organizationId}:${input.toolIds.slice().sort().join(",")}:${end ?? "open"}`,
    meta: { toolIds: input.toolIds, periodEnd: end },
    expiresInHours: 336,
  });
}

export function notifyLicensesRevoked(input: {
  organizationId: number;
  toolIds?: string[];
}): void {
  const label = input.toolIds?.length ? toolListLabel(input.toolIds) : "All paid tools";
  publishNotificationAsync({
    eventType: "billing.license_revoked",
    title: "Tool licenses revoked",
    body: `${label} cancelled for this organization.`,
    organizationId: input.organizationId,
    businessProfileId: null,
    href: "/admin/subscriptions",
    entityType: "org_tool_licenses",
    entityId: String(input.organizationId),
    dedupeKey: `lic-revoke:${input.organizationId}:${(input.toolIds ?? ["all"]).join(",")}:${Date.now()}`,
    severity: "attention",
    expiresInHours: 336,
  });
}

export function notifyCheckoutStarted(input: {
  organizationId: number;
  amountInr: number;
  toolIds: string[];
  provider: string;
}): void {
  publishNotificationAsync({
    eventType: "billing.checkout_started",
    title: "Checkout started",
    body: `₹${input.amountInr.toFixed(2)} for ${toolListLabel(input.toolIds)} via ${input.provider}. Complete payment to activate.`,
    organizationId: input.organizationId,
    businessProfileId: null,
    href: "/profile",
    entityType: "checkout",
    entityId: String(input.organizationId),
    dedupeKey: `checkout:${input.organizationId}:${Date.now()}`,
    expiresInHours: 48,
  });
}

export async function notifyPaymentOps(input: {
  organizationId: number;
  opId: number;
  party: string;
  amountInr: number;
  kind: string;
  decided?: "approved" | "rejected";
  relatedUserId?: number | null;
}): Promise<void> {
  if (input.decided) {
    await publishNotification({
      eventType: "billing.payment_ops_cleared",
      title: input.decided === "approved" ? "Payment desk cleared" : "Payment desk rejected",
      body: `${input.kind} · ${input.party} · ₹${input.amountInr.toFixed(2)} was ${input.decided}.`,
      organizationId: input.organizationId,
      businessProfileId: null,
      href: "/admin/payments",
      entityType: "payment_op",
      entityId: String(input.opId),
      actorRole: "admin",
      targetUserId: input.relatedUserId ?? null,
      dedupeKey: `payops:${input.opId}:${input.decided}`,
      severity: input.decided === "rejected" ? "urgent" : "info",
      expiresInHours: 168,
    });
    return;
  }
  await publishNotification({
    eventType: "billing.payment_ops_created",
    title: "Payment desk entry pending",
    body: `${input.kind} · ${input.party} · ₹${input.amountInr.toFixed(2)} awaits approval.`,
    organizationId: input.organizationId,
    businessProfileId: null,
    href: "/admin/approvals",
    entityType: "payment_op",
    entityId: String(input.opId),
    targetUserId: input.relatedUserId ?? undefined,
    dedupeKey: `payops-create:${input.opId}`,
    expiresInHours: 336,
  });
}

export function notifyUsageLimit(input: {
  organizationId: number;
  profileId?: number | null;
  toolId: string;
  limit: number;
  kind: "reached" | "near";
  recordCount?: number;
}): void {
  if (input.kind === "reached") {
    publishNotificationAsync({
      eventType: "admin.limit_reached",
      title: "Free usage limit reached",
      body: `${input.toolId} hit the free record limit (${input.limit}). Subscribe or license this tool to continue.`,
      organizationId: input.organizationId,
      businessProfileId: input.profileId ?? null,
      href: "/admin/subscriptions",
      entityType: "tool_usage",
      entityId: input.toolId,
      dedupeKey: `limit-reached:${input.organizationId}:${input.profileId ?? 0}:${input.toolId}`,
      severity: "urgent",
      expiresInHours: 72,
    });
    return;
  }
  publishNotificationAsync({
    eventType: "admin.usage_alert",
    title: "Approaching free usage limit",
    body: `${input.toolId} is at ${input.recordCount ?? "?"}/${input.limit} records. Consider upgrading soon.`,
    organizationId: input.organizationId,
    businessProfileId: input.profileId ?? null,
    href: "/admin/subscriptions",
    entityType: "tool_usage",
    entityId: input.toolId,
    dedupeKey: `limit-near:${input.organizationId}:${input.profileId ?? 0}:${input.toolId}:${input.limit}`,
    severity: "attention",
    expiresInHours: 72,
  });
}

export function notifyDocumentOutbound(input: {
  channel: "email" | "whatsapp";
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  href: string;
}): void {
  publishNotificationAsync({
    eventType: input.channel === "email" ? "document.sent_email" : "document.sent_whatsapp",
    title: input.title,
    body: input.body,
    href: input.href,
    entityType: input.entityType,
    entityId: input.entityId,
    dedupeKey: `outbound:${input.channel}:${input.entityId}:${Date.now()}`,
    expiresInHours: 72,
  });
}
