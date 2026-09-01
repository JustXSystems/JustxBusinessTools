/** Desktop / PWA install branding — single JustX logo (no generated presets). */

export const JUSTX_LOGO_URL = "/icons/justx-logo.png";

export const DEFAULT_INSTALL_ICON_URL = JUSTX_LOGO_URL;

/** @deprecated Presets removed — only the official JustX logo is used. */
export type InstallIconPreset = {
  id: string;
  label: string;
  description: string;
  url: string;
};

/** Empty: custom upload only; default icon is JUSTX_LOGO_URL. */
export const INSTALL_ICON_PRESETS: InstallIconPreset[] = [];

/** `transparent` or a #RRGGBB / #RGB color. Default: transparent. */
export type InstallIconBg = string;

export const INSTALL_ICON_BG_PRESETS: { id: string; label: string; value: InstallIconBg }[] = [
  { id: "transparent", label: "Transparent", value: "transparent" },
  { id: "black", label: "Black", value: "#000000" },
  { id: "white", label: "White", value: "#FFFFFF" },
];

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
  if (
    /\/icons\/(jbt-icon|justxsystems-icon)\.svg$/i.test(u) ||
    /\/icons\/presets\//i.test(u)
  ) {
    return JUSTX_LOGO_URL;
  }
  return u;
}

/** Prefer a path suitable for PWA manifest (not data: URLs). */
export function resolveInstallIconUrl(
  logoUrl: string,
  installIconUrl?: string | null,
): string {
  const custom = canonicalizeBrandIconUrl(String(installIconUrl || ""));
  if (custom && !custom.startsWith("data:") && custom !== JUSTX_LOGO_URL) return custom;
  if (custom && !custom.startsWith("data:")) return custom;
  const logo = canonicalizeBrandIconUrl(String(logoUrl || ""));
  if (logo && !logo.startsWith("data:")) return logo;
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
