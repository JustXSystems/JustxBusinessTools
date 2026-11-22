import {
  isFiniteLatLng,
  type CoordSource,
  type LatLng,
  type ParsedCoords,
} from "./types";

const GOOGLE_HOST_RE =
  /^(?:(?:www|maps|www\.maps)\.)?google\.[a-z.]+$|^(?:maps\.app\.)?goo\.gl$/i;

/** Hosts we may follow when expanding short maps links. */
export function isAllowedGoogleHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "maps.app.goo.gl" || host === "goo.gl" || host === "g.co") return true;
  if (GOOGLE_HOST_RE.test(host)) return true;
  // regional google.com.xx / google.co.in etc.
  return /(^|\.)google\.[a-z.]+$/i.test(host);
}

export function looksLikeUrl(input: string): boolean {
  const t = input.trim();
  return /^https?:\/\//i.test(t) || /^maps\.app\.goo\.gl\//i.test(t) || /^goo\.gl\//i.test(t);
}

export function normalizeMapsUrl(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    if (!isAllowedGoogleHost(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function parsePair(a: string, b: string): LatLng | null {
  const lat = Number(a);
  const lng = Number(b);
  if (!isFiniteLatLng(lat, lng)) return null;
  return { lat, lng };
}

/** Bare `lat,lng` or `lat, lng` (optional spaces). */
export function parseRawLatLng(input: string): ParsedCoords | null {
  const t = input.trim();
  const m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const pair = parsePair(m[1], m[2]);
  if (!pair) return null;
  return { ...pair, source: "raw" };
}

/**
 * Extract coordinates from a (possibly expanded) Google Maps URL.
 * Preference order mirrors product rule: /@lat,lng → !3d!4d → q= → ll= → place path.
 */
/** `/place/Zigma+Technologies/@...` → "Zigma Technologies" */
export function extractPlaceNameFromGoogleUrl(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    if (!isAllowedGoogleHost(url.hostname)) return null;
    const m = decodeURIComponent(url.pathname).match(/\/place\/([^/]+)/i);
    if (!m?.[1]) return null;
    const name = m[1].replace(/\+/g, " ").replace(/\s+/g, " ").trim();
    if (!name || /^[\d.,\s@-]+$/.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

export function extractCoordsFromGoogleUrl(urlString: string): ParsedCoords | null {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  if (!isAllowedGoogleHost(url.hostname)) return null;

  const href = url.href;
  const path = decodeURIComponent(url.pathname + url.search + url.hash);

  // data=!3dLAT!4dLNG (dropped pin) — prefer over viewport @ when both exist
  const bang = href.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (bang) {
    const pair = parsePair(bang[1], bang[2]);
    if (pair) return { ...pair, source: "bang" };
  }

  // /@lat,lng,zoom or /@lat,lng
  const at = path.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (at) {
    const pair = parsePair(at[1], at[2]);
    if (pair) return { ...pair, source: "at" };
  }

  // q=lat,lng or query=lat,lng
  for (const key of ["q", "query", "destination", "origin", "center"]) {
    const v = url.searchParams.get(key);
    if (!v) continue;
    const m = v.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) {
      const pair = parsePair(m[1], m[2]);
      if (pair) return { ...pair, source: "query", label: v };
    }
  }

  // ll=lat,lng
  const ll = url.searchParams.get("ll");
  if (ll) {
    const m = ll.match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
    if (m) {
      const pair = parsePair(m[1], m[2]);
      if (pair) return { ...pair, source: "ll" };
    }
  }

  // /place/.../@lat,lng already handled; bare /maps?q=place name without coords → null
  return null;
}

export function isShortGoogleMapsLink(input: string): boolean {
  const n = normalizeMapsUrl(input);
  if (!n) return false;
  try {
    const u = new URL(n);
    return u.hostname === "maps.app.goo.gl" || u.hostname === "goo.gl" || u.hostname === "g.co";
  } catch {
    return false;
  }
}

export type ParseInputResult =
  | { kind: "coords"; coords: ParsedCoords; googleUrl?: string }
  | { kind: "short_link"; url: string }
  | { kind: "google_url"; url: string; coords: ParsedCoords | null }
  | { kind: "address"; address: string };

/**
 * Classify user paste without network I/O.
 */
export function classifyInput(raw: string): ParseInputResult | { kind: "empty" } {
  const input = raw.trim();
  if (!input) return { kind: "empty" };

  const bare = parseRawLatLng(input);
  if (bare) return { kind: "coords", coords: bare };

  if (looksLikeUrl(input)) {
    const url = normalizeMapsUrl(input);
    if (!url) {
      return { kind: "address", address: input };
    }
    if (isShortGoogleMapsLink(url)) {
      return { kind: "short_link", url };
    }
    const coords = extractCoordsFromGoogleUrl(url);
    return { kind: "google_url", url, coords };
  }

  return { kind: "address", address: input };
}

export function sourceLabel(source: CoordSource): string {
  switch (source) {
    case "at":
      return "Google Maps @lat,lng";
    case "bang":
      return "Google Maps pin (!3d/!4d)";
    case "query":
      return "Google Maps query coords";
    case "ll":
      return "Google Maps ll=";
    case "place":
      return "Google place";
    case "short_link":
      return "Expanded Google short link";
    case "raw":
      return "Typed coordinates";
    case "geocode":
      return "Geocoded address (India-biased)";
    default:
      return source;
  }
}
