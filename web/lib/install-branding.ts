/** Desktop / PWA install branding presets (JustXSystems). */

export type InstallIconPreset = {
  id: string;
  label: string;
  description: string;
  url: string;
};

export const INSTALL_ICON_PRESETS: InstallIconPreset[] = [
  {
    id: "mark",
    label: "X Mark",
    description: "Primary JustXSystems mark",
    url: "/icons/presets/justx-mark.png",
  },
  {
    id: "shield",
    label: "Shield",
    description: "Trusted systems seal",
    url: "/icons/presets/justx-shield.png",
  },
  {
    id: "orbit",
    label: "Orbit",
    description: "Connected platforms",
    url: "/icons/presets/justx-orbit.png",
  },
  {
    id: "tile",
    label: "JX Tile",
    description: "Compact monogram tile",
    url: "/icons/presets/justx-tile.png",
  },
  {
    id: "seal",
    label: "Seal",
    description: "Circular brand seal",
    url: "/icons/presets/justx-seal.png",
  },
];

export const DEFAULT_INSTALL_ICON_URL = INSTALL_ICON_PRESETS[0].url;

/** `transparent` or a #RRGGBB / #RGB color. Default: transparent. */
export type InstallIconBg = string;

export const INSTALL_ICON_BG_PRESETS: { id: string; label: string; value: InstallIconBg }[] = [
  { id: "transparent", label: "Transparent", value: "transparent" },
  { id: "teal", label: "Brand teal", value: "#0B2E2F" },
  { id: "white", label: "White", value: "#FFFFFF" },
  { id: "paper", label: "Paper", value: "#FBF9F4" },
  { id: "black", label: "Black", value: "#111111" },
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

/** Prefer a path suitable for PWA manifest (not data: URLs). */
export function resolveInstallIconUrl(
  logoUrl: string,
  installIconUrl?: string | null,
): string {
  const normalize = (raw: string) => {
    let u = raw.trim();
    // Legacy SVG presets → PNG (Chrome install dialog ignores SVG).
    if (/\/icons\/presets\/justx-.+\.svg$/i.test(u)) {
      u = u.replace(/\.svg$/i, ".png");
    }
    return u;
  };

  const custom = normalize(String(installIconUrl || ""));
  if (custom && !custom.startsWith("data:")) return custom;
  const logo = normalize(String(logoUrl || ""));
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
