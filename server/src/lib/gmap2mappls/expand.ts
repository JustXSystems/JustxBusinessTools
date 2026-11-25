import {
  extractCoordsFromGoogleUrl,
  extractCoordsFromMapsHtml,
  extractPlaceNameFromGoogleUrl,
  isAllowedGoogleHost,
  type ParsedCoords,
} from "@jbt/shared";

/** Prefer a real browser UA — Maps short-link HTML is richer for some clients. */
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/**
 * Follow redirects for short Google Maps links, only onto Google hosts.
 * Many Share → Copy links expand to `/place/Name/data=!…!1s0x…` without @lat,lng;
 * we still return the place name so resolve can geocode it.
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

    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });

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
      // !3d!4d / marker for the saved place (common on mobile share links).
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
