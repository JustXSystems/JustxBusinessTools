/**
 * IMS E2E target resolution.
 *
 * Local (default): http://localhost:3100 (no basePath).
 * Production: set E2E_IMS_BASE_URL including basePath, e.g.
 *   https://justxsystems.com/jbt
 *
 * Important: Playwright resolves paths starting with `/` from the *origin*,
 * so baseURL must be the origin and app paths must include `/jbt` on production.
 * Otherwise `goto("/login")` hits https://justxsystems.com/login (marketing site).
 */

function parseAppRoot(): URL {
  const raw = (process.env.E2E_IMS_BASE_URL ?? "").trim() || "http://localhost:3100";
  const withSlash = raw.endsWith("/") ? raw : `${raw}/`;
  return new URL(withSlash);
}

/** Full app root as configured (may include /jbt). Used for logging. */
export function imsBaseURL(): string {
  const u = parseAppRoot();
  return `${u.origin}${u.pathname.replace(/\/$/, "") || ""}` || u.origin;
}

/** Origin only — safe Playwright `use.baseURL` (never includes /jbt). */
export function playwrightBaseURL(): string {
  return parseAppRoot().origin;
}

/** BasePath prefix, e.g. `/jbt` or `""` locally. */
export function appBasePath(): string {
  const p = parseAppRoot().pathname.replace(/\/$/, "");
  return p === "/" ? "" : p;
}

/**
 * App-relative path → absolute path from origin.
 * `/login` → `/jbt/login` on production, `/login` locally.
 */
export function appPath(pathAndQuery: string): string {
  const [pathPart, query = ""] = pathAndQuery.split("?");
  let path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const prefix = appBasePath();
  if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) {
    path = `${prefix}${path}`;
  }
  return query ? `${path}?${query}` : path;
}

/** API path under the app, e.g. `/api/auth/me` → `/jbt/api/auth/me`. */
export function apiPath(pathAndQuery: string): string {
  const p = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  if (p.startsWith("/api/") || p === "/api") return appPath(p);
  return appPath(`/api${p.startsWith("/") ? p : `/${p}`}`);
}

/** True when hitting a non-local deployment (staging / production). */
export function isRemoteImsTarget(): boolean {
  try {
    const host = parseAppRoot().hostname;
    return host !== "localhost" && host !== "127.0.0.1";
  } catch {
    return false;
  }
}

export function requireImsCredentials(): { email: string; password: string } {
  const email = process.env.E2E_IMS_EMAIL ?? process.env.JUSTTESTX_EMAIL;
  const password = process.env.E2E_IMS_PASSWORD ?? process.env.JUSTTESTX_PASSWORD;

  if (isRemoteImsTarget()) {
    if (!email || !password) {
      throw new Error(
        "Remote IMS E2E requires E2E_IMS_EMAIL and E2E_IMS_PASSWORD (JustTestX owner on that environment).",
      );
    }
    return { email, password };
  }

  return {
    email: email ?? "santhosh.hs@justxsystems.com",
    password: password ?? "Justx@2026",
  };
}

export function imsAuthStatePath(): string {
  return isRemoteImsTarget()
    ? "e2e/.auth/justtestx-remote.json"
    : "e2e/.auth/justtestx.json";
}
