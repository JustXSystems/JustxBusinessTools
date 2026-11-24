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
  | "mappls_pin"
  | "mappls_nav_deep_link"
  | "mappls_pin_url"
  | "geo_intent"
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
  searchBoxAccepts: ["place name", "address text", "Mappls Pin (6-char eLoc)", "pincode / category"] as const,
  searchBoxRejects: ["raw lat,lng", "geo: URI", "Google address paste as primary"] as const,
  whyLatLngFails:
    "Mappls Autosuggest `query` is text/POI/Pin. `location=lat,lng` is only a radial bias — pasting coordinates into the search field searches the wrong place.",
  routingAccepts: ["Mappls Pin / eLoc", "WGS-84 lat,lng (API & navigation deep links)"] as const,
  ampereConfirms: "Ampere Nexus lists Last Mile Guidance with House Numbers & Mappls PIN.",
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
    methods: ["mappls_pin", "mappls_nav_deep_link", "mappls_pin_url", "geo_intent"],
    note: "Dash uses Map My India navigation. Paste Mappls Pin into search; or push/open via Mappls nav / geo.",
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
      "1. Copy Mappls Pin → paste into any Mappls OEM destination search (SimpleOne, Chetak, OneApp, Mahindra, Tata, Hyundai, Kia, MG, Maruti, Ampere, Matter, Tork, Suzuki, TVS Mappls path).",
      "2. Or tap Navigate in Mappls (2W/4W) — official navigation deep link uses lat,lng and skips Autosuggest.",
      "3. Or Open Mappls Pin URL / geo: / phone maps chooser.",
      "4. Ola Electric / some TVS Google paths: Open Google Maps at the same lat,lng (not Mappls Pin search).",
    ],
  };
}
