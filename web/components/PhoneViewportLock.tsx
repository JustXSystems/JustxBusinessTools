"use client";

import { useEffect } from "react";
import {
  G2M_FORCE_PHONE_CLASS,
  JBT_FORCE_PHONE_CLASS,
  isPhoneLikeDevice,
  phoneCssWidth,
  phoneViewportMetaContent,
} from "@jbt/shared";

function isPhoneDevice(): boolean {
  if (typeof window === "undefined") return false;
  return isPhoneLikeDevice({
    screenWidth: window.screen.width || 0,
    screenHeight: window.screen.height || 0,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    noHover: window.matchMedia("(hover: none)").matches,
  });
}

function currentPhoneCssWidth(): number {
  return phoneCssWidth({
    screenWidth: window.screen.width || 0,
    screenHeight: window.screen.height || 0,
    innerWidth: window.innerWidth,
    visualWidth: window.visualViewport?.width,
    devicePixelRatio: window.devicePixelRatio || 1,
  });
}

function ensureViewportMeta(content: string): void {
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

function clearDocumentZoom(): void {
  const root = document.documentElement;
  const zoomStyle = root.style as CSSStyleDeclaration & { zoom?: string };
  zoomStyle.zoom = "";
  root.style.removeProperty("zoom");
  delete root.dataset.g2mZoom;
}

function applyLock(): void {
  const root = document.documentElement;
  clearDocumentZoom();
  if (!isPhoneDevice()) {
    root.classList.remove(JBT_FORCE_PHONE_CLASS, G2M_FORCE_PHONE_CLASS);
    return;
  }
  root.classList.add(JBT_FORCE_PHONE_CLASS, G2M_FORCE_PHONE_CLASS);
  ensureViewportMeta(phoneViewportMetaContent(currentPhoneCssWidth()));
  root.style.overflowX = "clip";
  document.body.style.overflowX = "clip";
}

/**
 * App-shell phone viewport lock for every JBT route (Chrome + Capacitor).
 * Reinforces the before-paint script in root layout after hydration / rotate.
 */
export function PhoneViewportLock() {
  useEffect(() => {
    applyLock();
    const timers = [50, 250, 800].map((ms) => window.setTimeout(applyLock, ms));
    const onChange = () => applyLock();
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    window.visualViewport?.addEventListener("resize", onChange);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
      window.visualViewport?.removeEventListener("resize", onChange);
    };
  }, []);

  return null;
}
