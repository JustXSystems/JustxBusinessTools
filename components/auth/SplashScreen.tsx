"use client";

import { useEffect, useState, type ReactNode } from "react";
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

export function SplashMark({ branding }: { branding?: PlatformBranding }) {
  const ctx = usePlatformBranding();
  const b = branding ?? ctx.branding;

  return (
    <div className="splash-screen" role="status" aria-live="polite">
      <div className="splash-mark">
        <PlatformBrandMark
          size="xl"
          layout="stack"
          logoUrl={b.logoUrl}
          appName={b.appName}
          tagline={b.tagline}
        />
      </div>
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

    const ms = branding.splashDurationMs;
    if (ms <= 0) {
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
    }, ms);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [loading, fingerprint, branding.splashDurationMs]);

  if (loading || decision === "pending") return <EmptySplash />;
  if (decision === "skip") return <>{children}</>;
  return <SplashMark branding={branding} />;
}
