import { pool } from "../../db.js";
import { canonicalizeStoredImageUrl, saveImageUpload, withFileAccessToken } from "../storage.js";
import {
  parseSplashAnimation,
  parseSplashIntensity,
  type SplashAnimation,
  type SplashIntensity,
} from "./splash-animation.js";

function parseInstallIconBg(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || /^transparent$/i.test(s) || /^none$/i.test(s)) return "transparent";
  const hex = s.startsWith("#") ? s : `#${s}`;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const r = hex[1];
    const g = hex[2];
    const b = hex[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return "transparent";
}

export type PlatformBranding = {
  logoUrl: string;
  appName: string;
  tagline: string;
  splashDurationMs: number;
  splashAnimation: SplashAnimation;
  splashIntensity: SplashIntensity;
  splashShowProgress: boolean;
  /** Desktop / PWA install label (falls back to appName when empty). */
  installName: string;
  /** Desktop / PWA icon URL (preset path, file URL, or falls back to logo). */
  installIconUrl: string;
  /** Install icon canvas: `transparent` (default) or #RRGGBB. */
  installIconBg: string;
};

export const DEFAULT_INSTALL_ICON_URL = "/icons/presets/justx-mark.png";

export const DEFAULT_BRANDING: PlatformBranding = {
  logoUrl: "/icons/justxsystems-icon.svg",
  appName: "JustXSystems",
  tagline: "JustXSystems",
  splashDurationMs: 2200,
  splashAnimation: "dash",
  splashIntensity: "balanced",
  splashShowProgress: true,
  installName: "JustXSystems",
  installIconUrl: DEFAULT_INSTALL_ICON_URL,
  installIconBg: "transparent",
};

const KEY = "branding";
const MIN_SPLASH_MS = 0;
const MAX_SPLASH_MS = 15000;
const MAX_INSTALL_NAME = 40;

function parseBranding(raw: unknown): PlatformBranding {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  // Handle accidental double-encoding from drivers that stringify JSON columns.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  const obj =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const splash = Number(obj.splashDurationMs);
  const installName = String(obj.installName ?? "").trim();
  const installIconUrl = String(obj.installIconUrl ?? "").trim();
  return {
    logoUrl: String(obj.logoUrl ?? DEFAULT_BRANDING.logoUrl).trim() || DEFAULT_BRANDING.logoUrl,
    appName: String(obj.appName ?? DEFAULT_BRANDING.appName).trim() || DEFAULT_BRANDING.appName,
    tagline: String(obj.tagline ?? DEFAULT_BRANDING.tagline).trim() || DEFAULT_BRANDING.tagline,
    splashDurationMs: Number.isFinite(splash)
      ? Math.min(MAX_SPLASH_MS, Math.max(MIN_SPLASH_MS, Math.round(splash)))
      : DEFAULT_BRANDING.splashDurationMs,
    splashAnimation: parseSplashAnimation(obj.splashAnimation ?? DEFAULT_BRANDING.splashAnimation),
    splashIntensity: parseSplashIntensity(obj.splashIntensity ?? DEFAULT_BRANDING.splashIntensity),
    splashShowProgress:
      obj.splashShowProgress == null
        ? DEFAULT_BRANDING.splashShowProgress
        : Boolean(obj.splashShowProgress),
    installName: installName || DEFAULT_BRANDING.installName,
    installIconUrl: (() => {
      let u = installIconUrl || DEFAULT_BRANDING.installIconUrl;
      if (/\/icons\/presets\/justx-.+\.svg$/i.test(u)) u = u.replace(/\.svg$/i, ".png");
      return u;
    })(),
    installIconBg: parseInstallIconBg(obj.installIconBg ?? DEFAULT_BRANDING.installIconBg),
  };
}

export async function getPlatformBranding(): Promise<PlatformBranding> {
  const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
    key: KEY,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ...DEFAULT_BRANDING };
  return parseBranding((row as { value: unknown }).value);
}

export async function savePlatformBranding(input: {
  logo?: string | null;
  logoUrl?: string | null;
  appName?: string;
  tagline?: string;
  splashDurationMs?: number;
  splashAnimation?: string;
  splashIntensity?: string;
  splashShowProgress?: boolean;
  clearLogo?: boolean;
  installName?: string;
  installIcon?: string | null;
  installIconUrl?: string | null;
  installIconBg?: string;
  clearInstallIcon?: boolean;
}): Promise<PlatformBranding> {
  const current = await getPlatformBranding();
  let logoUrl = current.logoUrl;
  let installIconUrl = current.installIconUrl;

  if (input.clearLogo) {
    logoUrl = DEFAULT_BRANDING.logoUrl;
  } else if (input.logo) {
    const saved = await saveImageUpload(String(input.logo), "platform");
    if (saved) logoUrl = saved;
  } else if (input.logoUrl != null && String(input.logoUrl).trim()) {
    logoUrl = canonicalizeStoredImageUrl(String(input.logoUrl).trim());
  }

  if (input.clearInstallIcon) {
    installIconUrl = DEFAULT_BRANDING.installIconUrl;
  } else if (input.installIcon) {
    const saved = await saveImageUpload(String(input.installIcon), "platform-install");
    if (saved) installIconUrl = saved;
  } else if (input.installIconUrl != null && String(input.installIconUrl).trim()) {
    const nextIcon = String(input.installIconUrl).trim();
    if (nextIcon.startsWith("data:")) {
      const saved = await saveImageUpload(nextIcon, "platform-install");
      if (saved) installIconUrl = saved;
    } else {
      installIconUrl = canonicalizeStoredImageUrl(nextIcon);
    }
  }

  const nextInstallName =
    input.installName != null
      ? String(input.installName).trim().slice(0, MAX_INSTALL_NAME)
      : current.installName;

  const next: PlatformBranding = {
    logoUrl,
    appName: input.appName != null ? String(input.appName).trim() || current.appName : current.appName,
    tagline: input.tagline != null ? String(input.tagline).trim() || current.tagline : current.tagline,
    splashDurationMs:
      input.splashDurationMs != null
        ? Math.min(MAX_SPLASH_MS, Math.max(MIN_SPLASH_MS, Math.round(Number(input.splashDurationMs))))
        : current.splashDurationMs,
    splashAnimation:
      input.splashAnimation != null
        ? parseSplashAnimation(input.splashAnimation)
        : current.splashAnimation,
    splashIntensity:
      input.splashIntensity != null
        ? parseSplashIntensity(input.splashIntensity)
        : current.splashIntensity,
    splashShowProgress:
      input.splashShowProgress != null
        ? Boolean(input.splashShowProgress)
        : current.splashShowProgress,
    installName: nextInstallName || DEFAULT_BRANDING.installName,
    installIconUrl: installIconUrl || DEFAULT_BRANDING.installIconUrl,
    installIconBg:
      input.installIconBg != null
        ? parseInstallIconBg(input.installIconBg)
        : current.installIconBg,
  };

  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(next) },
  );

  return {
    ...next,
    logoUrl: withFileAccessToken(next.logoUrl) ?? next.logoUrl,
    installIconUrl: withFileAccessToken(next.installIconUrl) ?? next.installIconUrl,
  };
}
