"use client";

import { useEffect } from "react";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import {
  resolveInstallIconDisplay,
  resolveInstallName,
} from "@/lib/install-branding";

const SYNC_ATTR = "data-jbt-icon-sync";

/**
 * Upsert a client-owned <link>. Never remove/replace Next metadata links —
 * that races React reconciliation and causes removeChild on null.
 */
function upsertSyncLink(rel: string, href: string, attrs?: Record<string, string>) {
  if (typeof document === "undefined" || !document.head) return;

  let el = document.head.querySelector(
    `link[${SYNC_ATTR}="1"][rel="${rel}"]`,
  ) as HTMLLinkElement | null;

  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    el.setAttribute(SYNC_ATTR, "1");
    document.head.appendChild(el);
  }

  if (el.getAttribute("href") !== href) {
    el.href = href;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (el.getAttribute(k) !== v) el.setAttribute(k, v);
    }
  }
}

function versionToken(icon: string, name: string): string {
  try {
    return btoa(`${icon}|${name}`).replace(/=+$/, "").slice(0, 32);
  } catch {
    return String(Date.now());
  }
}

/**
 * Sync favicon + apple-touch + manifest href so Chrome re-reads install icons
 * after admin branding changes (manifest is otherwise aggressively cached).
 */
export function DocumentIconSync() {
  const { branding, loading } = usePlatformBranding();

  useEffect(() => {
    if (loading) return;
    const icon = resolveInstallIconDisplay(branding.logoUrl, branding.installIconUrl);
    const name = resolveInstallName(branding.appName, branding.installName);
    const v = versionToken(`${icon}|${branding.installIconBg || "transparent"}`, name);

    upsertSyncLink("icon", `/pwa-icon/192?v=${encodeURIComponent(v)}`, {
      type: "image/png",
      sizes: "192x192",
    });
    upsertSyncLink("apple-touch-icon", `/pwa-icon/512?v=${encodeURIComponent(v)}`, {
      sizes: "512x512",
    });
    upsertSyncLink("manifest", `/manifest.webmanifest?v=${encodeURIComponent(v)}`);

    const title = branding.appName || "JustXSystems";
    if (document.title !== title) document.title = title;
  }, [branding, loading]);

  return null;
}
