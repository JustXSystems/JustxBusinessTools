import { extractCoordsFromGoogleUrl, isAllowedGoogleHost, type ParsedCoords } from "@jbt/shared";

const UA = "Justxsystems-JBT-GMAP2MAPPLS/1.0";

/**
 * Follow redirects for short Google Maps links, only onto Google hosts.
 */
export async function expandGoogleShortLink(startUrl: string): Promise<{
  finalUrl: string;
  coords: ParsedCoords | null;
}> {
  let current = startUrl;
  for (let i = 0; i < 6; i++) {
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
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8_000),
    });

    const loc = res.headers.get("location");
    if (loc && (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308)) {
      const next = new URL(loc, current).toString();
      const nextHost = new URL(next).hostname;
      if (!isAllowedGoogleHost(nextHost)) {
        throw new Error("Short link redirected off Google — blocked for safety.");
      }
      current = next;
      continue;
    }

    // Some short links land on an HTML page that embeds the destination
    if (res.ok) {
      const text = await res.text();
      const meta = text.match(/content=["']0;\s*url=([^"']+)["']/i);
      if (meta?.[1]) {
        const next = new URL(meta[1], current).toString();
        if (!isAllowedGoogleHost(new URL(next).hostname)) {
          throw new Error("Short link meta-refresh left Google hosts.");
        }
        current = next;
        continue;
      }
      const og = text.match(/property=["']og:url["']\s+content=["']([^"']+)["']/i)
        || text.match(/content=["']([^"']+)["']\s+property=["']og:url["']/i);
      if (og?.[1] && isAllowedGoogleHost(new URL(og[1], current).hostname)) {
        current = new URL(og[1], current).toString();
      }
    }
    break;
  }

  const coords = extractCoordsFromGoogleUrl(current);
  return { finalUrl: current, coords };
}
