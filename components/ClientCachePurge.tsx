"use client";

import { useEffect } from "react";
import { invalidateBrandingCache } from "@/components/branding/BrandingProvider";
import {
  CLIENT_CACHE_PURGE_VERSION,
  purgeClientCachesOnce,
} from "@/lib/client-cache-purge";

const RELOAD_FLAG = `jbt.cache-purge-reloaded:${CLIENT_CACHE_PURGE_VERSION}`;

/** One-shot wipe of SW / Cache Storage / jbt* browser storage on version bump. */
export function ClientCachePurge() {
  useEffect(() => {
    void (async () => {
      const didPurge = await purgeClientCachesOnce();
      if (!didPurge) return;

      invalidateBrandingCache();

      try {
        // Avoid a reload loop if Strict Mode / double-mount races.
        if (sessionStorage.getItem(RELOAD_FLAG) === "1") return;
        sessionStorage.setItem(RELOAD_FLAG, "1");
      } catch {
        /* ignore */
      }

      window.location.reload();
    })();
  }, []);

  return null;
}
