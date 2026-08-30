import type { NotificationEventType } from "./notification-events.js";
import { publishNotificationAsync } from "./notification-publish.js";
import { getActiveRole } from "./request-context.js";

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return v != null ? String(v) : "";
}

const STATUS_EVENTS: Record<
  string,
  Partial<Record<string, { eventType: NotificationEventType; title: string; severity?: "info" | "attention" | "urgent" | "critical" }>>
> = {
  servicetasks: {
    Completed: {
      eventType: "activity.staff_completed",
      title: "Service task completed",
    },
    "In Progress": {
      eventType: "workflow.stage_changed",
      title: "Service task in progress",
    },
  },
  installations: {
    "Needs Revisit": {
      eventType: "workflow.revisit_needed",
      title: "Installation needs revisit",
      severity: "urgent",
    },
    "Pending Handover": {
      eventType: "workflow.handover_pending",
      title: "Installation handover pending",
      severity: "attention",
    },
    Completed: {
      eventType: "activity.staff_completed",
      title: "Installation completed",
    },
  },
  projects: {
    "On Hold": {
      eventType: "workflow.project_at_risk",
      title: "Project placed on hold",
      severity: "attention",
    },
    Completed: {
      eventType: "activity.staff_completed",
      title: "Project completed",
    },
    "In Progress": {
      eventType: "workflow.stage_changed",
      title: "Project moved to in progress",
    },
  },
  purchaseorders: {
    Delayed: {
      eventType: "workflow.po_delayed",
      title: "Purchase order delayed",
      severity: "urgent",
    },
    Delivered: {
      eventType: "activity.staff_completed",
      title: "Purchase order delivered",
    },
    Dispatched: {
      eventType: "workflow.stage_changed",
      title: "Purchase order dispatched",
    },
  },
  visitors: {
    Completed: {
      eventType: "activity.staff_completed",
      title: "Visitor appointment completed",
    },
    Cancelled: {
      eventType: "activity.staff_major_event",
      title: "Visitor appointment cancelled",
      severity: "attention",
    },
  },
  paymenttracker: {
    Overdue: {
      eventType: "billing.receivable_overdue",
      title: "Payment marked overdue",
      severity: "urgent",
    },
    Paid: {
      eventType: "billing.payment_received",
      title: "Payment received",
    },
  },
  amc: {
    "Due for Renewal": {
      eventType: "billing.amc_renewal",
      title: "AMC due for renewal",
      severity: "attention",
    },
    Expired: {
      eventType: "billing.amc_renewal",
      title: "AMC expired",
      severity: "urgent",
    },
  },
};

function labelForRecord(toolId: string, data: Record<string, unknown>): string {
  return (
    str(data, "title") ||
    str(data, "name") ||
    str(data, "client") ||
    str(data, "party") ||
    str(data, "site") ||
    str(data, "vendor") ||
    str(data, "supplier") ||
    toolId
  );
}

/**
 * Emit stage / completion notifications when tracker status changes.
 */
export function notifyToolRecordChange(input: {
  toolId: string;
  recordId: string;
  previous?: Record<string, unknown> | null;
  next: Record<string, unknown>;
  isCreate?: boolean;
}): void {
  const prevStatus = input.previous ? str(input.previous, "status") : "";
  const nextStatus = str(input.next, "status");
  if (!nextStatus) return;
  if (!input.isCreate && prevStatus === nextStatus) return;

  const map = STATUS_EVENTS[input.toolId];
  const rule = map?.[nextStatus];
  if (!rule) {
    // Generic stage change for staff/owner when status flips on known trackers.
    if (prevStatus && prevStatus !== nextStatus && map) {
      publishNotificationAsync({
        eventType: "workflow.stage_changed",
        title: `${input.toolId} stage updated`,
        body: `"${labelForRecord(input.toolId, input.next)}" moved from ${prevStatus} to ${nextStatus}.`,
        href: `/tools/${input.toolId}`,
        entityType: "tool_record",
        entityId: input.recordId,
        dedupeKey: `stage:${input.toolId}:${input.recordId}:${nextStatus}`,
        meta: { toolId: input.toolId, from: prevStatus, to: nextStatus },
        expiresInHours: 72,
      });
    }
    return;
  }

  const role = getActiveRole();
  const body = `"${labelForRecord(input.toolId, input.next)}" is now ${nextStatus}.`;
  publishNotificationAsync({
    eventType: rule.eventType,
    title: rule.title,
    body,
    severity: rule.severity,
    href: `/tools/${input.toolId}`,
    entityType: "tool_record",
    entityId: input.recordId,
    dedupeKey: `${rule.eventType}:${input.toolId}:${input.recordId}:${nextStatus}`,
    meta: {
      toolId: input.toolId,
      status: nextStatus,
      actorRole: role,
    },
    expiresInHours: 168,
  });

  // Extra owner-only major-activity ping when staff completes (and the primary
  // event was a workflow type, not already activity.staff_completed).
  if (
    (role === "staff" || role === "legacy") &&
    rule.eventType !== "activity.staff_completed" &&
    (nextStatus === "Completed" || nextStatus === "Paid" || nextStatus === "Delivered")
  ) {
    publishNotificationAsync({
      eventType: "activity.staff_completed",
      title: "Staff completed a stage",
      body: `Staff marked "${labelForRecord(input.toolId, input.next)}" as ${nextStatus} in ${input.toolId}.`,
      href: `/tools/${input.toolId}`,
      entityType: "tool_record",
      entityId: input.recordId,
      targetRoles: ["owner"],
      targetUserId: null,
      dedupeKey: `owner-complete:${input.toolId}:${input.recordId}:${nextStatus}`,
      expiresInHours: 168,
    });
  }
}
