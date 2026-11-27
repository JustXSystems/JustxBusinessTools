import { getBasePath } from "@/lib/base-path";

/** PWA manifest with correct basePath (static public file cannot know /jbt). */
export function GET() {
  const base = getBasePath();
  const start = `${base}/ims`;

  const body = {
    name: "Justxsystems IMS — Dealer",
    short_name: "Justxsystems IMS",
    description:
      "Inventory, purchasing, GST sales, receivables and field ops for dealers — connected to your Justxsystems Business Tools.",
    start_url: start,
    scope: start,
    display: "standalone",
    background_color: "#091758",
    theme_color: "#0A33FF",
    icons: [
      {
        src: `${base}/icons/IMS/justx-invoice-icon.svg`,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: `${base}/icons/IMS/justx-invoice-icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: `${base}/icons/IMS/justx-invoice-icon-1024.png`,
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
