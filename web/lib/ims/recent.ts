"use client";

import { useSyncExternalStore } from "react";

/** Per-browser IMS preferences (favourite actions, recently used modules), synced across tabs. */
export const FAV_KEY = "ims.more.favourites";
export const RECENT_KEY = "ims.more.recent";

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: string[] }>();
const EMPTY: string[] = [];

function read(key: string): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function snapshot(key: string): string[] {
  const raw = window.localStorage.getItem(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  const value = read(key);
  cache.set(key, { raw, value });
  return value;
}

function write(key: string, value: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

export function useStoredList(key: string): [string[], (v: string[]) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot(key),
    () => EMPTY,
  );
  return [value, (v) => write(key, v)];
}

/** Record a module visit so More actions can show "Recently used". */
export function rememberModule(key: string) {
  if (key === "more" || key === "dashboard" || typeof window === "undefined") return;
  const prev = read(RECENT_KEY);
  if (prev[0] === key) return;
  write(RECENT_KEY, [key, ...prev.filter((k) => k !== key)].slice(0, 8));
}
