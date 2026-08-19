export type NotificationItem = {
  id: string;
  toolId: string;
  icon: string;
  text: string;
  date: string | null;
  urgent: boolean;
};

export type NotificationsPayload = {
  items: NotificationItem[];
  urgentCount: number;
};
