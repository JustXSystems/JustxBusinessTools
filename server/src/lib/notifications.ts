import {
  CATEGORY_LABELS,
  rolesForDerivedReminders,
  type NotificationCategory,
  type NotificationSeverity,
} from "./notification-events.js";
import { ensureNotificationSchema } from "./notification-schema.js";
import {
  getActiveOrgId,
  getActiveProfileId,
  getActiveRole,
  getActiveUserId,
  getIsPlatformAdmin,
  type OrgRole,
} from "./request-context.js";

export type NotificationItem = {
  id: string;
  source: "event" | "derived";
  eventType: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  toolId: string | null;
  icon: string;
  title: string;
  text: string;
  date: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  urgent: boolean;
  read: boolean;
  createdAt: string;
  businessProfileId: number | null;
};

export type NotificationsPayload = {
  items: NotificationItem[];
  unreadCount: number;
  urgentCount: number;
  categories: Array<{ id: NotificationCategory; label: string; count: number }>;
  role: OrgRole | "legacy";
};

function daysFrom(dateStr: string, today: string): number {
  const t0 = new Date(today.slice(0, 10));
  const t1 = new Date(dateStr.slice(0, 10));
  t0.setHours(0, 0, 0, 0);
  t1.setHours(0, 0, 0, 0);
  return Math.round((t1.getTime() - t0.getTime()) / 86400000);
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return v != null ? String(v) : "";
}

function severityRank(s: NotificationSeverity): number {
  switch (s) {
    case "critical":
      return 0;
    case "urgent":
      return 1;
    case "attention":
      return 2;
    default:
      return 3;
  }
}

function isUrgent(severity: NotificationSeverity): boolean {
  return severity === "urgent" || severity === "critical";
}

/** Build operational reminders from tracker tool_records (still live-derived). */
export function buildNotificationsFromRecords(
  records: Array<{ toolId: string; id: string; data: Record<string, unknown> }>,
  today: string,
): NotificationItem[] {
  const items: NotificationItem[] = [];
  const nowIso = `${today}T00:00:00.000Z`;

  for (const row of records) {
    const data = row.data ?? {};
    const toolId = row.toolId;

    if (toolId === "amc") {
      const renewalDate = str(data, "renewalDate");
      const client = str(data, "client") || "Client";
      if (!renewalDate) continue;
      const days = daysFrom(renewalDate, today);
      if (days <= 30) {
        const overdue = days < 0;
        const severity: NotificationSeverity = days < 7 ? "urgent" : "attention";
        items.push({
          id: `derived-amc-${row.id}`,
          source: "derived",
          eventType: "billing.amc_renewal",
          category: "reminder",
          severity,
          toolId,
          icon: "🛠️",
          title: overdue ? "AMC renewal overdue" : "AMC renewal upcoming",
          text: overdue
            ? `AMC renewal for ${client} is overdue`
            : `AMC renewal for ${client} due in ${days} day(s)`,
          date: renewalDate,
          href: `/tools/amc`,
          entityType: "tool_record",
          entityId: row.id,
          urgent: isUrgent(severity),
          read: false,
          createdAt: nowIso,
          businessProfileId: null,
        });
      }
    }

    if (toolId === "paymenttracker") {
      const status = str(data, "status");
      if (status !== "Overdue" && status !== "Pending") continue;
      const party = str(data, "party") || "Party";
      const kind = str(data, "kind") || "Payment";
      const amount = Number(data.amount) || 0;
      const date = str(data, "date") || null;
      const severity: NotificationSeverity = status === "Overdue" ? "urgent" : "attention";
      items.push({
        id: `derived-pay-${row.id}`,
        source: "derived",
        eventType: "billing.receivable_overdue",
        category: "reminder",
        severity,
        toolId,
        icon: "💰",
        title: status === "Overdue" ? "Payment overdue" : "Payment pending",
        text: `${kind} of ₹${amount.toFixed(2)} from ${party} is ${status.toLowerCase()}`,
        date,
        href: `/tools/paymenttracker`,
        entityType: "tool_record",
        entityId: row.id,
        urgent: isUrgent(severity),
        read: false,
        createdAt: nowIso,
        businessProfileId: null,
      });
    }

    if (toolId === "visitors") {
      const status = str(data, "status");
      const date = str(data, "date");
      if (status !== "Scheduled" || !date || date < today) continue;
      const name = str(data, "name") || "Visitor";
      items.push({
        id: `derived-vis-${row.id}`,
        source: "derived",
        eventType: "workflow.appointment_upcoming",
        category: "reminder",
        severity: "info",
        toolId,
        icon: "🗓️",
        title: "Upcoming appointment",
        text: `Appointment with ${name} on ${date}`,
        date,
        href: `/tools/visitors`,
        entityType: "tool_record",
        entityId: row.id,
        urgent: false,
        read: false,
        createdAt: nowIso,
        businessProfileId: null,
      });
    }

    if (toolId === "servicetasks") {
      const status = str(data, "status");
      const dueDate = str(data, "dueDate");
      if (status === "Completed" || !dueDate) continue;
      const title = str(data, "title") || "Task";
      const overdue = dueDate < today;
      const severity: NotificationSeverity = overdue ? "urgent" : "attention";
      items.push({
        id: `derived-task-${row.id}`,
        source: "derived",
        eventType: overdue ? "workflow.task_overdue" : "workflow.pending_activity",
        category: "reminder",
        severity,
        toolId,
        icon: "🔧",
        title: overdue ? "Service task overdue" : "Service task due",
        text: `Service task "${title}" due ${dueDate}`,
        date: dueDate,
        href: `/tools/servicetasks`,
        entityType: "tool_record",
        entityId: row.id,
        urgent: isUrgent(severity),
        read: false,
        createdAt: nowIso,
        businessProfileId: null,
      });
    }

    if (toolId === "installations") {
      const status = str(data, "status");
      if (status !== "Needs Revisit" && status !== "Pending Handover") continue;
      const site = str(data, "site") || str(data, "client") || "Site";
      const revisit = status === "Needs Revisit";
      items.push({
        id: `derived-inst-${row.id}`,
        source: "derived",
        eventType: revisit ? "workflow.revisit_needed" : "workflow.handover_pending",
        category: "workflow",
        severity: revisit ? "urgent" : "attention",
        toolId,
        icon: revisit ? "🔧" : "📦",
        title: revisit ? "Installation revisit needed" : "Handover pending",
        text: `${site}: ${status}`,
        date: str(data, "date") || null,
        href: `/tools/installations`,
        entityType: "tool_record",
        entityId: row.id,
        urgent: revisit,
        read: false,
        createdAt: nowIso,
        businessProfileId: null,
      });
    }

    if (toolId === "purchaseorders") {
      const status = str(data, "status");
      const expected = str(data, "expectedDate");
      const delayed = status === "Delayed" || (expected && expected < today && status !== "Delivered");
      if (!delayed) continue;
      const vendor = str(data, "vendor") || str(data, "supplier") || "Vendor";
      items.push({
        id: `derived-po-${row.id}`,
        source: "derived",
        eventType: "workflow.po_delayed",
        category: "workflow",
        severity: "urgent",
        toolId,
        icon: "🚚",
        title: "Purchase order delayed",
        text: `PO from ${vendor} is delayed${expected ? ` (expected ${expected})` : ""}`,
        date: expected || null,
        href: `/tools/purchaseorders`,
        entityType: "tool_record",
        entityId: row.id,
        urgent: true,
        read: false,
        createdAt: nowIso,
        businessProfileId: null,
      });
    }

    if (toolId === "projects") {
      const status = str(data, "status");
      const endDate = str(data, "endDate");
      const onHold = status === "On Hold";
      const overdue =
        endDate && endDate < today && status !== "Completed" && status !== "On Hold";
      if (!onHold && !overdue) continue;
      const name = str(data, "name") || str(data, "title") || "Project";
      items.push({
        id: `derived-proj-${row.id}`,
        source: "derived",
        eventType: "workflow.project_at_risk",
        category: "workflow",
        severity: overdue ? "urgent" : "attention",
        toolId,
        icon: "📁",
        title: onHold ? "Project on hold" : "Project past target date",
        text: onHold
          ? `Project "${name}" is on hold`
          : `Project "${name}" target date ${endDate} has passed`,
        date: endDate || null,
        href: `/tools/projects`,
        entityType: "tool_record",
        entityId: row.id,
        urgent: Boolean(overdue),
        read: false,
        createdAt: nowIso,
        businessProfileId: null,
      });
    }
  }

  return items;
}

async function loadDerived(
  profileId: number,
  today: string,
): Promise<NotificationItem[]> {
  const { pool } = await import("../db.js");
  const [rows] = await pool.query(
    `SELECT id, tool_id, data FROM tool_records
     WHERE business_profile_id = :profileId
       AND tool_id IN (
         'amc', 'paymenttracker', 'visitors', 'servicetasks',
         'installations', 'purchaseorders', 'projects'
       )`,
    { profileId },
  );

  const records = (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as { id: string; tool_id: string; data: string | Record<string, unknown> };
    let data: Record<string, unknown> = {};
    if (typeof r.data === "string") {
      try {
        data = JSON.parse(r.data) as Record<string, unknown>;
      } catch {
        data = {};
      }
    } else {
      data = r.data ?? {};
    }
    return { id: r.id, toolId: r.tool_id, data };
  });

  return buildNotificationsFromRecords(records, today).map((item) => ({
    ...item,
    businessProfileId: profileId,
  }));
}

function parseRoles(raw: unknown): OrgRole[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => String(r) as OrgRole);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map((r) => String(r) as OrgRole);
    } catch {
      /* ignore */
    }
  }
  return [];
}

function roleSeesEvent(role: OrgRole | "legacy", targets: OrgRole[], targetUserId: number | null, userId: number | null): boolean {
  if (role === "legacy") return true;
  if (targetUserId != null && userId != null && targetUserId === userId) return true;
  if (targets.includes(role)) return true;
  // Platform / org admins also see owner-scoped billing & system when acting as admin.
  if (role === "admin" && (targets.includes("owner") || targets.includes("admin"))) return true;
  return false;
}

async function loadStoredEvents(opts: {
  orgId: number;
  profileId: number;
  role: OrgRole | "legacy";
  userId: number | null;
  isPlatformAdmin: boolean;
}): Promise<NotificationItem[]> {
  await ensureNotificationSchema();
  const { pool } = await import("../db.js");

  const params = {
    orgId: opts.orgId,
    profileId: opts.profileId,
    userId: opts.userId ?? 0,
  };

  // Admins see org-wide + all branches; owners see all branches; staff/viewer see active branch + org-wide.
  let scopeSql: string;
  if (opts.isPlatformAdmin) {
    scopeSql = "1=1";
  } else if (opts.role === "admin" || opts.role === "owner") {
    scopeSql = "n.organization_id = :orgId";
  } else {
    scopeSql = `n.organization_id = :orgId
      AND (n.business_profile_id IS NULL OR n.business_profile_id = :profileId)`;
  }

  const [rows] = await pool.query(
    `SELECT n.*,
            (r.user_id IS NOT NULL) AS is_read
     FROM app_notifications n
     LEFT JOIN app_notification_reads r
       ON r.notification_id = n.id AND r.user_id = :userId
     WHERE ${scopeSql}
       AND (n.expires_at IS NULL OR n.expires_at > NOW())
     ORDER BY n.created_at DESC
     LIMIT 300`,
    params,
  );

  const items: NotificationItem[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as Record<string, unknown>;
    const targets = parseRoles(r.target_roles);
    const targetUserId = r.target_user_id == null ? null : Number(r.target_user_id);
    if (!opts.isPlatformAdmin && !roleSeesEvent(opts.role, targets, targetUserId, opts.userId)) {
      continue;
    }
    const severity = String(r.severity ?? "info") as NotificationSeverity;
    items.push({
      id: `evt-${r.id}`,
      source: "event",
      eventType: String(r.event_type),
      category: String(r.category) as NotificationCategory,
      severity,
      toolId: null,
      icon: String(r.icon ?? "🔔"),
      title: String(r.title),
      text: String(r.body),
      date: r.due_at ? String(r.due_at).slice(0, 10) : String(r.created_at).slice(0, 10),
      href: (r.href as string | null) ?? null,
      entityType: (r.entity_type as string | null) ?? null,
      entityId: (r.entity_id as string | null) ?? null,
      urgent: isUrgent(severity),
      read: Boolean(r.is_read),
      createdAt: String(r.created_at),
      businessProfileId: r.business_profile_id == null ? null : Number(r.business_profile_id),
    });
  }
  return items;
}

function sortInbox(items: NotificationItem[]): NotificationItem[] {
  return items.slice().sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    const sr = severityRank(a.severity) - severityRank(b.severity);
    if (sr !== 0) return sr;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

export async function getInboxNotifications(
  today = new Date().toISOString().slice(0, 10),
): Promise<NotificationsPayload> {
  const role = getActiveRole();
  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();
  const userId = getActiveUserId();
  const isPlatformAdmin = getIsPlatformAdmin();

  const stored = await loadStoredEvents({
    orgId,
    profileId,
    role,
    userId,
    isPlatformAdmin,
  });

  let derived: NotificationItem[] = [];
  if (rolesForDerivedReminders(role) && !isPlatformAdmin) {
    derived = await loadDerived(profileId, today);
  } else if (isPlatformAdmin || role === "admin") {
    // Admins still see derived for the active branch when reviewing operations.
    derived = await loadDerived(profileId, today);
  }

  const items = sortInbox([...stored, ...derived]);
  const unreadCount = items.filter((i) => !i.read).length;
  const urgentCount = items.filter((i) => i.urgent && !i.read).length;

  const catMap = new Map<NotificationCategory, number>();
  for (const item of items) {
    catMap.set(item.category, (catMap.get(item.category) ?? 0) + 1);
  }
  const categories = (Object.keys(CATEGORY_LABELS) as NotificationCategory[])
    .filter((id) => (catMap.get(id) ?? 0) > 0)
    .map((id) => ({ id, label: CATEGORY_LABELS[id], count: catMap.get(id) ?? 0 }));

  return { items, unreadCount, urgentCount, categories, role };
}

/** @deprecated Prefer getInboxNotifications — kept for older call sites / tests. */
export async function getDerivedNotifications(
  profileId = getActiveProfileId(),
  today = new Date().toISOString().slice(0, 10),
): Promise<{ items: NotificationItem[]; urgentCount: number }> {
  const items = await loadDerived(profileId, today);
  return { items, urgentCount: items.filter((i) => i.urgent).length };
}

export async function markNotificationRead(notificationId: string, userId?: number | null): Promise<boolean> {
  const uid = userId ?? getActiveUserId();
  if (!uid) return false;
  if (!notificationId.startsWith("evt-")) return false;
  const id = Number(notificationId.slice(4));
  if (!Number.isFinite(id) || id <= 0) return false;
  await ensureNotificationSchema();
  const { pool } = await import("../db.js");
  await pool.query(
    `INSERT IGNORE INTO app_notification_reads (notification_id, user_id)
     VALUES (:id, :userId)`,
    { id, userId: uid },
  );
  return true;
}

export async function markAllNotificationsRead(userId?: number | null): Promise<number> {
  const uid = userId ?? getActiveUserId();
  if (!uid) return 0;
  const inbox = await getInboxNotifications();
  let count = 0;
  for (const item of inbox.items) {
    if (item.read || item.source !== "event") continue;
    if (await markNotificationRead(item.id, uid)) count += 1;
  }
  return count;
}
