/** Shared theme tokens + CSS application for admin studio and runtime ConfigProvider. */

export type ColorScheme = "dark" | "light";

export type ThemeTokens = {
  accent: string;
  teal: string;
  bg0: string;
  bg1: string;
  bg2: string;
  radius: string;
  font: string;
  /** Optional; derived from accent when omitted. */
  accentStrong?: string;
  /** Surfaces + text contrast. Defaults to dark. */
  scheme?: ColorScheme;
};

export type ThemeExportPayload = {
  version: 1;
  name: string;
  exportedAt: string;
  tokens: ThemeTokens;
};

export const JUSTX_ELECTRIC: ThemeTokens = {
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

/** Daytime companion to JustX Electric — cool paper surfaces + deep cyan accent. */
export const JUSTX_LIGHT: ThemeTokens = {
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

export const DEFAULT_THEME_TOKENS: ThemeTokens = { ...JUSTX_ELECTRIC };

function schemeOf(tokens: Partial<ThemeTokens>): ColorScheme {
  return tokens.scheme === "light" ? "light" : "dark";
}

function schemeSurfaceVars(scheme: ColorScheme): Record<string, string> {
  if (scheme === "light") {
    return {
      "--text-hi": "rgba(12, 22, 38, 0.92)",
      "--text-mid": "rgba(12, 22, 38, 0.62)",
      "--text-low": "rgba(12, 22, 38, 0.42)",
      "--glass-1": "rgba(255, 255, 255, 0.72)",
      "--glass-2": "rgba(255, 255, 255, 0.88)",
      "--glass-3": "rgba(255, 255, 255, 0.96)",
      "--glass-hover": "rgba(0, 0, 0, 0.04)",
      "--border-hair": "rgba(12, 22, 38, 0.1)",
      "--border-hair-strong": "rgba(12, 22, 38, 0.18)",
      "--shadow-soft": "0 10px 28px rgba(12, 22, 38, 0.08)",
      "--shadow-lift": "0 16px 40px rgba(12, 22, 38, 0.12)",
    };
  }
  return {
    "--text-hi": "rgba(255, 255, 255, 0.94)",
    "--text-mid": "rgba(235, 238, 250, 0.62)",
    "--text-low": "rgba(235, 238, 250, 0.38)",
    "--glass-1": "rgba(255, 255, 255, 0.04)",
    "--glass-2": "rgba(255, 255, 255, 0.055)",
    "--glass-3": "rgba(255, 255, 255, 0.08)",
    "--glass-hover": "rgba(255, 255, 255, 0.08)",
    "--border-hair": "rgba(255, 255, 255, 0.09)",
    "--border-hair-strong": "rgba(255, 255, 255, 0.16)",
    "--shadow-soft": "0 10px 28px rgba(0, 0, 0, 0.28)",
    "--shadow-lift": "0 16px 40px rgba(0, 0, 0, 0.4)",
  };
}

export function hexToRgbChannels(hex: string): string | null {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = Number.parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `${r}, ${g}, ${b}`;
}

function darkenHex(hex: string, amount = 0.22): string {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const n = Number.parseInt(full, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(c * (1 - amount)))),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function lightenHex(hex: string, amount = 0.35): string {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const n = Number.parseInt(full, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(c + (255 - c) * amount))),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** CSS custom properties for scoped preview frames (does not touch :root). */
export function themeTokensToCssVars(tokens: ThemeTokens): Record<string, string> {
  const accent = tokens.accent?.trim() || JUSTX_ELECTRIC.accent;
  const teal = tokens.teal?.trim() || accent;
  const accentStrong = tokens.accentStrong?.trim() || darkenHex(accent, 0.18);
  const rgb = hexToRgbChannels(accent) ?? "0, 223, 255";
  const highlight = lightenHex(accent, 0.4);
  const deep = accentStrong;
  const scheme = schemeOf(tokens);
  return {
    "--accent": accent,
    "--accent-rgb": rgb,
    "--accent-strong": accentStrong,
    "--teal": teal,
    "--blue-400": accent,
    "--blue-500": accentStrong,
    "--bg-0": tokens.bg0 || (scheme === "light" ? JUSTX_LIGHT.bg0 : JUSTX_ELECTRIC.bg0),
    "--bg-1": tokens.bg1 || (scheme === "light" ? JUSTX_LIGHT.bg1 : JUSTX_ELECTRIC.bg1),
    "--bg-2": tokens.bg2 || (scheme === "light" ? JUSTX_LIGHT.bg2 : JUSTX_ELECTRIC.bg2),
    "--navy-950": tokens.bg0 || (scheme === "light" ? JUSTX_LIGHT.bg0 : JUSTX_ELECTRIC.bg0),
    "--radius": tokens.radius || JUSTX_ELECTRIC.radius,
    "--font-sans": tokens.font || JUSTX_ELECTRIC.font,
    "--grad": `linear-gradient(135deg, ${deep} 0%, ${accent} 55%, ${highlight} 100%)`,
    "--grad-soft": `linear-gradient(135deg, rgba(${rgb}, 0.22) 0%, rgba(${rgb}, 0.1) 100%)`,
    ...schemeSurfaceVars(scheme),
  };
}

export function buildThemeExport(name: string, tokens: ThemeTokens): ThemeExportPayload {
  return {
    version: 1,
    name: name.trim() || "Custom theme",
    exportedAt: new Date().toISOString(),
    tokens: { ...JUSTX_ELECTRIC, ...tokens, scheme: schemeOf(tokens) },
  };
}

export function parseThemeImport(raw: unknown): { name: string; tokens: ThemeTokens } | { error: string } {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { error: "Invalid JSON" };
    }
  }
  if (!data || typeof data !== "object") return { error: "Expected a theme object" };
  const obj = data as Record<string, unknown>;
  const tokensRaw =
    obj.tokens && typeof obj.tokens === "object"
      ? (obj.tokens as Record<string, unknown>)
      : obj;
  const scheme: ColorScheme = tokensRaw.scheme === "light" ? "light" : "dark";
  const base = scheme === "light" ? JUSTX_LIGHT : JUSTX_ELECTRIC;
  const tokens: ThemeTokens = {
    ...base,
    accent: String(tokensRaw.accent ?? base.accent),
    teal: String(tokensRaw.teal ?? tokensRaw.accent ?? base.teal),
    bg0: String(tokensRaw.bg0 ?? base.bg0),
    bg1: String(tokensRaw.bg1 ?? base.bg1),
    bg2: String(tokensRaw.bg2 ?? base.bg2),
    radius: String(tokensRaw.radius ?? base.radius),
    font: String(tokensRaw.font ?? base.font),
    accentStrong: tokensRaw.accentStrong ? String(tokensRaw.accentStrong) : base.accentStrong,
    scheme,
  };
  const name = String(obj.name ?? "Imported theme").trim() || "Imported theme";
  return { name, tokens };
}

/** Apply theme tokens to :root (and derived accent vars used across jbt.css). */
export function applyThemeTokens(tokens: Partial<ThemeTokens> | null | undefined): void {
  if (typeof document === "undefined" || !tokens) return;
  const root = document.documentElement;
  const scheme = schemeOf(tokens);
  root.dataset.scheme = scheme;
  root.style.colorScheme = scheme;

  const accent = tokens.accent?.trim();
  const teal = tokens.teal?.trim() || accent;
  const accentStrong = tokens.accentStrong?.trim() || (accent ? darkenHex(accent, 0.18) : undefined);

  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--blue-400", accent);
    const rgb = hexToRgbChannels(accent);
    if (rgb) root.style.setProperty("--accent-rgb", rgb);
    const highlight = lightenHex(accent, 0.4);
    const deep = accentStrong || darkenHex(accent, 0.25);
    root.style.setProperty(
      "--grad",
      `linear-gradient(135deg, ${deep} 0%, ${accent} 55%, ${highlight} 100%)`,
    );
    root.style.setProperty(
      "--grad-soft",
      `linear-gradient(135deg, rgba(${rgb ?? "0, 223, 255"}, 0.22) 0%, rgba(${rgb ?? "0, 223, 255"}, 0.1) 100%)`,
    );
  }
  if (accentStrong) {
    root.style.setProperty("--accent-strong", accentStrong);
    root.style.setProperty("--blue-500", accentStrong);
  }
  if (teal) root.style.setProperty("--teal", teal);
  if (tokens.bg0) {
    root.style.setProperty("--bg-0", tokens.bg0);
    root.style.setProperty("--navy-950", tokens.bg0);
  }
  if (tokens.bg1) root.style.setProperty("--bg-1", tokens.bg1);
  if (tokens.bg2) root.style.setProperty("--bg-2", tokens.bg2);
  if (tokens.radius) root.style.setProperty("--radius", tokens.radius);
  if (tokens.font) root.style.setProperty("--font-sans", tokens.font);

  for (const [k, v] of Object.entries(schemeSurfaceVars(scheme))) {
    root.style.setProperty(k, v);
  }
}
