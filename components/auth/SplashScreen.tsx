"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  fetchPlatformBrandPayload,
  splashFingerprint,
  SPLASH_SEEN_KEY,
  usePlatformBranding,
  type PlatformBranding,
} from "@/components/branding/BrandingProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";

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

export function SplashScreen({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  const [branding, setBranding] = useState<PlatformBranding | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    (async () => {
      const payload = await fetchPlatformBrandPayload(true);
      if (cancelled) return;
      const b = payload.branding;
      const fingerprint = splashFingerprint(b);

      try {
        if (sessionStorage.getItem(SPLASH_SEEN_KEY) === fingerprint) {
          setVisible(false);
          return;
        }
      } catch {
        /* ignore */
      }

      setBranding(b);

      const ms = b.splashDurationMs;
      if (ms <= 0) {
        try {
          sessionStorage.setItem(SPLASH_SEEN_KEY, fingerprint);
        } catch {
          /* ignore */
        }
        setVisible(false);
        return;
      }

      timer = window.setTimeout(() => {
        try {
          sessionStorage.setItem(SPLASH_SEEN_KEY, fingerprint);
        } catch {
          /* ignore */
        }
        if (!cancelled) setVisible(false);
      }, ms);
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!visible) return <>{children}</>;
  if (!branding) {
    return <div className="splash-screen" role="status" aria-live="polite" />;
  }
  return <SplashMark branding={branding} />;
}
