"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

export function CapacitorInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    document.body.classList.add("capacitor-native");

    async function initNative() {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: "#0a0b0f" });
      } catch {
        /* StatusBar plugin optional */
      }

      try {
        const { App } = await import("@capacitor/app");
        await App.addListener("backButton", () => {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            App.minimizeApp();
          }
        });
      } catch {
        /* App plugin optional */
      }
    }

    initNative();
  }, []);

  return null;
}

/** Request camera permission on native before getUserMedia (QR scan). */
export async function ensureNativeCameraPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const { Camera } = await import("@capacitor/camera");
    const result = await Camera.requestPermissions({ permissions: ["camera"] });
    return result.camera === "granted" || result.camera === "limited";
  } catch {
    return true;
  }
}
