"use client";

import { useEffect } from "react";
import { ToastProvider } from "@/components/common/ToastProvider";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { SubscriptionProvider } from "@/components/subscription/SubscriptionProvider";
import { Gmap2MapplsTool } from "@/components/utilities/Gmap2MapplsTool";

/** Full-screen Google Maps to Mappls app (no JBT chrome). IMS skin + dark/light via BosRoot. */
export function PinwayStandalone() {
  // Real mobile browsers shrink-to-fit when document width exceeds the
  // layout viewport (looks like an extreme zoom-out). Keep the shell clipped.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlOverflowX: html.style.overflowX,
      bodyOverflow: body.style.overflow,
      bodyOverflowX: body.style.overflowX,
      bodyWidth: body.style.width,
      bodyMaxWidth: body.style.maxWidth,
    };
    html.style.overflow = "hidden";
    html.style.overflowX = "clip";
    body.style.overflow = "hidden";
    body.style.overflowX = "clip";
    body.style.width = "100%";
    body.style.maxWidth = "100%";

    const meta = document.querySelector('meta[name="viewport"]');
    if (meta && !/width=device-width/i.test(meta.getAttribute("content") || "")) {
      meta.setAttribute(
        "content",
        "width=device-width, initial-scale=1, viewport-fit=cover",
      );
    }

    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.overflowX = prev.htmlOverflowX;
      body.style.overflow = prev.bodyOverflow;
      body.style.overflowX = prev.bodyOverflowX;
      body.style.width = prev.bodyWidth;
      body.style.maxWidth = prev.bodyMaxWidth;
    };
  }, []);

  return (
    <ConfigProvider>
      <ToastProvider>
        <SubscriptionProvider>
          <div className="pinway-standalone-shell">
            <Gmap2MapplsTool variant="standalone" />
          </div>
        </SubscriptionProvider>
      </ToastProvider>
    </ConfigProvider>
  );
}
