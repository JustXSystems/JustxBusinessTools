import type { OrgRole } from "./request-context.js";

/** High-level buckets shown in the corporate inbox. */
export type NotificationCategory =
  | "workflow"
  | "reminder"
  | "approval"
  | "billing"
  | "activity"
  | "system"
  | "usage";

export type NotificationSeverity = "info" | "attention" | "urgent" | "critical";

export type NotificationAudience = OrgRole | "platform";

/**
 * Hierarchy: Admin → Owner → Staff
 *
 * - Staff: minimal inbox. Role audiences almost never include `staff`.
 *   Staff only receive (1) personal `targetUserId` copies and (2) branch-derived reminders.
 * - Owner: all major staff activity + all business-profile / billing / approval events for the org.
 * - Admin: platform + org oversight (and owner-facing business events).
 *
 * Personal delivery uses `targetUserId` (defaults to actor on publish).
 */
export const NOTIFICATION_EVENTS = {
  // ── Staff operational work → Owner sees; actor staff gets personal copy ─
  "workflow.stage_changed": {
    category: "workflow" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "🔄",
  },
  "workflow.pending_activity": {
    category: "reminder" as const,
    severity: "attention" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "⏳",
  },
  "workflow.task_overdue": {
    category: "reminder" as const,
    severity: "urgent" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "⚠️",
  },
  "workflow.appointment_upcoming": {
    category: "reminder" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "🗓️",
  },
  "workflow.handover_pending": {
    category: "workflow" as const,
    severity: "attention" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "📦",
  },
  "workflow.revisit_needed": {
    category: "workflow" as const,
    severity: "urgent" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "🔧",
  },
  "workflow.po_delayed": {
    category: "workflow" as const,
    severity: "urgent" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "🚚",
  },
  "workflow.project_at_risk": {
    category: "workflow" as const,
    severity: "attention" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "📁",
  },

  // ── Quotation / site survey → Owner; acting staff via targetUserId ─────
  "document.quotation_submitted": {
    category: "workflow" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "📑",
  },
  "document.quotation_sent": {
    category: "workflow" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "📄",
  },
  "document.quotation_approved": {
    category: "workflow" as const,
    severity: "attention" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "✅",
  },
  "document.quotation_rejected": {
    category: "workflow" as const,
    severity: "urgent" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "✖️",
  },
  "document.survey_submitted": {
    category: "activity" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "☀️",
  },
  "document.survey_sent": {
    category: "activity" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "📤",
  },

  // ── Owner: staff major activity ─────────────────────────────────────────
  "activity.staff_completed": {
    category: "activity" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "✔️",
  },
  "activity.staff_major_event": {
    category: "activity" as const,
    severity: "attention" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "📣",
  },

  // ── Business profile (admin → owner always) ─────────────────────────────
  "business.profile_updated": {
    category: "system" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🏢",
  },
  "artifact.synced": {
    category: "activity" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "📁",
  },
  "artifact.sync_failed": {
    category: "activity" as const,
    severity: "attention" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "📂",
  },
  "business.branch_submitted": {
    category: "approval" as const,
    severity: "attention" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🏛️",
  },
  "business.branch_approved": {
    category: "approval" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "✅",
  },
  "business.branch_rejected": {
    category: "approval" as const,
    severity: "urgent" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🚫",
  },
  "business.branch_archived": {
    category: "system" as const,
    severity: "attention" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🗄️",
  },

  // ── Approvals / team (staff only via personal targetUserId) ─────────────
  "approval.requested": {
    category: "approval" as const,
    severity: "attention" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "🛂",
  },
  "approval.decided": {
    category: "approval" as const,
    severity: "info" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "📋",
  },
  "team.member_invited": {
    category: "system" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "👤",
  },
  "team.member_pending": {
    category: "approval" as const,
    severity: "attention" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "🧑‍💼",
  },
  "team.member_approved": {
    category: "system" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🤝",
  },
  "team.role_changed": {
    category: "system" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🔑",
  },

  // ── Billing (Owner + Admin; staff only if personally targeted) ──────────
  "billing.subscription_renewal": {
    category: "billing" as const,
    severity: "attention" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "💳",
  },
  "billing.subscription_activated": {
    category: "billing" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "✨",
  },
  "billing.subscription_cancelled": {
    category: "billing" as const,
    severity: "attention" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "📴",
  },
  "billing.subscription_assigned": {
    category: "billing" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🏷️",
  },
  "billing.subscription_expired": {
    category: "billing" as const,
    severity: "critical" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "⛔",
  },
  "billing.subscription_past_due": {
    category: "billing" as const,
    severity: "urgent" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "📅",
  },
  "billing.checkout_started": {
    category: "billing" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🛒",
  },
  "billing.license_granted": {
    category: "billing" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🔓",
  },
  "billing.license_revoked": {
    category: "billing" as const,
    severity: "attention" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🔒",
  },
  "billing.payment_received": {
    category: "billing" as const,
    severity: "info" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "💰",
  },
  "billing.payment_failed": {
    category: "billing" as const,
    severity: "urgent" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "💸",
  },
  "billing.payment_ops_created": {
    category: "billing" as const,
    severity: "attention" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "🧾",
  },
  "billing.payment_ops_cleared": {
    category: "billing" as const,
    severity: "info" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "✅",
  },
  "billing.upi_claim_submitted": {
    category: "billing" as const,
    severity: "attention" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "📲",
  },
  "billing.upi_claim_decided": {
    category: "billing" as const,
    severity: "info" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "🏦",
  },
  "billing.amc_renewal": {
    category: "reminder" as const,
    severity: "attention" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "🛠️",
  },
  "billing.receivable_overdue": {
    category: "reminder" as const,
    severity: "urgent" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "💰",
  },

  // ── Documents / outbound → Owner; sender via targetUserId ───────────────
  "document.sent_email": {
    category: "activity" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "✉️",
  },
  "document.sent_whatsapp": {
    category: "activity" as const,
    severity: "info" as const,
    audience: ["owner"] as NotificationAudience[],
    icon: "💬",
  },

  // ── Auth / access ───────────────────────────────────────────────────────
  "auth.user_registered": {
    category: "system" as const,
    severity: "attention" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🆕",
  },
  "team.member_suspended": {
    category: "system" as const,
    severity: "urgent" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "⛔",
  },
  "team.member_rejected": {
    category: "system" as const,
    severity: "attention" as const,
    audience: ["owner", "admin"] as NotificationAudience[],
    icon: "🚫",
  },

  // ── Admin / JustX platform ──────────────────────────────────────────────
  "admin.business_update": {
    category: "system" as const,
    severity: "info" as const,
    // Business-profile related admin updates must reach the owner.
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "🛰️",
  },
  "admin.usage_alert": {
    category: "usage" as const,
    severity: "attention" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "📊",
  },
  "admin.limit_reached": {
    category: "usage" as const,
    severity: "urgent" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "🚦",
  },
  "admin.system_issue": {
    category: "system" as const,
    severity: "critical" as const,
    audience: ["admin"] as NotificationAudience[],
    icon: "🛠️",
  },
  "admin.gateway_event": {
    category: "billing" as const,
    severity: "attention" as const,
    audience: ["admin", "owner"] as NotificationAudience[],
    icon: "🔌",
  },
} as const;

export type NotificationEventType = keyof typeof NOTIFICATION_EVENTS;

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  workflow: "Workflow",
  reminder: "Reminders",
  approval: "Approvals",
  billing: "Billing",
  activity: "Team activity",
  system: "System",
  usage: "Usage",
};

export const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: "Info",
  attention: "Attention",
  urgent: "Urgent",
  critical: "Critical",
};

export function eventMeta(eventType: NotificationEventType) {
  return NOTIFICATION_EVENTS[eventType];
}

/**
 * Hierarchy expansion (Admin → Owner → Staff):
 * - Staff/viewer actions → always notify Owner (major activity upward).
 *   Never broadcast to the whole Staff role (personal targetUserId only).
 * - Owner actions → keep catalogue; ensure Owner; do not fan-out to all Staff.
 * - Admin actions → ensure Admin + Owner (business-profile / org relevance).
 *   Staff receive admin decisions only via explicit targetUserId.
 */
export function expandAudienceForActor(
  catalogAudience: readonly NotificationAudience[],
  actorRole: OrgRole | "legacy" | null | undefined,
): NotificationAudience[] {
  const set = new Set<NotificationAudience>(catalogAudience);

  // Staff never receive role-level broadcasts — only personal targetUserId.
  set.delete("staff");
  set.delete("viewer");

  if (actorRole === "staff" || actorRole === "viewer" || actorRole === "legacy") {
    set.add("owner");
  } else if (actorRole === "owner") {
    set.add("owner");
  } else if (actorRole === "admin") {
    set.add("admin");
    set.add("owner");
  }

  return [...set];
}

/** Roles that may see derived operational reminders (branch-scoped, not broadcasts). */
export function rolesForDerivedReminders(role: OrgRole | "legacy"): boolean {
  if (role === "legacy") return true;
  return role === "staff" || role === "owner" || role === "viewer" || role === "admin";
}
