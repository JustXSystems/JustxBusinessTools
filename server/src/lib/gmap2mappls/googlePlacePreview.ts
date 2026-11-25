import { isFiniteLatLng, type ParsedCoords } from "@jbt/shared";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Resolve exact WGS-84 for a Google feature id (`0x…:0x…`) via maps/preview/place.
 * This matches the pin Google Maps shows for saved / place-id share links — unlike
 * Photon/Nominatim geocoding of the place-name string (often 1km+ off).
 */
export async function fetchGoogleFeatureCoords(ftid: string): Promise<ParsedCoords | null> {
  const id = ftid.trim();
  if (!/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(id)) return null;

  const url =
    "https://www.google.com/maps/preview/place?authuser=0&hl=en&gl=in&pb=!1m1!1s" +
    encodeURIComponent(id);

  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": UA,
          Accept: "*/*",
          "Accept-Language": "en-IN,en;q=0.9",
        },
        signal: AbortSignal.timeout(12_000),
      });
      break;
    } catch {
      if (attempt >= 2) return null;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  if (!res || !res.ok) return null;

  const text = await res.text();
  // Place marker is emitted as [null,null,lat,lng] (often twice).
  const m = text.match(/\[null,null,(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)\]/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!isFiniteLatLng(lat, lng)) return null;
  return { lat, lng, source: "place" };
}
