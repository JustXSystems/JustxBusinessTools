/**
 * Global app flash / toast bus.
 * Durations come from Business Profile (via configureAppFlashDurations).
 * Always dismissible with Close / ✕ before the timer ends.
 */

import {
  DEFAULT_FLASH_ERROR_SECONDS,
  DEFAULT_FLASH_OK_SECONDS,
  flashDisplayToMs,
  normalizeFlashDisplaySettings,
  type FlashDisplaySettings,
} from "@/lib/flash-display";

export type AppFlashKind = "error" | "ok" | "warn";

export type AppFlashItem = {
  id: string;
  kind: AppFlashKind;
  message: string;
  createdAt: number;
};

/** Defaults (ms) — overridden by Business Profile when config loads. */
export const APP_FLASH_ERROR_MS = DEFAULT_FLASH_ERROR_SECONDS * 1000;
export const APP_FLASH_WARN_MS = DEFAULT_FLASH_ERROR_SECONDS * 1000;
export const APP_FLASH_OK_MS = DEFAULT_FLASH_OK_SECONDS * 1000;

type Listener = (items: AppFlashItem[]) => void;

let items: AppFlashItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, number>();

let durationMs = {
  errorMs: APP_FLASH_ERROR_MS,
  warnMs: APP_FLASH_WARN_MS,
  okMs: APP_FLASH_OK_MS,
};

function emit() {
  const snapshot = items.slice();
  listeners.forEach((l) => l(snapshot));
}

function durationFor(kind: AppFlashKind): number {
  if (kind === "ok") return durationMs.okMs;
  if (kind === "warn") return durationMs.warnMs;
  return durationMs.errorMs;
}

/** Apply Business Profile (or defaults) toast durations. */
export function configureAppFlashDurations(settings?: Partial<FlashDisplaySettings> | null) {
  durationMs = flashDisplayToMs(normalizeFlashDisplaySettings(settings));
}

export function getAppFlashDurationsMs() {
  return { ...durationMs };
}

export function subscribeAppFlash(listener: Listener): () => void {
  listeners.add(listener);
  listener(items.slice());
  return () => {
    listeners.delete(listener);
  };
}

export function dismissAppFlash(id: string) {
  const t = timers.get(id);
  if (t) {
    globalThis.clearTimeout(t);
    timers.delete(id);
  }
  const next = items.filter((x) => x.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

export function clearAppFlash() {
  for (const t of timers.values()) globalThis.clearTimeout(t);
  timers.clear();
  if (!items.length) return;
  items = [];
  emit();
}

/** Show a global flash. Dedupes identical kind+message (restarts timer). */
export function flashApp(message: string, kind: AppFlashKind = "error"): string {
  const text = String(message ?? "").trim() || "Something went wrong";
  const existing = items.find((x) => x.kind === kind && x.message === text);
  if (existing) {
    dismissAppFlash(existing.id);
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: AppFlashItem = { id, kind, message: text, createdAt: Date.now() };
  items = [...items, item].slice(-6);
  emit();
  const timer = globalThis.setTimeout(() => dismissAppFlash(id), durationFor(kind));
  timers.set(id, timer as unknown as number);
  return id;
}

export function flashAppError(message: string) {
  return flashApp(message, "error");
}

export function flashAppWarn(message: string) {
  return flashApp(message, "warn");
}

export function flashAppOk(message: string) {
  return flashApp(message, "ok");
}
