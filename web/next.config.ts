import type { NextConfig } from "next";
import path from "path";

const apiPort = process.env.API_PROXY_PORT || "4000";

/** e.g. "/jbt" for https://www.justxsystems.com/jbt — leave empty for root hosting */
function normalizeBasePath(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim();
  if (!v || v === "/") return undefined;
  const withSlash = v.startsWith("/") ? v : `/${v}`;
  return withSlash.replace(/\/$/, "");
}

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // Surface real file/component names in production console stacks (React 19
  // "i is not a function" effect-cleanup bugs are otherwise unreadable).
  productionBrowserSourceMaps: true,
  transpilePackages: ["@jbt/shared"],
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://localhost:${apiPort}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
