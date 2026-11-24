import {
  encodeDigipin,
  mapplsPointUrl,
  roundCoord,
  sampleMapplsSide,
  type MapplsSide,
} from "@jbt/shared";
import { fetchMapplsClickRevg } from "./clickRevg.js";

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

async function fetchDigipinApi(lat: number, lng: number, token: string): Promise<string | undefined> {
  try {
    const url = new URL("https://sdk.mappls.com/map/api/digipin");
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
  return /^[A-Za-z0-9]{6}$/.test(pin) ? pin.toLowerCase() : undefined;
}

function withOfflineDigipin(side: MapplsSide, lat: number, lng: number): MapplsSide {
  if (!side.digipin) {
    const local = encodeDigipin(lat, lng);
    if (local) side.digipin = local;
  }
  return side;
}

/**
 * Mappls Reverse Geocode only — never text / place search.
 * Always tries Mappls web click-revg for Mappls Pin (required for SimpleOne search).
 * Optionally enriches Digipin via token API; falls back to offline India Post encode.
 */
export async function reverseGeocodeMappls(lat: number, lng: number): Promise<MapplsSide> {
  const token = getMapplsAccessToken();
  const clickPromise = fetchMapplsClickRevg(lat, lng);

  if (!token) {
    const sample = sampleMapplsSide(lat, lng);
    const click = await clickPromise;
    if (click) {
      sample.mapplsPin = click.mapplsPin;
      sample.digipin = click.digipin || sample.digipin;
      if (click.formattedAddress && sample.sampleMode) {
        // Prefer live place name/address from click-revg over generic sample copy
        sample.formattedAddress = click.formattedAddress;
      }
    }
    return withOfflineDigipin(sample, lat, lng);
  }

  const url = new URL("https://search.mappls.com/search/address/rev-geocode");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("region", "IND");
  url.searchParams.set("access_token", token);

  try {
    const [res, click] = await Promise.all([
      fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }),
      clickPromise,
    ]);

    if (!res.ok) {
      const sample = sampleMapplsSide(lat, lng);
      sample.formattedAddress = `${sample.formattedAddress} [Mappls HTTP ${res.status}]`;
      if (click) {
        sample.mapplsPin = click.mapplsPin;
        sample.digipin = click.digipin || sample.digipin;
        if (click.formattedAddress) sample.formattedAddress = click.formattedAddress;
      } else {
        const digipin = await fetchDigipinApi(lat, lng, token);
        if (digipin) sample.digipin = digipin;
      }
      return withOfflineDigipin(sample, lat, lng);
    }

    const data = (await res.json()) as MapplsRevResponse;
    const row = data.results?.[0];
    if (!row) {
      const sample = sampleMapplsSide(lat, lng);
      if (click) {
        sample.mapplsPin = click.mapplsPin;
        sample.digipin = click.digipin || sample.digipin;
        if (click.formattedAddress) sample.formattedAddress = click.formattedAddress;
      } else {
        const digipin = await fetchDigipinApi(lat, lng, token);
        if (digipin) sample.digipin = digipin;
      }
      return withOfflineDigipin(sample, lat, lng);
    }

    const formatted =
      row.formatted_address?.trim() ||
      click?.formattedAddress ||
      [row.subLocality, row.locality, row.village, row.city, row.state, row.pincode]
        .filter(Boolean)
        .join(", ") ||
      `${roundCoord(lat)}, ${roundCoord(lng)}`;

    const digipin =
      click?.digipin ||
      (await fetchDigipinApi(lat, lng, token)) ||
      encodeDigipin(lat, lng);

    return {
      formattedAddress: formatted,
      locality: row.locality || row.subLocality || row.village || undefined,
      city: row.city || undefined,
      state: row.state || undefined,
      pincode: row.pincode || undefined,
      mapplsPin: pickMapplsPin(row) || click?.mapplsPin,
      digipin,
      // Critical: echo the *requested* shared point, not Mappls's snapped lat/lng
      lat: roundCoord(lat),
      lng: roundCoord(lng),
      mapplsUrl: mapplsPointUrl(lat, lng),
      sampleMode: false,
    };
  } catch {
    const sample = sampleMapplsSide(lat, lng);
    const click = await clickPromise.catch(() => null);
    if (click) {
      sample.mapplsPin = click.mapplsPin;
      sample.digipin = click.digipin || sample.digipin;
      if (click.formattedAddress) sample.formattedAddress = click.formattedAddress;
    }
    return withOfflineDigipin(sample, lat, lng);
  }
}
