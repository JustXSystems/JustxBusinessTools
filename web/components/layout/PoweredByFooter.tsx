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
};

export function PoweredByFooter({ variant = "inline" }: Props) {
  const fromConfig = usePoweredByText();
  const { poweredBy } = usePlatformBranding();
  const text = poweredBy?.text || fromConfig;
  const clock = useClockDisplaySettings();
  const showClock = variant === "bar" && clock.visible;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!showClock) return;
    const ms = clockDisplayNeedsSeconds(clock.format) ? 1000 : 30_000;
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [showClock, clock.format]);

  const parts = showClock ? getClockChromeParts(now, clock.format) : null;

  return (
    <footer
      className={`powered-by-footer powered-by-footer--${variant}${showClock ? " has-clock" : ""} no-print`}
      aria-label="Platform status"
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
