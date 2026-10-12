/**
 * Onsite Track map source (Settings → Field map) and the geometry behind the built-in map.
 * The built-in map draws positions itself, so the browser contacts no map server unless a business
 * opts into a tile server or a self-hosted PMTiles file.
 */
import { get, put } from "./api";

export const MAP_SOURCES = ["builtin", "tiles", "pmtiles"] as const;
export type MapSource = (typeof MAP_SOURCES)[number];
export const MAP_FLAVORS = ["light", "white", "grayscale", "dark", "black"] as const;
export type MapFlavor = (typeof MAP_FLAVORS)[number];

export type MapSettings = {
  source: MapSource;
  tileUrl: string | null;
  pmtilesUrl: string | null;
  attribution: string | null;
  maxZoom: number;
  flavor: MapFlavor;
  updatedAt: string | null;
};
export type MapSettingsInput = Omit<MapSettings, "updatedAt">;

export const BUILTIN_MAP: MapSettings = { source: "builtin", tileUrl: null, pmtilesUrl: null, attribution: null, maxZoom: 19, flavor: "light", updatedAt: null };

export const TILE_PRESETS: ReadonlyArray<{ key: string; label: string; tileUrl: string; attribution: string; maxZoom: number; note: string }> = [
  {
    key: "osm",
    label: "OpenStreetMap public servers",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    note: "Free for light use under the OpenStreetMap tile policy. Not for heavy traffic — switch to your own server or a paid provider as usage grows.",
  },
];

let cache: Promise<MapSettings> | null = null;

export const mapApi = {
  get: () => get<{ map: MapSettings }>("/settings/map"),
  save: async (input: MapSettingsInput) => {
    const out = await put<{ map: MapSettings }>("/settings/map", input);
    cache = Promise.resolve(out.map);
    return out;
  },
};

/** The tenant's map source, fetched once per page load. Any failure means the built-in map. */
export function loadMapSettings(): Promise<MapSettings> {
  cache ??= mapApi.get().then(
    (r) => r.map ?? BUILTIN_MAP,
    () => {
      cache = null;
      return BUILTIN_MAP;
    },
  );
  return cache;
}

/* ---------- Connection checks (Settings → Field map → Test) ---------- */

/** A tile URL for zoom 5 over central India, with {s}, {-y} and {r} filled in. */
export function sampleTileUrl(template: string): string {
  const z = 5;
  const x = 22;
  const y = 13;
  return template
    .replace(/\{s\}/g, "a")
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{-y\}/g, String(2 ** z - 1 - y))
    .replace(/\{y\}/g, String(y))
    .replace(/\{r\}/g, "");
}

export function probeTiles(template: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => resolve("The tile server didn't answer in time."), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve("A sample tile didn't load. Check the address, the key and that the server allows this website.");
    };
    img.src = sampleTileUrl(template);
  });
}

/** Reads the first bytes with a Range request: the server must answer 206 and the file must start with "PMTiles". */
export async function probePmtiles(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-6" }, signal: ctrl.signal, cache: "no-store" });
    if (res.status === 200) {
      ctrl.abort();
      return "The server sent the whole file instead of a part. Turn on HTTP range requests (206 Partial Content) for this file.";
    }
    if (res.status !== 206) return `The file couldn't be fetched (HTTP ${res.status}).`;
    const head = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(0, 7));
    return head === "PMTiles" ? null : "That file isn't a PMTiles archive.";
  } catch {
    return "The file couldn't be reached. If it's on another domain, allow this website in its CORS settings (GET, Range header).";
  } finally {
    window.clearTimeout(timer);
  }
}

/* ---------- Built-in map geometry ---------- */

export type LatLng = { lat: number; lng: number };

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.32;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local flat projection in km around `origin` (x east, y south) — accurate enough across a city or district. */
export function toKm(p: LatLng, origin: LatLng): { x: number; y: number } {
  return { x: (p.lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180) * KM_PER_DEG_LNG, y: -(p.lat - origin.lat) * KM_PER_DEG_LAT };
}

/** Centre (km) and pixels-per-km that fit every point into width × height with padding; at least `minSpanKm` across. */
export function fitView(points: ReadonlyArray<{ x: number; y: number }>, width: number, height: number, pad = 48, minSpanKm = 0.6): { cx: number; cy: number; scale: number } {
  if (!points.length) return { cx: 0, cy: 0, scale: (width - 2 * pad) / minSpanKm };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = Math.max(x1 - x0, minSpanKm);
  const spanY = Math.max(y1 - y0, minSpanKm);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY) };
}

/** Largest 1-2-5 step (km) not above `km`. */
export function niceKm(km: number): number {
  if (!(km > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(km));
  const m = km / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

export const kmLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km % 1 ? km.toFixed(1) : km} km`);

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Only hex or rgb()/hsl() colours reach generated HTML. */
export const safeColor = (c: string, fallback = "#4C6FF5") => (/^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%]+\))$/i.test(c.trim()) ? c.trim() : fallback);
