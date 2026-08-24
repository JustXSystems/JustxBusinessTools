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
  appName: "JustXSystems",
  tagline: "JustXSystems",
  splashDurationMs: 1800,
};

export const DEFAULT_POWERED_BY: PoweredByConfig = {
  text: "Powered by JustXSystems LLP",
  locked: true,
};

export const SPLASH_SEEN_KEY = "jbt.splash.seen";
export const BRANDING_STORAGE_KEY = "jbt.branding.payload";

export function splashFingerprint(b: PlatformBranding): string {
  return [b.logoUrl, b.appName, b.tagline, String(b.splashDurationMs)].join("\u0001");
}

type BrandingContextValue = {
  branding: PlatformBranding;
  poweredBy: PoweredByConfig;
  /** True until the first network branding response (or stored fallback) is applied. */
  loading: boolean;
  refresh: () => Promise<void>;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

type CachedPayload = { branding: PlatformBranding; poweredBy: PoweredByConfig };

let cached: CachedPayload | null = null;
let inflight: Promise<CachedPayload> | null = null;
/** True after this tab has applied a branding payload (network or storage fallback). */
let confirmed = false;

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

function readStoredPayload(): CachedPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
    if (!raw) return null;
    return normalizePayload(JSON.parse(raw) as {
      branding?: Partial<PlatformBranding>;
      poweredBy?: Partial<PoweredByConfig>;
    });
  } catch {
    return null;
  }
}

function writeStoredPayload(payload: CachedPayload): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function applyPayload(payload: CachedPayload, fromNetwork: boolean): CachedPayload {
  cached = payload;
  confirmed = true;
  if (fromNetwork) writeStoredPayload(payload);
  return payload;
}

export async function fetchPlatformBranding(force = false): Promise<PlatformBranding> {
  const payload = await fetchPlatformBrandPayload(force);
  return payload.branding;
}

export async function fetchPlatformBrandPayload(force = false): Promise<CachedPayload> {
  if (!force && cached && confirmed) return cached;
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
    return applyPayload(normalizePayload(data), true);
  })();

  if (!force) {
    inflight = run.finally(() => {
      inflight = null;
    });
    try {
      return await inflight;
    } catch {
      const stored = readStoredPayload();
      if (stored) return applyPayload(stored, false);
      return applyPayload(
        {
          branding: { ...DEFAULT_BRANDING },
          poweredBy: { ...DEFAULT_POWERED_BY },
        },
        false,
      );
    }
  }

  try {
    return await run;
  } catch {
    if (cached) return cached;
    const stored = readStoredPayload();
    if (stored) return applyPayload(stored, false);
    return applyPayload(
      {
        branding: { ...DEFAULT_BRANDING },
        poweredBy: { ...DEFAULT_POWERED_BY },
      },
      false,
    );
  }
}

export function invalidateBrandingCache(): void {
  cached = null;
  confirmed = false;
  try {
    sessionStorage.removeItem(SPLASH_SEEN_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(BRANDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  // Never paint DEFAULT on first frame — stay in loading until network/storage confirms.
  const [branding, setBranding] = useState<PlatformBranding>(DEFAULT_BRANDING);
  const [poweredBy, setPoweredBy] = useState<PoweredByConfig>(DEFAULT_POWERED_BY);
  const [loading, setLoading] = useState(true);

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
    loading: !confirmed,
    refresh: async () => {
      await fetchPlatformBrandPayload(true);
    },
  };
}
