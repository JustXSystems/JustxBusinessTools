"use client";

import { ToastProvider } from "@/components/common/ToastProvider";
import { useDynamicToolFavicon } from "@/components/common/ToolIconMark";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { SubscriptionProvider } from "@/components/subscription/SubscriptionProvider";
import { Gmap2MapplsTool } from "@/components/utilities/Gmap2MapplsTool";

function PinwayFaviconSync() {
  useDynamicToolFavicon("gmap2mappls", "/icons/Google2MapplsMap/favicon.ico");
  return null;
}

/**
 * Full-screen Google Maps → Mappls app (no JBT chrome).
 * Phone viewport lock is owned by root layout + PhoneViewportLock (ClientInit).
 */
export function PinwayStandalone() {
  return (
    <ConfigProvider>
      <PinwayFaviconSync />
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
