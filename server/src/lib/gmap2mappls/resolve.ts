import {
  buildOemHandoffSummary,
  buildPasteKit,
  classifyInput,
  extractCoordsFromGoogleUrl,
  extractPlaceNameFromGoogleUrl,
  formatCoordPair,
  googleMapsPointUrl,
  mapplsPointUrl,
  matchSampleByCoords,
  roundCoord,
  SAMPLE_FIXTURES,
  sourceLabel,
  type CoordSource,
  type ResolveResponse,
} from "@jbt/shared";
import { expandGoogleShortLink } from "./expand.js";
import { geocodeIndiaAddress } from "./geocode.js";
import { getMapplsAccessToken, reverseGeocodeMappls } from "./mappls.js";

function googleName(opts: {
  input: string;
  source: CoordSource;
  label?: string;
  displayName?: string;
}): string {
  if (opts.displayName) return opts.displayName;
  if (opts.label) return opts.label;
  if (opts.source === "raw" || opts.source === "at" || opts.source === "bang" || opts.source === "query" || opts.source === "ll") {
    return `Point ${opts.input.slice(0, 80)}`;
  }
  return opts.input.slice(0, 160);
}

export async function resolveGmap2Mappls(rawInput: string): Promise<ResolveResponse> {
  const input = String(rawInput ?? "").trim();
  if (!input) {
    return { ok: false, error: "Paste a Google Maps link, an Indian address, or lat,lng.", code: "empty" };
  }

  // Exact sample-chip match → deterministic acceptance fixtures (works without token)
  const fixture = SAMPLE_FIXTURES.find(
    (s) => s.input.trim().toLowerCase() === input.toLowerCase() || s.label === input,
  );
  if (fixture) {
    const mappls = await reverseGeocodeMappls(fixture.lat, fixture.lng);
    // Keep sample address wording when in sample mode; live Mappls when token present
    if (mappls.sampleMode) {
      mappls.formattedAddress = fixture.mapplsAddress;
      mappls.locality = fixture.locality;
      mappls.city = fixture.city;
      mappls.state = fixture.state;
      mappls.pincode = fixture.pincode;
    }
    const lat = roundCoord(fixture.lat);
    const lng = roundCoord(fixture.lng);
    return {
      ok: true,
      lat,
      lng,
      sampleMode: mappls.sampleMode,
      tip: "Google Maps to Mappls: pick brand → drop a Google place → open your car app.",
      paste: buildPasteKit(lat, lng, {
        mapplsPin: mappls.mapplsPin,
        digipin: mappls.digipin,
        name: fixture.googleName,
        placeName: mappls.placeName || fixture.googleName,
        locality: mappls.locality || fixture.locality,
        city: mappls.city || fixture.city,
      }),
      google: {
        input,
        name: fixture.googleName,
        lat,
        lng,
        source: fixture.id.includes("address") || fixture.id.includes("gate") ? "geocode" : "at",
        mapsUrl: googleMapsPointUrl(lat, lng),
      },
      mappls: {
        ...mappls,
        lat,
        lng,
        mapplsUrl: mapplsPointUrl(lat, lng),
      },
    };
  }

  const classified = classifyInput(input);
  let lat = 0;
  let lng = 0;
  let source: CoordSource = "raw";
  let displayName: string | undefined;
  let label: string | undefined;

  try {
    if (classified.kind === "empty") {
      return { ok: false, error: "Paste a Google Maps link, an Indian address, or lat,lng.", code: "empty" };
    }

    if (classified.kind === "coords") {
      lat = classified.coords.lat;
      lng = classified.coords.lng;
      source = classified.coords.source;
    } else if (classified.kind === "short_link") {
      const expanded = await expandGoogleShortLink(classified.url);
      if (!expanded.coords) {
        return {
          ok: false,
          error:
            "Short link opened on Google but had no coordinates. Open the place in Google Maps → Share → Copy link (full URL with @lat,lng).",
          code: "no_coords",
        };
      }
      lat = expanded.coords.lat;
      lng = expanded.coords.lng;
      source = "short_link";
      label = expanded.coords.label;
      displayName = expanded.placeName ?? undefined;
    } else if (classified.kind === "google_url") {
      const coords = classified.coords ?? extractCoordsFromGoogleUrl(classified.url);
      if (!coords) {
        return {
          ok: false,
          error:
            "That Google Maps URL has no coordinates. Use Share → Copy link from the place pin, or paste lat,lng.",
          code: "no_coords",
        };
      }
      lat = coords.lat;
      lng = coords.lng;
      source = coords.source;
      label = coords.label;
      displayName = extractPlaceNameFromGoogleUrl(classified.url) ?? undefined;
    } else {
      // Full address — Photon/Nominatim only (never Mappls text search)
      const geo = await geocodeIndiaAddress(classified.address);
      lat = geo.lat;
      lng = geo.lng;
      source = "geocode";
      displayName = geo.displayName;
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not resolve that location.",
      code: "resolve_failed",
    };
  }

  lat = roundCoord(lat);
  lng = roundCoord(lng);

  const mappls = await reverseGeocodeMappls(lat, lng);
  // Align sample copy when we land on a known fixture point
  if (mappls.sampleMode) {
    const hit = matchSampleByCoords(lat, lng);
    if (hit) {
      mappls.formattedAddress = hit.mapplsAddress;
      mappls.locality = hit.locality;
      mappls.city = hit.city;
      mappls.state = hit.state;
      mappls.pincode = hit.pincode;
    }
  }

  return {
    ok: true,
    lat,
    lng,
    sampleMode: mappls.sampleMode || !getMapplsAccessToken(),
    tip: "Google Maps to Mappls: pick brand → drop a Google place → open your car app.",
    paste: buildPasteKit(lat, lng, {
      mapplsPin: mappls.mapplsPin,
      digipin: mappls.digipin,
      name: googleName({ input, source, label, displayName }),
      placeName: mappls.placeName || googleName({ input, source, label, displayName }),
      locality: mappls.locality,
      city: mappls.city,
    }),
    google: {
      input,
      name: googleName({ input, source, label, displayName }),
      lat,
      lng,
      source,
      mapsUrl: googleMapsPointUrl(lat, lng),
    },
    mappls: {
      ...mappls,
      lat,
      lng,
      mapplsUrl: mapplsPointUrl(lat, lng),
    },
  };
}

export function resolveMeta() {
  return {
    hasToken: Boolean(getMapplsAccessToken()),
    samples: SAMPLE_FIXTURES.map((s) => ({
      id: s.id,
      label: s.label,
      input: s.input,
      coords: formatCoordPair(s.lat, s.lng),
    })),
    tip: "Google Maps to Mappls: pick brand → drop a Google place → open your car app.",
    sourceHint: sourceLabel,
    oem: buildOemHandoffSummary(),
  };
}
