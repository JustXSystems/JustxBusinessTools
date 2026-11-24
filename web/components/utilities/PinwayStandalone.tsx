"use client";

import { Gmap2MapplsTool } from "@/components/utilities/Gmap2MapplsTool";

/** Full-screen Pinway app (no JBT chrome). Same engine as /tools/gmap2mappls. */
export function PinwayStandalone() {
  return (
    <div className="pinway-standalone">
      <Gmap2MapplsTool variant="standalone" />
    </div>
  );
}
