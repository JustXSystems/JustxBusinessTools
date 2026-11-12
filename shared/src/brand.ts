/**
 * Canonical platform brand copy. Admin → Experience → Branding is the runtime
 * source of truth; these defaults seed new installs and fill missing fields.
 */
export const BRAND_DEFAULTS = {
  appName: "Justxsystems",
  tagline: "Justxsystems",
  installName: "Justxsystems",
  /** Legal / payee / copyright entity. */
  legalName: "Justxsystems LLP",
  /** Full product title for marketing chrome. */
  productName: "Justxsystems Business Tools",
  poweredBy: "Powered by Justxsystems LLP",
} as const;

export type BrandDefaults = typeof BRAND_DEFAULTS;

/**
 * Case-sensitive substring renames (longest first). Used by DB migration and
 * codebase rewrite scripts. Does not touch lowercase `justx` / emails / paths.
 * Bare JustX / Justx must use {@link renameBrandText} (regex) so
 * Justxsystems is not double-prefixed.
 */
export const BRAND_RENAME_RULES: ReadonlyArray<readonly [string, string]> = [
  ["JustXSystems", "Justxsystems"],
  ["JustxSystems", "Justxsystems"],
  ["JustX Business Tools", "Justxsystems Business Tools"],
  ["Justx Business Tools", "Justxsystems Business Tools"],
  ["JustX Systems LLP", "Justxsystems LLP"],
  ["Justx Systems LLP", "Justxsystems LLP"],
  ["JustX Systems", "Justxsystems"],
  ["Justx Systems", "Justxsystems"],
  ["JustX Sync Agent", "Justxsystems Sync Agent"],
  ["Justx Sync Agent", "Justxsystems Sync Agent"],
];

/** Apply phrase rules, then bare JustX/Justx → Justxsystems (never doubles Justxsystems). */
export function renameBrandText(input: string): string {
  let s = input;
  for (const [from, to] of BRAND_RENAME_RULES) {
    if (s.includes(from)) s = s.split(from).join(to);
  }
  // Bare brand token only when not already "Justxsystems" / "JustXsystems"
  s = s.replace(/JustX(?![Ss]ystems)/g, "Justxsystems");
  s = s.replace(/Justx(?![Ss]ystems)/g, "Justxsystems");
  return s;
}

/** Exact legacy labels we migrate to the new canonical brand. */
const LEGACY_APP = new Set([
  "JustXSystems",
  "JustX",
  "JustxSystems",
  "Justx",
  "JustX Systems",
  "Justx Systems",
]);

const LEGACY_LEGAL = new Set([
  "JustXSystems LLP",
  "JustX LLP",
  "JustxSystems LLP",
  "Justx Systems LLP",
  "JustX Systems LLP",
  "Justx LLP",
]);

const LEGACY_PRODUCT = new Set([
  "JustX Business Tools",
  "Justx Business Tools",
  "JustXSystems Business Tools",
  "JustxSystems Business Tools",
]);

const LEGACY_POWERED = new Set([
  "Powered by JustXSystems LLP",
  "Powered by JustXSystems",
  "Powered by JustX",
  "Powered by JustxSystems LLP",
  "Powered by JustX Systems LLP",
  "Powered by Justx Systems LLP",
  "Powered by Justx Systems",
  "Powered by Justx",
]);

export function coerceBrandAppName(
  raw: unknown,
  fallback: string = BRAND_DEFAULTS.appName,
): string {
  const s = String(raw ?? "").trim();
  if (!s || LEGACY_APP.has(s)) return fallback;
  const renamed = renameBrandText(s);
  // Older installs stored the product title in appName — fold those back to app name.
  if (
    renamed === BRAND_DEFAULTS.productName ||
    LEGACY_PRODUCT.has(s) ||
    LEGACY_PRODUCT.has(renamed)
  ) {
    return fallback;
  }
  return renamed;
}

export function coerceBrandLegalName(
  raw: unknown,
  fallback: string = BRAND_DEFAULTS.legalName,
): string {
  const s = String(raw ?? "").trim();
  if (!s || LEGACY_LEGAL.has(s) || LEGACY_APP.has(s)) return fallback;
  const renamed = renameBrandText(s);
  // Product title mistakenly stored as legal name
  if (
    renamed === BRAND_DEFAULTS.productName ||
    LEGACY_PRODUCT.has(s) ||
    LEGACY_PRODUCT.has(renamed) ||
    renamed === BRAND_DEFAULTS.appName
  ) {
    return fallback;
  }
  return renamed;
}

export function coerceBrandProductName(
  raw: unknown,
  fallback: string = BRAND_DEFAULTS.productName,
): string {
  const s = String(raw ?? "").trim();
  if (!s || LEGACY_PRODUCT.has(s)) return fallback;
  return renameBrandText(s);
}

export function coerceBrandPoweredBy(
  raw: unknown,
  fallback: string = BRAND_DEFAULTS.poweredBy,
): string {
  const s = String(raw ?? "").trim();
  if (!s || LEGACY_POWERED.has(s)) return fallback;
  return renameBrandText(s);
}

export function brandCopyright(legalName: string = BRAND_DEFAULTS.legalName): string {
  return `© ${legalName}. All rights reserved.`;
}
