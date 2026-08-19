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
    subtitle: "Reminders and activity across your tools.",
    allCaughtUp: "All caught up",
    allCaughtUpSub:
      "Reminders from AMC, payments, visitors, and service tasks will appear here.",
    urgent: "Urgent",
    upcoming: "Upcoming",
    loadError: "Failed to load notifications",
  },
  settings: {
    locale: "Language",
    localeHint: "More languages will be added in future releases.",
  },
} as const;

export type MessageCatalog = typeof enIN;
