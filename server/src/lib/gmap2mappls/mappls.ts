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
};

type MapplsRevResponse = {
  responseCode?: number;
  results?: MapplsRevResult[];
};

/**
 * Mappls Reverse Geocode only — never text / place search.
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
      // Soft-fail to sample so the shared point still ships
      const sample = sampleMapplsSide(lat, lng);
      sample.formattedAddress = `${sample.formattedAddress} [Mappls HTTP ${res.status}]`;
      return sample;
    }
    const data = (await res.json()) as MapplsRevResponse;
    const row = data.results?.[0];
    if (!row) {
      return sampleMapplsSide(lat, lng);
    }
    const formatted =
      row.formatted_address?.trim() ||
      [row.subLocality, row.locality, row.village, row.city, row.state, row.pincode]
        .filter(Boolean)
        .join(", ") ||
      `${roundCoord(lat)}, ${roundCoord(lng)}`;

    return {
      formattedAddress: formatted,
      locality: row.locality || row.subLocality || row.village || undefined,
      city: row.city || undefined,
      state: row.state || undefined,
      pincode: row.pincode || undefined,
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
