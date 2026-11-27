import { pool } from "../../db.js";
import { canonicalizeStoredImageUrl, saveImageUpload, withFileAccessToken } from "../storage.js";

const KEY = "tool_icons";

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
  /** Legacy fallback display size scale percentage (50..200, default 100). */
  scale?: number;
  /** Chip / Header icon size scale percentage (50..200, default 100). */
  scaleSm?: number;
  /** Home / Tool Card icon size scale percentage (50..200, default 100). */
  scaleMd?: number;
  /** Large / App icon size scale percentage (50..200, default 100). */
  scaleLg?: number;
};

export type ToolIconsMap = Record<string, ToolIconConfig>;

const URL_SLOTS = ["light", "dark", "favicon", "appleTouch", "size192", "size512", "size1024"] as const;
type UrlSlot = (typeof URL_SLOTS)[number];

function parseBg(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  if (/^(transparent|none)$/i.test(s)) return "transparent";
  const hex = s.startsWith("#") ? s : `#${s}`;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toUpperCase();
  }
  return undefined;
}

function parseShape(raw: unknown): ToolIconShape | undefined {
  if (raw === "rounded" || raw === "square" || raw === "circle") return raw;
  return undefined;
}

function parsePadding(raw: unknown): number | undefined {
  if (raw === "" || raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(12, Math.max(0, Math.round(n)));
}

function parseScale(raw: unknown): number | undefined {
  if (raw === "" || raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(200, Math.max(50, Math.round(n)));
}

function sanitizeSlotValue(raw: unknown, allowEmoji: boolean): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 512 && !trimmed.startsWith("data:")) return trimmed.slice(0, 512);
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }
  if (allowEmoji && trimmed.length <= 16) return trimmed;
  return undefined;
}

function signConfig(cfg: ToolIconConfig): ToolIconConfig {
  const out: ToolIconConfig = {};
  for (const slot of URL_SLOTS) {
    const val = cfg[slot];
    if (!val) continue;
    out[slot] = val.startsWith("/") || val.startsWith("http") ? (withFileAccessToken(val) ?? val) : val;
  }
  if (cfg.bg) out.bg = cfg.bg;
  if (cfg.shape) out.shape = cfg.shape;
  if (cfg.paddingPx != null) out.paddingPx = cfg.paddingPx;
  if (cfg.scale != null) out.scale = cfg.scale;
  if (cfg.scaleSm != null) out.scaleSm = cfg.scaleSm;
  if (cfg.scaleMd != null) out.scaleMd = cfg.scaleMd;
  if (cfg.scaleLg != null) out.scaleLg = cfg.scaleLg;
  return out;
}

function parseConfigEntry(raw: unknown): ToolIconConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const cfg: ToolIconConfig = {};
  for (const slot of URL_SLOTS) {
    const val = sanitizeSlotValue(obj[slot], slot === "light" || slot === "dark");
    if (val) cfg[slot] = val;
  }
  const bg = parseBg(obj.bg);
  if (bg) cfg.bg = bg;
  const shape = parseShape(obj.shape);
  if (shape) cfg.shape = shape;
  const paddingPx = parsePadding(obj.paddingPx);
  if (paddingPx != null) cfg.paddingPx = paddingPx;
  const scale = parseScale(obj.scale);
  if (scale != null) cfg.scale = scale;
  const scaleSm = parseScale(obj.scaleSm);
  if (scaleSm != null) cfg.scaleSm = scaleSm;
  const scaleMd = parseScale(obj.scaleMd);
  if (scaleMd != null) cfg.scaleMd = scaleMd;
  const scaleLg = parseScale(obj.scaleLg);
  if (scaleLg != null) cfg.scaleLg = scaleLg;
  return Object.keys(cfg).length > 0 ? cfg : null;
}

function parseRawMap(raw: unknown): ToolIconsMap {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ToolIconsMap = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    const toolId = String(id ?? "").trim();
    if (!toolId) continue;
    const parsed = parseConfigEntry(entry);
    if (parsed) out[toolId] = parsed;
  }
  return out;
}

async function readStoredToolIconsMap(): Promise<ToolIconsMap> {
  const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
    key: KEY,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return {};
  return parseRawMap((row as { value: unknown }).value);
}

async function writeStoredToolIconsMap(map: ToolIconsMap): Promise<void> {
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(map) },
  );
}

/** Signed tool-icons map for clients (`/api/config/effective`, `/api/admin/config/tool-icons`). */
export async function getToolIconsMap(): Promise<ToolIconsMap> {
  const raw = await readStoredToolIconsMap();
  const signed: ToolIconsMap = {};
  for (const [id, cfg] of Object.entries(raw)) {
    signed[id] = signConfig(cfg);
  }
  return signed;
}

export async function saveToolIconConfig(
  toolId: string,
  input: Partial<ToolIconConfig> & { reset?: boolean },
): Promise<{ icon: ToolIconConfig | null; toolIcons: ToolIconsMap }> {
  const id = String(toolId ?? "").trim();
  if (!id) throw new Error("toolId required");

  const currentMap = await readStoredToolIconsMap();
  if (input.reset) {
    delete currentMap[id];
    await writeStoredToolIconsMap(currentMap);
    return { icon: null, toolIcons: await getToolIconsMap() };
  }

  const prev = currentMap[id] ?? {};
  const next: ToolIconConfig = { ...prev };

  for (const slot of URL_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(input, slot)) continue;
    const rawVal = input[slot as UrlSlot];
    if (rawVal == null || String(rawVal).trim() === "") {
      delete next[slot];
      continue;
    }
    const str = String(rawVal).trim();
    if (str.startsWith("data:")) {
      const saved = await saveImageUpload(str, `tool-icons/${id}`);
      if (saved) next[slot] = saved;
    } else if (str.startsWith("/") || str.startsWith("http://") || str.startsWith("https://")) {
      next[slot] = canonicalizeStoredImageUrl(str);
    } else if (slot === "light" || slot === "dark") {
      next[slot] = str.slice(0, 16);
    } else {
      throw new Error(`Invalid URL or upload for ${slot}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "bg")) {
    const bg = parseBg(input.bg);
    if (bg) next.bg = bg;
    else delete next.bg;
  }

  if (Object.prototype.hasOwnProperty.call(input, "shape")) {
    const shape = parseShape(input.shape);
    if (shape) next.shape = shape;
    else delete next.shape;
  }

  if (Object.prototype.hasOwnProperty.call(input, "paddingPx")) {
    const pad = parsePadding(input.paddingPx);
    if (pad != null && pad > 0) next.paddingPx = pad;
    else delete next.paddingPx;
  }

  for (const key of ["scale", "scaleSm", "scaleMd", "scaleLg"] as const) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const val = parseScale(input[key]);
    if (val != null && val !== 100) next[key] = val;
    else delete next[key];
  }

  if (Object.keys(next).length === 0) {
    delete currentMap[id];
  } else {
    currentMap[id] = next;
  }

  await writeStoredToolIconsMap(currentMap);
  const signedMap = await getToolIconsMap();
  return { icon: signedMap[id] ?? null, toolIcons: signedMap };
}
