"use client";

import { useOfflineSync } from "@/hooks/useOfflineSync";

export function OfflineSyncBanner({ onSynced }: { onSynced?: () => void }) {
  const { online, pending, syncing } = useOfflineSync(onSynced);

  if (online && pending === 0) return null;

  return (
    <div className={`offline-banner ${online ? "offline-banner-syncing" : "offline-banner-offline"}`}>
      {online
        ? syncing
          ? "Syncing offline changes…"
          : `${pending} change(s) waiting to sync`
        : "You are offline — changes will sync when connection returns"}
    </div>
  );
}
