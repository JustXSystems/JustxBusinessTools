import { getBasePath } from "@/lib/base-path";

/** PWA manifest with correct basePath (static public file cannot know /jbt). */
export function GET() {
  const base = getBasePath();
  const start = `${base}/googlemaps2mappls`;
  const icon = `${base}/icons/googlemaps2mappls-icon.png`;

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
        src: icon,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
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
