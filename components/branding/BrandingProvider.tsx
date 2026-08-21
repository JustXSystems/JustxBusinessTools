"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiUrl } from "@/lib/api-base";

export type PlatformBranding = {
  logoUrl: string;
  appName: string;
  tagline: string;
  splashDurationMs: number;
};

export type PoweredByConfig = {
  text: string;
  locked: boolean;
};

export const DEFAULT_BRANDING: PlatformBranding = {
  logoUrl: "/icons/jbt-icon.svg",
  appName: "JustX Business Tools",
  tagline: "JustX Systems",
  splashDurationMs: 1800,
};

export const DEFAULT_POWERED_BY: PoweredByConfig = {
  text: "Powered by JustX Systems LLP",
  locked: true,
};

export const SPLASH_SEEN_KEY = "jbt.splash.seen";

export function splashFingerprint(b: PlatformBranding): string {
  return [b.logoUrl, b.appName, b.tagline, String(b.splashDurationMs)].join("\u0001");
}

type BrandingContextValue = {
  branding: PlatformBranding;
  poweredBy: PoweredByConfig;
  loading: boolean;
  refresh: () => Promise<void>;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

type CachedPayload = { branding: PlatformBranding; poweredBy: PoweredByConfig };

let cached: CachedPayload | null = null;
let inflight: Promise<CachedPayload> | null = null;

function normalizePayload(data: {
  branding?: Partial<PlatformBranding>;
  poweredBy?: Partial<PoweredByConfig>;
}): CachedPayload {
  const b = data.branding ?? {};
  const p = data.poweredBy ?? {};
  return {
    branding: {
      logoUrl: String(b.logoUrl || DEFAULT_BRANDING.logoUrl),
      appName: String(b.appName || DEFAULT_BRANDING.appName),
      tagline: String(b.tagline || DEFAULT_BRANDING.tagline),
      splashDurationMs: Number.isFinite(Number(b.splashDurationMs))
        ? Math.max(0, Math.round(Number(b.splashDurationMs)))
        : DEFAULT_BRANDING.splashDurationMs,
    },
    poweredBy: {
      text: String(p.text || DEFAULT_POWERED_BY.text),
      locked: p.locked == null ? true : Boolean(p.locked),
    },
  };
}

export async function fetchPlatformBranding(force = false): Promise<PlatformBranding> {
  const payload = await fetchPlatformBrandPayload(force);
  return payload.branding;
}

export async function fetchPlatformBrandPayload(force = false): Promise<CachedPayload> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;

  const run = (async () => {
    const res = await fetch(apiUrl(`/api/config/branding?t=${Date.now()}`), {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) throw new Error("branding fetch failed");
    const data = (await res.json()) as {
      branding?: Partial<PlatformBranding>;
      poweredBy?: Partial<PoweredByConfig>;
    };
    cached = normalizePayload(data);
    return cached;
  })();

  if (!force) {
    inflight = run.finally(() => {
      inflight = null;
    });
    try {
      return await inflight;
    } catch {
      // Do not cache failures — next call retries against the API.
      return {
        branding: { ...DEFAULT_BRANDING },
        poweredBy: { ...DEFAULT_POWERED_BY },
      };
    }
  }

  try {
    return await run;
  } catch {
    return {
      branding: cached?.branding ?? { ...DEFAULT_BRANDING },
      poweredBy: cached?.poweredBy ?? { ...DEFAULT_POWERED_BY },
    };
  }
}

export function invalidateBrandingCache(): void {
  cached = null;
  try {
    sessionStorage.removeItem(SPLASH_SEEN_KEY);
  } catch {
    /* ignore */
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<PlatformBranding>(
    cached?.branding ?? DEFAULT_BRANDING,
  );
  const [poweredBy, setPoweredBy] = useState<PoweredByConfig>(
    cached?.poweredBy ?? DEFAULT_POWERED_BY,
  );
  const [loading, setLoading] = useState(!cached);

  const refresh = useCallback(async () => {
    invalidateBrandingCache();
    const next = await fetchPlatformBrandPayload(true);
    setBranding(next.branding);
    setPoweredBy(next.poweredBy);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPlatformBrandPayload(true).then((next) => {
      if (!cancelled) {
        setBranding(next.branding);
        setPoweredBy(next.poweredBy);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ branding, poweredBy, loading, refresh }),
    [branding, poweredBy, loading, refresh],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function usePlatformBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (ctx) return ctx;
  return {
    branding: cached?.branding ?? DEFAULT_BRANDING,
    poweredBy: cached?.poweredBy ?? DEFAULT_POWERED_BY,
    loading: !cached,
    refresh: async () => {
      await fetchPlatformBrandPayload(true);
    },
  };
}
