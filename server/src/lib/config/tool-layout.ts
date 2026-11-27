import { pool } from "../../db.js";
import { clampImsContentWidthPct, saveImsLayout } from "./ims-layout.js";

export type ToolContentWidthsMap = Record<string, number>;

const KEY = "tool_content_widths";

function parseWidths(raw: unknown): ToolContentWidthsMap {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ToolContentWidthsMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const id = k.trim();
    if (!id) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) {
      out[id] = clampImsContentWidthPct(n);
    }
  }
  return out;
}

export async function getToolContentWidths(): Promise<ToolContentWidthsMap> {
  const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
    key: KEY,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return {};
  return parseWidths((row as { value: unknown }).value);
}

export async function setToolContentWidth(
  toolId: string,
  contentWidthPct: number,
): Promise<ToolContentWidthsMap> {
  const id = toolId.trim();
  if (!id) throw new Error("toolId is required");
  const clamped = clampImsContentWidthPct(contentWidthPct);
  const current = await getToolContentWidths();
  const next: ToolContentWidthsMap = { ...current, [id]: clamped };
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(next) },
  );
  if (id === "imsdealer") {
    await saveImsLayout({ contentWidthPct: clamped });
  }
  return next;
}
