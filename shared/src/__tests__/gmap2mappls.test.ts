import { describe, expect, it } from "vitest";
import {
  classifyInput,
  extractCoordsFromGoogleUrl,
  extractCoordsFromMapsHtml,
  extractGoogleFeatureId,
  extractPlaceNameFromGoogleUrl,
  extractNeighbourhoodTokens,
  pickBestCandidate,
  scoreCandidate,
  SAMPLE_FIXTURES,
  formatCoordPair,
  mapplsPointUrl,
  googleMapsPointUrl,
  buildPasteKit,
  encodeDigipin,
  buildOemHandoffSummary,
  buildBrandPlaybook,
  normalizeMapplsPin,
  resolveOemBrandId,
  oemPackageLaunchUrl,
  oemPackageGeoIntentUrl,
  mapplsNavigationUrl,
  OEM_BRANDS,
  looksLikeMapsInput,
  resolveFindButtonLabel,
  playStoreUrlForBrand,
  buildToolDeepLink,
  buildWhatsAppToolShareUrl,
  filterOemBrands,
  brandChipLabel,
  isMahindraFamily,
  parseRecentPlaces,
  pushRecentPlace,
  recentPlaceLabel,
  recentResolveQuery,
  whatsappStyleGeoUri,
  G2M_WALKTHROUGH,
  emptyStateHint,
  G2M_RECENT_MAX,
  normalizePinwayAppPath,
  PINWAY_BRAND_NAME,
  PINWAY_PRODUCT_NAME,
  PINWAY_APP_PATH,
  isPhoneLikeDevice,
  phoneCssWidth,
  phoneViewportMetaContent,
  shrinkToFitZoom,
  buildForcePhoneInlineScript,
  JBT_FORCE_PHONE_CLASS,
  G2M_FORCE_PHONE_CLASS,
} from "../gmap2mappls/index";

describe("gmap2mappls phone viewport", () => {
  it("detects phones via coarse pointer or small screen edge", () => {
    expect(
      isPhoneLikeDevice({ screenWidth: 1080, screenHeight: 2400, coarsePointer: true, noHover: true }),
    ).toBe(true);
    expect(
      isPhoneLikeDevice({ screenWidth: 390, screenHeight: 844, coarsePointer: false, noHover: false }),
    ).toBe(true);
    expect(
      isPhoneLikeDevice({ screenWidth: 1440, screenHeight: 900, coarsePointer: false, noHover: false }),
    ).toBe(false);
  });

  it("locks viewport meta to real phone CSS width (not device-width / physical px)", () => {
    expect(phoneCssWidth({ screenWidth: 360, screenHeight: 800 })).toBe(360);
    expect(phoneCssWidth({ screenWidth: 412, screenHeight: 915 })).toBe(412);
    // Prefer visual/inner when in phone range over a wide layout width:
    expect(
      phoneCssWidth({
        screenWidth: 412,
        screenHeight: 915,
        innerWidth: 980,
        visualWidth: 412,
      }),
    ).toBe(412);
    // Physical px screen.* (common WebView mistake) → convert via DPR:
    expect(
      phoneCssWidth({
        screenWidth: 1080,
        screenHeight: 2400,
        devicePixelRatio: 3,
      }),
    ).toBe(360);
    const meta = phoneViewportMetaContent(412);
    expect(meta).toContain("width=412");
    expect(meta).not.toContain("device-width");
    expect(meta).toContain("initial-scale=1");
  });

  it("never applies document zoom (dead-space bug on Android)", () => {
    expect(shrinkToFitZoom(360, 360)).toBe(1);
    expect(shrinkToFitZoom(980, 360)).toBe(1);
    expect(shrinkToFitZoom(1080, 360)).toBe(1);
  });

  it("builds a before-paint script that locks phone CSS width for all JBT routes", () => {
    const script = buildForcePhoneInlineScript();
    expect(script).toContain(JBT_FORCE_PHONE_CLASS);
    expect(script).toContain(G2M_FORCE_PHONE_CLASS);
    expect(script).toContain('meta[name="viewport"]');
    expect(script).toContain("user-scalable=no");
    expect(script).not.toContain("device-width\","); // phone branch uses numeric width=
  });
});

describe("gmap2mappls parse", () => {
  it("extracts @lat,lng from Google Maps URL (acceptance 1)", () => {
    const c = extractCoordsFromGoogleUrl("https://www.google.com/maps/@12.8804,77.5958,18z");
    expect(c).toEqual({ lat: 12.8804, lng: 77.5958, source: "at" });
  });

  it("prefers !3d!4d pin when present", () => {
    const c = extractCoordsFromGoogleUrl(
      "https://www.google.com/maps/place/Foo/@12.88,77.59,17z/data=!3d12.8804!4d77.5958",
    );
    expect(c?.lat).toBeCloseTo(12.8804, 4);
    expect(c?.lng).toBeCloseTo(77.5958, 4);
    expect(c?.source).toBe("bang");
  });

  it("HTML scrape prefers majority !3d!4d pin over viewport @", () => {
    const html = `
      <meta property="og:url" content="https://www.google.com/maps/place/Foo/@13.10,77.61,17z"/>
      data=!3d12.930188!4d77.537833 more !3d12.930188!4d77.537833
      and a stray marker !3d13.105528!4d77.610415
      @13.10,77.61,14z
    `;
    const c = extractCoordsFromMapsHtml(html);
    expect(c?.source).toBe("bang");
    expect(c?.lat).toBeCloseTo(12.930188, 5);
    expect(c?.lng).toBeCloseTo(77.537833, 5);
  });

  it("HTML scrape prefers canonical !8m2!3d!4d over majority vote", () => {
    const html = `
      data=!8m2!3d12.9177946!4d77.5366781
      !3d13.105528!4d77.610415 !3d13.105528!4d77.610415 !3d13.105528!4d77.610415
      @13.10,77.61,14z
    `;
    const c = extractCoordsFromMapsHtml(html);
    expect(c?.lat).toBeCloseTo(12.9177946, 6);
    expect(c?.lng).toBeCloseTo(77.5366781, 6);
  });

  it("extracts Google feature id from place-id share URLs", () => {
    expect(
      extractGoogleFeatureId(
        "https://www.google.com/maps/place/Foo/data=!4m2!3m1!1s0x3bae3fb518806a77:0xb632e3c78c9fcbd9",
      ),
    ).toBe("0x3bae3fb518806a77:0xb632e3c78c9fcbd9");
    expect(
      extractGoogleFeatureId("pb=!1m1!1s0x3bae3fb518806a77%3A0xb632e3c78c9fcbd9"),
    ).toBe("0x3bae3fb518806a77:0xb632e3c78c9fcbd9");
  });

  it("parses raw lat,lng", () => {
    const r = classifyInput("12.8804, 77.5958");
    expect(r.kind).toBe("coords");
    if (r.kind === "coords") {
      expect(r.coords.lat).toBeCloseTo(12.8804, 4);
      expect(r.coords.lng).toBeCloseTo(77.5958, 4);
    }
  });

  it("classifies short links", () => {
    const r = classifyInput("https://maps.app.goo.gl/abc123");
    expect(r.kind).toBe("short_link");
  });

  it("rejects non-Google hosts as maps URL", () => {
    const r = classifyInput("https://evil.example/maps/@12.88,77.59");
    expect(r.kind).toBe("address");
  });
});

describe("gmap2mappls neighbourhood", () => {
  it("extracts Hulimavu / Bannerghatta tokens", () => {
    const tokens = extractNeighbourhoodTokens(
      "Brindavan Enclaves, near Meenakshi Temple, Hulimavu, Bannerghatta Road, Bengaluru, Karnataka 560076",
    );
    expect(tokens).toContain("hulimavu");
    expect(tokens).toContain("bannerghatta");
    expect(tokens).toContain("brindavan");
  });

  it("prefers Hosakerehalli over north Sapthagiri Layout for Hanumangiri place string", () => {
    const address =
      "Hanumangiri, Saptagiri Layout, Hosakerehalli, Bengaluru, Karnataka 560061";
    const northLayout = scoreCandidate(address, {
      lat: 13.105528,
      lng: 77.6104158,
      displayName: "Sapthagiri Layout Road, Akash Ward, Bengaluru, Karnataka, India",
      city: "Bengaluru",
      country: "India",
    });
    const hosakerehalli = scoreCandidate(address, {
      lat: 12.9301881,
      lng: 77.5378332,
      displayName: "Hosakerehalli, Bengaluru, Karnataka 560085, India",
      city: "Bengaluru",
      country: "India",
    });
    expect(hosakerehalli).toBeGreaterThan(northLayout);
    const picked = pickBestCandidate(address, [
      {
        lat: 13.105528,
        lng: 77.6104158,
        displayName: "Sapthagiri Layout Road, Akash Ward, Bengaluru, Karnataka, India",
        city: "Bengaluru",
        country: "India",
      },
      {
        lat: 12.9301881,
        lng: 77.5378332,
        displayName: "Hosakerehalli, Bengaluru, Karnataka 560085, India",
        city: "Bengaluru",
        country: "India",
      },
    ]);
    expect(picked?.candidate.lat).toBeCloseTo(12.9301881, 4);
  });

  it("rejects Whitefield / Navi Mumbai for Hulimavu address (acceptance 2)", () => {
    const address =
      "Brindavan Enclaves, near Meenakshi Temple, Hulimavu, Bannerghatta Road, Bengaluru, Karnataka 560076";
    const whitefield = scoreCandidate(address, {
      lat: 12.9698,
      lng: 77.75,
      displayName: "Whitefield, Bengaluru, Karnataka, India",
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
    });
    const taloja = scoreCandidate(address, {
      lat: 19.05,
      lng: 73.1,
      displayName: "Sector 19, Taloja, Navi Mumbai, Maharashtra, India",
      city: "Navi Mumbai",
      state: "Maharashtra",
      country: "India",
    });
    const hulimavu = scoreCandidate(address, {
      lat: 12.8769,
      lng: 77.5952,
      displayName: "Hulimavu, Bannerghatta Road, Bengaluru, Karnataka, India",
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
    });
    expect(whitefield).toBeLessThan(0);
    expect(taloja).toBeLessThan(0);
    expect(hulimavu).toBeGreaterThan(0);
    const picked = pickBestCandidate(address, [
      {
        lat: 19.05,
        lng: 73.1,
        displayName: "Sector 19, Taloja, Navi Mumbai, Maharashtra, India",
        city: "Navi Mumbai",
        country: "India",
      },
      {
        lat: 12.9698,
        lng: 77.75,
        displayName: "Whitefield, Bengaluru, Karnataka, India",
        city: "Bengaluru",
        country: "India",
      },
      {
        lat: 12.8769,
        lng: 77.5952,
        displayName: "Hulimavu, Bannerghatta Road, Bengaluru, Karnataka, India",
        city: "Bengaluru",
        country: "India",
      },
    ]);
    expect(picked?.candidate.displayName).toMatch(/Hulimavu/i);
  });

  it("scores India Gate into Delhi (acceptance 3)", () => {
    const delhi = scoreCandidate("India Gate, New Delhi", {
      lat: 28.6129,
      lng: 77.2295,
      displayName: "India Gate, Rajpath, New Delhi, Delhi, India",
      city: "New Delhi",
      country: "India",
    });
    const mumbai = scoreCandidate("India Gate, New Delhi", {
      lat: 19.07,
      lng: 72.87,
      displayName: "Mumbai, Maharashtra, India",
      city: "Mumbai",
      country: "India",
    });
    expect(delhi).toBeGreaterThan(mumbai);
    expect(delhi).toBeGreaterThan(0);
  });
});

describe("gmap2mappls urls + samples", () => {
  it("builds matching mappls and google URLs from same coords (no Google-style 18z)", () => {
    const lat = 12.8804;
    const lng = 77.5958;
    // Mappls web breaks on `,18z` — official share format is @lat,lng only
    expect(mapplsPointUrl(lat, lng)).toBe("https://www.mappls.com/@12.8804,77.5958");
    expect(mapplsPointUrl(lat, lng)).not.toMatch(/18z/);
    expect(googleMapsPointUrl(lat, lng)).toContain(formatCoordPair(lat, lng));
  });

  it("normalizes Mappls Pin for OEM clipboard paste", () => {
    expect(normalizeMapplsPin("KCF7ZJ")).toBe("kcf7zj");
    expect(normalizeMapplsPin(" kcf7zj ")).toBe("kcf7zj");
    expect(normalizeMapplsPin("bad")).toBeUndefined();
  });

  it("builds geo URI + place-name search for SimpleOne handoff", () => {
    const kit = buildPasteKit(12.877073, 77.613574, {
      name: "Zigma Technologies",
      placeName: "Zigma Technologies",
      locality: "Nyanappanahalli",
      city: "Bengaluru",
      mapplsPin: "kcf7zj",
    });
    expect(kit.geoUri.startsWith("geo:12.877073,77.613574")).toBe(true);
    // Coords-only q= — never embed place names (OEM Autosuggest re-search bug)
    expect(kit.geoUri).toBe("geo:12.877073,77.613574?q=12.877073,77.613574");
    expect(kit.geoUri).not.toMatch(/Zigma|Saptagiri|Hosakerehalli|\(/i);
    expect(kit.whatsappGeoUri).toBe(kit.geoUri);
    expect(kit.simpleConnectIntentUrl).not.toMatch(/Zigma|Saptagiri|%28/i);
    expect(kit.searchQuery).toContain("Zigma Technologies");
    expect(kit.searchQuery).toContain("Nyanappanahalli");
    expect(kit.simpleConnectIntentUrl).toContain("package=com.sepl.android");
    expect(kit.simpleConnectIntentUrl).toContain("scheme=geo");
    expect(kit.shareText).toContain("Zigma Technologies");
    expect(kit.shareText).toContain("kcf7zj");
    expect(kit.mapplsUrl).toBe("https://www.mappls.com/@12.877073,77.613574");
    expect(kit.mapplsPinUrl).toBe("https://www.mappls.com/kcf7zj");
    expect(kit.mapplsNavBikingUrl).toContain("mode=biking");
    expect(kit.googleMapsUrl).toContain("12.877073,77.613574");
    expect(kit.tip.toLowerCase()).toMatch(/simple connect|simpleone/);
  });

  it("geo Intents ignore ambiguous layout labels (Hosakerehalli / Sapthagiri class)", () => {
    const ambiguous =
      "Hanumangiri, Saptagiri Layout, Hosakerehalli, Bengaluru, Karnataka 560061";
    const geo = whatsappStyleGeoUri(12.930188, 77.537833, ambiguous);
    expect(geo).toBe("geo:12.930188,77.537833?q=12.930188,77.537833");
    expect(geo).not.toMatch(/Saptagiri|Hosakerehalli|Hanumangiri|\(/i);

    const intent = oemPackageGeoIntentUrl("com.sepl.android", 12.930188, 77.537833, ambiguous);
    expect(intent).toContain("12.930188,77.537833");
    expect(intent).not.toMatch(/Saptagiri|Hosakerehalli|Hanumangiri|%28/i);

    const paste = buildPasteKit(12.930188, 77.537833, {
      placeName: ambiguous,
      locality: "Hosakerehalli",
      city: "Bengaluru",
    });
    const simple = buildBrandPlaybook("simple-energy", paste)!;
    expect(simple.autoOpenUrl).toContain("12.930188,77.537833");
    expect(simple.autoOpenUrl).not.toMatch(/Saptagiri|Hosakerehalli|%28/i);

    // All geo-handoff brands must open with coords, not the searchable place string
    for (const id of ["bajaj", "hero", "ampere", "tvs"] as const) {
      const pb = buildBrandPlaybook(id, paste)!;
      expect(pb.autoOpenUrl, id).toContain("12.930188,77.537833");
      expect(pb.autoOpenUrl, id).not.toMatch(/Saptagiri|Hosakerehalli|%28/i);
    }
  });

  it("covers listed 2W/4W OEMs in handoff matrix", () => {
    const ids = new Set(OEM_BRANDS.map((b) => b.id));
    for (const id of [
      "simple-energy",
      "bajaj",
      "hero",
      "ampere",
      "ather",
      "ultraviolette",
      "matter",
      "ola",
      "tork",
      "suzuki-2w",
      "tvs",
      "mahindra",
      "mahindra-me4u",
      "tata",
      "hyundai",
      "kia",
      "mg",
      "maruti",
      "honda",
      "byd",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(resolveOemBrandId("adrenox")).toBe("mahindra");
    expect(resolveOemBrandId("me4u")).toBe("mahindra-me4u");
    expect(resolveOemBrandId("born-electric")).toBe("mahindra-me4u");
    expect(resolveOemBrandId("xuv700")).toBe("mahindra");
    expect(resolveOemBrandId("rizta")).toBe("ather");
    expect(resolveOemBrandId("f77")).toBe("ultraviolette");
    expect(resolveOemBrandId("atto-3")).toBe("byd");
    expect(resolveOemBrandId("e-vitara")).toBe("maruti");
    expect(OEM_BRANDS.find((b) => b.id === "tvs")?.stack).toBe("mappls");
    expect(OEM_BRANDS.find((b) => b.id === "ola")?.stack).toBe("ola_maps");
    const summary = buildOemHandoffSummary();
    expect(summary.rules.searchBoxRejects.join(" ")).toMatch(/lat,lng/);
    expect(summary.brands.filter((b) => b.stack === "mappls").length).toBeGreaterThan(15);
    expect(summary.brands.filter((b) => b.segment === "2W").length).toBeGreaterThanOrEqual(10);
    expect(summary.brands.filter((b) => b.segment === "4W").length).toBeGreaterThanOrEqual(8);
  });

  it("builds a one-CTA playbook that opens each brand’s companion app", () => {
    const paste = buildPasteKit(12.877073, 77.613574, {
      placeName: "Zigma Technologies",
      locality: "Nyanappanahalli",
      city: "Bengaluru",
      mapplsPin: "kcf7zj",
    });
    expect(paste.lat).toBe(12.877073);
    expect(paste.lng).toBe(77.613574);

    const simple = buildBrandPlaybook("simple-energy", paste);
    expect(simple?.brand.companionApp?.packageId).toBe("com.sepl.android");
    expect(simple?.autoOpenUrl).toContain("package=com.sepl.android");
    expect(simple?.autoOpenUrl).toContain("scheme=geo");
    expect(simple?.autoOpenUrl).not.toMatch(/mappls\.com/);
    expect(simple?.primary.kind).toBe("open");
    expect(simple?.primary.href).toContain("com.sepl.android");
    expect(simple?.autoOpenLabel.toLowerCase()).toMatch(/simple connect/);
    expect(simple?.steps.length).toBe(1);
    expect(simple?.steps[0]).toMatch(/only remaining step/i);

    const mahindra = buildBrandPlaybook("mahindra", paste);
    expect(mahindra?.brand.companionApp?.handoff).toBe("geo_with_pin");
    expect(mahindra?.autoOpenUrl).toContain("package=com.mahindra.adrenox");
    expect(mahindra?.autoOpenUrl).toMatch(/^intent:\/\//);
    expect(mahindra?.autoOpenUrl).toContain("action=android.intent.action.MAIN");
    expect(mahindra?.autoOpenUrl).not.toMatch(/mappls\.com/);
    expect(mahindra?.primary.kind).toBe("open");
    expect(mahindra?.primary.label).toMatch(/Copy Pin.*Adrenox Connect/i);
    expect(mahindra?.autoCopyText).toBe("kcf7zj");
    expect(mahindra?.qrPayload).toBe("kcf7zj"); // scannable Pin text, not LAUNCHER intent
    expect(mahindra?.rejectLatLngPaste).toBe(true);
    expect(mahindra?.deferAutoOpen).toBe(true); // must tap to copy+open
    expect(mahindra?.steps[0]).toMatch(/Push to car/i);
    expect(mahindra?.steps[0].toLowerCase()).toMatch(/never paste lat/);
    expect(mahindra?.backup?.href).toContain("mode=driving");
    expect(mahindra?.share?.text).toContain("kcf7zj");
    expect(mahindra?.share?.url).toBe("https://www.mappls.com/kcf7zj");
    expect(mahindra?.inCar?.copyText).toBe("kcf7zj");
    expect(mahindra?.inCar?.label).toMatch(/vehicle Mappls/i);

    // Born Electric Me4U (Mappls NCASE) — same Pin path, different package
    const me4u = buildBrandPlaybook("mahindra-me4u", paste);
    expect(me4u?.brand.companionApp?.packageId).toBe("com.mahindra.inglo");
    expect(me4u?.autoOpenUrl).toContain("package=com.mahindra.inglo");
    expect(me4u?.autoCopyText).toBe("kcf7zj");
    expect(me4u?.deferAutoOpen).toBe(true);
    expect(me4u?.steps[0]).toMatch(/Send to vehicle/i);
    expect(me4u?.inCar?.copyText).toBe("kcf7zj");
    expect(me4u?.backup?.href).toContain("mode=driving");
    expect(buildBrandPlaybook("me4u", paste)?.brand.id).toBe("mahindra-me4u");

    // No Pin: STILL open Adrenox (not Mappls) — avoid Simple Connect “wrong app” bug
    const noPin = buildPasteKit(12.877073, 77.613574, {
      placeName: "Zigma Technologies",
      locality: "Nyanappanahalli",
    });
    const mahindraNoPin = buildBrandPlaybook("mahindra", noPin);
    expect(mahindraNoPin?.autoOpenUrl).toContain("package=com.mahindra.adrenox");
    expect(mahindraNoPin?.autoOpenUrl).not.toMatch(/mappls\.com/);
    expect(mahindraNoPin?.autoCopyText).toMatch(/Zigma/);
    expect(mahindraNoPin?.deferAutoOpen).toBe(true);
    expect(mahindraNoPin?.rejectLatLngPaste).toBe(true);
    expect(mahindraNoPin?.backup?.href).toContain("mode=driving");

    // Simple Connect still auto-opens (geo carries the destination)
    expect(simple?.deferAutoOpen).toBeFalsy();

    // Other send-to-car 4W apps use the same Pin → vehicle path as Mahindra
    for (const id of ["tata", "hyundai", "kia", "mg", "maruti"] as const) {
      const pb = buildBrandPlaybook(id, paste);
      expect(pb?.brand.companionApp?.handoff, id).toBe("geo_with_pin");
      expect(pb?.deferAutoOpen, id).toBe(true);
      expect(pb?.autoCopyText, id).toBe("kcf7zj");
      expect(pb?.autoOpenUrl, id).toContain(`package=${pb!.brand.companionApp!.packageId}`);
      expect(pb?.autoOpenUrl, id).not.toMatch(/mappls\.com/);
      expect(pb?.inCar?.copyText, id).toBe("kcf7zj");
    }
    expect(buildBrandPlaybook("hyundai", paste)?.steps[0]).toMatch(/Send to car/i);
    expect(buildBrandPlaybook("maruti", paste)?.steps[0]).toMatch(/vehicle Mappls/i);

    const ola = buildBrandPlaybook("ola", paste);
    expect(ola?.autoOpenUrl).toContain("package=com.olaelectric.companion");
    expect(ola?.autoOpenUrl).toContain("maps.google.com");

    const matter = buildBrandPlaybook("matter", paste);
    expect(matter?.brand.companionApp).toBeUndefined();
    expect(matter?.autoOpenUrl).toContain("mode=biking");

    // Full matrix: every brand opens OEM package (or Mappls fallback) — never wrong target
    for (const brand of OEM_BRANDS) {
      const pb = buildBrandPlaybook(brand.id, paste);
      expect(pb, brand.id).toBeTruthy();
      expect(pb!.primary.kind).toBe("open");
      expect(pb!.primary.href).toBe(pb!.autoOpenUrl);
      expect(pb!.steps).toHaveLength(1);
      if (brand.companionApp) {
        expect(pb!.autoOpenUrl).toContain(`package=${brand.companionApp.packageId}`);
        expect(pb!.autoOpenUrl).not.toMatch(/mappls\.com/);
      } else {
        expect(pb!.autoOpenUrl).toMatch(/mappls\.com/);
      }
    }
  });

  it("encodes Digipin offline for India coords", () => {
    // India Post sample: 13.11179621, 80.20264269 → 4T396F42L7
    expect(encodeDigipin(13.11179621, 80.20264269)?.replace(/\s+/g, "")).toBe("4T396F42L7");
    expect(encodeDigipin(12.877073, 77.613574)).toMatch(
      /^[23456789CJKLMPFT]{3} [23456789CJKLMPFT]{3} [23456789CJKLMPFT]{4}$/,
    );
  });

  it("extracts place name from Google /place/ path", () => {
    expect(
      extractPlaceNameFromGoogleUrl(
        "https://www.google.com/maps/place/Zigma+Technologies/@12.87,77.61,16z/data=!3d12.8770726!4d77.6135744",
      ),
    ).toBe("Zigma Technologies");
  });

  it("extracts place name from share URLs that only have place id (no @lat,lng)", () => {
    const url =
      "https://www.google.com/maps/place/Hanumangiri,+Saptagiri+Layout,+Hosakerehalli,+Bengaluru,+Karnataka+560061/data=!4m2!3m1!1s0x3bae3fb518806a77:0xb632e3c78c9fcbd9!18m1!1e1";
    expect(extractCoordsFromGoogleUrl(url)).toBeNull();
    expect(extractPlaceNameFromGoogleUrl(url)).toMatch(/Hanumangiri/i);
    expect(extractPlaceNameFromGoogleUrl(url)).toMatch(/Bengaluru/i);
  });

  it("scrapes !3d!4d and @ coords from Maps HTML blobs", () => {
    expect(extractCoordsFromMapsHtml('...data=!3d12.8770726!4d77.6135744...')).toMatchObject({
      lat: 12.8770726,
      lng: 77.6135744,
      source: "bang",
    });
    expect(extractCoordsFromMapsHtml("viewport @12.8804,77.5958,18z more")).toMatchObject({
      lat: 12.8804,
      lng: 77.5958,
      source: "at",
    });
    expect(
      extractCoordsFromMapsHtml('state:[null,null,12.97,77.59],title:"x"'),
    ).toMatchObject({ lat: 12.97, lng: 77.59, source: "place" });
  });

  it("ships acceptance fixtures with shared coords", () => {
    expect(SAMPLE_FIXTURES[0].lat).toBe(12.8804);
    expect(SAMPLE_FIXTURES[0].lng).toBe(77.5958);
    expect(SAMPLE_FIXTURES[2].input.toLowerCase()).toContain("india gate");
  });
});

describe("production invariants — Mahindra NCASE + Simple Connect", () => {
  const paste = buildPasteKit(12.877073, 77.613574, {
    placeName: "Zigma Technologies",
    locality: "Nyanappanahalli",
    city: "Bengaluru",
    mapplsPin: "KCF7ZJ", // uppercase from APIs
  });

  it("normalizes Pin through PasteKit for Adrenox and Me4U", () => {
    expect(paste.mapplsPin).toBe("kcf7zj");
    expect(paste.mapplsPinUrl).toBe("https://www.mappls.com/kcf7zj");
    expect(paste.mapplsUrl).not.toMatch(/18z/);
    expect(paste.mapplsNavDrivingUrl).toContain("mode=driving");
    expect(paste.mapplsNavDrivingUrl).toContain("12.877073");
  });

  it("never confuses Simple Connect with Mahindra packages", () => {
    const sc = buildBrandPlaybook("simple-energy", paste)!;
    const adrenox = buildBrandPlaybook("mahindra", paste)!;
    const me4u = buildBrandPlaybook("mahindra-me4u", paste)!;
    expect(sc.autoOpenUrl).toContain("com.sepl.android");
    expect(sc.autoOpenUrl).toContain("scheme=geo");
    expect(adrenox.autoOpenUrl).toContain("com.mahindra.adrenox");
    expect(me4u.autoOpenUrl).toContain("com.mahindra.inglo");
    expect(sc.autoOpenUrl).not.toContain("mahindra");
    expect(adrenox.autoOpenUrl).not.toContain("com.sepl");
    expect(me4u.autoOpenUrl).not.toContain("com.sepl");
    expect(adrenox.autoOpenUrl).not.toContain("inglo");
    expect(me4u.autoOpenUrl).not.toContain("adrenox");
  });

  it("resolves all Mahindra deep-link aliases to the correct app family", () => {
    for (const a of ["mahindra", "adrenox", "mahindra-adrenox", "xuv700", "scorpio-n", "scorpio"]) {
      expect(resolveOemBrandId(a), a).toBe("mahindra");
      expect(buildBrandPlaybook(a, paste)?.brand.companionApp?.packageId, a).toBe(
        "com.mahindra.adrenox",
      );
    }
    for (const a of [
      "mahindra-me4u",
      "me4u",
      "inglo",
      "born-electric",
      "mahindra-bev",
      "be05",
      "be.05",
      "be06",
      "be.06",
      "xev",
      "xev9e",
    ]) {
      expect(resolveOemBrandId(a), a).toBe("mahindra-me4u");
      expect(buildBrandPlaybook(a, paste)?.brand.companionApp?.packageId, a).toBe(
        "com.mahindra.inglo",
      );
    }
    expect(resolveOemBrandId("unknown-oem")).toBeUndefined();
    expect(buildBrandPlaybook("unknown-oem", paste)).toBeNull();
  });

  it("keeps Pin-paste OEMs on deferAutoOpen + rejectLatLng + driving backup", () => {
    for (const id of ["mahindra", "mahindra-me4u", "tata", "hyundai", "kia", "mg", "maruti"]) {
      const pb = buildBrandPlaybook(id, paste)!;
      expect(pb.deferAutoOpen, id).toBe(true);
      expect(pb.rejectLatLngPaste, id).toBe(true);
      expect(pb.autoCopyText, id).toBe("kcf7zj");
      expect(pb.qrPayload, id).toBe("kcf7zj");
      expect(pb.share?.url, id).toBe("https://www.mappls.com/kcf7zj");
      expect(pb.inCar?.copyText, id).toBe("kcf7zj");
      expect(pb.backup?.href, id).toContain("mode=driving");
      expect(pb.steps[0].toLowerCase(), id).toMatch(/never paste lat/);
      // Must not auto-open Mappls as primary (Simple Connect wrong-app lesson)
      expect(pb.autoOpenUrl, id).not.toMatch(/mappls\.com/);
    }
  });

  it("Me4U no-Pin path still opens Me4U (not Mappls) with place-name assist", () => {
    const noPin = buildPasteKit(12.877073, 77.613574, {
      placeName: "Zigma Technologies",
      locality: "Nyanappanahalli",
    });
    const pb = buildBrandPlaybook("mahindra-me4u", noPin)!;
    expect(pb.autoOpenUrl).toContain("package=com.mahindra.inglo");
    expect(pb.autoOpenUrl).not.toMatch(/mappls\.com/);
    expect(pb.autoCopyText).toMatch(/Zigma/);
    expect(pb.deferAutoOpen).toBe(true);
    expect(pb.backup?.href).toContain("mode=driving");
    expect(pb.steps[0]).toMatch(/Send to vehicle/i);
  });

  it("builds Intent helpers that Android Chrome can launch", () => {
    const launch = oemPackageLaunchUrl("com.mahindra.adrenox");
    expect(launch.startsWith("intent://#Intent;")).toBe(true);
    expect(launch).toContain("package=com.mahindra.adrenox");
    expect(launch).toContain("action=android.intent.action.MAIN");
    expect(launch).toContain("category=android.intent.category.LAUNCHER");
    expect(launch).toContain("S.browser_fallback_url=");
    expect(launch.endsWith(";end")).toBe(true);

    const geo = oemPackageGeoIntentUrl("com.sepl.android", 12.877073, 77.613574, "Zigma");
    expect(geo).toContain("scheme=geo");
    expect(geo).toContain("package=com.sepl.android");
    expect(geo).toContain("12.877073,77.613574");

    const nav = mapplsNavigationUrl(12.877073, 77.613574, {
      name: "Zigma Technologies",
      mode: "driving",
    });
    expect(nav).toContain("https://www.mappls.com/navigation?");
    expect(nav).toContain("isNav=true");
    expect(nav).toContain("mode=driving");
    expect(nav).not.toMatch(/18z/);
  });

  it("Adrenox and Me4U share NCASE Pin contract but different final actions", () => {
    const adrenox = buildBrandPlaybook("mahindra", paste)!;
    const me4u = buildBrandPlaybook("mahindra-me4u", paste)!;
    expect(adrenox.brand.companionApp?.finalAction).toBe("Push to car");
    expect(me4u.brand.companionApp?.finalAction).toBe("Send to vehicle");
    expect(adrenox.steps[0]).toContain("Push to car");
    expect(me4u.steps[0]).toContain("Send to vehicle");
    expect(adrenox.primary.href).toBe(adrenox.autoOpenUrl);
    expect(me4u.primary.href).toBe(me4u.autoOpenUrl);
  });
});

describe("gmap2mappls UX helpers (mobile / OEM usability)", () => {
  it("detects pasteable Maps inputs without false positives", () => {
    expect(looksLikeMapsInput("https://maps.app.goo.gl/abc")).toBe(true);
    expect(looksLikeMapsInput("https://www.google.com/maps/@12.8,77.5,18z")).toBe(true);
    expect(looksLikeMapsInput("12.877073, 77.613574")).toBe(true);
    expect(looksLikeMapsInput("Zigma Technologies Nyanappanahalli")).toBe(true);
    expect(looksLikeMapsInput("")).toBe(false);
    expect(looksLikeMapsInput("ok")).toBe(false);
    expect(looksLikeMapsInput("{json:true}")).toBe(false);
  });

  it("labels Find CTA by OEM handoff mode", () => {
    expect(resolveFindButtonLabel("simple-energy")).toMatch(/Simple Connect/i);
    expect(resolveFindButtonLabel("mahindra")).toMatch(/copy Pin.*Adrenox/i);
    expect(resolveFindButtonLabel("mahindra-me4u")).toMatch(/copy Pin.*Me4U/i);
    expect(resolveFindButtonLabel("matter")).toMatch(/Mappls/i);
  });

  it("builds Play Store + WhatsApp tool deep links", () => {
    expect(playStoreUrlForBrand("mahindra")).toContain("com.mahindra.adrenox");
    expect(playStoreUrlForBrand("mahindra-me4u")).toContain("com.mahindra.inglo");
    expect(playStoreUrlForBrand("matter")).toBeUndefined();

    expect(normalizePinwayAppPath("/tools/gmap2mappls")).toBe(PINWAY_APP_PATH);
    expect(normalizePinwayAppPath("/jbt/tools/gmap2mappls")).toBe(`/jbt${PINWAY_APP_PATH}`);
    expect(normalizePinwayAppPath("/pinway")).toBe(PINWAY_APP_PATH);
    expect(normalizePinwayAppPath("/googlemaps2mappls")).toBe(PINWAY_APP_PATH);
    expect(PINWAY_APP_PATH).toBe("/googlemaps2mappls");

    const deep = buildToolDeepLink(
      "https://app.example/tools/gmap2mappls?oem=old&input=x",
      "me4u",
      "https://maps.app.goo.gl/abc",
    );
    // Aliases canonicalize; path lands on standalone GoogleMaps2Mappls app.
    expect(deep).toContain("/googlemaps2mappls?");
    expect(deep).toContain("brand=mahindra-me4u");
    expect(deep).not.toContain("brand=me4u");
    expect(deep).toContain("q=");
    expect(deep).not.toContain("oem=");
    expect(deep).not.toContain("input=");
    expect(deep).not.toContain("/tools/gmap2mappls");

    expect(PINWAY_PRODUCT_NAME).toBe("Google Maps to Mappls");
    expect(PINWAY_BRAND_NAME).toBe("GoogleMaps2Mappls");

    const wa = buildWhatsAppToolShareUrl(deep, "Me4U");
    expect(wa.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(wa)).toContain(PINWAY_PRODUCT_NAME);
    expect(decodeURIComponent(wa)).toContain("brand=mahindra-me4u");
  });

  it("filters brands by segment + search (Mahindra clarity)", () => {
    expect(filterOemBrands(OEM_BRANDS, { segment: "2W" }).every((b) => b.segment === "2W")).toBe(
      true,
    );
    const mah = filterOemBrands(OEM_BRANDS, { query: "adrenox" });
    expect(mah.some((b) => b.id === "mahindra")).toBe(true);
    expect(mah.some((b) => b.id === "mahindra-me4u")).toBe(false);
    const be = filterOemBrands(OEM_BRANDS, { query: "born electric" });
    expect(be.some((b) => b.id === "mahindra-me4u")).toBe(true);
    expect(brandChipLabel(OEM_BRANDS.find((b) => b.id === "mahindra")!)).toBe("Adrenox");
    expect(brandChipLabel(OEM_BRANDS.find((b) => b.id === "mahindra-me4u")!)).toBe("Me4U");
    expect(isMahindraFamily("mahindra")).toBe(true);
    expect(isMahindraFamily("mahindra-me4u")).toBe(true);
    expect(isMahindraFamily("hyundai")).toBe(false);
  });

  it("stores recent destinations with dedupe + cap", () => {
    expect(parseRecentPlaces("not-json")).toEqual([]);
    expect(parseRecentPlaces(null)).toEqual([]);
    const a = pushRecentPlace([], {
      input: "https://maps.app.goo.gl/a",
      label: "Zigma",
      lat: 12.877073,
      lng: 77.613574,
      pin: "kcf7zj",
      brandId: "mahindra",
      at: 100,
    });
    expect(a).toHaveLength(1);
    const b = pushRecentPlace(a, {
      input: "https://maps.app.goo.gl/b",
      label: "Zigma again",
      lat: 12.877073,
      lng: 77.613574,
      pin: "kcf7zj",
      brandId: "mahindra",
      at: 200,
    });
    expect(b).toHaveLength(1);
    expect(b[0].label).toBe("Zigma again");
    let list = b;
    for (let i = 0; i < 8; i++) {
      list = pushRecentPlace(list, {
        input: `https://maps.app.goo.gl/${i}`,
        label: `Place ${i}`,
        lat: 12 + i * 0.01,
        lng: 77,
        brandId: "simple-energy",
        at: 300 + i,
      });
    }
    expect(list.length).toBe(G2M_RECENT_MAX);
    expect(recentPlaceLabel({ placeName: "Zigma Technologies", lat: 1, lng: 2 })).toBe(
      "Zigma Technologies",
    );
    expect(recentPlaceLabel({ pin: "kcf7zj", lat: 1, lng: 2 })).toBe("Pin kcf7zj");

    // Saved/recent places must re-open via stored coords, not the Google short link
    expect(
      recentResolveQuery({
        input: "https://maps.app.goo.gl/HWzYiASacCnENGAT7?g_st=ac",
        lat: 12.930188,
        lng: 77.537833,
      }),
    ).toBe("12.930188,77.537833");
    expect(
      recentResolveQuery({
        input: "https://maps.app.goo.gl/fallback",
        lat: 0,
        lng: 0,
      }),
    ).toBe("https://maps.app.goo.gl/fallback");
  });

  it("ships walkthrough + empty-state hints per OEM", () => {
    expect(G2M_WALKTHROUGH).toHaveLength(3);
    expect(emptyStateHint("mahindra")).toMatch(/Pin/i);
    expect(emptyStateHint("mahindra")).toMatch(/Push to car/i);
    expect(emptyStateHint("simple-energy")).toMatch(/Simple Connect/i);
    expect(emptyStateHint("matter")).toMatch(/Mappls/i);
  });
});
