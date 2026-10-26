"use client";

import { StockInModule } from "./StockEntry";

/** Default-export wrapper so React.lazy never depends on a re-export interop getter. */
export default function StockInScreen() {
  return <StockInModule />;
}
