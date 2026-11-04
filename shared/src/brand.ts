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
]);

export function coerceBrandAppName(
  raw: unknown,
  fallback: string = BRAND_DEFAULTS.appName,
): string {
  const s = String(raw ?? "").trim();
  if (!s || LEGACY_APP.has(s)) return fallback;
  return s;
}

export function coerceBrandLegalName(
  raw: unknown,
  fallback: string = BRAND_DEFAULTS.legalName,
): string {
  const s = String(raw ?? "").trim();
  if (!s || LEGACY_LEGAL.has(s) || LEGACY_APP.has(s)) return fallback;
  return s;
}

export function coerceBrandProductName(
  raw: unknown,
  fallback: string = BRAND_DEFAULTS.productName,
): string {
  const s = String(raw ?? "").trim();
  if (!s || LEGACY_PRODUCT.has(s)) return fallback;
  return s;
}

export function coerceBrandPoweredBy(
  raw: unknown,
  fallback: string = BRAND_DEFAULTS.poweredBy,
): string {
  const s = String(raw ?? "").trim();
  if (!s || LEGACY_POWERED.has(s)) return fallback;
  return s;
}

export function brandCopyright(legalName: string = BRAND_DEFAULTS.legalName): string {
  return `© ${legalName}. All rights reserved.`;
}
