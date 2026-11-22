import type { LatLng } from "./types";

/** Tokens that are too generic to use as neighbourhood anchors. */
const STOP = new Set([
  "india",
  "bharat",
  "near",
  "opp",
  "opposite",
  "next",
  "to",
  "the",
  "and",
  "road",
  "rd",
  "street",
  "st",
  "lane",
  "ln",
  "cross",
  "main",
  "layout",
  "nagar",
  "colony",
  "enclave",
  "enclaves",
  "apartment",
  "apartments",
  "flat",
  "flats",
  "block",
  "phase",
  "sector",
  "plot",
  "no",
  "number",
  "house",
  "building",
  "floor",
  "ground",
  "post",
  "office",
  "pin",
  "pincode",
  "district",
  "taluk",
  "tehsil",
  "village",
  "town",
  "city",
  "state",
  "karnataka",
  "maharashtra",
  "tamil",
  "nadu",
  "telangana",
  "andhra",
  "pradesh",
  "delhi",
  "new",
  "nct",
  "bengaluru",
  "bangalore",
  "mumbai",
  "navi",
  "chennai",
  "hyderabad",
  "pune",
  "kolkata",
  "gurgaon",
  "gurugram",
  "noida",
  "ltd",
  "pvt",
  "private",
  "limited",
  "co",
  "company",
]);

/**
 * Pull neighbourhood-like tokens from a full Indian address.
 * Prefers mid-address locality words (e.g. Hulimavu, Bannerghatta) over door numbers.
 */
export function extractNeighbourhoodTokens(address: string): string[] {
  const cleaned = address
    .toLowerCase()
    .replace(/[#&/\\|()[\]]+/g, " ")
    .replace(/\b\d{6}\b/g, " ") // pin
    .replace(/\b\d+[a-z]?\b/g, " ") // door / sector numbers
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
  // Prefer distinctive tokens; keep order, unique
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.slice(0, 8);
}

export type GeocodeCandidate = LatLng & {
  displayName: string;
  city?: string;
  state?: string;
  country?: string;
};

function haystack(c: GeocodeCandidate): string {
  return `${c.displayName} ${c.city ?? ""} ${c.state ?? ""} ${c.country ?? ""}`.toLowerCase();
}

/** Soft city/region hints from the query — used to reject cross-metro mismatches. */
export function extractCityHints(address: string): string[] {
  const lower = address.toLowerCase();
  const hints: string[] = [];
  const cities: Array<[RegExp, string]> = [
    [/\b(bengaluru|bangalore)\b/, "bengaluru"],
    [/\b(mumbai|bombay)\b/, "mumbai"],
    [/\bnavi\s+mumbai\b/, "navi mumbai"],
    [/\b(delhi|new delhi)\b/, "delhi"],
    [/\b(chennai|madras)\b/, "chennai"],
    [/\b(hyderabad)\b/, "hyderabad"],
    [/\b(pune)\b/, "pune"],
    [/\b(kolkata|calcutta)\b/, "kolkata"],
    [/\b(whitefield)\b/, "whitefield"],
    [/\b(hulimavu)\b/, "hulimavu"],
    [/\b(bannerghatta)\b/, "bannerghatta"],
    [/\b(taloja)\b/, "taloja"],
    [/\b(india gate)\b/, "india gate"],
  ];
  for (const [re, label] of cities) {
    if (re.test(lower)) hints.push(label);
  }
  return hints;
}

/**
 * Score a geocode candidate against the original address.
 * Higher is better. Negative = hard reject.
 */
export function scoreCandidate(address: string, c: GeocodeCandidate): number {
  const tokens = extractNeighbourhoodTokens(address);
  const hints = extractCityHints(address);
  const hay = haystack(c);

  // India bias: non-India results are weak unless query has no India context
  const inIndia =
    /\bindia\b/.test(hay) ||
    /\b(karnataka|maharashtra|delhi|tamil|telangana|andhra|kerala|rajasthan|gujarat|west bengal|uttar|madhya|bihar|odisha|punjab|haryana)\b/.test(
      hay,
    );
  let score = inIndia ? 2 : -5;

  let tokenHits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) {
      tokenHits += 1;
      score += t.length >= 7 ? 6 : 4;
    }
  }

  for (const h of hints) {
    if (hay.includes(h)) score += 8;
    else if (h === "bengaluru" && (hay.includes("bangalore") || hay.includes("bengaluru"))) score += 8;
    else if (h === "delhi" && hay.includes("delhi")) score += 8;
  }

  // Hard rejects for known confusion cases
  if (hints.includes("hulimavu") || tokens.includes("hulimavu")) {
    if (hay.includes("whitefield") && !hay.includes("hulimavu")) return -100;
    if ((hay.includes("navi mumbai") || hay.includes("taloja") || hay.includes("navi-mumbai")) && !hay.includes("hulimavu")) {
      return -100;
    }
    if (!hay.includes("hulimavu") && !hay.includes("bannerghatta") && !hay.includes("bengaluru") && !hay.includes("bangalore")) {
      score -= 20;
    }
  }

  if (hints.includes("bannerghatta") || tokens.includes("bannerghatta")) {
    if (hay.includes("whitefield") && !hay.includes("bannerghatta")) return -80;
  }

  // Door-number / sector traps: "19 & 20" must not prefer "Sector 19, Taloja"
  if (/\btaloja\b/.test(hay) && !/\btaloja\b/i.test(address)) {
    score -= 40;
  }

  if (tokenHits === 0 && tokens.length >= 2) score -= 10;

  return score;
}

export function pickBestCandidate(
  address: string,
  candidates: GeocodeCandidate[],
): { candidate: GeocodeCandidate; score: number } | null {
  if (!candidates.length) return null;
  let best: GeocodeCandidate | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreCandidate(address, c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best || bestScore < 0) return null;
  return { candidate: best, score: bestScore };
}

/** Approx India bounding box for soft filter. */
export function isInIndiaBBox(lat: number, lng: number): boolean {
  return lat >= 6.5 && lat <= 37.5 && lng >= 68 && lng <= 97.5;
}
