"use client";

import { useState } from "react";
import { fetchNotifications } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

/** Badge is client-only (API-driven) to avoid SSR/client hydration mismatch. */
export function NotificationDot() {
  const [count, setCount] = useState(0);

  useLiveRefresh(async () => {
    try {
      const data = await fetchNotifications();
      setCount(data.unreadCount || data.urgentCount || 0);
    } catch {
      setCount(0);
    }
  }, { intervalMs: 30_000 });

  if (count <= 0) return null;
  return (
    <span className="notif-dot" aria-hidden="true" title={`${count} unread`}>
      {count > 9 ? "9+" : count > 1 ? count : null}
    </span>
  );
}
