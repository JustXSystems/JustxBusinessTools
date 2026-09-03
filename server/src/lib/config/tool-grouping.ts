import { pool } from "../../db.js";

export type ToolGroupingConfig = {
  /** When true, Tools/Products render under category/group headings. */
  enabled: boolean;
};

export const DEFAULT_TOOL_GROUPING: ToolGroupingConfig = {
  enabled: true,
};

const KEY = "tool_grouping";

function parseToolGrouping(raw: unknown): ToolGroupingConfig {
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
  if (obj.enabled == null) return { ...DEFAULT_TOOL_GROUPING };
  return { enabled: Boolean(obj.enabled) };
}

export async function getToolGrouping(): Promise<ToolGroupingConfig> {
  const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
    key: KEY,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ...DEFAULT_TOOL_GROUPING };
  return parseToolGrouping((row as { value: unknown }).value);
}

export async function saveToolGrouping(input: {
  enabled?: boolean;
}): Promise<ToolGroupingConfig> {
  const current = await getToolGrouping();
  const next: ToolGroupingConfig = {
    enabled: input.enabled == null ? current.enabled : Boolean(input.enabled),
  };
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(next) },
  );
  return next;
}
