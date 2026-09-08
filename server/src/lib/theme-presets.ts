import { pool } from "../db.js";
import { jsonVal } from "./admin/approvals.js";

/** JustXSystems Electric — deep royal blue surfaces + electric cyan (brand strip). */
export const JUSTX_ELECTRIC = {
  accent: "#00dfff",
  teal: "#00dfff",
  accentStrong: "#1a6fd4",
  bg0: "#081018",
  bg1: "#0c1829",
  bg2: "#122440",
  radius: "16px",
  font: "system-ui",
  scheme: "dark",
};

export const JUSTX_LIGHT = {
  accent: "#007a99",
  teal: "#0f766e",
  accentStrong: "#1a6fd4",
  bg0: "#eef3f8",
  bg1: "#f7fafc",
  bg2: "#ffffff",
  radius: "16px",
  font: "system-ui",
  scheme: "light",
};

export const JUSTX_BOS_LIGHT = {
  accent: "#5B8DEF",
  teal: "#34B27B",
  accentStrong: "#4271D6",
  bg0: "#F5F6F8",
  bg1: "#FAFBFC",
  bg2: "#FFFFFF",
  radius: "14px",
  font: "var(--font-plex-sans, 'IBM Plex Sans', system-ui)",
  scheme: "light",
  pack: "bos",
};

export const JUSTX_BOS_DARK = {
  accent: "#6E9BFF",
  teal: "#3DCB8F",
  accentStrong: "#618DED",
  bg0: "#1C1C1E",
  bg1: "#262628",
  bg2: "#2C2C2E",
  radius: "14px",
  font: "var(--font-plex-sans, 'IBM Plex Sans', system-ui)",
  scheme: "dark",
  pack: "bos",
};

export const DEFAULT_THEME_TOKENS = { ...JUSTX_ELECTRIC };

/** Built-in theme presets — keep in sync with `web/lib/theme-presets.ts`. */
export const THEME_PRESETS = [
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
      ...DEFAULT_THEME_TOKENS,
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
      ...DEFAULT_THEME_TOKENS,
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
      ...DEFAULT_THEME_TOKENS,
      accent: "#fbbf24",
      teal: "#fb923c",
      accentStrong: "#d97706",
      bg0: "#120d07",
      bg1: "#1c150c",
      bg2: "#2a1f12",
    },
  },
] as const;

export type ThemeTokensRecord = Record<string, string>;

/** null / empty / "default" → inherit organization Admin active theme. */
export function normalizeThemePreset(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s === "default" || s === "__org_default__") return null;
  return s.slice(0, 120);
}

export function findPresetTokens(name: string): ThemeTokensRecord | null {
  const hit = THEME_PRESETS.find((p) => p.name === name);
  return hit ? ({ ...hit.tokens } as ThemeTokensRecord) : null;
}

export function parseSavedThemeId(preset: string | null): number | null {
  if (!preset) return null;
  const m = /^saved:(\d+)$/i.exec(preset.trim());
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

let columnReady: Promise<void> | null = null;

export async function ensureThemePresetColumn(): Promise<void> {
  if (!columnReady) {
    columnReady = (async () => {
      try {
        await pool.query(
          `ALTER TABLE business_profiles ADD COLUMN theme_preset VARCHAR(120) NULL`,
        );
      } catch (err) {
        const e = err as { code?: string; errno?: number };
        if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
      }
    })().catch((err) => {
      columnReady = null;
      throw err;
    });
  }
  await columnReady;
}

async function loadOrgActiveTheme(orgId: number): Promise<ThemeTokensRecord | null> {
  const [themeRows] = await pool.query(
    `SELECT tokens FROM org_themes WHERE organization_id = :orgId AND is_active = 1 LIMIT 1`,
    { orgId },
  );
  const themeRow = Array.isArray(themeRows) ? themeRows[0] : null;
  if (!themeRow) return null;
  const raw = (themeRow as { tokens: string | Record<string, unknown> }).tokens;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return (parsed ?? null) as ThemeTokensRecord | null;
}

async function loadOrgThemeById(
  orgId: number,
  themeId: number,
): Promise<ThemeTokensRecord | null> {
  const [rows] = await pool.query(
    `SELECT tokens FROM org_themes WHERE id = :id AND organization_id = :orgId LIMIT 1`,
    { id: themeId, orgId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const raw = (row as { tokens: string | Record<string, unknown> }).tokens;
  const parsed = jsonVal(raw) ?? (typeof raw === "string" ? null : raw);
  return (parsed ?? null) as ThemeTokensRecord | null;
}

/**
 * Resolve UI theme for the active Business Profile.
 * Profile override (preset name or saved:{id}) always wins; otherwise Admin active theme.
 */
export async function resolveEffectiveTheme(opts: {
  orgId: number;
  profileId: number;
}): Promise<{
  theme: ThemeTokensRecord | null;
  themeSource: "profile" | "organization";
  themePreset: string | null;
}> {
  await ensureThemePresetColumn();
  const [rows] = await pool.query(
    `SELECT theme_preset FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: opts.profileId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { theme_preset?: string | null } | undefined) : undefined;
  const themePreset = normalizeThemePreset(row?.theme_preset);

  if (themePreset) {
    const savedId = parseSavedThemeId(themePreset);
    if (savedId) {
      const tokens = await loadOrgThemeById(opts.orgId, savedId);
      if (tokens) {
        return { theme: tokens, themeSource: "profile", themePreset };
      }
    } else {
      const tokens = findPresetTokens(themePreset);
      if (tokens) {
        return { theme: tokens, themeSource: "profile", themePreset };
      }
    }
  }

  const orgTheme = await loadOrgActiveTheme(opts.orgId);
  return { theme: orgTheme, themeSource: "organization", themePreset: null };
}
