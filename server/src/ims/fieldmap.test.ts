import { describe, expect, it } from "vitest";
import { DEFAULT_MAP, MapInput, mapSettingsOf } from "./fieldmap.js";

const OSM = { source: "tiles", tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors" };

describe("field map settings", () => {
  it("defaults to the built-in map", () => {
    expect(mapSettingsOf(null)).toEqual(DEFAULT_MAP);
    expect(MapInput.parse({ source: "builtin" })).toMatchObject({ source: "builtin", maxZoom: 19, flavor: "light" });
  });

  it("accepts a tile template or a self-hosted PMTiles file", () => {
    expect(MapInput.safeParse(OSM).success).toBe(true);
    expect(MapInput.safeParse({ source: "pmtiles", pmtilesUrl: "/maps/india.pmtiles", attribution: "© OpenStreetMap" }).success).toBe(true);
  });

  it("rejects unsafe or incomplete sources", () => {
    expect(MapInput.safeParse({ ...OSM, tileUrl: "javascript:alert(1)//{z}{x}{y}" }).success).toBe(false);
    expect(MapInput.safeParse({ ...OSM, tileUrl: "http://tiles.example.com/{z}/{x}/{y}.png" }).success).toBe(false);
    expect(MapInput.safeParse({ ...OSM, tileUrl: "https://tiles.example.com/{z}/{x}.png" }).success).toBe(false);
    expect(MapInput.safeParse({ ...OSM, attribution: "" }).success).toBe(false);
    expect(MapInput.safeParse({ ...OSM, attribution: "<img src=x onerror=alert(1)>" }).success).toBe(false);
    expect(MapInput.safeParse({ source: "pmtiles", pmtilesUrl: "https://cdn.example.com/india.mbtiles", attribution: "x" }).success).toBe(false);
  });

  it("falls back to the built-in map when switched off or the stored config is broken", () => {
    expect(mapSettingsOf({ enabled: 0, config: JSON.stringify(OSM) }).source).toBe("builtin");
    expect(mapSettingsOf({ enabled: 0, config: JSON.stringify(OSM) }).tileUrl).toBe(OSM.tileUrl);
    expect(mapSettingsOf({ enabled: 1, config: JSON.stringify(OSM) }).source).toBe("tiles");
    expect(mapSettingsOf({ enabled: 1, config: "{not json" }).source).toBe("builtin");
  });
});
