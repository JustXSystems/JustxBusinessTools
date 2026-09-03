/** Desktop / PWA install branding + browser favicon. */

export const JUSTX_LOGO_URL = "/icons/justx-logo.png";

export const DEFAULT_INSTALL_ICON_URL = JUSTX_LOGO_URL;

/** Stored installIconUrl value: favicon/install icon tracks the platform logo. */
export const INSTALL_ICON_FOLLOW_LOGO = "__logo__";

export type InstallIconSource = "justx" | "logo" | "custom";

/** `transparent` or a #RRGGBB / #RGB color. Default: transparent. */
export type InstallIconBg = string;

export function parseInstallIconBg(raw: unknown): InstallIconBg {
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

export function isTransparentInstallBg(bg: unknown): boolean {
  return parseInstallIconBg(bg) === "transparent";
}

export function resolveInstallName(appName: string, installName?: string | null): string {
  const custom = String(installName || "").trim();
  if (custom) return custom;
  return String(appName || "JustXSystems").trim() || "JustXSystems";
}

/** Map legacy generated icons → official JustX logo. */
export function canonicalizeBrandIconUrl(raw: string): string {
  const u = String(raw || "").trim();
  if (!u) return JUSTX_LOGO_URL;
  if (u === INSTALL_ICON_FOLLOW_LOGO) return INSTALL_ICON_FOLLOW_LOGO;
  if (
    /\/icons\/(jbt-icon|justxsystems-icon)\.svg$/i.test(u) ||
    /\/icons\/presets\//i.test(u)
  ) {
    return JUSTX_LOGO_URL;
  }
  return u;
}

export function detectInstallIconSource(
  logoUrl: string,
  installIconUrl?: string | null,
): InstallIconSource {
  const raw = String(installIconUrl || "").trim();
  if (!raw || raw === JUSTX_LOGO_URL || raw === DEFAULT_INSTALL_ICON_URL) return "justx";
  if (raw === INSTALL_ICON_FOLLOW_LOGO) return "logo";
  const logo = canonicalizeBrandIconUrl(String(logoUrl || ""));
  if (logo && raw === logo) return "logo";
  return "custom";
}

/** Prefer a path suitable for PWA manifest / favicon (not data: URLs). */
export function resolveInstallIconUrl(
  logoUrl: string,
  installIconUrl?: string | null,
): string {
  const raw = String(installIconUrl || "").trim();
  if (raw === INSTALL_ICON_FOLLOW_LOGO) {
    const logo = canonicalizeBrandIconUrl(String(logoUrl || ""));
    if (logo && logo !== INSTALL_ICON_FOLLOW_LOGO && !logo.startsWith("data:")) return logo;
    return DEFAULT_INSTALL_ICON_URL;
  }
  const custom = canonicalizeBrandIconUrl(raw);
  if (custom === INSTALL_ICON_FOLLOW_LOGO) {
    const logo = canonicalizeBrandIconUrl(String(logoUrl || ""));
    if (logo && !logo.startsWith("data:")) return logo;
    return DEFAULT_INSTALL_ICON_URL;
  }
  if (custom && !custom.startsWith("data:") && custom !== JUSTX_LOGO_URL) return custom;
  if (custom && !custom.startsWith("data:")) return custom;
  const logo = canonicalizeBrandIconUrl(String(logoUrl || ""));
  if (logo && logo !== INSTALL_ICON_FOLLOW_LOGO && !logo.startsWith("data:")) return logo;
  if (custom.startsWith("data:")) return custom;
  return DEFAULT_INSTALL_ICON_URL;
}

/** Icon shown in the in-app install prompt (data URLs OK). */
export function resolveInstallIconDisplay(
  logoUrl: string,
  installIconUrl?: string | null,
): string {
  return resolveInstallIconUrl(logoUrl, installIconUrl);
}
