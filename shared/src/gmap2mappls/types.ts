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
  /** Numeric WGS-84 — used to build per-brand OEM package Intents. */
  lat: number;
  lng: number;
  /** Shared WGS-84 point — for geo: / nav deep links, NOT OEM Autosuggest search. */
  latLng: string;
  /** Space-separated variant some map UIs prefer. */
  latLngSpaced: string;
  /** Android / many map apps: one-tap open at the shared point. */
  geoUri: string;
  /**
   * Chrome Intent that forces Simple Connect (`com.sepl.android`) with a WhatsApp-style
   * geo: destination — preferred auto-open for SimpleOne brand.
   */
  simpleConnectIntentUrl: string;
  /** Alternate: force Simple Connect via maps.google.com URL (WhatsApp location family). */
  simpleConnectMapsIntentUrl: string;
  /** Plain WhatsApp-style geo: URI (chooser → pick Simple Connect). */
  whatsappGeoUri: string;
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

/** Normalize Mappls Pin / eLoc for clipboard + search (6-char, lowercase). */
export function normalizeMapplsPin(pin: string | null | undefined): string | undefined {
  const p = String(pin || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return p.length >= 5 && p.length <= 8 ? p : undefined;
}

/** Share / open a place by its 6-char Mappls Pin (eLoc). */
export function mapplsPinUrl(pin: string): string {
  return `https://www.mappls.com/${normalizeMapplsPin(pin) || String(pin).trim().toLowerCase()}`;
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

/**
 * Android geo: URI at an exact WGS-84 point.
 * Always uses coords-only `q=lat,lng` — never a place-name label. OEM apps
 * (Simple Connect, Chetak, …) that re-run the parenthetical label through
 * Mappls Autosuggest jump to the wrong POI (e.g. "Saptagiri Layout").
 */
export function geoPointUri(lat: number, lng: number, _label?: string): string {
  const la = roundCoord(lat);
  const ln = roundCoord(lng);
  return `geo:${la},${ln}?q=${la},${ln}`;
}

/** Simple Connect package id (Simple Energy companion app). */
export const SIMPLE_CONNECT_PACKAGE = "com.sepl.android";

export const SIMPLE_CONNECT_PLAY_STORE =
  `https://play.google.com/store/apps/details?id=${SIMPLE_CONNECT_PACKAGE}`;

export function playStoreUrl(packageId: string): string {
  return `https://play.google.com/store/apps/details?id=${packageId}`;
}

/**
 * WhatsApp / Simple Connect geo URI at an exact WGS-84 point.
 * Coords-only `q=lat,lng` (no parenthetical place name). Labels caused OEMs to
 * Autosuggest-search “Saptagiri Layout” etc. while Pinway’s map stayed correct.
 * Example: geo:12.877073,77.613574?q=12.877073,77.613574
 */
export function whatsappStyleGeoUri(
  lat: number,
  lng: number,
  _label?: string,
): string {
  const la = roundCoord(lat);
  const ln = roundCoord(lng);
  return `geo:${la},${ln}?q=${la},${ln}`;
}

/**
 * Chrome/Android Intent that opens a specific OEM package with a WhatsApp-style
 * geo destination (coords only). Falls back to that app’s Play Store page if missing.
 * `label` is accepted for API compat but intentionally ignored — never embed
 * place names in geo Intents (Autosuggest re-search → wrong pin).
 */
export function oemPackageGeoIntentUrl(
  packageId: string,
  lat: number,
  lng: number,
  _label?: string,
): string {
  const geo = whatsappStyleGeoUri(lat, lng);
  const path = geo.replace(/^geo:/i, "");
  const fallback = encodeURIComponent(playStoreUrl(packageId));
  return `intent://${path}#Intent;scheme=geo;package=${packageId};S.browser_fallback_url=${fallback};end`;
}

/**
 * Launch an OEM companion app’s main activity (no location payload).
 * Use when the app does not accept geo shares but supports in-app Pin search
 * + Push to car (e.g. Mahindra Adrenox Connect).
 */
export function oemPackageLaunchUrl(packageId: string): string {
  const fallback = encodeURIComponent(playStoreUrl(packageId));
  // Prefer intent://#Intent (same family as Simple Connect geo Intents) so
  // Android Chrome + our top-level <a> launcher treat it consistently.
  return `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${packageId};S.browser_fallback_url=${fallback};end`;
}

/**
 * Force a maps.google.com pin into a specific OEM package (WhatsApp location family).
 */
export function oemPackageGoogleMapsIntentUrl(
  packageId: string,
  lat: number,
  lng: number,
): string {
  const la = roundCoord(lat);
  const ln = roundCoord(lng);
  const path = `maps.google.com/maps?q=${la}%2C${ln}&z=17`;
  const fallback = encodeURIComponent(playStoreUrl(packageId));
  return `intent://${path}#Intent;scheme=https;package=${packageId};S.browser_fallback_url=${fallback};end`;
}

/** @deprecated Prefer oemPackageGeoIntentUrl(SIMPLE_CONNECT_PACKAGE, …) */
export function simpleConnectGeoIntentUrl(
  lat: number,
  lng: number,
  label?: string,
): string {
  return oemPackageGeoIntentUrl(SIMPLE_CONNECT_PACKAGE, lat, lng, label);
}

/** @deprecated Prefer oemPackageGoogleMapsIntentUrl(SIMPLE_CONNECT_PACKAGE, …) */
export function simpleConnectGoogleMapsIntentUrl(
  lat: number,
  lng: number,
): string {
  return oemPackageGoogleMapsIntentUrl(SIMPLE_CONNECT_PACKAGE, lat, lng);
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
  "Never paste lat,lng into OEM search. SimpleOne → Simple Connect geo Intent. Mahindra Adrenox → Mappls Pin then Push to car. Other Mappls OEMs → Pin or Mappls nav.";

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
    lines.push(`Mappls Pin: ${opts.mapplsPin}`);
    lines.push(`Pin link: ${mapplsPinUrl(opts.mapplsPin)}`);
  }
  if (opts?.digipin) lines.push(`Digipin: ${opts.digipin}`);
  lines.push(
    "Do NOT paste lat,lng into OEM search. SimpleOne → Simple Connect. Mahindra → Adrenox Pin search → Push to car.",
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
  const pin = normalizeMapplsPin(opts?.mapplsPin);
  const name = opts?.placeName?.trim() || opts?.name?.trim() || undefined;
  const searchQuery = buildOemSearchQuery({
    placeName: name,
    locality: opts?.locality,
    city: opts?.city,
  });
  return {
    lat,
    lng,
    latLng,
    latLngSpaced: `${roundCoord(lat)}, ${roundCoord(lng)}`,
    geoUri: geoPointUri(lat, lng, name),
    simpleConnectIntentUrl: simpleConnectGeoIntentUrl(lat, lng, name),
    simpleConnectMapsIntentUrl: simpleConnectGoogleMapsIntentUrl(lat, lng),
    whatsappGeoUri: whatsappStyleGeoUri(lat, lng, name),
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
    tip: OEM_PASTE_TIP,
  };
}

export function isFiniteLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
