import { getBasePath, withBasePath } from "@/lib/base-path";

/** API origin for Capacitor / static hosting (no Next rewrite). Empty = same-origin `/api`. */
export function getApiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  return base;
}

/**
 * Build a browser/server URL for an API path (must start with `/api` or be absolute).
 * Under `NEXT_PUBLIC_BASE_PATH=/jbt`, same-origin calls become `/jbt/api/...`.
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const apiBase = getApiBase();
  if (apiBase) {
    // Absolute API host already includes any path prefix (e.g. https://host/jbt).
    return `${apiBase}${normalized}`;
  }
  return withBasePath(normalized);
}

/** @deprecated use withBasePath from base-path — kept for call sites needing app paths */
export function appPath(path: string): string {
  return withBasePath(path);
}

export { getBasePath, withBasePath };
