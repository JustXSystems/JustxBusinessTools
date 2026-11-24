/**
 * India Post DIGIPIN encoder (Apache-2.0 reference algorithm).
 * https://github.com/INDIAPOST-gov/digipin
 *
 * Offline — no API key. Used as a searchable handoff when Mappls Pin
 * is unavailable and for always-on Digipin display.
 */

const DIGIPIN_GRID = [
  ["F", "C", "9", "8"],
  ["J", "3", "2", "7"],
  ["K", "4", "5", "6"],
  ["L", "M", "P", "T"],
] as const;

const BOUNDS = {
  minLat: 2.5,
  maxLat: 38.5,
  minLon: 63.5,
  maxLon: 99.5,
};

/** Encode WGS-84 to spaced Digipin e.g. "4P3 KCM 7J87". */
export function encodeDigipin(lat: number, lon: number): string | undefined {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < BOUNDS.minLat ||
    lat > BOUNDS.maxLat ||
    lon < BOUNDS.minLon ||
    lon > BOUNDS.maxLon
  ) {
    return undefined;
  }

  let minLat = BOUNDS.minLat;
  let maxLat = BOUNDS.maxLat;
  let minLon = BOUNDS.minLon;
  let maxLon = BOUNDS.maxLon;
  let digiPin = "";

  for (let level = 1; level <= 10; level++) {
    const latDiv = (maxLat - minLat) / 4;
    const lonDiv = (maxLon - minLon) / 4;
    let row = 3 - Math.floor((lat - minLat) / latDiv);
    let col = Math.floor((lon - minLon) / lonDiv);
    row = Math.max(0, Math.min(row, 3));
    col = Math.max(0, Math.min(col, 3));
    digiPin += DIGIPIN_GRID[row][col];
    maxLat = minLat + latDiv * (4 - row);
    minLat = minLat + latDiv * (3 - row);
    minLon = minLon + lonDiv * col;
    maxLon = minLon + lonDiv;
  }

  const compact = digiPin.toUpperCase();
  return `${compact.slice(0, 3)} ${compact.slice(3, 6)} ${compact.slice(6)}`;
}

/** Compact 10-char form without spaces. */
export function encodeDigipinCompact(lat: number, lon: number): string | undefined {
  return encodeDigipin(lat, lon)?.replace(/\s+/g, "");
}
