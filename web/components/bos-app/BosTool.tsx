"use client";

import { BosApp } from "./BosApp";

/** "Justx BOS" JBT tool (`/tools/bos`). The same app also runs full-screen at `/bos`. */
export default function BosTool() {
  return <BosApp mode="tool" />;
}
