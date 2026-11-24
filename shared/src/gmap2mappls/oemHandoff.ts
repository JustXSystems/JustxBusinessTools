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

export type OemBrand = {
  id: string;
  name: string;
  segment: "2W" | "4W";
  examples: string;
  stack: OemMapStack;
  /** Ordered preferred methods for that OEM shell. */
  methods: OemHandoffMethod[];
  note: string;
};

/** Universal playbook that covers Mappls NCASE / SDK / phone-projection OEMs. */
export const MAPPLS_OEM_SEARCH_RULES = {
  searchBoxAccepts: ["place name / POI", "address text", "Mappls Pin (only if OEM entitled eLoc search)", "pincode / category"] as const,
  searchBoxRejects: ["raw lat,lng", "geo: URI", "Pin as fuzzy text when eLoc search disabled"] as const,
  whyLatLngFails:
    "Mappls Autosuggest `query` is text/POI/Pin. `location=lat,lng` is only a radial bias — pasting coordinates into the search field searches the wrong place.",
  whyPinFailsOnSimpleOne:
    "kcf7zj is correct on mappls.com (Zigma). SimpleOne search often lacks eLoc resolution, so typing the Pin fuzzy-matches an unrelated place. Use POI place name or Push Navigation via Google/geo → Simple Connect.",
  routingAccepts: ["Mappls Pin / eLoc", "WGS-84 lat,lng (API & navigation deep links)"] as const,
  ampereConfirms: "Ampere Nexus lists Last Mile Guidance with House Numbers & Mappls PIN.",
  simpleConnectConfirms:
    "Simple Connect: Push Location / Push Navigation + Share WhatsApp locations to Simple Connect for navigation.",
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
    methods: ["place_name", "simple_connect_push", "google_maps", "geo_intent", "mappls_nav_deep_link", "mappls_pin"],
    note: "Pin is correct on Mappls web but SimpleOne search often fuzzy-mismatches eLoc. Prefer POI place name, or Open Google/geo → Share/Push to Simple Connect (official WhatsApp-location / Push Navigation path).",
  },
  {
    id: "bajaj",
    name: "Bajaj",
    segment: "2W",
    examples: "Chetak + ICE/EV (Pulsar etc.)",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Chetak app + ICE/EV Mappls go-lives. Same Autosuggest rule — Pin in search.",
  },
  {
    id: "hero",
    name: "Hero MotoCorp",
    segment: "2W",
    examples: "OneApp",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "OneApp Mappls go-live (FY23). Paste Pin into destination search.",
  },
  {
    id: "ampere",
    name: "Ampere (Greaves)",
    segment: "2W",
    examples: "Nexus, Magnus GMax",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Mappls phone projection; docs explicitly advertise Mappls PIN last-mile.",
  },
  {
    id: "matter",
    name: "Matter Motor Works",
    segment: "2W",
    examples: "Matter connected line",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Cited Mappls go-live with Ampere / Simple Energy cohort.",
  },
  {
    id: "tork",
    name: "Tork Motors",
    segment: "2W",
    examples: "Tork connected EV",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Mappls go-live (FY23). Prefer Pin in OEM search.",
  },
  {
    id: "suzuki-2w",
    name: "Suzuki Motorcycles",
    segment: "2W",
    examples: "Cluster phone-projection",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Mappls smartphone projection on cluster across vehicle lines.",
  },
  {
    id: "tvs",
    name: "TVS",
    segment: "2W",
    examples: "Apache RTR 160, SmartXonnect / Connect",
    stack: "mixed",
    methods: ["mappls_pin", "mappls_nav_deep_link", "google_maps", "geo_intent"],
    note: "Apache RTR 160 Mappls go-live; TVS Connect also added Google Maps for some EV riders — use Pin for Mappls path, Google link for Google path.",
  },
  {
    id: "ola",
    name: "Ola Electric",
    segment: "2W",
    examples: "MoveOS / Ola Maps",
    stack: "ola_maps",
    methods: ["google_maps", "geo_intent", "mappls_pin"],
    note: "Primary stack is Ola Maps (not Mappls Autosuggest). Open Google / geo: for the shared point; Pin only helps if they also open Mappls.",
  },
  {
    id: "mahindra",
    name: "Mahindra",
    segment: "4W",
    examples: "Scorpio-N, XUV400, Born Electric, BE6, 7X0",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Multiple Mappls NCASE go-lives across ICE + Born Electric.",
  },
  {
    id: "tata",
    name: "Tata Motors",
    segment: "4W",
    examples: "Harrier, Safari, Sierra EV",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Connected lines go-live with Mappls (Harrier/Safari/Sierra EV).",
  },
  {
    id: "hyundai",
    name: "Hyundai",
    segment: "4W",
    examples: "Connected vehicle lines",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Mappls across connected vehicle lines (FY25).",
  },
  {
    id: "kia",
    name: "Kia",
    segment: "4W",
    examples: "Connected vehicle lines",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "Same Mappls connected-vehicle go-live cohort as Hyundai.",
  },
  {
    id: "mg",
    name: "MG",
    segment: "4W",
    examples: "Hector",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "MG Hector Mappls go-live (FY23).",
  },
  {
    id: "maruti",
    name: "Maruti Suzuki",
    segment: "4W",
    examples: "e-Vitara, Brezza (NCASE)",
    stack: "mappls",
    methods: ["mappls_pin", "mappls_nav_deep_link", "geo_intent"],
    note: "e-Vitara / Brezza NCASE go-lives — Pin for in-car / app search.",
  },
];

export type OemHandoffSummary = {
  rules: typeof MAPPLS_OEM_SEARCH_RULES;
  brands: OemBrand[];
  universalSteps: string[];
};

export function buildOemHandoffSummary(): OemHandoffSummary {
  return {
    rules: MAPPLS_OEM_SEARCH_RULES,
    brands: OEM_BRANDS,
    universalSteps: [
      "1. Pick your brand.",
      "2. Tap the one big button — Mappls is opened automatically.",
      "3. Follow the single short step shown for that brand.",
    ],
  };
}

export function getOemBrand(id: string | null | undefined): OemBrand | undefined {
  if (!id) return undefined;
  return OEM_BRANDS.find((b) => b.id === id);
}

/** Minimal paste fields the brand playbook needs (avoids circular type deps). */
export type BrandPasteLinks = {
  searchQuery?: string;
  mapplsPin?: string;
  mapplsPinUrl?: string;
  mapplsNavBikingUrl: string;
  mapplsNavDrivingUrl: string;
  mapplsUrl: string;
  googleMapsUrl: string;
  geoUri: string;
  simpleConnectIntentUrl: string;
  latLng: string;
};

export type BrandPlaybookAction = {
  /** Button label */
  label: string;
  /** Open this URL (Mappls / Google / geo / Simple Connect). */
  href?: string;
  /** Copy this to clipboard (place name or Pin). */
  copyText?: string;
  kind: "open" | "copy";
};

/**
 * One automated Mappls open + one user action per brand.
 * Keeps the UI to a single CTA and 1–2 short steps.
 */
export type BrandPlaybook = {
  brand: OemBrand;
  /** Always open Mappls at the exact point (auto-push). */
  autoOpenUrl: string;
  autoOpenLabel: string;
  /** The one thing the user must do in the OEM app. */
  primary: BrandPlaybookAction;
  /** Max 2 short steps after auto-open. */
  steps: string[];
  /** Optional backup if primary fails. */
  backup?: BrandPlaybookAction;
};

export function buildBrandPlaybook(
  brandId: string,
  paste: BrandPasteLinks,
): BrandPlaybook | null {
  const brand = getOemBrand(brandId);
  if (!brand) return null;

  const navUrl =
    brand.segment === "2W" ? paste.mapplsNavBikingUrl : paste.mapplsNavDrivingUrl;
  const place = paste.searchQuery?.trim();
  const pin = paste.mapplsPin?.trim();

  // SimpleOne: place name or Push — Pin search is unreliable
  if (brand.id === "simple-energy") {
    return {
      brand,
      autoOpenUrl: navUrl,
      autoOpenLabel: "Open exact point on Mappls",
      primary: place
        ? {
            kind: "copy",
            label: "Copy place name for SimpleOne",
            copyText: place,
          }
        : {
            kind: "open",
            label: "Open Google → share to Simple Connect",
            href: paste.googleMapsUrl,
          },
      steps: place
        ? [
            "Mappls already shows the exact point (opened for you).",
            `In SimpleOne / Simple Connect search, paste “${place}” and pick that place — then Push Navigation to the scooter.`,
          ]
        : [
            "Mappls already shows the exact point (opened for you).",
            "On your phone: Open Google → Share / Push the location to Simple Connect.",
          ],
      backup: {
        kind: "open",
        label: "Open Simple Connect (geo)",
        href: paste.simpleConnectIntentUrl || paste.geoUri,
      },
    };
  }

  // Ola: Google Maps, not Mappls search
  if (brand.stack === "ola_maps") {
    return {
      brand,
      autoOpenUrl: paste.googleMapsUrl,
      autoOpenLabel: "Open exact point on Google",
      primary: {
        kind: "open",
        label: "Open in Google Maps (Ola path)",
        href: paste.googleMapsUrl,
      },
      steps: [
        "Google already shows the exact point.",
        "In Ola / MoveOS, set destination from this Google location (or share the Google link into the Ola app).",
      ],
    };
  }

  // TVS mixed: prefer Mappls nav + Pin/place, Google backup
  if (brand.id === "tvs") {
    return {
      brand,
      autoOpenUrl: navUrl,
      autoOpenLabel: "Open exact point on Mappls",
      primary: pin
        ? { kind: "copy", label: `Copy Mappls Pin (${pin})`, copyText: pin }
        : place
          ? { kind: "copy", label: "Copy place name", copyText: place }
          : { kind: "open", label: "Open Google Maps", href: paste.googleMapsUrl },
      steps: [
        "Mappls already shows the exact point (opened for you).",
        pin
          ? `In TVS Mappls navigation search, paste Pin “${pin}”. If that fails (Google path on some EVs), use Open Google below.`
          : "Use the copied place name in TVS navigation search, or Open Google for the Google Maps EV path.",
      ],
      backup: {
        kind: "open",
        label: "Open Google (TVS Google path)",
        href: paste.googleMapsUrl,
      },
    };
  }

  // Default Mappls OEM: auto-open nav, copy Pin (or place name)
  return {
    brand,
    autoOpenUrl: navUrl,
    autoOpenLabel: "Open exact point on Mappls",
    primary: pin
      ? { kind: "copy", label: `Copy Mappls Pin (${pin})`, copyText: pin }
      : place
        ? { kind: "copy", label: "Copy place name", copyText: place }
        : {
            kind: "open",
            label: "Open Mappls navigation",
            href: navUrl,
          },
    steps: [
      "Mappls already shows the exact point (opened for you).",
      pin
        ? `In your ${brand.name} app / vehicle navigation search, paste Pin “${pin}” and start navigation.`
        : place
          ? `In your ${brand.name} app / vehicle navigation search, paste “${place}” and pick that place.`
          : `In your ${brand.name} app, open the Mappls screen that just launched and start navigation to this point.`,
    ],
    backup: paste.mapplsPinUrl
      ? { kind: "open", label: "Open pin on Mappls", href: paste.mapplsPinUrl }
      : { kind: "open", label: "Open Mappls map", href: paste.mapplsUrl },
  };
}
