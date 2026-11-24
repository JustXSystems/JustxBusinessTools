import { describe, expect, it } from "vitest";
import {
  classifyInput,
  extractCoordsFromGoogleUrl,
  extractPlaceNameFromGoogleUrl,
  extractNeighbourhoodTokens,
  pickBestCandidate,
  scoreCandidate,
  SAMPLE_FIXTURES,
  formatCoordPair,
  mapplsPointUrl,
  googleMapsPointUrl,
  buildPasteKit,
} from "../gmap2mappls/index";

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

  it("builds geo URI + share text for OEM Mappls handoff", () => {
    const kit = buildPasteKit(12.877073, 77.613574, { name: "Zigma Technologies", mapplsPin: "kcf7zj" });
    expect(kit.geoUri.startsWith("geo:12.877073,77.613574")).toBe(true);
    expect(kit.shareText).toContain("Zigma Technologies");
    expect(kit.shareText).toContain("kcf7zj");
    expect(kit.mapplsUrl).toBe("https://www.mappls.com/@12.877073,77.613574");
  });

  it("extracts place name from Google /place/ path", () => {
    expect(
      extractPlaceNameFromGoogleUrl(
        "https://www.google.com/maps/place/Zigma+Technologies/@12.87,77.61,16z/data=!3d12.8770726!4d77.6135744",
      ),
    ).toBe("Zigma Technologies");
  });

  it("ships acceptance fixtures with shared coords", () => {
    expect(SAMPLE_FIXTURES[0].lat).toBe(12.8804);
    expect(SAMPLE_FIXTURES[0].lng).toBe(77.5958);
    expect(SAMPLE_FIXTURES[2].input.toLowerCase()).toContain("india gate");
  });
});
