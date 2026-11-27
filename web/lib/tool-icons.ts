import type { CSSProperties } from "react";
import { publicAssetUrl, withBasePath } from "@/lib/base-path";

export type ToolIconShape = "rounded" | "square" | "circle";

export type ToolIconConfig = {
  /** Default / Light-mode icon (emoji, /public path, uploaded file URL, or https:// URL). */
  light?: string;
  /** Optional Dark-mode icon override (falls back to light). */
  dark?: string;
  /** Browser tab favicon (.ico / .svg / .png). */
  favicon?: string;
  /** Apple touch icon (PNG preferred). */
  appleTouch?: string;
  /** 192×192 icon variant. */
  size192?: string;
  /** 512×512 icon variant. */
  size512?: string;
  /** 1024×1024 high-res icon variant (OpenGraph / marketing). */
  size1024?: string;
  /** Tile background: "transparent" or #RRGGBB. */
  bg?: string;
  /** Tile corner shape. */
  shape?: ToolIconShape;
  /** Inner padding in px (0..12). */
  paddingPx?: number;
};

export type ToolIconsMap = Record<string, ToolIconConfig>;

/**
 * Built-in static icon variants shipped in `web/public/icons/`.
 * Admin overrides saved via Admin → Tools → Icons take precedence field-by-field.
 */
export const BUILTIN_TOOL_ICON_DEFAULTS: ToolIconsMap = {
  bos: {
    light: "/icons/BOS/svg/bos-app-light.svg",
    dark: "/icons/BOS/svg/bos-app-dark.svg",
    favicon: "/icons/BOS/web/bos-favicon.svg",
    appleTouch: "/icons/BOS/web/apple-touch-icon.png",
    size192: "/icons/BOS/web/android-chrome-192x192.png",
    size512: "/icons/BOS/web/android-chrome-512x512.png",
    size1024: "/icons/BOS/png/app-light/bos-app-light-1024.png",
  },
  bosdesign: {
    light: "/icons/BOS/svg/bos-mark-light.svg",
    dark: "/icons/BOS/svg/bos-mark-dark.svg",
    favicon: "/icons/BOS/web/favicon-mark.ico",
    appleTouch: "/icons/BOS/web/apple-touch-icon.png",
  },
  imsdealer: {
    light: "/icons/IMS/justx-invoice-icon.svg",
    favicon: "/icons/IMS/favicon.ico",
    appleTouch: "/icons/IMS/justx-invoice-icon-512.png",
    size512: "/icons/IMS/justx-invoice-icon-512.png",
    size1024: "/icons/IMS/justx-invoice-icon-1024.png",
  },
};

export type ToolIconSizeHint = "sm" | "md" | "lg" | "xl" | "favicon" | "apple";

export function isImageIcon(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  return (
    v.startsWith("/") ||
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("data:")
  );
}

/** Resolve a stored/public icon URL with basePath when needed. */
export function resolveIconAssetUrl(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("data:")) return v;
  if (v.startsWith("/api/")) return withBasePath(v);
  if (v.startsWith("/")) return publicAssetUrl(v);
  return v;
}

/** Pick the best icon string (image URL/path or emoji) for a given theme and size. */
export function resolveToolIconSource(
  cfg: ToolIconConfig | null | undefined,
  fallback: string,
  opts?: { theme?: "light" | "dark"; size?: ToolIconSizeHint },
): string {
  const theme = opts?.theme ?? "light";
  const size = opts?.size ?? "md";

  if (size === "favicon") {
    return (
      cfg?.favicon ||
      (theme === "dark" ? cfg?.dark : undefined) ||
      cfg?.light ||
      cfg?.size192 ||
      cfg?.size512 ||
      fallback
    );
  }
  if (size === "apple") {
    return cfg?.appleTouch || cfg?.size512 || cfg?.size192 || cfg?.light || fallback;
  }

  const themed = theme === "dark" ? cfg?.dark || cfg?.light : cfg?.light;
  if (size === "xl") {
    return cfg?.size1024 || cfg?.size512 || themed || fallback;
  }
  if (size === "lg") {
    return themed || cfg?.size512 || cfg?.size192 || fallback;
  }
  return themed || cfg?.size192 || cfg?.size512 || fallback;
}

export function toolIconTileStyle(cfg: ToolIconConfig | null | undefined): CSSProperties | undefined {
  if (!cfg) return undefined;
  const style: CSSProperties = {};
  if (cfg.bg && cfg.bg !== "transparent") style.background = cfg.bg;
  if (cfg.shape === "square") style.borderRadius = 4;
  else if (cfg.shape === "circle") style.borderRadius = "50%";
  else if (cfg.shape === "rounded") style.borderRadius = 10;
  if (cfg.paddingPx && cfg.paddingPx > 0) style.padding = cfg.paddingPx;
  return Object.keys(style).length > 0 ? style : undefined;
}

export function normalizeToolIconsMap(raw: unknown): ToolIconsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ToolIconsMap = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const cfg: ToolIconConfig = {};
    for (const k of ["light", "dark", "favicon", "appleTouch", "size192", "size512", "size1024"] as const) {
      if (typeof obj[k] === "string" && obj[k].trim()) cfg[k] = obj[k].trim();
    }
    if (typeof obj.bg === "string" && obj.bg.trim()) cfg.bg = obj.bg.trim();
    if (obj.shape === "rounded" || obj.shape === "square" || obj.shape === "circle") {
      cfg.shape = obj.shape;
    }
    if (typeof obj.paddingPx === "number" && Number.isFinite(obj.paddingPx)) {
      cfg.paddingPx = Math.min(12, Math.max(0, Math.round(obj.paddingPx)));
    }
    if (Object.keys(cfg).length > 0) out[id] = cfg;
  }
  return out;
}
