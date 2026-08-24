import {
  brandingIconVersion,
  loadPlatformBrandingFresh,
  resolveInstallName,
  resolveManifestIconPath,
} from "@/lib/pwa-branding";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Explicit manifest route with no-store headers.
 * Chrome's install dialog / desktop shortcut read THIS file — not the in-app preview.
 */
export async function GET(request: Request) {
  const branding = await loadPlatformBrandingFresh();
  const name = resolveInstallName(branding.appName, branding.installName);
  const shortName = name.length > 12 ? name.slice(0, 12) : name;
  const v = brandingIconVersion(branding);
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const { path: iconPath } = resolveManifestIconPath(branding);
  const iconSrc = `${origin}${iconPath}${iconPath.includes("?") ? "&" : "?"}v=${encodeURIComponent(v)}`;

  const body = {
    name,
    short_name: shortName,
    description:
      "Quotations, invoices, stock, projects, and calculators for Indian businesses.",
    start_url: "/",
    scope: "/",
    id: `/?jbt=${encodeURIComponent(v)}`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B2E2F",
    theme_color: "#0F3D3E",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: `${origin}/pwa-icon/192?v=${encodeURIComponent(v)}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: iconSrc,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: iconSrc,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0, must-revalidate",
    },
  });
}
