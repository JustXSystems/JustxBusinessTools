import { pool } from "../../db.js";

export type ImsLayoutConfig = {
  /** Full-screen `/ims` content width as % of the viewport (50–100). Default 90. */
  contentWidthPct: number;
};

export const DEFAULT_IMS_LAYOUT: ImsLayoutConfig = {
  contentWidthPct: 90,
};

const KEY = "ims_layout";
const MIN = 50;
const MAX = 100;

export function clampImsContentWidthPct(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_IMS_LAYOUT.contentWidthPct;
  return Math.min(MAX, Math.max(MIN, Math.round(n)));
}

function parseImsLayout(raw: unknown): ImsLayoutConfig {
  let value: unknown = raw;
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
  return {
    contentWidthPct: clampImsContentWidthPct(obj.contentWidthPct ?? DEFAULT_IMS_LAYOUT.contentWidthPct),
  };
}

export async function getImsLayout(): Promise<ImsLayoutConfig> {
  const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
    key: KEY,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ...DEFAULT_IMS_LAYOUT };
  return parseImsLayout((row as { value: unknown }).value);
}

export async function saveImsLayout(input: { contentWidthPct?: number }): Promise<ImsLayoutConfig> {
  const current = await getImsLayout();
  const next: ImsLayoutConfig = {
    contentWidthPct:
      input.contentWidthPct == null ? current.contentWidthPct : clampImsContentWidthPct(input.contentWidthPct),
  };
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(next) },
  );
  return next;
}
