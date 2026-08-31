import {
  parseInstallIconBg,
  resolveInstallIconUrl,
  resolveInstallName,
} from "@/lib/install-branding";
import { DEFAULT_BRANDING, type PlatformBranding } from "@/components/branding/BrandingProvider";

function apiOrigin(): string {
  const raw =
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    `http://127.0.0.1:${process.env.API_PROXY_PORT || "4000"}`;
  return raw.replace(/\/$/, "");
}

function webOrigin(): string {
  const raw =
    process.env.WEB_PUBLIC_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_ORIGIN ||
    "http://127.0.0.1:3000";
  return raw.replace(/\/$/, "");
}

export async function loadPlatformBrandingFresh(): Promise<PlatformBranding> {
  const urls = [
    `${apiOrigin()}/api/config/branding?t=${Date.now()}`,
    // Fallback through Next rewrite when API_INTERNAL_URL is wrong in some envs
    `http://127.0.0.1:${process.env.PORT || "3000"}/api/config/branding?t=${Date.now()}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { branding?: Partial<PlatformBranding> };
      const merged = { ...DEFAULT_BRANDING, ...(data.branding ?? {}) };
      merged.installIconUrl = resolveInstallIconUrl(merged.logoUrl, merged.installIconUrl);
      merged.installIconBg = parseInstallIconBg(merged.installIconBg);
      return merged;
    } catch {
      /* try next */
    }
  }
  return { ...DEFAULT_BRANDING };
}

export function brandingIconVersion(b: PlatformBranding): string {
  const icon = resolveInstallIconUrl(b.logoUrl, b.installIconUrl);
  const name = resolveInstallName(b.appName, b.installName);
  const bg = String(b.installIconBg || "transparent");
  return Buffer.from(`${icon}|${name}|${bg}`).toString("base64url").slice(0, 24);
}

/**
 * Path Chrome should load for install / desktop icons.
 * Always use /pwa-icon so we emit exact square 192/512 PNGs.
 * Raw uploads (often non-square / huge) are rejected by Chrome's install UI.
 */
export function resolveManifestIconPath(_b: PlatformBranding): {
  path: string;
  type: string;
} {
  return { path: "/pwa-icon/512", type: "image/png" };
}

/** Resolve icon to an absolute URL the Next server can fetch. */
export function absoluteIconFetchUrl(iconPath: string): string {
  const icon = String(iconPath || "").trim();
  const base =
    (process.env.NEXT_PUBLIC_BASE_PATH ?? process.env.WEB_BASE_PATH ?? "").trim().replace(/\/$/, "") ||
    "";
  if (!icon) return `${webOrigin()}${base}/icons/presets/justx-mark.png`;
  if (icon.startsWith("http://") || icon.startsWith("https://")) return icon;
  if (icon.startsWith("/api/")) return `${apiOrigin()}${icon}`;
  const path = icon.startsWith("/") ? icon : `/${icon}`;
  const prefixed =
    base && path !== base && !path.startsWith(`${base}/`) ? `${base}${path}` : path;
  return `${webOrigin()}${prefixed}`;
}

export function iconMimeFromUrl(url: string, fallback = "image/png"): string {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".png")) return "image/png";
  return fallback;
}

export { resolveInstallIconUrl, resolveInstallName, webOrigin };
