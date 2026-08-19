"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { fetchNotifications } from "@/lib/api";

/** Badge is client-only (API-driven) to avoid SSR/client hydration mismatch. */
export function NotificationDot() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setVisible(false);

    fetchNotifications()
      .then((data) => {
        if (!cancelled) setVisible(data.urgentCount > 0);
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!visible) return null;
  return <span className="notif-dot" aria-hidden="true" />;
}
