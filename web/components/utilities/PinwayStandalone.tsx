"use client";

import { ToastProvider } from "@/components/common/ToastProvider";
import { SubscriptionProvider } from "@/components/subscription/SubscriptionProvider";
import { Gmap2MapplsTool } from "@/components/utilities/Gmap2MapplsTool";

/** Full-screen Pinway app (no JBT chrome). IMS skin + dark/light live inside the tool via BosRoot. */
export function PinwayStandalone() {
  return (
    <ToastProvider>
      <SubscriptionProvider>
        <Gmap2MapplsTool variant="standalone" />
      </SubscriptionProvider>
    </ToastProvider>
  );
}
