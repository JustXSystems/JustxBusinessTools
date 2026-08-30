"use client";

import { useCallback, useEffect, useState } from "react";
import { flushOfflineQueue } from "@/lib/offline/sync-engine";
import { offlineQueueCount } from "@/lib/offline/queue-store";
import { OFFLINE_SYNCED_EVENT } from "@/lib/offline/types";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function useOfflineSync(onSynced?: () => void) {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(() => {
    setPending(offlineQueueCount());
  }, []);

  const sync = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    if (offlineQueueCount() === 0) return null;

    setSyncing(true);
    try {
      const result = await flushOfflineQueue();
      refreshCount();
      if (result.processed > 0) {
        window.dispatchEvent(new CustomEvent(OFFLINE_SYNCED_EVENT));
        onSynced?.();
      }
      return result;
    } finally {
      setSyncing(false);
    }
  }, [onSynced, refreshCount]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    if (!online || offlineQueueCount() === 0) return;
    sync();
  }, [online, sync]);

  return { online, pending, syncing, sync, refreshCount };
}
