import { NextResponse } from "next/server";

/**
 * Dynamic web app manifest for Justxsystems BOS so icon and start_url paths
 * automatically respect NEXT_PUBLIC_BASE_PATH.
 */
export function GET() {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  const manifest = {
    name: "Justxsystems BOS",
    short_name: "BOS",
    description: "Finance, GST invoicing, HR and projects — connected to your Justxsystems Business Tools.",
    start_url: `${base}/bos`,
    scope: `${base}/bos`,
    display: "standalone",
    background_color: "#0A1348",
    theme_color: "#0A1348",
    icons: [
      {
        src: `${base}/icons/BOS/web/bos-favicon.svg`,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: `${base}/icons/BOS/web/android-chrome-192x192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: `${base}/icons/BOS/web/android-chrome-512x512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: `${base}/icons/BOS/png/app-light/bos-app-light-1024.png`,
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
