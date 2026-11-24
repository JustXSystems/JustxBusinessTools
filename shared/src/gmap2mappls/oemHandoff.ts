/**
 * OEM Mappls / maps coverage for GMAP2MAPPLS handoff.
 *
 * Sources: MapmyIndia investor go-lives (FY23–FY27), Mappls Auto NCASE docs,
 * Ampere Nexus feature list (explicit Mappls PIN last-mile), Mappls Autosuggest
 * contract (query = places/Pin; location = bias only), Ola Maps / TVS Connect
 * public product notes.
 *
 * Reality check: almost every Mappls-integrated OEM reuses the same Autosuggest
 * destination search. Lat/lng pasted as search text fails everywhere that stack
 * is used. Mappls Pin (eLoc) is the searchable identity. Coordinate deep links
 * (`mappls.com/navigation?places=lat,lng,…`, `@lat,lng`, geo:) bypass search.
 */
import {
  normalizeMapplsPin,
  oemPackageGeoIntentUrl,
  oemPackageGoogleMapsIntentUrl,
  oemPackageLaunchUrl,
} from "./types";

export type OemMapStack = "mappls" | "ola_maps" | "mixed" | "unknown";

export type OemHandoffMethod =
  | "place_name"
  | "mappls_pin"
  | "mappls_nav_deep_link"
  | "mappls_pin_url"
  | "geo_intent"
  | "simple_connect_push"
  | "google_maps"
  | "digipin";

/** Public Play Store companion app used to hand off the destination. */
export type OemCompanionApp = {
  /** Button label, e.g. "Simple Connect". */
  name: string;
  /** Android applicationId. */
  packageId: string;
  /**
   * geo = WhatsApp-style geo Intent into the package (Simple Connect style).
   * maps = maps.google.com Intent into the package (Ola / Google-path brands).
   * geo_with_pin = launch OEM app + auto-copy Mappls Pin → search → send/push to vehicle
   *   (Mahindra Adrenox, Hyundai Bluelink, Kia Connect, Tata iRA, MG iSMART, …).
   */
  handoff: "geo" | "maps" | "geo_with_pin";
  /**
   * Final in-app action after pasting Pin (default: "Push to car").
   * Examples: "Send to car", "Push POI to car".
   */
  finalAction?: string;
};

export type OemBrand = {
  id: string;
  name: string;
  segment: "2W" | "4W";
  examples: string;
  stack: OemMapStack;
  /** Ordered preferred methods for that OEM shell. */
  methods: OemHandoffMethod[];
  note: string;
  /** When set, primary action opens this OEM app (not Mappls). */
  companionApp?: OemCompanionApp;
};

/** Universal playbook that covers Mappls NCASE / SDK / phone-projection OEMs. */
export const MAPPLS_OEM_SEARCH_RULES = {
  searchBoxAccepts: ["place name / POI", "address text", "Mappls Pin (only if OEM entitled eLoc search)", "pincode / category"] as const,
  searchBoxRejects: ["raw lat,lng", "geo: URI", "Pin as fuzzy text when eLoc search disabled"] as const,
  whyLatLngFails:
    "Mappls Autosuggest `query` is text/POI/Pin. `location=lat,lng` is only a radial bias — pasting coordinates into the search field searches the wrong place.",
  whyPinFailsOnSimpleOne:
    "kcf7zj is correct on mappls.com (Zigma). SimpleOne search often lacks eLoc resolution, so typing the Pin fuzzy-matches an unrelated place. Use POI place name or Push Navigation via Google/geo → Simple Connect.",
  whyMahindraDiffersFromSimpleConnect:
    "Adrenox Connect does not advertise WhatsApp-style geo intake. Reliable path: open Adrenox → paste Mappls Pin (Mappls NCASE entitled) → Push to car. Never paste lat,lng. If Pin is missing, open Mappls 4W nav (exact lat,lng deep link) and/or paste place name.",
  routingAccepts: ["Mappls Pin / eLoc", "WGS-84 lat,lng (API & navigation deep links)"] as const,
  ampereConfirms: "Ampere Nexus lists Last Mile Guidance with House Numbers & Mappls PIN.",
  simpleConnectConfirms:
    "Simple Connect: Push Location / Push Navigation + Share WhatsApp locations to Simple Connect for navigation.",
  mahindraConfirms:
    "Mahindra Mappls Auto NCASE: Adrenox Connect (XUV700 / Scorpio-N) and Me4U (Born Electric) — Mappls Pin search + push/send to vehicle; in-car multi-screen Mappls; EV routing on Born Electric.",
} as const;

/**
 * Brand matrix for the UI. “mappls” = Mappls NCASE / SDK / projection go-live
 * cited by MapmyIndia or Mappls case studies. Methods are what GMAP2MAPPLS can
 * emit today — not private OEM deep-link schemes (those are not public).
 */
export const OEM_BRANDS: OemBrand[] = [
  {
    id: "simple-energy",
    name: "Simple Energy / SimpleOne",
    segment: "2W",
    examples: "SimpleOne, Simple Connect",
    stack: "mappls",
    methods: ["simple_connect_push", "geo_intent", "google_maps", "place_name", "mappls_nav_deep_link", "mappls_pin"],
    note: "Open Simple Connect location finder (geo Intent). Do not use Mappls / Pin search as primary.",
    companionApp: { name: "Simple Connect", packageId: "com.sepl.android", handoff: "geo" },
  },
  {
    id: "bajaj",
    name: "Bajaj",
    segment: "2W",
    examples: "Chetak + ICE/EV (Pulsar etc.)",
    stack: "mappls",
    methods: ["geo_intent", "mappls_pin", "mappls_nav_deep_link"],
    note: "Open Chetak app with destination; Pin as backup in-app search.",
    companionApp: { name: "Chetak", packageId: "com.bajajmychetak", handoff: "geo" },
  },
  {
    id: "hero",
    name: "Hero MotoCorp",
    segment: "2W",
    examples: "Hero Connect / OneApp",
    stack: "mappls",
    methods: ["geo_intent", "mappls_pin", "mappls_nav_deep_link"],
    note: "Open Hero Connect with destination; Pin as backup.",
    companionApp: { name: "Hero Connect", packageId: "com.invenzen.rollr.hmc", handoff: "geo" },
  },
  {
    id: "ampere",
    name: "Ampere (Greaves)",
    segment: "2W",
    examples: "Nexus, Magnus GMax",
    stack: "mappls",
    methods: ["geo_intent", "mappls_pin", "mappls_nav_deep_link"],
    note: "Open Ampere Connect (navigation → console); Pin for last-mile backup.",
    companionApp: { name: "Ampere Connect", packageId: "com.greavesmobility.app", handoff: "geo" },
  },
  {
    id: "matter",
    name: "Matter Motor Works",
    segment: "2W",
    examples: "Matter connected line",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "No public companion package for location share — Mappls nav + Pin.",
  },
  {
    id: "tork",
    name: "Tork Motors",
    segment: "2W",
    examples: "Tork connected EV",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "No public companion package for location share — Mappls nav + Pin.",
  },
  {
    id: "suzuki-2w",
    name: "Suzuki Motorcycles",
    segment: "2W",
    examples: "Cluster phone-projection",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Phone-projection Mappls path — Mappls nav + Pin.",
  },
  {
    id: "tvs",
    name: "TVS",
    segment: "2W",
    examples: "Apache RTR 160, SmartXonnect / Connect",
    stack: "mixed",
    methods: ["geo_intent", "mappls_pin", "google_maps", "mappls_nav_deep_link"],
    note: "Open TVS Connect with destination; Pin / Google as backup.",
    companionApp: { name: "TVS Connect", packageId: "com.tvsm.connect", handoff: "geo" },
  },
  {
    id: "ola",
    name: "Ola Electric",
    segment: "2W",
    examples: "MoveOS / Ola Maps",
    stack: "ola_maps",
    methods: ["google_maps", "geo_intent", "mappls_pin"],
    note: "Open Ola Electric app (Google Maps location family).",
    companionApp: { name: "Ola Electric", packageId: "com.olaelectric.companion", handoff: "maps" },
  },
  {
    id: "mahindra",
    name: "Mahindra · Adrenox (XUV700 / Scorpio-N)",
    segment: "4W",
    examples: "XUV700, Scorpio-N, XUV 3XO, connected ICE SUVs — Adrenox Connect + Mappls Auto NCASE",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "place_name", "geo_intent"],
    note:
      "Adrenox Connect (com.mahindra.adrenox) + in-car Mappls NCASE. Paste Mappls Pin → Push to car. Never geo share / lat,lng. Backup: Mappls 4W nav + vehicle Mappls Pin search.",
    companionApp: {
      name: "Adrenox Connect",
      packageId: "com.mahindra.adrenox",
      handoff: "geo_with_pin",
      finalAction: "Push to car",
    },
  },
  {
    id: "mahindra-me4u",
    name: "Mahindra · Me4U (Born Electric)",
    segment: "4W",
    examples: "BE.05, BE.06, XEV 9e, Born Electric eSUVs — Me4U + Mappls Auto NCASE (EV routing / multi-screen)",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "place_name", "geo_intent"],
    note:
      "Me4U (com.mahindra.inglo) for Born Electric: Mappls Pin search + send location to vehicle NCASE. Never lat,lng. Backup: Mappls 4W nav (EV routing verify) + in-car Pin.",
    companionApp: {
      name: "Me4U",
      packageId: "com.mahindra.inglo",
      handoff: "geo_with_pin",
      finalAction: "Send to vehicle",
    },
  },
  {
    id: "tata",
    name: "Tata Motors",
    segment: "4W",
    examples: "Harrier, Safari, Sierra EV",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "place_name", "geo_intent"],
    note: "Tata iRA: send destination to car — launch app + Mappls Pin (not geo share, not lat,lng).",
    companionApp: {
      name: "Tata Motors iRA",
      packageId: "com.tatamotors.oneapp",
      handoff: "geo_with_pin",
      finalAction: "Send to car",
    },
  },
  {
    id: "hyundai",
    name: "Hyundai",
    segment: "4W",
    examples: "Connected vehicle lines",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "place_name", "geo_intent"],
    note: "Bluelink Destination send to car — launch app + Mappls Pin (not geo share, not lat,lng).",
    companionApp: {
      name: "Hyundai Bluelink",
      packageId: "com.hyundai.india.bluelink.prd",
      handoff: "geo_with_pin",
      finalAction: "Send to car",
    },
  },
  {
    id: "kia",
    name: "Kia",
    segment: "4W",
    examples: "Connected vehicle lines",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "place_name", "geo_intent"],
    note: "Kia Connect send destination to car — launch app + Mappls Pin (not geo share, not lat,lng).",
    companionApp: {
      name: "Kia Connect",
      packageId: "com.kia.uvo.in.prd",
      handoff: "geo_with_pin",
      finalAction: "Send to car",
    },
  },
  {
    id: "mg",
    name: "MG",
    segment: "4W",
    examples: "Hector",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "place_name", "geo_intent"],
    note: "MG iSMART Push POI to car — launch app + Mappls Pin (not geo share, not lat,lng).",
    companionApp: {
      name: "MG iSMART",
      packageId: "com.saicmotor.iov.india",
      handoff: "geo_with_pin",
      finalAction: "Push POI to car",
    },
  },
  {
    id: "maruti",
    name: "Maruti Suzuki",
    segment: "4W",
    examples: "e-Vitara, Brezza (NCASE)",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "place_name", "geo_intent"],
    note: "Suzuki Connect has limited send-to-car; prefer Mappls Pin in vehicle NCASE search. App launch + Pin copy still helps.",
    companionApp: {
      name: "Suzuki Connect",
      packageId: "com.msil.suzukiconnect_generation_2",
      handoff: "geo_with_pin",
      finalAction: "paste Pin in vehicle Mappls search",
    },
  },
];

export type OemHandoffSummary = {
  rules: typeof MAPPLS_OEM_SEARCH_RULES;
  brands: OemBrand[];
  universalSteps: string[];
};

/** URL / support aliases → canonical OEM brand id. */
export const OEM_BRAND_ALIASES: Record<string, string> = {
  mahindra: "mahindra",
  adrenox: "mahindra",
  "mahindra-adrenox": "mahindra",
  xuv700: "mahindra",
  "scorpio-n": "mahindra",
  scorpio: "mahindra",
  "mahindra-me4u": "mahindra-me4u",
  me4u: "mahindra-me4u",
  inglo: "mahindra-me4u",
  "born-electric": "mahindra-me4u",
  "mahindra-bev": "mahindra-me4u",
  be05: "mahindra-me4u",
  "be.05": "mahindra-me4u",
  be06: "mahindra-me4u",
  "be.06": "mahindra-me4u",
  xev: "mahindra-me4u",
  xev9e: "mahindra-me4u",
};

/** Resolve deep-link / alias to a known OEM brand id. */
export function resolveOemBrandId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (OEM_BRANDS.some((b) => b.id === key)) return key;
  const aliased = OEM_BRAND_ALIASES[key];
  if (aliased && OEM_BRANDS.some((b) => b.id === aliased)) return aliased;
  return undefined;
}

export function buildOemHandoffSummary(): OemHandoffSummary {
  return {
    rules: MAPPLS_OEM_SEARCH_RULES,
    brands: OEM_BRANDS,
    universalSteps: [
      "1. Pick your vehicle brand (Mahindra: Adrenox vs Me4U by model).",
      "2. Tap Open — that brand’s companion app opens; Pin is ready when needed.",
      "3. Confirm in the app / vehicle Mappls and push / send / start navigation.",
    ],
  };
}

export function getOemBrand(id: string | null | undefined): OemBrand | undefined {
  const resolved = resolveOemBrandId(id) || id?.trim();
  if (!resolved) return undefined;
  return OEM_BRANDS.find((b) => b.id === resolved);
}

/** Minimal paste fields the brand playbook needs (avoids circular type deps). */
export type BrandPasteLinks = {
  lat: number;
  lng: number;
  searchQuery?: string;
  mapplsPin?: string;
  mapplsPinUrl?: string;
  mapplsNavBikingUrl: string;
  mapplsNavDrivingUrl: string;
  mapplsUrl: string;
  googleMapsUrl: string;
  geoUri: string;
  simpleConnectIntentUrl: string;
  simpleConnectMapsIntentUrl?: string;
  whatsappGeoUri?: string;
  latLng: string;
};

export type BrandPlaybookAction = {
  /** Button label */
  label: string;
  /** Open this URL (OEM app Intent / Mappls / Google / geo). */
  href?: string;
  /** Copy this to clipboard (place name or Pin). */
  copyText?: string;
  kind: "open" | "copy";
};

/**
 * Pick brand → open that brand’s companion app with the destination.
 * Mappls is only used when the brand has no public companion package.
 */
export type BrandPlaybook = {
  brand: OemBrand;
  /** Open target for the selected brand’s app (or Mappls fallback). */
  autoOpenUrl: string;
  autoOpenLabel: string;
  /** The one CTA — almost always “Open {OEM app}”. */
  primary: BrandPlaybookAction;
  /** Max 2 short steps after open. */
  steps: string[];
  /** Optional backup if primary fails. */
  backup?: BrandPlaybookAction;
  /**
   * Text auto-copied for Mappls Pin / place OEMs (e.g. Mahindra Adrenox
   * search → Push to car). UI must also re-copy on primary tap (clipboard
   * after async fetch is unreliable).
   */
  autoCopyText?: string;
  /**
   * Preferred QR payload. Prefer HTTPS / plain Pin text — many scanners
   * fail on intent:#Intent LAUNCHER URLs (unlike Simple Connect geo Intent).
   */
  qrPayload?: string;
  /** True when this brand must never paste lat,lng into OEM search. */
  rejectLatLngPaste?: boolean;
  /**
   * If true, UI must NOT auto-open after resolve. User taps primary so Pin
   * copy + app launch share one user gesture (Mahindra / Push-to-car).
   */
  deferAutoOpen?: boolean;
  /** Android/iOS Web Share payload (Pin + Mappls link) when supported. */
  share?: { title: string; text: string; url?: string };
  /** Copy Pin for the vehicle’s built-in Mappls search (skip phone app). */
  inCar?: { label: string; copyText: string };
};

function parsePasteCoords(paste: BrandPasteLinks): { lat: number; lng: number } {
  if (Number.isFinite(paste.lat) && Number.isFinite(paste.lng)) {
    return { lat: paste.lat, lng: paste.lng };
  }
  const m = paste.latLng.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  return { lat: 0, lng: 0 };
}

export function buildBrandPlaybook(
  brandId: string,
  paste: BrandPasteLinks,
): BrandPlaybook | null {
  const brand = getOemBrand(brandId);
  if (!brand) return null;

  const navUrl =
    brand.segment === "2W" ? paste.mapplsNavBikingUrl : paste.mapplsNavDrivingUrl;
  const place = paste.searchQuery?.trim();
  const pin = normalizeMapplsPin(paste.mapplsPin);
  const { lat, lng } = parsePasteCoords(paste);
  const app = brand.companionApp;
  const coordsOk =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);

  // Preferred path: open the selected OEM companion app with this location
  if (app) {
    const openUrl =
      brand.id === "simple-energy" && paste.simpleConnectIntentUrl
        ? paste.simpleConnectIntentUrl
        : app.handoff === "maps"
          ? oemPackageGoogleMapsIntentUrl(app.packageId, lat, lng)
          : oemPackageGeoIntentUrl(app.packageId, lat, lng, place);

    const mapsBackup =
      brand.id === "simple-energy" && paste.simpleConnectMapsIntentUrl
        ? paste.simpleConnectMapsIntentUrl
        : oemPackageGoogleMapsIntentUrl(app.packageId, lat, lng);

    // Mahindra Adrenox / Mappls NCASE “Push to car” path.
    // Lessons from Simple Connect applied here:
    // - Do NOT open Mappls as primary (wrong app) — even when Pin is missing.
    // - Do NOT paste lat,lng into search (Autosuggest fails).
    // - Adrenox does NOT take WhatsApp geo like Simple Connect → launch app + Pin.
    // - Clipboard after async fetch is flaky → deferAutoOpen; primary tap copies+opens.
    // - QR scanners often fail on intent:#Intent → QR uses Pin text / HTTPS.
    if (app.handoff === "geo_with_pin") {
      const launchUrl = oemPackageLaunchUrl(app.packageId);
      const finalAction = app.finalAction?.trim() || "Push to car";
      const mapplsBackup = coordsOk
        ? { kind: "open" as const, label: "Open exact point on Mappls (4W)", href: navUrl }
        : {
            kind: "open" as const,
            label: "Open Google Maps",
            href: paste.googleMapsUrl,
          };

      if (pin) {
        const dest = place || pin;
        return {
          brand,
          autoOpenUrl: launchUrl,
          autoOpenLabel: `Open ${app.name}`,
          primary: {
            kind: "open",
            label: `Copy Pin ${pin} & open ${app.name}`,
            href: launchUrl,
          },
          autoCopyText: pin,
          qrPayload: pin,
          rejectLatLngPaste: true,
          deferAutoOpen: true,
          share: {
            title: `Mappls Pin ${pin}`,
            text: `Destination: ${dest}\nMappls Pin: ${pin}\nPaste in ${app.name} or vehicle Mappls search → ${finalAction}. Never paste lat,lng.`,
            url: paste.mapplsPinUrl,
          },
          inCar: {
            label: `Copy Pin ${pin} for vehicle Mappls`,
            copyText: pin,
          },
          steps: [
            `Phone: tap button (copies Pin + opens ${app.name}) → paste “${pin}” → ${finalAction}. Or already in the car: copy Pin into vehicle Mappls search. Never paste lat,lng.`,
          ],
          backup: mapplsBackup,
        };
      }

      // No Pin: still open OEM app, not Mappls. Place name / Mappls are assists.
      return {
        brand,
        autoOpenUrl: launchUrl,
        autoOpenLabel: `Open ${app.name}`,
        primary: {
          kind: "open",
          label: place
            ? `Copy place name & open ${app.name}`
            : `Open ${app.name}`,
          href: launchUrl,
        },
        autoCopyText: place,
        qrPayload: place || (coordsOk ? navUrl : paste.googleMapsUrl),
        rejectLatLngPaste: true,
        deferAutoOpen: true,
        share: place
          ? {
              title: place,
              text: `Destination: ${place}\nPaste in ${app.name} search → ${finalAction}. Never paste lat,lng.`,
              url: coordsOk ? navUrl : paste.googleMapsUrl,
            }
          : undefined,
        steps: [
          place
            ? `Pin unavailable. Tap the button (copies place name + opens ${app.name}). Paste “${place}” → ${finalAction}. Use Mappls 4W backup to verify the exact point.`
            : `Pin unavailable. Open ${app.name} and set the destination → ${finalAction}. Use Mappls 4W backup for the exact point. Never paste lat,lng.`,
        ],
        backup: mapplsBackup,
      };
    }

    return {
      brand,
      autoOpenUrl: openUrl,
      autoOpenLabel: `Open ${app.name}`,
      primary: {
        kind: "open",
        label: `Open ${app.name} with this location`,
        href: openUrl,
      },
      qrPayload:
        brand.id === "simple-energy"
          ? paste.whatsappGeoUri || openUrl
          : openUrl,
      rejectLatLngPaste: true,
      steps: [
        `Only remaining step: in ${app.name}, confirm this place and push / start navigation to the vehicle.`,
      ],
      backup: {
        kind: "open",
        label: `Try Google Maps → ${app.name}`,
        href: mapsBackup,
      },
    };
  }

  // No public companion package: Mappls nav + copy Pin/place for in-vehicle search
  return {
    brand,
    autoOpenUrl: navUrl,
    autoOpenLabel: `Open Mappls for ${brand.name}`,
    primary: {
      kind: "open",
      label: `Open Mappls navigation (${brand.name})`,
      href: navUrl,
    },
    autoCopyText: pin || place,
    qrPayload: pin || navUrl,
    rejectLatLngPaste: true,
    steps: [
      pin
        ? `Only remaining step: paste Pin “${pin}” in ${brand.name} search and start navigation (never lat,lng).`
        : place
          ? `Only remaining step: paste “${place}” in ${brand.name} search and start navigation (never lat,lng).`
          : `Only remaining step: start navigation to this point in ${brand.name}.`,
    ],
    backup: pin
      ? { kind: "copy", label: `Copy Mappls Pin (${pin})`, copyText: pin }
      : paste.mapplsPinUrl
        ? { kind: "open", label: "Open pin on Mappls", href: paste.mapplsPinUrl }
        : { kind: "open", label: "Open Mappls map", href: paste.mapplsUrl },
  };
}
