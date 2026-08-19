import type { NextConfig } from "next";
import path from "path";

const apiPort = process.env.API_PROXY_PORT || "4000";

const nextConfig: NextConfig = {
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
