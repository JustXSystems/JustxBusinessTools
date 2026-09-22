export type QuoteAlertKind = "approval" | "rejected" | "sent" | "link" | "submit" | "activity";

export type QuoteAlertTone = "success" | "warning" | "danger" | "info" | "neutral";

export type QuoteAlertMeta = {
  kind: QuoteAlertKind;
  tone: QuoteAlertTone;
  label: string;
  icon: string;
  actionable: boolean;
};

const KIND_META: Record<QuoteAlertKind, Omit<QuoteAlertMeta, "kind">> = {
  approval: { tone: "success", label: "Approved", icon: "✓", actionable: true },
  rejected: { tone: "danger", label: "Rejected", icon: "!", actionable: true },
  sent: { tone: "info", label: "Sent", icon: "↗", actionable: true },
  link: { tone: "warning", label: "Approval link", icon: "◎", actionable: true },
  submit: { tone: "info", label: "Submitted", icon: "⇪", actionable: true },
  activity: { tone: "neutral", label: "Activity", icon: "·", actionable: false },
};

export function classifyQuoteAlert(message: string): QuoteAlertMeta {
  const m = message.toLowerCase();
  let kind: QuoteAlertKind = "activity";
  if (m.includes("reject")) kind = "rejected";
  else if (m.includes("approv") && m.includes("link")) kind = "link";
  else if (m.includes("approv")) kind = "approval";
  else if (m.includes("submitted") || m.includes("submit")) kind = "submit";
  else if (
    m.includes("sent") ||
    m.includes("emailed") ||
    m.includes("whatsapp") ||
    m.includes("queued") ||
    m.includes("opened on")
  ) {
    kind = "sent";
  }
  return { kind, ...KIND_META[kind] };
}

export type QuoteAlertFilter = "all" | "unread" | "action" | QuoteAlertKind;

export function quoteAlertMatchesFilter(
  filter: QuoteAlertFilter,
  opts: { read: boolean; kind: QuoteAlertKind; actionable: boolean },
): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !opts.read;
  if (filter === "action") return !opts.read && opts.actionable;
  return opts.kind === filter;
}

/** Counts that match each filter key exactly (for accurate KPI / chip labels). */
export function countQuoteAlerts(
  notifications: Array<{ message: string; read: boolean }>,
  filter: QuoteAlertFilter,
): number {
  let n = 0;
  for (const item of notifications) {
    const meta = classifyQuoteAlert(item.message);
    if (
      quoteAlertMatchesFilter(filter, {
        read: item.read,
        kind: meta.kind,
        actionable: meta.actionable,
      })
    ) {
      n += 1;
    }
  }
  return n;
}

export function quoteAlertFilterStats(notifications: Array<{ message: string; read: boolean }>) {
  return {
    all: notifications.length,
    unread: countQuoteAlerts(notifications, "unread"),
    action: countQuoteAlerts(notifications, "action"),
    approval: countQuoteAlerts(notifications, "approval"),
    rejected: countQuoteAlerts(notifications, "rejected"),
    sent: countQuoteAlerts(notifications, "sent"),
    link: countQuoteAlerts(notifications, "link"),
    submit: countQuoteAlerts(notifications, "submit"),
    activity: countQuoteAlerts(notifications, "activity"),
  };
}
