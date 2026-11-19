"use client";

import { useEffect, useState } from "react";
import { usePoweredByText, useClockDisplaySettings } from "@/components/config/ConfigProvider";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import {
  CLOCK_DISPLAY_TZ_LABEL,
  clockDisplayNeedsSeconds,
  getClockChromeParts,
} from "@/lib/clock-display";

type Props = {
  /** Fixed slim bar for app chrome (operator/admin). Default for auth pages. */
  variant?: "bar" | "inline";
  /**
   * Hide the bar until the pointer is near the viewport bottom or the
   * page/scroll container is scrolled to the end (admin desktop chrome).
   */
  autoHide?: boolean;
};

const BOTTOM_EDGE_PX = 36;
const SCROLL_BOTTOM_PX = 8;

function useAutohideBottomBar(enabled: boolean) {
  const [nearBottom, setNearBottom] = useState(false);
  const [atScrollBottom, setAtScrollBottom] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const scrollRoot = (): Element =>
      document.querySelector(".bos.admin-bos .bos-shell-main") ??
      document.scrollingElement ??
      document.documentElement;

    const syncScroll = () => {
      const el = scrollRoot();
      const scrollTop = "scrollTop" in el ? el.scrollTop : window.scrollY;
      const clientHeight = "clientHeight" in el ? el.clientHeight : window.innerHeight;
      const scrollHeight = "scrollHeight" in el ? el.scrollHeight : document.documentElement.scrollHeight;
      const overflow = scrollHeight > clientHeight + 1;
      setAtScrollBottom(overflow && scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_PX);
    };

    const onMove = (e: MouseEvent) => {
      setNearBottom(window.innerHeight - e.clientY <= BOTTOM_EDGE_PX);
    };

    const onLeaveWindow = () => setNearBottom(false);

    syncScroll();
    const scroller = scrollRoot();
    scroller.addEventListener("scroll", syncScroll, { passive: true });
    window.addEventListener("resize", syncScroll, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeaveWindow);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncScroll())
        : null;
    ro?.observe(scroller instanceof Element ? scroller : document.documentElement);
    if (scroller !== document.documentElement) {
      ro?.observe(document.documentElement);
    }

    return () => {
      scroller.removeEventListener("scroll", syncScroll);
      window.removeEventListener("resize", syncScroll);
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeaveWindow);
      ro?.disconnect();
    };
  }, [enabled]);

  return !enabled || nearBottom || atScrollBottom;
}

export function PoweredByFooter({ variant = "inline", autoHide = false }: Props) {
  const fromConfig = usePoweredByText();
  const { poweredBy } = usePlatformBranding();
  const text = poweredBy?.text || fromConfig;
  const clock = useClockDisplaySettings();
  const showClock = variant === "bar" && clock.visible;
  const [now, setNow] = useState(() => new Date());
  const revealed = useAutohideBottomBar(autoHide && variant === "bar");

  useEffect(() => {
    if (!showClock) return;
    const ms = clockDisplayNeedsSeconds(clock.format) ? 1000 : 30_000;
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [showClock, clock.format]);

  const parts = showClock ? getClockChromeParts(now, clock.format) : null;
  const autohideClass =
    autoHide && variant === "bar"
      ? ` is-autohide${revealed ? " is-revealed" : ""}`
      : "";

  return (
    <footer
      className={`powered-by-footer powered-by-footer--${variant}${showClock ? " has-clock" : ""}${autohideClass} no-print`}
      aria-label="Platform status"
      aria-hidden={autoHide && variant === "bar" && !revealed ? true : undefined}
    >
      {parts ? (
        <div className="powered-by-footer-start">
          <time
            className={`status-clock powered-by-footer-clock${parts.live ? " is-live" : ""}`}
            dateTime={now.toISOString()}
            title={`India Standard Time (${CLOCK_DISPLAY_TZ_LABEL})`}
          >
            {parts.live ? <span className="status-clock-pulse" aria-hidden /> : null}
            {parts.weekday ? <span className="status-clock-weekday">{parts.weekday}</span> : null}
            {parts.weekday && (parts.dateLine || parts.timeLine) ? (
              <span className="status-clock-sep" aria-hidden />
            ) : null}
            {parts.dateLine ? <span className="status-clock-date">{parts.dateLine}</span> : null}
            {parts.dateLine && parts.timeLine ? <span className="status-clock-sep" aria-hidden /> : null}
            {parts.timeLine ? <span className="status-clock-time">{parts.timeLine}</span> : null}
            {!parts.dateLine && !parts.timeLine ? (
              <span className="status-clock-time">{parts.stamp}</span>
            ) : null}
            {parts.showTzChip ? (
              <span className="status-clock-tz">{CLOCK_DISPLAY_TZ_LABEL}</span>
            ) : null}
            <span className="sr-only">{parts.stamp}</span>
          </time>
        </div>
      ) : null}

      <div className="powered-by-footer-end">
        {showClock ? <span className="powered-by-footer-divider" aria-hidden /> : null}
        <span className="powered-by-footer-text">{text}</span>
      </div>
    </footer>
  );
}
