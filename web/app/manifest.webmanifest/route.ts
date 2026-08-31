import {
  brandingIconVersion,
  loadPlatformBrandingFresh,
  resolveInstallName,
  resolveManifestIconPath,
} from "@/lib/pwa-branding";
import { getBasePath, resolvePublicOrigin, withBasePath } from "@/lib/base-path";

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
  const origin = resolvePublicOrigin(request);
  const base = getBasePath();
  const { path: iconPath } = resolveManifestIconPath(branding);
  const icon512 = withBasePath(iconPath);
  const icon192 = withBasePath("/pwa-icon/192");
  const startPath = withBasePath("/");
  // Scope must end with / for Chrome; include basePath when hosted under /jbt.
  const scopePath = `${base || ""}/` || "/";

  const body = {
    name,
    short_name: shortName,
    description:
      "Quotations, invoices, stock, projects, and calculators for Indian businesses.",
    start_url: `${startPath}${startPath.includes("?") ? "&" : "?"}jbt=${encodeURIComponent(v)}`,
    scope: scopePath,
    id: `${startPath}?jbt=${encodeURIComponent(v)}`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B2E2F",
    theme_color: "#0F3D3E",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: `${origin}${icon192}?v=${encodeURIComponent(v)}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${origin}${icon512}${icon512.includes("?") ? "&" : "?"}v=${encodeURIComponent(v)}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${origin}${icon512}${icon512.includes("?") ? "&" : "?"}v=${encodeURIComponent(v)}`,
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
