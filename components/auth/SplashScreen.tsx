"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  splashFingerprint,
  SPLASH_SEEN_KEY,
  usePlatformBranding,
  type PlatformBranding,
} from "@/components/branding/BrandingProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";

export function EmptySplash() {
  return <div className="splash-screen" role="status" aria-live="polite" />;
}

type SplashMarkProps = {
  branding?: PlatformBranding;
  /** When true, loop ambient motion (admin preview). */
  preview?: boolean;
  className?: string;
};

export function SplashMark({ branding, preview = false, className = "" }: SplashMarkProps) {
  const ctx = usePlatformBranding();
  const b = branding ?? ctx.branding;
  const anim = b.splashAnimation || "dash";
  const intensity = b.splashIntensity || "balanced";
  const showProgress = Boolean(b.splashShowProgress);
  const ms = Math.max(0, b.splashDurationMs || 0);

  const style = {
    "--splash-ms": `${Math.max(ms, 600)}ms`,
  } as CSSProperties;

  return (
    <div
      className={[
        "splash-screen",
        `splash-anim-${anim}`,
        `splash-intensity-${intensity}`,
        preview ? "splash-preview" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      style={style}
    >
      <div className="splash-atmosphere" aria-hidden>
        <span className="splash-vignette" />
        <span className="splash-aurora" />
        <span className="splash-beam" />
        <span className="splash-scan" />
        <span className="splash-orb splash-orb-a" />
        <span className="splash-orb splash-orb-b" />
        <span className="splash-orb splash-orb-c" />
        <span className="splash-grid" />
        <span className="splash-streak splash-streak-1" />
        <span className="splash-streak splash-streak-2" />
        <span className="splash-streak splash-streak-3" />
        <span className="splash-spark splash-spark-1" />
        <span className="splash-spark splash-spark-2" />
        <span className="splash-spark splash-spark-3" />
        <span className="splash-spark splash-spark-4" />
        <span className="splash-spark splash-spark-5" />
        <span className="splash-spark splash-spark-6" />
        <span className="splash-spark splash-spark-7" />
        <span className="splash-spark splash-spark-8" />
      </div>

      <div className="splash-mark">
        <div className="splash-logo-stage">
          <span className="splash-halo" aria-hidden />
          <span className="splash-burst" aria-hidden />
          <span className="splash-ring splash-ring-outer" aria-hidden />
          <span className="splash-ring splash-ring-mid" aria-hidden />
          <span className="splash-ring splash-ring-inner" aria-hidden />
          <span className="splash-tick splash-tick-n" aria-hidden />
          <span className="splash-tick splash-tick-e" aria-hidden />
          <span className="splash-tick splash-tick-s" aria-hidden />
          <span className="splash-tick splash-tick-w" aria-hidden />
          <div className="splash-logo-core">
            <PlatformBrandMark
              size="xl"
              layout="stack"
              showText={false}
              logoUrl={b.logoUrl}
              appName={b.appName}
              tagline={b.tagline}
            />
          </div>
        </div>
        <div className="splash-copy">
          <span className="splash-name">{b.appName}</span>
          <span className="splash-underline" aria-hidden />
          {b.tagline ? <span className="splash-tagline">{b.tagline}</span> : null}
        </div>
      </div>

      {showProgress && ms > 0 ? (
        <div className="splash-progress" aria-hidden>
          <span className="splash-progress-glow" />
          <span className="splash-progress-bar" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Holds children until platform branding is confirmed from the network,
 * then optionally shows the splash mark for splashDurationMs.
 * Never paints DEFAULT branding — blank splash until ready.
 */
export function SplashScreen({ children }: { children: ReactNode }) {
  const { branding, loading } = usePlatformBranding();
  const [decision, setDecision] = useState<"pending" | "show" | "skip">("pending");
  const fingerprint = splashFingerprint(branding);

  useEffect(() => {
    if (loading) {
      setDecision("pending");
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    try {
      if (sessionStorage.getItem(SPLASH_SEEN_KEY) === fingerprint) {
        setDecision("skip");
        return;
      }
    } catch {
      /* ignore */
    }

    setDecision("show");

    const duration = branding.splashDurationMs;
    if (duration <= 0) {
      try {
        sessionStorage.setItem(SPLASH_SEEN_KEY, fingerprint);
      } catch {
        /* ignore */
      }
      setDecision("skip");
      return;
    }

    timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(SPLASH_SEEN_KEY, fingerprint);
      } catch {
        /* ignore */
      }
      if (!cancelled) setDecision("skip");
    }, duration);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [loading, fingerprint, branding.splashDurationMs]);

  if (loading || decision === "pending") return <EmptySplash />;
  if (decision === "skip") return <>{children}</>;
  return <SplashMark branding={branding} />;
}
