import { pool } from "../../db.js";

const KEY = "tool_personal_usage";

/** Built-in GSTIN-independent tools (mirrors web/config/tools.config DEFAULT_PERSONAL_USAGE_TOOL_IDS). */
export const DEFAULT_PERSONAL_USAGE_TOOL_IDS: ReadonlySet<string> = new Set([
  "gstcalc",
  "tdscalc",
  "taxcalc",
  "profitcalc",
  "emicalc",
  "loancalc",
  "solarroi",
  "dealercommission",
  "qrscanner",
  "qrgenerator",
  "gmap2mappls",
  "visitors",
]);

export type ToolPersonalUsageMap = Record<string, boolean>;

function parseMap(raw: unknown): ToolPersonalUsageMap {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ToolPersonalUsageMap = {};
  for (const [id, flag] of Object.entries(value as Record<string, unknown>)) {
    const toolId = String(id ?? "").trim();
    if (!toolId) continue;
    if (typeof flag === "boolean") out[toolId] = flag;
  }
  return out;
}

export async function getToolPersonalUsageOverrides(): Promise<ToolPersonalUsageMap> {
  const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
    key: KEY,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return {};
  return parseMap((row as { value: unknown }).value);
}

/** Effective flag for one tool (override wins, else built-in default). */
export function resolvePersonalUsage(
  toolId: string,
  overrides: ToolPersonalUsageMap | null | undefined,
): boolean {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, toolId)) {
    return Boolean(overrides[toolId]);
  }
  return DEFAULT_PERSONAL_USAGE_TOOL_IDS.has(toolId);
}

/** Full map of known tools + overrides for the admin / effective config payload. */
export async function getToolPersonalUsageMap(
  toolIds: ReadonlyArray<string>,
): Promise<ToolPersonalUsageMap> {
  const overrides = await getToolPersonalUsageOverrides();
  const out: ToolPersonalUsageMap = {};
  for (const id of toolIds) {
    out[id] = resolvePersonalUsage(id, overrides);
  }
  for (const id of Object.keys(overrides)) {
    if (!(id in out)) out[id] = Boolean(overrides[id]);
  }
  return out;
}

export async function setToolPersonalUsage(
  toolId: string,
  personalUsage: boolean,
): Promise<ToolPersonalUsageMap> {
  const id = String(toolId ?? "").trim();
  if (!id) throw new Error("toolId required");
  const current = await getToolPersonalUsageOverrides();
  current[id] = Boolean(personalUsage);
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(current) },
  );
  return getToolPersonalUsageMap([id, ...Object.keys(current)]);
}
