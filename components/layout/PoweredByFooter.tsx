"use client";

import { usePoweredByText } from "@/components/config/ConfigProvider";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";

export function PoweredByFooter() {
  const fromConfig = usePoweredByText();
  const { poweredBy } = usePlatformBranding();
  // Prefer live branding (works on login without ConfigProvider); fall back to effective config.
  const text = poweredBy?.text || fromConfig;

  return (
    <footer className="powered-by-footer no-print" aria-label="Platform branding">
      <span>{text}</span>
    </footer>
  );
}
