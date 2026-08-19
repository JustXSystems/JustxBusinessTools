"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics";

export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/tools/")) {
      const toolId = pathname.split("/")[2];
      if (toolId) trackEvent("tool.open", { toolId });
    }
  }, [pathname]);

  return null;
}
