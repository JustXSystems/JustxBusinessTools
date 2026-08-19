"use client";

import { useCallback, useEffect, useState } from "react";
import { flushOfflineQueue } from "@/lib/offline/sync-engine";
import { offlineQueueCount } from "@/lib/offline/queue-store";

/** Returns true when `navigator.onLine` is available; defaults true for SSR. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}
