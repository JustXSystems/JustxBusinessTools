"use client";

import { ToastProvider } from "@/components/common/ToastProvider";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { SubscriptionProvider } from "@/components/subscription/SubscriptionProvider";
import { Gmap2MapplsTool } from "@/components/utilities/Gmap2MapplsTool";

/** Full-screen Google Maps to Mappls app (no JBT chrome). IMS skin + dark/light via BosRoot. */
export function PinwayStandalone() {
  return (
    <ConfigProvider>
      <ToastProvider>
        <SubscriptionProvider>
          <Gmap2MapplsTool variant="standalone" />
        </SubscriptionProvider>
      </ToastProvider>
    </ConfigProvider>
  );
}
