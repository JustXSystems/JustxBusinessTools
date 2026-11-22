import {
  extractCityHints,
  extractNeighbourhoodTokens,
  isInIndiaBBox,
  pickBestCandidate,
  type GeocodeCandidate,
} from "@jbt/shared";

/** Drop door / plot numbers that confuse Photon into "Sector 19, Taloja" style hits. */
function stripDoorNoise(address: string): string {
  return address
    .replace(/\b\d+\s*&\s*\d+\b/g, " ")
    .replace(/\b(?:no\.?|plot|flat|door|house)\s*#?\s*\d+[a-z]?\b/gi, " ")
    .replace(/\b\d+[a-z]?(?=\s*,)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localityFocusedQuery(address: string): string | null {
  const tokens = extractNeighbourhoodTokens(address);
  const hints = extractCityHints(address);
  const parts = [...tokens.slice(0, 4), ...hints.filter((h) => !tokens.includes(h))].slice(0, 6);
  if (parts.length < 2) return null;
  return `${parts.join(" ")}, India`;
}

const UA = "Justxsystems-JBT-GMAP2MAPPLS/1.0 (https://justxsystems.com; maps-utility)";

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    district?: string;
    locality?: string;
    street?: string;
    postcode?: string;
  };
};

function photonToCandidate(f: PhotonFeature): GeocodeCandidate | null {
  const coords = f.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = f.properties ?? {};
  const parts = [p.name, p.street, p.locality, p.district, p.city, p.state, p.country].filter(Boolean);
  return {
    lat,
    lng,
    displayName: parts.join(", ") || `${lat},${lng}`,
    city: p.city,
    state: p.state,
    country: p.country ?? (p.countrycode === "IN" ? "India" : undefined),
  };
}

async function geocodePhoton(address: string): Promise<GeocodeCandidate[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", address);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  // India-ish view bias (Bengaluru)
  url.searchParams.set("lat", "12.97");
  url.searchParams.set("lon", "77.59");

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const out: GeocodeCandidate[] = [];
  for (const f of data.features ?? []) {
    const c = photonToCandidate(f);
    if (c && isInIndiaBBox(c.lat, c.lng)) out.push(c);
  }
  return out;
}

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    state?: string;
    country?: string;
    suburb?: string;
    neighbourhood?: string;
  };
};

async function geocodeNominatim(address: string): Promise<GeocodeCandidate[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "in");

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as NominatimResult[];
  return (data ?? [])
    .map((r) => {
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        lat,
        lng,
        displayName: r.display_name,
        city: r.address?.city ?? r.address?.town,
        state: r.address?.state,
        country: r.address?.country,
      } satisfies GeocodeCandidate;
    })
    .filter((c): c is GeocodeCandidate => Boolean(c));
}

/**
 * India-biased forward geocode. Never uses Mappls Text Search.
 * Scores candidates against the original address (neighbourhood validation).
 */
export async function geocodeIndiaAddress(address: string): Promise<GeocodeCandidate> {
  const cleaned = stripDoorNoise(address);
  const focused = localityFocusedQuery(address);
  const queries = [...new Set([address, cleaned, focused].filter((q): q is string => Boolean(q && q.length >= 6)))];

  const pool: GeocodeCandidate[] = [];
  const seen = new Set<string>();
  const pushAll = (list: GeocodeCandidate[]) => {
    for (const c of list) {
      const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(c);
    }
  };

  for (const q of queries) {
    pushAll(await geocodePhoton(q).catch(() => [] as GeocodeCandidate[]));
    let picked = pickBestCandidate(address, pool);
    if (picked) return picked.candidate;
  }

  for (const q of queries) {
    pushAll(await geocodeNominatim(q).catch(() => [] as GeocodeCandidate[]));
  }

  const picked = pickBestCandidate(address, pool);
  if (!picked) {
    throw new Error(
      "Could not place that address in India with enough neighbourhood confidence. Paste a Google Maps share link for best accuracy.",
    );
  }
  return picked.candidate;
}
