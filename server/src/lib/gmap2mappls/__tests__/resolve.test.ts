import { afterEach, describe, expect, it } from "vitest";
import { resolveGmap2Mappls } from "../resolve.js";

describe("resolveGmap2Mappls sample mode", () => {
  const prev = process.env.MAPPLS_ACCESS_TOKEN;

  afterEach(() => {
    if (prev === undefined) delete process.env.MAPPLS_ACCESS_TOKEN;
    else process.env.MAPPLS_ACCESS_TOKEN = prev;
  });

  it("acceptance 1: Google @ coords → same lat/lng both sides (no token)", async () => {
    delete process.env.MAPPLS_ACCESS_TOKEN;
    const r = await resolveGmap2Mappls("https://www.google.com/maps/@12.8804,77.5958,18z");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lat).toBeCloseTo(12.8804, 4);
    expect(r.lng).toBeCloseTo(77.5958, 4);
    expect(r.google.lat).toBe(r.mappls.lat);
    expect(r.google.lng).toBe(r.mappls.lng);
    expect(r.mappls.mapplsUrl).toContain("@12.8804,77.5958");
    expect(r.sampleMode).toBe(true);
    expect(r.mappls.formattedAddress.toLowerCase()).toMatch(/hulimavu|bannerghatta/);
  });

  it("acceptance 2: Brindavan / Hulimavu address stays Bengaluru area", async () => {
    delete process.env.MAPPLS_ACCESS_TOKEN;
    const r = await resolveGmap2Mappls(
      "Brindavan Enclaves, near Meenakshi Temple, Hulimavu, Bannerghatta Road, Bengaluru, Karnataka 560076",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.google.lat).toBe(r.mappls.lat);
    expect(r.google.lng).toBe(r.mappls.lng);
    // Bengaluru south — not Navi Mumbai (~19.x) or Whitefield (~77.75)
    expect(r.lat).toBeGreaterThan(12.8);
    expect(r.lat).toBeLessThan(13.0);
    expect(r.lng).toBeGreaterThan(77.55);
    expect(r.lng).toBeLessThan(77.65);
    expect(r.mappls.formattedAddress.toLowerCase()).not.toMatch(/taloja|navi mumbai|whitefield/);
  });

  it("acceptance 3: India Gate → Delhi area", async () => {
    delete process.env.MAPPLS_ACCESS_TOKEN;
    const r = await resolveGmap2Mappls("India Gate, New Delhi");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.google.lat).toBe(r.mappls.lat);
    expect(r.google.lng).toBe(r.mappls.lng);
    expect(r.lat).toBeGreaterThan(28.5);
    expect(r.lat).toBeLessThan(28.7);
    expect(r.lng).toBeGreaterThan(77.1);
    expect(r.lng).toBeLessThan(77.3);
  });

  it("acceptance 4: without token sample mode works", async () => {
    delete process.env.MAPPLS_ACCESS_TOKEN;
    const r = await resolveGmap2Mappls("28.6129,77.2295");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sampleMode).toBe(true);
    expect(r.mappls.sampleMode).toBe(true);
    expect(r.google.lat).toBe(r.mappls.lat);
    expect(r.google.lng).toBe(r.mappls.lng);
  });
});
