/**
 * Public browser URL helpers for OAuth redirects when the app is hosted
 * under a path (e.g. https://www.justxsystems.com/jbt).
 *
 * - WEB_PUBLIC_ORIGIN: scheme+host only, e.g. https://www.justxsystems.com
 *   (falls back to CORS_ORIGIN)
 * - WEB_BASE_PATH: optional path prefix, e.g. /jbt (no trailing slash)
 */

export function webPublicOrigin(): string {
  const raw =
    process.env.WEB_PUBLIC_ORIGIN?.trim() ||
    process.env.CORS_ORIGIN?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

/** e.g. "" or "/jbt" */
export function webBasePath(): string {
  const raw = (process.env.WEB_BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
  if (!raw || raw === "/") return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/$/, "");
}

/** Absolute URL into the web app, e.g. https://www.justxsystems.com/jbt/profile */
export function webAppUrl(path = "/"): string {
  const origin = webPublicOrigin();
  const base = webBasePath();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${base}${p}`;
}
