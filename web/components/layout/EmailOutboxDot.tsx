"use client";

import { useState } from "react";
import { fetchEmailOutboxStatus } from "@/lib/email-outbox";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

/** Badge for pending/failed Email Outbox items (not the Notifications inbox). */
export function EmailOutboxDot() {
  const [count, setCount] = useState(0);

  useLiveRefresh(async () => {
    try {
      const data = await fetchEmailOutboxStatus();
      setCount(data.pendingCount || 0);
    } catch {
      setCount(0);
    }
  }, { intervalMs: 30_000 });

  if (count <= 0) return null;
  return (
    <span className="notif-dot" aria-hidden="true" title={`${count} pending email(s)`}>
      {count > 9 ? "9+" : count > 1 ? count : null}
    </span>
  );
}
