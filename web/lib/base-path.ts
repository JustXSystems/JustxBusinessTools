/**
 * App path prefix for subpath hosting (e.g. /jbt on justxsystems.com).
 * NEXT_PUBLIC_BASE_PATH is inlined at build time for client bundles.
 */

export function getBasePath(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_PATH ?? process.env.WEB_BASE_PATH ?? "").trim();
  if (!raw || raw === "/") return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/$/, "");
}

/** Prefix an app-root path. Leaves http(s) URLs unchanged. */
export function withBasePath(path: string): string {
  if (!path) return getBasePath() || "/";
  if (/^https?:\/\//i.test(path)) return path;
  const base = getBasePath();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) return p;
  if (p === base || p.startsWith(`${base}/`)) return p;
  return `${base}${p}`;
}

/**
 * Resolve a stored asset path for <img src> under basePath.
 * Rewrites `/api/files/...`, `/icons/...`, and mistaken absolute
 * `https://host/api/files/...` (missing /jbt) to the public app path.
 */
export function publicAssetUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw || /^(data:|blob:)/i.test(raw)) return raw;

  let pathname = raw;
  let search = "";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const isAppAsset =
        u.pathname.startsWith("/api/files/") ||
        u.pathname.startsWith("/icons/") ||
        u.pathname.startsWith("/pwa-icon/") ||
        /^\/jbt\/(api\/files|icons|pwa-icon)\//.test(u.pathname);
      if (!isAppAsset) return raw;
      pathname = u.pathname.replace(/^\/jbt(?=\/)/, "");
      search = u.search;
    } catch {
      return raw;
    }
  } else {
    const q = raw.indexOf("?");
    if (q >= 0) {
      pathname = raw.slice(0, q);
      search = raw.slice(q);
    }
    pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    pathname = pathname.replace(/^\/jbt(?=\/)/, "");
  }

  return `${withBasePath(pathname)}${search}`;
}

/**
 * Public browser origin for absolute URLs (manifest icons, etc.).
 * Prefer env / forwarded headers — Next often sees localhost behind nginx.
 */
export function resolvePublicOrigin(request?: Request): string {
  const fromEnv = (
    process.env.WEB_PUBLIC_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.CORS_ORIGIN ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  if (fromEnv && !isLoopbackOrigin(fromEnv)) return fromEnv;

  if (request) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    if (forwardedHost && !isLoopbackHost(forwardedHost)) {
      return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
    }

    const host = request.headers.get("host")?.trim();
    if (host && !isLoopbackHost(host)) {
      const proto =
        request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
        (new URL(request.url).protocol.replace(":", "") || "https");
      return `${proto}://${host}`.replace(/\/$/, "");
    }

    const urlOrigin = new URL(request.url).origin;
    if (!isLoopbackOrigin(urlOrigin)) return urlOrigin;
  }

  return fromEnv || "http://127.0.0.1:3000";
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).host);
  } catch {
    return false;
  }
}
