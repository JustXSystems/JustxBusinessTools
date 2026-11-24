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
  /** Nearest POI / place name from Mappls click-revg (best OEM search text). */
  placeName?: string;
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
  /** Shared WGS-84 point — for geo: / nav deep links, NOT OEM Autosuggest search. */
  latLng: string;
  /** Space-separated variant some map UIs prefer. */
  latLngSpaced: string;
  /** Android / many map apps: one-tap open at the shared point. */
  geoUri: string;
  /**
   * Android intent that targets Simple Connect (`com.sepl.android`) with geo coords.
   * Works when Simple Connect registers for geo / WhatsApp-location style opens.
   */
  simpleConnectIntentUrl: string;
  /** Same point on Google Maps (Ola / TVS Google / share-to-Simple-Connect). */
  googleMapsUrl: string;
  /** Official Mappls web/share deep link (no Google-style 18z). */
  mapplsUrl: string;
  /** Mappls Pin deep link when pin is known — `mappls.com/{pin}`. */
  mapplsPinUrl?: string;
  /** Directions widget ending at shared lat/lng. */
  mapplsDirectionsUrl: string;
  /** Turn-by-turn nav deep link (4W / driving) — lat,lng works here. */
  mapplsNavDrivingUrl: string;
  /** Turn-by-turn nav deep link (2W / biking). */
  mapplsNavBikingUrl: string;
  /** Native Android scheme (requires Mappls app). */
  mapplsNavDrivingUri: string;
  mapplsNavBikingUri: string;
  /**
   * Best string to type into OEM Autosuggest when eLoc/Pin search is NOT entitled
   * (SimpleOne often falls in this bucket — Pin fuzzy-matches the wrong place).
   */
  searchQuery?: string;
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

export type MapplsNavMode = "driving" | "biking" | "walking" | "trucking";

/**
 * Official Mappls navigation deep link — lat,lng IS valid here (unlike search).
 * Docs: https://about.mappls.com/api/move-api/android
 */
export function mapplsNavigationUrl(
  lat: number,
  lng: number,
  opts?: { name?: string; mode?: MapplsNavMode; scheme?: "https" | "mappls" },
): string {
  const mode = opts?.mode || "driving";
  const label = (opts?.name || "Destination").replace(/[,&]/g, " ").trim().slice(0, 80) || "Destination";
  const places = `${roundCoord(lat)},${roundCoord(lng)},${encodeURIComponent(label)}`;
  const q = `places=${places}&isNav=true&mode=${mode}`;
  return opts?.scheme === "mappls"
    ? `mappls://navigation?${q}`
    : `https://www.mappls.com/navigation?${q}`;
}

export function geoPointUri(lat: number, lng: number, label?: string): string {
  const q = label?.trim()
    ? `?q=${roundCoord(lat)},${roundCoord(lng)}(${encodeURIComponent(label.trim().slice(0, 80))})`
    : `?q=${roundCoord(lat)},${roundCoord(lng)}`;
  return `geo:${roundCoord(lat)},${roundCoord(lng)}${q}`;
}

/**
 * Chrome/Android intent URL that tries to open Simple Connect with the exact geo point.
 * Package: com.sepl.android (Simple Connect). Falls back to geo chooser if unsupported.
 */
export function simpleConnectGeoIntentUrl(
  lat: number,
  lng: number,
  label?: string,
): string {
  const la = roundCoord(lat);
  const ln = roundCoord(lng);
  const q = label?.trim()
    ? `${la},${ln}(${encodeURIComponent(label.trim().slice(0, 80))})`
    : `${la},${ln}`;
  return `intent://${la},${ln}?q=${q}#Intent;scheme=geo;package=com.sepl.android;end`;
}

/** Best Autosuggest query: POI name (not Pin, not raw coords). */
export function buildOemSearchQuery(opts?: {
  placeName?: string;
  locality?: string;
  city?: string;
}): string | undefined {
  const name = opts?.placeName?.trim();
  if (!name) return undefined;
  const bits = [name];
  const loc = opts?.locality?.trim();
  const city = opts?.city?.trim();
  if (loc && !name.toLowerCase().includes(loc.toLowerCase())) bits.push(loc);
  if (city && !name.toLowerCase().includes(city.toLowerCase())) bits.push(city);
  return bits.join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Short tip shown under OEM paste actions. */
export const OEM_PASTE_TIP =
  "SimpleOne: do NOT paste Mappls Pin / lat,lng into search (fuzzy wrong place). Copy place name, or Open Google/geo → Share/Push to Simple Connect. Other Mappls OEMs: try Pin or Navigate Mappls.";

/** @deprecated Use OEM_PASTE_TIP */
export const SIMPLEONE_PASTE_TIP = OEM_PASTE_TIP;

export function buildShareText(
  lat: number,
  lng: number,
  opts?: {
    name?: string;
    searchQuery?: string;
    mapplsPin?: string;
    digipin?: string;
    mapplsUrl?: string;
  },
): string {
  const latLng = formatCoordPair(lat, lng);
  const lines = [
    opts?.name ? `Place: ${opts.name}` : "Shared map point (Google = Mappls)",
    `Coordinates: ${latLng}`,
    `Mappls: ${opts?.mapplsUrl || mapplsPointUrl(lat, lng)}`,
    `Navigate 2W: ${mapplsNavigationUrl(lat, lng, { name: opts?.name, mode: "biking" })}`,
    `Navigate 4W: ${mapplsNavigationUrl(lat, lng, { name: opts?.name, mode: "driving" })}`,
    `Google: ${googleMapsPointUrl(lat, lng)}`,
  ];
  if (opts?.searchQuery) {
    lines.push(`OEM search text: ${opts.searchQuery}`);
  }
  if (opts?.mapplsPin) {
    lines.push(`Mappls Pin: ${opts.mapplsPin} (correct on mappls.com — SimpleOne search may not resolve eLoc)`);
    lines.push(`Pin link: ${mapplsPinUrl(opts.mapplsPin)}`);
  }
  if (opts?.digipin) lines.push(`Digipin: ${opts.digipin}`);
  lines.push(
    "SimpleOne: paste place name OR open Google/geo and Push/Share to Simple Connect — not Pin/lat,lng in search.",
  );
  return lines.join("\n");
}

export function buildPasteKit(
  lat: number,
  lng: number,
  opts?: {
    mapplsPin?: string;
    digipin?: string;
    name?: string;
    placeName?: string;
    locality?: string;
    city?: string;
  },
): PasteKit {
  const latLng = formatCoordPair(lat, lng);
  const mapplsUrl = mapplsPointUrl(lat, lng);
  const pin = opts?.mapplsPin?.trim() || undefined;
  const name = opts?.placeName?.trim() || opts?.name?.trim() || undefined;
  const searchQuery = buildOemSearchQuery({
    placeName: name,
    locality: opts?.locality,
    city: opts?.city,
  });
  return {
    latLng,
    latLngSpaced: `${roundCoord(lat)}, ${roundCoord(lng)}`,
    geoUri: geoPointUri(lat, lng, name),
    simpleConnectIntentUrl: simpleConnectGeoIntentUrl(lat, lng, name),
    googleMapsUrl: googleMapsPointUrl(lat, lng),
    mapplsUrl,
    mapplsPinUrl: pin ? mapplsPinUrl(pin) : undefined,
    mapplsDirectionsUrl: mapplsDirectionsUrl(lat, lng),
    mapplsNavDrivingUrl: mapplsNavigationUrl(lat, lng, { name, mode: "driving" }),
    mapplsNavBikingUrl: mapplsNavigationUrl(lat, lng, { name, mode: "biking" }),
    mapplsNavDrivingUri: mapplsNavigationUrl(lat, lng, { name, mode: "driving", scheme: "mappls" }),
    mapplsNavBikingUri: mapplsNavigationUrl(lat, lng, { name, mode: "biking", scheme: "mappls" }),
    searchQuery,
    shareText: buildShareText(lat, lng, {
      name,
      searchQuery,
      mapplsPin: pin,
      digipin: opts?.digipin,
      mapplsUrl,
    }),
    mapplsPin: pin,
    digipin: opts?.digipin || undefined,
    tip: searchQuery
      ? `SimpleOne: Copy place name “${searchQuery}” into search — or Open Google → Share/Push to Simple Connect. Pin may fuzzy-match wrong.`
      : OEM_PASTE_TIP,
  };
}

export function isFiniteLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
