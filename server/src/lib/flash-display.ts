import { pool } from "../db.js";

/** Toast / flash duration prefs on business_profiles (seconds). */

export type FlashDisplaySettings = {
  errorSeconds: number;
  okSeconds: number;
};

export const DEFAULT_FLASH_ERROR_SECONDS = 60;
export const DEFAULT_FLASH_OK_SECONDS = 8;

const ERROR_MIN = 5;
const ERROR_MAX = 600;
const OK_MIN = 2;
const OK_MAX = 120;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeFlashErrorSeconds(raw: unknown): number {
  return clampInt(raw, DEFAULT_FLASH_ERROR_SECONDS, ERROR_MIN, ERROR_MAX);
}

export function normalizeFlashOkSeconds(raw: unknown): number {
  return clampInt(raw, DEFAULT_FLASH_OK_SECONDS, OK_MIN, OK_MAX);
}

export function normalizeFlashDisplaySettings(
  input?: Partial<FlashDisplaySettings> | null,
): FlashDisplaySettings {
  return {
    errorSeconds: normalizeFlashErrorSeconds(input?.errorSeconds),
    okSeconds: normalizeFlashOkSeconds(input?.okSeconds),
  };
}

let columnReady: Promise<void> | null = null;

export async function ensureFlashDisplayColumns(): Promise<void> {
  if (!columnReady) {
    columnReady = (async () => {
      for (const sql of [
        `ALTER TABLE business_profiles ADD COLUMN flash_error_seconds INT NOT NULL DEFAULT 60`,
        `ALTER TABLE business_profiles ADD COLUMN flash_ok_seconds INT NOT NULL DEFAULT 8`,
      ]) {
        try {
          await pool.query(sql);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/duplicate column|exists/i.test(msg)) throw err;
        }
      }
    })();
  }
  await columnReady;
}
