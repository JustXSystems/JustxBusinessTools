"use client";

import { usePoweredByText } from "@/components/config/ConfigProvider";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";

type Props = {
  /** Fixed slim bar for app chrome (operator/admin). Default for auth pages. */
  variant?: "bar" | "inline";
};

export function PoweredByFooter({ variant = "inline" }: Props) {
  const fromConfig = usePoweredByText();
  const { poweredBy } = usePlatformBranding();
  const text = poweredBy?.text || fromConfig;

  return (
    <footer
      className={`powered-by-footer powered-by-footer--${variant} no-print`}
      aria-label="Platform branding"
    >
      <span className="powered-by-footer-text">{text}</span>
    </footer>
  );
}
