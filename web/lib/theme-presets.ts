import type { ThemeTokens } from "./theme";
import { JUSTX_BOS_DARK, JUSTX_BOS_LIGHT, JUSTX_ELECTRIC, JUSTX_LIGHT } from "./theme";

/** Built-in theme presets — keep in sync with `server/src/lib/theme-presets.ts`. */
export const THEME_PRESETS: Array<{ name: string; tokens: ThemeTokens }> = [
  { name: "JustXSystems Electric", tokens: JUSTX_ELECTRIC },
  { name: "JustXSystems Light", tokens: JUSTX_LIGHT },
  { name: "JustX BOS (Light)", tokens: JUSTX_BOS_LIGHT },
  { name: "JustX BOS (Dark)", tokens: JUSTX_BOS_DARK },
  {
    name: "Midnight Cyan",
    tokens: {
      accent: "#00dfff",
      teal: "#2dd4bf",
      accentStrong: "#00b8d4",
      bg0: "#0a0b0f",
      bg1: "#12141c",
      bg2: "#1a1d28",
      radius: "14px",
      font: "system-ui",
      scheme: "dark",
    },
  },
  {
    name: "Royal Indigo",
    tokens: {
      ...JUSTX_ELECTRIC,
      accent: "#818cf8",
      teal: "#a78bfa",
      accentStrong: "#6366f1",
      bg0: "#0b0a12",
      bg1: "#151322",
      bg2: "#1e1b2e",
    },
  },
  {
    name: "Emerald Ledger",
    tokens: {
      ...JUSTX_ELECTRIC,
      accent: "#34d399",
      teal: "#6ee7b7",
      accentStrong: "#059669",
      bg0: "#07110c",
      bg1: "#0f1c16",
      bg2: "#16261e",
    },
  },
  {
    name: "Sunset Gold",
    tokens: {
      ...JUSTX_ELECTRIC,
      accent: "#fbbf24",
      teal: "#fb923c",
      accentStrong: "#d97706",
      bg0: "#120d07",
      bg1: "#1c150c",
      bg2: "#2a1f12",
    },
  },
];

/** Sentinel / empty → inherit Admin (organization) active theme. */
export const THEME_PRESET_ORG_DEFAULT = "";

export function normalizeThemePreset(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s === "default" || s === "__org_default__") return null;
  return s.slice(0, 120);
}

export function findThemePresetTokens(name: string | null | undefined): ThemeTokens | null {
  if (!name) return null;
  const hit = THEME_PRESETS.find((p) => p.name === name);
  return hit ? { ...hit.tokens } : null;
}

/** `saved:123` → org theme id, else null. */
export function parseSavedThemeId(preset: string | null | undefined): number | null {
  if (!preset) return null;
  const m = /^saved:(\d+)$/i.exec(preset.trim());
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function savedThemePresetKey(id: number): string {
  return `saved:${id}`;
}
