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
  lat: number;
  lng: number;
  mapplsUrl: string;
  sampleMode: boolean;
};

export type ResolveResult = {
  ok: true;
  lat: number;
  lng: number;
  google: GoogleSide;
  mappls: MapplsSide;
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

export function isFiniteLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
