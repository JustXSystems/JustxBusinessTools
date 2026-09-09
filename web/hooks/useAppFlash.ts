"use client";

import { useCallback } from "react";
import { flashApp, flashAppError, flashAppOk, flashAppWarn, type AppFlashKind } from "@/lib/app-flash";

/** Convenience hook for pages/components. */
export function useAppFlash() {
  const flash = useCallback((message: string, kind: AppFlashKind = "error") => flashApp(message, kind), []);
  return {
    flash,
    flashError: flashAppError,
    flashWarn: flashAppWarn,
    flashOk: flashAppOk,
  };
}
