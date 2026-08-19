"use client";

import { usePoweredByText } from "@/components/config/ConfigProvider";

export function PoweredByFooter() {
  const text = usePoweredByText();

  return (
    <footer className="powered-by-footer no-print" aria-label="Platform branding">
      <span>{text}</span>
    </footer>
  );
}
