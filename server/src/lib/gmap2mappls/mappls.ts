import {
  mapplsPointUrl,
  roundCoord,
  sampleMapplsSide,
  type MapplsSide,
} from "@jbt/shared";

export function getMapplsAccessToken(): string | null {
  const t = (process.env.MAPPLS_ACCESS_TOKEN ?? "").trim();
  return t || null;
}

type MapplsRevResult = {
  formatted_address?: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
  village?: string;
  subLocality?: string;
  lat?: string | number;
  lng?: string | number;
  mapplsPin?: string;
  eloc?: string;
  eLoc?: string;
};

type MapplsRevResponse = {
  responseCode?: number;
  results?: MapplsRevResult[];
};

async function fetchDigipin(lat: number, lng: number, token: string): Promise<string | undefined> {
  try {
    const url = new URL("https://sdk.mappls.com/map/api/digipin");
    // API expects quoted "lat,lng" in some samples; also try bare pair.
    url.searchParams.set("coordinates", `${lat},${lng}`);
    url.searchParams.set("access_token", token);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { digipin?: string };
    const pin = data.digipin?.trim();
    return pin || undefined;
  } catch {
    return undefined;
  }
}

function pickMapplsPin(row: MapplsRevResult): string | undefined {
  const raw = row.mapplsPin || row.eloc || row.eLoc;
  const pin = String(raw ?? "").trim();
  return /^[A-Za-z0-9]{6}$/.test(pin) ? pin : undefined;
}

/**
 * Mappls Reverse Geocode only — never text / place search.
 * Optionally enriches Digipin when the key allows Digipin Conversion.
 * Falls back to sample mode when token is missing or API fails soft.
 */
export async function reverseGeocodeMappls(lat: number, lng: number): Promise<MapplsSide> {
  const token = getMapplsAccessToken();
  if (!token) {
    return sampleMapplsSide(lat, lng);
  }

  const url = new URL("https://search.mappls.com/search/address/rev-geocode");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("region", "IND");
  url.searchParams.set("access_token", token);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const sample = sampleMapplsSide(lat, lng);
      sample.formattedAddress = `${sample.formattedAddress} [Mappls HTTP ${res.status}]`;
      const digipin = await fetchDigipin(lat, lng, token);
      if (digipin) sample.digipin = digipin;
      return sample;
    }
    const data = (await res.json()) as MapplsRevResponse;
    const row = data.results?.[0];
    if (!row) {
      const sample = sampleMapplsSide(lat, lng);
      const digipin = await fetchDigipin(lat, lng, token);
      if (digipin) sample.digipin = digipin;
      return sample;
    }
    const formatted =
      row.formatted_address?.trim() ||
      [row.subLocality, row.locality, row.village, row.city, row.state, row.pincode]
        .filter(Boolean)
        .join(", ") ||
      `${roundCoord(lat)}, ${roundCoord(lng)}`;

    const digipin = await fetchDigipin(lat, lng, token);

    return {
      formattedAddress: formatted,
      locality: row.locality || row.subLocality || row.village || undefined,
      city: row.city || undefined,
      state: row.state || undefined,
      pincode: row.pincode || undefined,
      mapplsPin: pickMapplsPin(row),
      digipin,
      // Critical: echo the *requested* shared point, not Mappls's snapped lat/lng
      lat: roundCoord(lat),
      lng: roundCoord(lng),
      mapplsUrl: mapplsPointUrl(lat, lng),
      sampleMode: false,
    };
  } catch {
    return sampleMapplsSide(lat, lng);
  }
}
