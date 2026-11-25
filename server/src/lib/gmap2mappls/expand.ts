import {
  extractCoordsFromGoogleUrl,
  extractCoordsFromMapsHtml,
  extractGoogleFeatureId,
  extractPlaceNameFromGoogleUrl,
  isAllowedGoogleHost,
  type ParsedCoords,
} from "@jbt/shared";
import { fetchGoogleFeatureCoords } from "./googlePlacePreview.js";

/** Prefer a real browser UA — Maps short-link HTML is richer for some clients. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchGoogle(url: string, attempt = 0): Promise<Response> {
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    if (attempt >= 2) throw err;
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    return fetchGoogle(url, attempt + 1);
  }
}

/**
 * Follow redirects for short Google Maps links, only onto Google hosts.
 * Many Share → Copy links expand to `/place/Name/data=!…!1s0x…` without @lat,lng;
 * we recover the exact Google pin via feature-id preview (not place-name geocode).
 */
export async function expandGoogleShortLink(startUrl: string): Promise<{
  finalUrl: string;
  coords: ParsedCoords | null;
  placeName: string | null;
  htmlSnippet?: string;
}> {
  let current = startUrl;
  let lastHtml: string | null = null;

  for (let i = 0; i < 8; i++) {
    let host: string;
    try {
      host = new URL(current).hostname;
    } catch {
      throw new Error("Invalid Google Maps link.");
    }
    if (!isAllowedGoogleHost(host)) {
      throw new Error("Refusing to follow redirect off Google hosts.");
    }

    const res = await fetchGoogle(current);

    const loc = res.headers.get("location");
    if (
      loc &&
      (res.status === 301 ||
        res.status === 302 ||
        res.status === 303 ||
        res.status === 307 ||
        res.status === 308)
    ) {
      const next = new URL(loc, current).toString();
      const nextHost = new URL(next).hostname;
      if (!isAllowedGoogleHost(nextHost)) {
        throw new Error("Short link redirected off Google — blocked for safety.");
      }
      current = next;
      // Fast-path only for exact pin coords in the Location header.
      // Viewport @ alone is the camera — keep following so we can read HTML
      // !3d!4d / marker / feature-id for the saved place.
      const early = extractCoordsFromGoogleUrl(current);
      if (early && early.source !== "at") break;
      continue;
    }

    if (res.ok) {
      const text = await res.text();
      lastHtml = text;

      const meta = text.match(/content=["']0;\s*url=([^"']+)["']/i);
      if (meta?.[1]) {
        const next = new URL(meta[1], current).toString();
        if (!isAllowedGoogleHost(new URL(next).hostname)) {
          throw new Error("Short link meta-refresh left Google hosts.");
        }
        current = next;
        continue;
      }
      const og =
        text.match(/property=["']og:url["']\s+content=["']([^"']+)["']/i) ||
        text.match(/content=["']([^"']+)["']\s+property=["']og:url["']/i);
      if (og?.[1] && isAllowedGoogleHost(new URL(og[1], current).hostname)) {
        const next = new URL(og[1], current).toString();
        if (next !== current) {
          current = next;
          continue;
        }
      }
    }
    break;
  }

  let coords = extractCoordsFromGoogleUrl(current);
  // Prefer HTML dropped-pin (!3d!4d / marker) over URL viewport @ — mobile
  // share pages often put the camera in the URL and the saved pin only in HTML.
  if (lastHtml) {
    const fromHtml = extractCoordsFromMapsHtml(lastHtml);
    if (fromHtml) {
      if (
        !coords ||
        fromHtml.source === "bang" ||
        fromHtml.source === "place" ||
        (coords.source === "at" && fromHtml.source !== "at")
      ) {
        coords = fromHtml;
      }
    }
  }

  // Place-id shares often have neither @ nor !3d!4d. Google's preview/place
  // returns the same lat/lng the Maps pin shows — use that before any geocode.
  if (!coords || coords.source === "at") {
    const ftid =
      extractGoogleFeatureId(current) ||
      (lastHtml ? extractGoogleFeatureId(lastHtml) : null);
    if (ftid) {
      const fromFeature = await fetchGoogleFeatureCoords(ftid).catch(() => null);
      if (fromFeature) coords = fromFeature;
    }
  }

  const placeName =
    extractPlaceNameFromGoogleUrl(current) ||
    (lastHtml ? extractPlaceNameFromGoogleUrl(guessPlaceUrlFromHtml(lastHtml, current)) : null);

  return { finalUrl: current, coords, placeName };
}

function guessPlaceUrlFromHtml(html: string, base: string): string {
  const m =
    html.match(/\/maps\/place\/[^"'\\\s<>]+/i) ||
    html.match(/ES5DGURL='(\/maps\/place\/[^']+)'/i) ||
    html.match(/ES5DGURL="(\/maps\/place\/[^"]+)"/i);
  if (!m) return base;
  try {
    const path = (m[1] || m[0]).replace(/\\x3d/g, "=").replace(/\\x26/g, "&");
    return new URL(path, "https://www.google.com").toString();
  } catch {
    return base;
  }
}
