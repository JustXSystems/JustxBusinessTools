import type { BosTheme } from "@/components/bos/tokens";

export const BOS_THEME_STORAGE_KEY = "jbt.bos.theme";

export function isBosTheme(value: unknown): value is BosTheme {
  return value === "light" || value === "dark";
}

/**
 * Initial BOS theme, in priority order:
 * 1. explicit user choice persisted for BOS surfaces,
 * 2. the host app scheme when the org runs the BOS theme pack (stay visually in sync),
 * 3. light — the design system's default.
 */
export function resolveInitialBosTheme(input: {
  stored?: string | null;
  hostScheme?: string | null;
  hostPack?: string | null;
}): BosTheme {
  if (isBosTheme(input.stored)) return input.stored;
  if (input.hostPack === "bos" && isBosTheme(input.hostScheme)) return input.hostScheme;
  return "light";
}

export function readStoredBosTheme(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(BOS_THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredBosTheme(theme: BosTheme): void {
  try {
    window.localStorage.setItem(BOS_THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode / quota) — theme still applies for the session */
  }
}
