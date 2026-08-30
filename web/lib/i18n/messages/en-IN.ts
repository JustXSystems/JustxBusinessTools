export const enIN = {
  common: {
    loading: "Loading…",
    save: "Save",
    cancel: "Cancel",
    export: "Export",
    exportCsv: "Export CSV",
    exportXlsx: "Export Excel",
    exportProOnly: "Export is available after you subscribe to this tool.",
    upgrade: "Subscribe to this tool",
  },
  notifications: {
    title: "Notifications",
    subtitle: "Operational alerts, approvals, and business activity.",
    roleStaff: "Stage changes, pending work, and reminders for your branch.",
    roleOwner: "Business events, staff completions, approvals, and renewals.",
    roleAdmin: "Platform alerts — profiles, billing, approvals, usage, and issues.",
    allCaughtUp: "All caught up",
    allCaughtUpSub:
      "Workflow stages, reminders, approvals, billing, and team activity will appear here.",
    urgent: "Urgent",
    attention: "Attention",
    upcoming: "Info",
    loadError: "Failed to load notifications",
    markRead: "Mark read",
    markAllRead: "Mark all read",
    filterAll: "All",
    filterUnread: "Unread",
    filterUrgent: "Urgent",
    kpiTotal: "Total",
    kpiUnread: "Unread",
    kpiUrgent: "Urgent",
    liveReminder: "Live reminder",
  },
  settings: {
    locale: "Language",
    localeHint: "More languages will be added in future releases.",
  },
} as const;

export type MessageCatalog = typeof enIN;
