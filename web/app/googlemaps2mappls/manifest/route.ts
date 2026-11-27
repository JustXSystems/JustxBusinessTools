import { getBasePath } from "@/lib/base-path";

/** PWA manifest with correct basePath (static public file cannot know /jbt). */
export function GET() {
  const base = getBasePath();
  const start = `${base}/googlemaps2mappls`;

  const body = {
    name: "Google Maps to Mappls",
    short_name: "GoogleMaps2Mappls",
    description: "Convert a Google Maps link to a Mappls Pin and open your car app.",
    start_url: start,
    scope: start,
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0B1B3A",
    theme_color: "#4854EB",
    icons: [
      {
        src: `${base}/icons/Google2MapplsMap/justx-mappls-india-icon.svg`,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-128.png`,
        sizes: "128x128",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-256.png`,
        sizes: "256x256",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: `${base}/icons/Google2MapplsMap/justx-mappls-india-icon-1024.png`,
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
    ],
  };

  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
