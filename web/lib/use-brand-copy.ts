"use client";

import { BRAND_DEFAULTS } from "@jbt/shared";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";

/**
 * Runtime brand copy from Admin → Experience → Branding (single source of truth).
 */
export function useBrandCopy() {
  const { branding, poweredBy } = usePlatformBranding();
  return {
    appName: branding.appName || BRAND_DEFAULTS.appName,
    legalName: branding.legalName || BRAND_DEFAULTS.legalName,
    productName: branding.productName || BRAND_DEFAULTS.productName,
    tagline: branding.tagline || BRAND_DEFAULTS.tagline,
    poweredBy: poweredBy.text || BRAND_DEFAULTS.poweredBy,
  };
}
