"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  splashFingerprint,
  SPLASH_SEEN_KEY,
  usePlatformBranding,
  type PlatformBranding,
} from "@/components/branding/BrandingProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";

/** Same shell as SplashMark so boot frames don't flash a different background. */
export function EmptySplash() {
  return <div className="splash-screen splash-boot" role="status" aria-live="polite" />;
}

type SplashMarkProps = {
  branding?: PlatformBranding;
  /** When true, loop ambient motion (admin preview). */
  preview?: boolean;
  className?: string;
};

/**
 * Brand-value cinematic layer. Kept behind / around the logo — never over it.
 * Story: integrate systems → multiply (X) → inspire.
 */
function SplashBrandSignal() {
  return (
    <div className="splash-signal" aria-hidden>
      <span className="splash-signal-ring splash-signal-ring-1" />
      <span className="splash-signal-ring splash-signal-ring-2" />
      <span className="splash-signal-ring splash-signal-ring-3" />
      <span className="splash-signal-x splash-signal-x-a" />
      <span className="splash-signal-x splash-signal-x-b" />
      <span className="splash-signal-chip splash-signal-chip-1">Systems</span>
      <span className="splash-signal-chip splash-signal-chip-2">Integrate</span>
      <span className="splash-signal-chip splash-signal-chip-3">Multiply</span>
      <span className="splash-signal-chip splash-signal-chip-4">Inspire</span>
      <span className="splash-signal-chip splash-signal-chip-5">Any stack</span>
      <span className="splash-signal-chip splash-signal-chip-6">Just like that</span>
    </div>
  );
}

export function SplashMark({ branding, preview = false, className = "" }: SplashMarkProps) {
  const ctx = usePlatformBranding();
  const b = branding ?? ctx.branding;
  const anim = b.splashAnimation || "dash";
  const intensity = b.splashIntensity || "balanced";
  const showProgress = Boolean(b.splashShowProgress);
  const ms = Math.max(0, b.splashDurationMs || 0);
  const isSignal = anim === "signal";

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

      {isSignal ? <SplashBrandSignal /> : null}

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
          {isSignal ? (
            <div className="splash-value-reel" aria-hidden>
              <span className="splash-value splash-value-1">Integrate anything</span>
              <span className="splash-value splash-value-2">Multiply exponentially</span>
              <span className="splash-value splash-value-3">Inspire everyone</span>
            </div>
          ) : null}
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
 * Holds children until branding is ready, then shows splash for splashDurationMs.
 * Keeps one continuous SplashMark mount (no blank→branded→blank flicker).
 */
export function SplashScreen({ children }: { children: ReactNode }) {
  const { branding, loading } = usePlatformBranding();
  const [decision, setDecision] = useState<"hold" | "skip">("hold");
  const fingerprint = splashFingerprint(branding);
  const lockedRef = useRef(false);

  // If this visit already saw this branding, skip before paint when possible.
  useLayoutEffect(() => {
    try {
      if (sessionStorage.getItem(SPLASH_SEEN_KEY) === fingerprint) {
        lockedRef.current = true;
        setDecision("skip");
      }
    } catch {
      /* ignore */
    }
  }, [fingerprint]);

  useEffect(() => {
    if (loading) return;
    if (lockedRef.current) return;

    try {
      if (sessionStorage.getItem(SPLASH_SEEN_KEY) === fingerprint) {
        lockedRef.current = true;
        setDecision("skip");
        return;
      }
    } catch {
      /* ignore */
    }

    let cancelled = false;
    setDecision("hold");

    const duration = Math.max(0, branding.splashDurationMs);
    const seenKey = fingerprint;
    const markSeen = () => {
      try {
        sessionStorage.setItem(SPLASH_SEEN_KEY, seenKey);
      } catch {
        /* ignore */
      }
    };

    if (duration <= 0) {
      markSeen();
      lockedRef.current = true;
      setDecision("skip");
      return;
    }

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      markSeen();
      lockedRef.current = true;
      setDecision("skip");
    }, duration);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Don't depend on fingerprint — settling branding must not remount/restart splash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, branding.splashDurationMs]);

  if (decision === "skip") return <>{children}</>;

  // Always paint the branded splash (even while branding is still resolving) so
  // we never flash EmptySplash → SplashMark → remount.
  return <SplashMark branding={branding} />;
}
