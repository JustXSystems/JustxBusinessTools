type AnalyticsEvent = {
  eventType: string;
  toolId?: string;
  properties?: Record<string, unknown>;
};

const queue: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushEvents();
  }, 2000);
}

async function flushEvents() {
  if (!queue.length) return;
  const events = queue.splice(0, queue.length).map((e) => ({
    eventType: e.eventType,
    toolId: e.toolId,
    properties: e.properties,
    device: typeof window !== "undefined" && window.innerWidth < 768 ? "mobile" : "desktop",
    appVersion: "1.0",
  }));

  try {
    await fetch("/api/analytics/events", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
  } catch {
    queue.unshift(...events);
  }
}

export function trackEvent(
  eventType: string,
  opts?: { toolId?: string; properties?: Record<string, unknown> },
) {
  queue.push({
    eventType,
    toolId: opts?.toolId,
    properties: opts?.properties,
  });
  scheduleFlush();
}

export function trackRecordCreate(toolId: string) {
  trackEvent("record.create", { toolId });
}

export function trackRecordUpdate(toolId: string) {
  trackEvent("record.update", { toolId });
}

export function trackRecordDelete(toolId: string) {
  trackEvent("record.delete", { toolId });
}

export function trackExport(toolId: string) {
  trackEvent("record.export", { toolId });
}

export function trackPrint(toolId: string) {
  trackEvent("doc.print", { toolId });
}

export function trackCalcRun(toolId: string) {
  trackEvent("calc.run", { toolId });
}

export function trackLimitBlocked(toolId: string) {
  trackEvent("limit.blocked", { toolId });
}

export function trackUpgradeClick() {
  trackEvent("upgrade.modal");
}
