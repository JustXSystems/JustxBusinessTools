"use client";

import { useEffect } from "react";
import {
  isPhoneLikeDevice,
  phoneCssWidth,
  phoneViewportMetaContent,
  shrinkToFitZoom,
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
  });
}

/** Keep the app shell inside the visible viewport when the soft keyboard opens. */
function syncVisualViewport(): void {
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) {
    root.style.setProperty("--g2m-vvh", `${window.innerHeight}px`);
    root.style.setProperty("--g2m-vv-offset", "0px");
    return;
  }
  root.style.setProperty("--g2m-vvh", `${Math.round(vv.height)}px`);
  root.style.setProperty("--g2m-vv-offset", `${Math.round(vv.offsetTop)}px`);
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

/**
 * If layout CSS width is still much wider than the phone screen, force a
 * corrective zoom so 16px text is actually readable (Chrome/Android WebView).
 */
function correctShrinkToFit(): void {
  const root = document.documentElement;
  const target = currentPhoneCssWidth();
  const layoutW = root.clientWidth || window.innerWidth || target;
  const zoom = shrinkToFitZoom(layoutW, target);
  if (zoom < 1) {
    (root.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(zoom);
    root.dataset.g2mZoom = String(zoom);
  } else {
    (root.style as CSSStyleDeclaration & { zoom?: string }).zoom = "";
    root.style.removeProperty("zoom");
    delete root.dataset.g2mZoom;
  }
}

function applyPhoneShell(): () => void {
  const html = document.documentElement;
  const body = document.body;
  const phone = isPhoneDevice();

  if (phone) html.classList.add(PHONE_CLASS);

  const prev = {
    htmlOverflow: html.style.overflow,
    htmlOverflowX: html.style.overflowX,
    bodyOverflow: body.style.overflow,
    bodyOverflowX: body.style.overflowX,
    bodyWidth: body.style.width,
    bodyMaxWidth: body.style.maxWidth,
    htmlZoom: (html.style as CSSStyleDeclaration & { zoom?: string }).zoom || "",
  };

  html.style.overflow = "hidden";
  html.style.overflowX = "clip";
  body.style.overflow = "hidden";
  body.style.overflowX = "clip";
  body.style.width = "100%";
  body.style.maxWidth = "100%";

  const metaContent = phone
    ? phoneViewportMetaContent(currentPhoneCssWidth())
    : "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content";
  const meta = ensureViewportMeta(metaContent);
  const prevViewport = meta.getAttribute("content");

  syncVisualViewport();
  if (phone) correctShrinkToFit();

  const onVv = () => {
    syncVisualViewport();
    if (isPhoneDevice()) {
      ensureViewportMeta(phoneViewportMetaContent(currentPhoneCssWidth()));
      correctShrinkToFit();
    }
  };
  window.visualViewport?.addEventListener("resize", onVv);
  window.visualViewport?.addEventListener("scroll", onVv);
  window.addEventListener("resize", onVv);
  window.addEventListener("orientationchange", onVv);

  return () => {
    html.classList.remove(PHONE_CLASS);
    html.style.overflow = prev.htmlOverflow;
    html.style.overflowX = prev.htmlOverflowX;
    body.style.overflow = prev.bodyOverflow;
    body.style.overflowX = prev.bodyOverflowX;
    body.style.width = prev.bodyWidth;
    body.style.maxWidth = prev.bodyMaxWidth;
    const zoomStyle = html.style as CSSStyleDeclaration & { zoom?: string };
    if (prev.htmlZoom) zoomStyle.zoom = prev.htmlZoom;
    else {
      zoomStyle.zoom = "";
      html.style.removeProperty("zoom");
    }
    delete html.dataset.g2mZoom;
    if (prevViewport != null) meta.setAttribute("content", prevViewport);
    window.visualViewport?.removeEventListener("resize", onVv);
    window.visualViewport?.removeEventListener("scroll", onVv);
    window.removeEventListener("resize", onVv);
    window.removeEventListener("orientationchange", onVv);
    html.style.removeProperty("--g2m-vvh");
    html.style.removeProperty("--g2m-vv-offset");
  };
}

/** Full-screen Google Maps to Mappls app (no JBT chrome). IMS skin + dark/light via BosRoot. */
export function PinwayStandalone() {
  useEffect(() => {
    const cleanup = applyPhoneShell();
    // Re-lock after paint — Android WebView often restores a wide layout viewport.
    const timers = [50, 250, 800].map((ms) =>
      window.setTimeout(() => {
        if (isPhoneDevice()) {
          document.documentElement.classList.add(PHONE_CLASS);
          ensureViewportMeta(phoneViewportMetaContent(currentPhoneCssWidth()));
          correctShrinkToFit();
        }
        syncVisualViewport();
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
