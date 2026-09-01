/**
 * Paths that may be accessed without a session when REQUIRE_AUTH=true.
 * Keep in sync across request-context and branch-access middleware.
 */
export function isUnauthenticatedApiPath(pathname: string): boolean {
  const path = pathname.split("?")[0] || "";
  return (
    path === "/api/health" ||
    path === "/api/config/branding" ||
    path === "/api/config/install-icon.png" ||
    path === "/api/config/install-icon-meta" ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/files") ||
    path.startsWith("/api/webhooks") ||
    path.startsWith("/api/public/") ||
    path === "/api/profile/drive/callback"
  );
}
