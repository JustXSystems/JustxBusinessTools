"use client";

import { useEffect } from "react";
import {
  isPhoneLikeDevice,
  phoneCssWidth,
  phoneViewportMetaContent,
} from "@jbt/shared";
import { ToastProvider } from "@/components/common/ToastProvider";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { SubscriptionProvider } from "@/components/subscription/SubscriptionProvider";
import { Gmap2MapplsTool } from "@/components/utilities/Gmap2MapplsTool";

const PHONE_CLASS = "g2m-force-phone";

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

function ensureViewportMeta(content: string): HTMLMetaElement {
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
  return meta as HTMLMetaElement;
}

/** Clear leftover document zoom from older Pinway builds. */
function clearDocumentZoom(): void {
  const root = document.documentElement;
  const zoomStyle = root.style as CSSStyleDeclaration & { zoom?: string };
  zoomStyle.zoom = "";
  root.style.removeProperty("zoom");
  delete root.dataset.g2mZoom;
}

/**
 * Phone shell: lock viewport meta to real CSS width, allow page scroll.
 * No document zoom, no locked 100dvh flex dock (those caused the dead middle).
 */
function applyPhoneShell(): () => void {
  const html = document.documentElement;
  const body = document.body;
  const phone = isPhoneDevice();

  if (phone) html.classList.add(PHONE_CLASS);
  clearDocumentZoom();

  const prev = {
    htmlOverflowX: html.style.overflowX,
    bodyOverflowX: body.style.overflowX,
    bodyWidth: body.style.width,
    bodyMaxWidth: body.style.maxWidth,
  };

  html.style.overflowX = "clip";
  body.style.overflowX = "clip";
  body.style.width = "100%";
  body.style.maxWidth = "100%";
  // Let the page scroll — do not lock html/body overflow:hidden
  html.style.removeProperty("overflow");
  body.style.removeProperty("overflow");

  const metaContent = phone
    ? phoneViewportMetaContent(currentPhoneCssWidth())
    : "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content";
  const meta = ensureViewportMeta(metaContent);
  const prevViewport = meta.getAttribute("content");

  const onResize = () => {
    clearDocumentZoom();
    if (isPhoneDevice()) {
      document.documentElement.classList.add(PHONE_CLASS);
      ensureViewportMeta(phoneViewportMetaContent(currentPhoneCssWidth()));
    }
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  return () => {
    html.classList.remove(PHONE_CLASS);
    html.style.overflowX = prev.htmlOverflowX;
    body.style.overflowX = prev.bodyOverflowX;
    body.style.width = prev.bodyWidth;
    body.style.maxWidth = prev.bodyMaxWidth;
    clearDocumentZoom();
    if (prevViewport != null) meta.setAttribute("content", prevViewport);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    html.style.removeProperty("--g2m-vvh");
    html.style.removeProperty("--g2m-vv-offset");
  };
}

/** Full-screen Google Maps to Mappls app (no JBT chrome). IMS skin + dark/light via BosRoot. */
export function PinwayStandalone() {
  useEffect(() => {
    const cleanup = applyPhoneShell();
    const timers = [50, 250, 800].map((ms) =>
      window.setTimeout(() => {
        clearDocumentZoom();
        if (isPhoneDevice()) {
          document.documentElement.classList.add(PHONE_CLASS);
          ensureViewportMeta(phoneViewportMetaContent(currentPhoneCssWidth()));
        }
      }, ms),
    );
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cleanup();
    };
  }, []);

  return (
    <ConfigProvider>
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
