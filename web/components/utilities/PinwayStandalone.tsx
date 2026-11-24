"use client";

import { useEffect } from "react";
import { ToastProvider } from "@/components/common/ToastProvider";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { SubscriptionProvider } from "@/components/subscription/SubscriptionProvider";
import { Gmap2MapplsTool } from "@/components/utilities/Gmap2MapplsTool";

const PHONE_CLASS = "g2m-force-phone";
const VIEWPORT =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

function isPhoneDevice(): boolean {
  if (typeof window === "undefined") return false;
  const sw = Math.min(window.screen.width || 0, window.screen.height || 0);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  // screen.* stays ~360–430 on phones even when layout width wrongly reports ~980.
  return (coarse && noHover) || (sw > 0 && sw <= 900);
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
  };

  html.style.overflow = "hidden";
  html.style.overflowX = "clip";
  body.style.overflow = "hidden";
  body.style.overflowX = "clip";
  body.style.width = "100%";
  body.style.maxWidth = "100%";

  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    document.head.appendChild(meta);
  }
  const prevViewport = meta.getAttribute("content");
  meta.setAttribute("content", VIEWPORT);

  return () => {
    html.classList.remove(PHONE_CLASS);
    html.style.overflow = prev.htmlOverflow;
    html.style.overflowX = prev.htmlOverflowX;
    body.style.overflow = prev.bodyOverflow;
    body.style.overflowX = prev.bodyOverflowX;
    body.style.width = prev.bodyWidth;
    body.style.maxWidth = prev.bodyMaxWidth;
    if (prevViewport != null) meta?.setAttribute("content", prevViewport);
  };
}

/** Full-screen Google Maps to Mappls app (no JBT chrome). IMS skin + dark/light via BosRoot. */
export function PinwayStandalone() {
  useEffect(() => {
    const cleanup = applyPhoneShell();
    // Re-apply after paint — Android sometimes restores a wide layout viewport.
    const t = window.setTimeout(() => {
      applyPhoneShell();
    }, 50);
    return () => {
      window.clearTimeout(t);
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
