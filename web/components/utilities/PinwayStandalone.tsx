"use client";

import { ToastProvider } from "@/components/common/ToastProvider";
import { SubscriptionProvider } from "@/components/subscription/SubscriptionProvider";
import { Gmap2MapplsTool } from "@/components/utilities/Gmap2MapplsTool";

/** Full-screen Pinway app (no JBT chrome). Requires login + trial/subscription. */
export function PinwayStandalone() {
  return (
    <div className="pinway-standalone">
      <ToastProvider>
        <SubscriptionProvider>
          <Gmap2MapplsTool variant="standalone" />
        </SubscriptionProvider>
      </ToastProvider>
    </div>
  );
}
