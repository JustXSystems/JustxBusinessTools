import { pool } from "../../db.js";

export type PoweredByConfig = {
  text: string;
  /** Footer always renders; locked means operators cannot hide it. */
  locked: boolean;
};

export const DEFAULT_POWERED_BY: PoweredByConfig = {
  text: "Powered by JustXSystems LLP",
  locked: true,
};

const KEY = "powered_by";

function parsePoweredBy(raw: unknown): PoweredByConfig {
  const obj =
    typeof raw === "string"
      ? (JSON.parse(raw) as Record<string, unknown>)
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
  return {
    text: String(obj.text ?? DEFAULT_POWERED_BY.text).trim() || DEFAULT_POWERED_BY.text,
    locked: obj.locked == null ? true : Boolean(obj.locked),
  };
}

export async function getPoweredBy(): Promise<PoweredByConfig> {
  const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
    key: KEY,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ...DEFAULT_POWERED_BY };
  return parsePoweredBy((row as { value: unknown }).value);
}

export async function savePoweredBy(input: {
  text?: string;
  locked?: boolean;
}): Promise<PoweredByConfig> {
  const current = await getPoweredBy();
  const next: PoweredByConfig = {
    text:
      input.text != null
        ? String(input.text).trim() || current.text
        : current.text,
    // Footer cannot be removed from the product; keep locked true unless explicitly unlocked by admin.
    locked: input.locked == null ? current.locked : Boolean(input.locked),
  };

  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, :value)
     ON DUPLICATE KEY UPDATE value = :value`,
    { key: KEY, value: JSON.stringify(next) },
  );

  return next;
}
