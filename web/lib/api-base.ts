/** API origin for Capacitor / static hosting (no Next rewrite). Empty = same-origin `/api`. */
export function getApiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  return base;
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBase();
  if (!base) return normalized;
  return `${base}${normalized}`;
}
