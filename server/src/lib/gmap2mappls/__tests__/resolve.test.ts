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
    expect(r.mappls.mapplsUrl).toBe("https://www.mappls.com/@12.8804,77.5958");
    expect(r.mappls.mapplsUrl).not.toMatch(/18z/);
    expect(r.sampleMode).toBe(true);
    expect(r.mappls.formattedAddress.toLowerCase()).toMatch(/hulimavu|bannerghatta/);
    expect(r.paste.latLng).toBe("12.8804,77.5958");
    expect(r.paste.geoUri).toBe("geo:12.8804,77.5958?q=12.8804,77.5958");
    expect(r.paste.geoUri).not.toMatch(/\(/);
    expect(r.paste.simpleConnectIntentUrl).not.toMatch(/%28|\(/);
    expect(r.paste.mapplsUrl).toBe("https://www.mappls.com/@12.8804,77.5958");
    expect(r.paste.shareText).toContain("12.8804,77.5958");
    expect(r.paste.tip.toLowerCase()).toMatch(/simpleone|place name|geo|mappls/);
  });

  it("Zigma short link: pin !3d!4d, same Google/Mappls coords, Mappls Pin for SimpleOne", async () => {
    delete process.env.MAPPLS_ACCESS_TOKEN;
    const r = await resolveGmap2Mappls("https://maps.app.goo.gl/P3RTQ5woooJXgFGA6");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lat).toBeCloseTo(12.877073, 5);
    expect(r.lng).toBeCloseTo(77.613574, 5);
    expect(r.google.lat).toBe(r.mappls.lat);
    expect(r.google.lng).toBe(r.mappls.lng);
    expect(r.google.name.toLowerCase()).toContain("zigma");
    expect(r.mappls.mapplsUrl).toBe(`https://www.mappls.com/@${r.lat},${r.lng}`);
    expect(r.google.mapsUrl).toContain(`${r.lat},${r.lng}`);
    expect(r.mappls.mapplsPin).toBe("kcf7zj");
    expect(r.paste.mapplsPin).toBe("kcf7zj");
    expect(r.paste.mapplsPinUrl).toBe("https://www.mappls.com/kcf7zj");
    expect(r.paste.digipin || r.mappls.digipin).toBeTruthy();
    // SimpleOne path: POI place name + Simple Connect geo intent (Pin alone fails in-app)
    expect(r.mappls.placeName?.toLowerCase()).toContain("zigma");
    expect(r.paste.searchQuery?.toLowerCase()).toContain("zigma");
    expect(r.paste.simpleConnectIntentUrl).toContain("com.sepl.android");
    expect(r.paste.mapplsNavBikingUrl).toContain("mode=biking");
    expect(r.paste.mapplsNavDrivingUrl).toContain("mode=driving");
  }, 45_000);

  it("place-id share short link (no @lat,lng) geocodes place name — Hanumangiri", async () => {
    delete process.env.MAPPLS_ACCESS_TOKEN;
    const r = await resolveGmap2Mappls("https://maps.app.goo.gl/HWzYiASacCnENGAT7?g_st=ac");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Hosakerehalli / Banashankari west Bengaluru — not north Sapthagiri (~13.10)
    expect(r.lat).toBeGreaterThan(12.88);
    expect(r.lat).toBeLessThan(12.98);
    expect(r.lng).toBeGreaterThan(77.50);
    expect(r.lng).toBeLessThan(77.58);
    expect(r.google.lat).toBe(r.mappls.lat);
    expect(r.google.lng).toBe(r.mappls.lng);
    expect(`${r.google.name} ${r.mappls.formattedAddress}`.toLowerCase()).toMatch(
      /hanumangiri|hosakerehalli|saptagiri|bengaluru|bangalore/,
    );
  }, 60_000);

  it("full place URL without coords geocodes from /place/ path", async () => {
    delete process.env.MAPPLS_ACCESS_TOKEN;
    const r = await resolveGmap2Mappls(
      "https://www.google.com/maps/place/Hanumangiri,+Saptagiri+Layout,+Hosakerehalli,+Bengaluru,+Karnataka+560061/data=!4m2!3m1!1s0x3bae3fb518806a77:0xb632e3c78c9fcbd9",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lat).toBeGreaterThan(12.88);
    expect(r.lat).toBeLessThan(12.98);
    expect(r.lng).toBeGreaterThan(77.50);
    expect(r.lng).toBeLessThan(77.58);
  }, 60_000);

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
