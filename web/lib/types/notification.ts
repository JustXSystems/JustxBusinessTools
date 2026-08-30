export type NotificationCategory =
  | "workflow"
  | "reminder"
  | "approval"
  | "billing"
  | "activity"
  | "system"
  | "usage";

export type NotificationSeverity = "info" | "attention" | "urgent" | "critical";

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
  role: string;
};
