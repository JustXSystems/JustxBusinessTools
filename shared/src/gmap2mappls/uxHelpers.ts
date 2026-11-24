/**
 * UI helpers for Google Maps to Mappls (tool id gmap2mappls) — pure functions so
 * mobile/OEM flows stay testable without a browser. The React app owns clipboard / Intent side effects.
 */
import { OEM_BRANDS, getOemBrand, resolveOemBrandId, type OemBrand } from "./oemHandoff";
import { playStoreUrl } from "./types";

/** SEO-facing product name (titles, H1, catalog, WhatsApp). */
export const PINWAY_PRODUCT_NAME = "Google Maps to Mappls";
/** Compact brand for PWA short_name / applicationName. */
export const PINWAY_BRAND_NAME = "GoogleMaps2Mappls";
export const PINWAY_TAGLINE = "Convert a Google Maps link to a Mappls Pin and open your car app.";
/** Standalone app path (no JBT chrome). Matches brand GoogleMaps2Mappls. */
export const PINWAY_APP_PATH = "/googlemaps2mappls";
/** Legacy short path — redirects to PINWAY_APP_PATH. */
export const PINWAY_LEGACY_APP_PATH = "/pinway";
/** Stable catalog / API tool id — do not rename without a migration. */
export const PINWAY_TOOL_ID = "gmap2mappls";

export const G2M_BRAND_STORAGE_KEY = "g2m.oemBrand";
export const G2M_RECENT_STORAGE_KEY = "g2m.recentPlaces";
export const G2M_RECENT_MAX = 5;

export type G2mRecentPlace = {
  input: string;
  label: string;
  lat: number;
  lng: number;
  pin?: string;
  brandId: string;
  at: number;
};

/** Heuristic: clipboard / paste looks like a Maps destination we can resolve. */
export function looksLikeMapsInput(raw: string | null | undefined): boolean {
  const t = (raw || "").trim();
  if (!t || t.length < 4 || t.length > 4000) return false;
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.|www\.google\.[^/]+\/maps)/i.test(t)) {
    return true;
  }
  if (/google\.com\/maps|maps\.app\.goo\.gl/i.test(t)) return true;
  if (/^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(t)) return true;
  // Indian-ish address / place (letters + space, not a single word password)
  if (/[a-zA-Z]{3,}/.test(t) && /\s/.test(t) && !/^[{[]/.test(t)) return true;
  return false;
}

export function resolveFindButtonLabel(brandId: string | null | undefined): string {
  const brand = getOemBrand(brandId);
  if (!brand) return "Find & open brand app";
  const app = brand.companionApp;
  if (!app) return `Find point → Mappls (${brand.name})`;
  if (app.handoff === "geo_with_pin") {
    return `Find point (then copy Pin & open ${app.name})`;
  }
  return `Find & open ${app.name}`;
}

export function playStoreUrlForBrand(brandId: string | null | undefined): string | undefined {
  const pkg = getOemBrand(brandId)?.companionApp?.packageId;
  return pkg ? playStoreUrl(pkg) : undefined;
}

/**
 * Normalize any tool or legacy URL onto the standalone app path while
 * preserving origin and base-path prefixes
 * (e.g. /jbt/tools/gmap2mappls → /jbt/googlemaps2mappls, /pinway → /googlemaps2mappls).
 */
export function normalizePinwayAppPath(pathname: string): string {
  const raw = (pathname || "/").replace(/\/+$/, "") || "/";
  const m = raw.match(
    /^(.*?)(?:\/tools\/gmap2mappls|\/gmap2mappls|\/googlemaps2mappls|\/pinway)$/i,
  );
  if (m) {
    const prefix = m[1] || "";
    return `${prefix}${PINWAY_APP_PATH}`;
  }
  if (raw === "/") return PINWAY_APP_PATH;
  return `${raw}${PINWAY_APP_PATH}`;
}

/** Build shareable Pinway URL with brand (+ optional Google link). */
export function buildToolDeepLink(
  pageUrl: string,
  brandId: string,
  q?: string | null,
): string {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    url = new URL(pageUrl, "https://example.invalid");
  }
  url.pathname = normalizePinwayAppPath(url.pathname);
  const brand = resolveOemBrandId(brandId) || brandId.trim();
  url.searchParams.set("brand", brand);
  const trimmed = (q || "").trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  else url.searchParams.delete("q");
  url.searchParams.delete("input");
  url.searchParams.delete("oem");
  return url.toString();
}

export function buildWhatsAppToolShareUrl(toolDeepLink: string, brandLabel: string): string {
  const text = `Open this place in ${brandLabel} via ${PINWAY_PRODUCT_NAME}:\n${toolDeepLink}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export type BrandSegmentFilter = "all" | "2W" | "4W";

export function filterOemBrands(
  brands: OemBrand[],
  opts: { segment?: BrandSegmentFilter; query?: string },
): OemBrand[] {
  const seg = opts.segment || "all";
  const q = (opts.query || "").trim().toLowerCase();
  return brands.filter((b) => {
    if (seg !== "all" && b.segment !== seg) return false;
    if (!q) return true;
    const hay = [
      b.id,
      b.name,
      b.examples,
      b.companionApp?.name,
      b.companionApp?.packageId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Short chip label for brand picker (mobile-friendly). */
export function brandChipLabel(brand: OemBrand): string {
  if (brand.id === "mahindra") return "Adrenox";
  if (brand.id === "mahindra-me4u") return "Me4U";
  if (brand.id === "simple-energy") return "SimpleOne";
  return brand.companionApp?.name || brand.name.split("·")[0]?.trim() || brand.name;
}

export function isMahindraFamily(brandId: string | null | undefined): boolean {
  return brandId === "mahindra" || brandId === "mahindra-me4u";
}

export function parseRecentPlaces(raw: string | null | undefined): G2mRecentPlace[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: G2mRecentPlace[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const input = typeof r.input === "string" ? r.input.trim() : "";
      const label = typeof r.label === "string" ? r.label.trim() : "";
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      const brandId = typeof r.brandId === "string" ? r.brandId : "";
      const at = Number(r.at);
      if (!input || !label || !brandId || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        input,
        label,
        lat,
        lng,
        brandId,
        at: Number.isFinite(at) ? at : 0,
        pin: typeof r.pin === "string" && r.pin ? r.pin : undefined,
      });
    }
    return out.slice(0, G2M_RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushRecentPlace(
  existing: G2mRecentPlace[],
  next: Omit<G2mRecentPlace, "at"> & { at?: number },
): G2mRecentPlace[] {
  const entry: G2mRecentPlace = {
    ...next,
    input: next.input.trim(),
    label: next.label.trim().slice(0, 80),
    at: next.at ?? Date.now(),
  };
  if (!entry.input || !entry.label) return existing.slice(0, G2M_RECENT_MAX);
  const deduped = existing.filter(
    (r) =>
      !(
        Math.abs(r.lat - entry.lat) < 1e-5 &&
        Math.abs(r.lng - entry.lng) < 1e-5 &&
        r.brandId === entry.brandId
      ),
  );
  return [entry, ...deduped].slice(0, G2M_RECENT_MAX);
}

export function recentPlaceLabel(opts: {
  placeName?: string;
  pin?: string;
  lat: number;
  lng: number;
}): string {
  if (opts.placeName?.trim()) return opts.placeName.trim().slice(0, 80);
  if (opts.pin) return `Pin ${opts.pin}`;
  return `${opts.lat.toFixed(5)}, ${opts.lng.toFixed(5)}`;
}

/** Empty-state walkthrough steps (copy for UI). */
export const G2M_WALKTHROUGH = [
  { id: "brand", title: "Pick your car brand", body: "SimpleOne, Adrenox, Me4U, Bluelink…" },
  { id: "paste", title: "Drop a Google place", body: "Share link, address, or lat,lng" },
  { id: "confirm", title: "Open in your app", body: "Push / send / start navigation" },
] as const;

export type PinwayStage = "brand" | "place" | "open";

export function emptyStateHint(brandId: string | null | undefined): string {
  const brand = getOemBrand(brandId) || OEM_BRANDS[0];
  const app = brand?.companionApp?.name;
  if (brand?.companionApp?.handoff === "geo_with_pin") {
    return `After find: copy Mappls Pin → open ${app} → ${brand.companionApp.finalAction || "Push to car"}.`;
  }
  if (app) return `After find we open ${app} with this location.`;
  return "After find we open Mappls navigation for your vehicle.";
}
