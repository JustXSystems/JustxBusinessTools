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
  /** Shared WGS-84 point — for geo: / Open Mappls, NOT for SimpleOne search box. */
  latLng: string;
  /** Space-separated variant some map UIs prefer. */
  latLngSpaced: string;
  /** Android / many map apps: one-tap open at the shared point. */
  geoUri: string;
  /** Official Mappls web/share deep link (no Google-style 18z). */
  mapplsUrl: string;
  /** Mappls Pin deep link when pin is known — `mappls.com/{pin}`. */
  mapplsPinUrl?: string;
  /** Directions deep link ending at the shared lat/lng. */
  mapplsDirectionsUrl: string;
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

/** Share / open a place by its 6-char Mappls Pin (eLoc). */
export function mapplsPinUrl(pin: string): string {
  return `https://www.mappls.com/${String(pin).trim().toLowerCase()}`;
}

/**
 * Mappls directions widget ending at the shared coordinates.
 * Prefer this over pasting lat,lng into Autosuggest/search.
 */
export function mapplsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.mappls.com/direction?places=;${roundCoord(lat)},${roundCoord(lng)}`;
}

export function geoPointUri(lat: number, lng: number, label?: string): string {
  const q = label?.trim()
    ? `?q=${roundCoord(lat)},${roundCoord(lng)}(${encodeURIComponent(label.trim().slice(0, 80))})`
    : `?q=${roundCoord(lat)},${roundCoord(lng)}`;
  return `geo:${roundCoord(lat)},${roundCoord(lng)}${q}`;
}

/** Short tip shown under SimpleOne / OEM paste actions. */
export const SIMPLEONE_PASTE_TIP =
  "SimpleOne Mappls search = places & Mappls Pin only. Paste the 6-char Mappls Pin — do NOT paste lat,lng or geo: (Autosuggest treats those as text and jumps elsewhere).";

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
  if (opts?.mapplsPin) {
    lines.push(`Mappls Pin: ${opts.mapplsPin}`);
    lines.push(`Pin link: ${mapplsPinUrl(opts.mapplsPin)}`);
  }
  if (opts?.digipin) lines.push(`Digipin: ${opts.digipin}`);
  lines.push(
    "SimpleOne: paste Mappls Pin into search — never lat,lng / geo: / Google address text.",
  );
  return lines.join("\n");
}

export function buildPasteKit(
  lat: number,
  lng: number,
  opts?: { mapplsPin?: string; digipin?: string; name?: string },
): PasteKit {
  const latLng = formatCoordPair(lat, lng);
  const mapplsUrl = mapplsPointUrl(lat, lng);
  const pin = opts?.mapplsPin?.trim() || undefined;
  return {
    latLng,
    latLngSpaced: `${roundCoord(lat)}, ${roundCoord(lng)}`,
    geoUri: geoPointUri(lat, lng, opts?.name),
    mapplsUrl,
    mapplsPinUrl: pin ? mapplsPinUrl(pin) : undefined,
    mapplsDirectionsUrl: mapplsDirectionsUrl(lat, lng),
    shareText: buildShareText(lat, lng, {
      name: opts?.name,
      mapplsPin: pin,
      digipin: opts?.digipin,
      mapplsUrl,
    }),
    mapplsPin: pin,
    digipin: opts?.digipin || undefined,
    tip: pin
      ? `SimpleOne: Copy Mappls Pin (${pin}) and paste into search — not lat,lng.`
      : SIMPLEONE_PASTE_TIP,
  };
}

export function isFiniteLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
