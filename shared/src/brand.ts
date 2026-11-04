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
 */
export const BRAND_RENAME_RULES: ReadonlyArray<readonly [string, string]> = [
  ["JustXSystems", "Justxsystems"],
  ["JustX Business Tools", "Justxsystems Business Tools"],
  ["JustX Systems LLP", "Justxsystems LLP"],
  ["JustX Systems", "Justxsystems"],
  ["JustX Sync Agent", "Justxsystems Sync Agent"],
  ["JustX", "Justxsystems"],
];

/** Apply {@link BRAND_RENAME_RULES} (case-sensitive). */
export function renameBrandText(input: string): string {
  let s = input;
  for (const [from, to] of BRAND_RENAME_RULES) {
    if (s.includes(from)) s = s.split(from).join(to);
  }
  return s;
}

/** Exact legacy labels we migrate to the new canonical brand. */
const LEGACY_APP = new Set([
  "JustXSystems",
  "JustX",
  "JustxSystems",
  "JustX Systems",
]);

const LEGACY_LEGAL = new Set([
  "JustXSystems LLP",
  "JustX LLP",
  "JustxSystems LLP",
  "JustX Systems LLP",
]);

const LEGACY_PRODUCT = new Set([
  "JustX Business Tools",
  "JustXSystems Business Tools",
  "JustxSystems Business Tools",
]);

const LEGACY_POWERED = new Set([
  "Powered by JustXSystems LLP",
  "Powered by JustXSystems",
  "Powered by JustX",
  "Powered by JustxSystems LLP",
  "Powered by JustX Systems LLP",
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
