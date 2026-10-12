import { describe, expect, it } from "vitest";
import { escapeHtml, fitView, haversineKm, initialsOf, kmLabel, niceKm, safeColor, sampleTileUrl, toKm } from "./fieldmap";

describe("built-in map geometry", () => {
  const mg = { lat: 12.9716, lng: 77.5946 };
  const koramangala = { lat: 12.9352, lng: 77.6245 };

  it("projects close to true distances across a city", () => {
    const p = toKm(koramangala, mg);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(haversineKm(mg, koramangala), 1);
    expect(p.y).toBeGreaterThan(0);
  });

  it("fits every point inside the frame", () => {
    const pts = [toKm(mg, mg), toKm(koramangala, mg)];
    const v = fitView(pts, 800, 360, 40);
    for (const p of pts) {
      expect(Math.abs((p.x - v.cx) * v.scale)).toBeLessThanOrEqual(360);
      expect(Math.abs((p.y - v.cy) * v.scale)).toBeLessThanOrEqual(140);
    }
    expect(fitView([{ x: 0, y: 0 }], 800, 360).scale).toBeGreaterThan(0);
  });

  it("picks 1-2-5 scale steps and labels them", () => {
    expect([niceKm(0.7), niceKm(3.4), niceKm(18)]).toEqual([0.5, 2, 10]);
    expect([kmLabel(0.5), kmLabel(2), kmLabel(10)]).toEqual(["500 m", "2 km", "10 km"]);
  });
});

describe("map helpers", () => {
  it("fills a tile template for the connection test", () => {
    expect(sampleTileUrl("https://{s}.tiles.example.com/{z}/{x}/{y}{r}.png")).toBe("https://a.tiles.example.com/5/22/13.png");
    expect(sampleTileUrl("/tiles/{z}/{x}/{-y}.png")).toBe("/tiles/5/22/18.png");
  });

  it("keeps generated marker HTML inert", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(safeColor("#1FA679")).toBe("#1FA679");
    expect(safeColor("red;background:url(x)")).toBe("#4C6FF5");
    expect(initialsOf("Asha Rao")).toBe("AR");
    expect(initialsOf("")).toBe("?");
  });
});
