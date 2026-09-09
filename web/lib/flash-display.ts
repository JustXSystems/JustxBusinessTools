/** Toast / flash duration prefs (Business Profile). Values are seconds. */

export type FlashDisplaySettings = {
  /** How long error/warn toasts stay unless dismissed. */
  errorSeconds: number;
  /** How long success toasts stay unless dismissed. */
  okSeconds: number;
};

export const DEFAULT_FLASH_ERROR_SECONDS = 60;
export const DEFAULT_FLASH_OK_SECONDS = 8;

export const FLASH_ERROR_SECOND_OPTIONS = [15, 30, 60, 90, 120, 180, 300] as const;
export const FLASH_OK_SECOND_OPTIONS = [3, 5, 8, 12, 15, 30] as const;

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

export function flashDisplayToMs(settings: FlashDisplaySettings): {
  errorMs: number;
  warnMs: number;
  okMs: number;
} {
  const s = normalizeFlashDisplaySettings(settings);
  return {
    errorMs: s.errorSeconds * 1000,
    warnMs: s.errorSeconds * 1000,
    okMs: s.okSeconds * 1000,
  };
}
