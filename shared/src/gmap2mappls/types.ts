export type LatLng = { lat: number; lng: number };

export type CoordSource =
  | "at"
  | "bang"
  | "query"
  | "place"
  | "ll"
  | "raw"
  | "short_link"
  | "geocode";

export type ParsedCoords = LatLng & {
  source: CoordSource;
  label?: string;
};

export type GoogleSide = {
  input: string;
  name: string;
  lat: number;
  lng: number;
  source: CoordSource;
  mapsUrl: string;
};

export type MapplsSide = {
  formattedAddress: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
  /** 6-char Mappls Pin / eLoc when the reverse API returns it. */
  mapplsPin?: string;
  /** India Post Digipin for the shared lat/lng (when Digipin API is enabled). */
  digipin?: string;
  lat: number;
  lng: number;
  mapplsUrl: string;
  sampleMode: boolean;
};

/** Clipboard / open helpers for Mappls-integrated apps (SimpleOne, OEM apps, etc.). */
export type PasteKit = {
  /** Canonical shared point — best paste into Mappls / SimpleOne search. */
  latLng: string;
  /** Space-separated variant some map UIs prefer. */
  latLngSpaced: string;
  /** Android / many map apps: one-tap open at the shared point. */
  geoUri: string;
  /** Official Mappls web/share deep link (no Google-style 18z). */
  mapplsUrl: string;
  /** Ready-to-send WhatsApp / SMS / ticket text. */
  shareText: string;
  mapplsPin?: string;
  digipin?: string;
  tip: string;
};

export type ResolveResult = {
  ok: true;
  lat: number;
  lng: number;
  google: GoogleSide;
  mappls: MapplsSide;
  paste: PasteKit;
  sampleMode: boolean;
  tip?: string;
};

export type ResolveError = {
  ok: false;
  error: string;
  code?: string;
};

export type ResolveResponse = ResolveResult | ResolveError;

export function roundCoord(n: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function formatCoordPair(lat: number, lng: number, digits = 6): string {
  return `${roundCoord(lat, digits)},${roundCoord(lng, digits)}`;
}

export function googleMapsPointUrl(lat: number, lng: number): string {
  // Center + pin on the shared point (same lat/lng Mappls uses).
  return `https://www.google.com/maps?q=${roundCoord(lat)},${roundCoord(lng)}&z=18`;
}

/**
 * Official Mappls lat/lng share URL.
 * Do NOT append Google-style `,18z` — Mappls treats that as a broken path and the
 * map never opens at the shared point (interstitial → blank / wrong place).
 * Docs: https://mappls.com/@lat,lng
 */
export function mapplsPointUrl(lat: number, lng: number): string {
  return `https://www.mappls.com/@${roundCoord(lat)},${roundCoord(lng)}`;
}

export function geoPointUri(lat: number, lng: number, label?: string): string {
  const q = label?.trim()
    ? `?q=${roundCoord(lat)},${roundCoord(lng)}(${encodeURIComponent(label.trim().slice(0, 80))})`
    : `?q=${roundCoord(lat)},${roundCoord(lng)}`;
  return `geo:${roundCoord(lat)},${roundCoord(lng)}${q}`;
}

export function buildShareText(
  lat: number,
  lng: number,
  opts?: { name?: string; mapplsPin?: string; digipin?: string; mapplsUrl?: string },
): string {
  const latLng = formatCoordPair(lat, lng);
  const lines = [
    opts?.name ? `Place: ${opts.name}` : "Shared map point (Google = Mappls)",
    `Coordinates: ${latLng}`,
    `Mappls: ${opts?.mapplsUrl || mapplsPointUrl(lat, lng)}`,
  ];
  if (opts?.mapplsPin) lines.push(`Mappls Pin: ${opts.mapplsPin}`);
  if (opts?.digipin) lines.push(`Digipin: ${opts.digipin}`);
  lines.push("Tip: In SimpleOne / OEM Mappls apps, paste coordinates or Mappls Pin — not the Google address text.");
  return lines.join("\n");
}

export function buildPasteKit(
  lat: number,
  lng: number,
  opts?: { mapplsPin?: string; digipin?: string; name?: string },
): PasteKit {
  const latLng = formatCoordPair(lat, lng);
  const mapplsUrl = mapplsPointUrl(lat, lng);
  return {
    latLng,
    latLngSpaced: `${roundCoord(lat)}, ${roundCoord(lng)}`,
    geoUri: geoPointUri(lat, lng, opts?.name),
    mapplsUrl,
    shareText: buildShareText(lat, lng, {
      name: opts?.name,
      mapplsPin: opts?.mapplsPin,
      digipin: opts?.digipin,
      mapplsUrl,
    }),
    mapplsPin: opts?.mapplsPin || undefined,
    digipin: opts?.digipin || undefined,
    tip: "Best: Open phone maps (geo:) or paste lat,lng / Mappls Pin into SimpleOne — never Google address text.",
  };
}

export function isFiniteLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
