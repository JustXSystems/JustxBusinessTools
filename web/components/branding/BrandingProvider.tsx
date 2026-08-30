"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiUrl } from "@/lib/api-base";
import { DEFAULT_INSTALL_ICON_URL, parseInstallIconBg, resolveInstallIconUrl } from "@/lib/install-branding";
import {
  parseSplashAnimation,
  parseSplashIntensity,
  type SplashAnimation,
  type SplashIntensity,
} from "@/lib/splash-animation";
import { invalidateLiveData, useLiveRefresh } from "@/hooks/useLiveRefresh";
import {
  clearContingency,
  liveFirstFetch,
  readContingencyJson,
  type LiveSource,
  writeContingencyJson,
} from "@/lib/live-first";

export type PlatformBranding = {
  logoUrl: string;
  appName: string;
  tagline: string;
  splashDurationMs: number;
  splashAnimation: SplashAnimation;
  splashIntensity: SplashIntensity;
  splashShowProgress: boolean;
  installName: string;
  installIconUrl: string;
  /** `transparent` (default) or #RRGGBB behind the install icon. */
  installIconBg: string;
};

export type PoweredByConfig = {
  text: string;
  locked: boolean;
};

export const DEFAULT_BRANDING: PlatformBranding = {
  logoUrl: "/icons/justxsystems-icon.svg",
  appName: "JustXSystems",
  tagline: "JustXSystems",
  splashDurationMs: 2200,
  splashAnimation: "dash",
  splashIntensity: "balanced",
  splashShowProgress: true,
  installName: "JustXSystems",
  installIconUrl: DEFAULT_INSTALL_ICON_URL,
  installIconBg: "transparent",
};

export const DEFAULT_POWERED_BY: PoweredByConfig = {
  text: "Powered by JustXSystems LLP",
  locked: true,
};

export const SPLASH_SEEN_KEY = "jbt.splash.seen";
/** Contingency mirror only — never preferred over a live DB response while online. */
export const BRANDING_STORAGE_KEY = "jbt.branding.payload";

export function splashFingerprint(b: PlatformBranding): string {
  return [
    b.logoUrl,
    b.appName,
    b.tagline,
    String(b.splashDurationMs),
    b.splashAnimation,
    b.splashIntensity,
    b.splashShowProgress ? "1" : "0",
    b.installName,
    b.installIconUrl,
    b.installIconBg,
  ].join("\u0001");
}

type BrandPayload = { branding: PlatformBranding; poweredBy: PoweredByConfig };

type BrandingContextValue = {
  branding: PlatformBranding;
  poweredBy: PoweredByConfig;
  /** True until the first live-first attempt finishes (network or offline fallback). */
  loading: boolean;
  /** Where the current payload came from. */
  source: LiveSource;
  /** True after a successful live (DB) fetch in this session. */
  liveConfirmed: boolean;
  refresh: () => Promise<void>;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

let memoryLive: BrandPayload | null = null;
let inflight: Promise<BrandPayload & { source: LiveSource }> | null = null;

function normalizePayload(data: {
  branding?: Partial<PlatformBranding>;
  poweredBy?: Partial<PoweredByConfig>;
}): BrandPayload {
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
      splashAnimation: parseSplashAnimation(b.splashAnimation ?? DEFAULT_BRANDING.splashAnimation),
      splashIntensity: parseSplashIntensity(b.splashIntensity ?? DEFAULT_BRANDING.splashIntensity),
      splashShowProgress:
        b.splashShowProgress == null
          ? DEFAULT_BRANDING.splashShowProgress
          : Boolean(b.splashShowProgress),
      installName: String(b.installName || DEFAULT_BRANDING.installName).trim() || DEFAULT_BRANDING.installName,
      installIconUrl: resolveInstallIconUrl(
        String(b.logoUrl || DEFAULT_BRANDING.logoUrl),
        String(b.installIconUrl || DEFAULT_BRANDING.installIconUrl).trim() || DEFAULT_BRANDING.installIconUrl,
      ),
      installIconBg: parseInstallIconBg(b.installIconBg ?? DEFAULT_BRANDING.installIconBg),
    },
    poweredBy: {
      text: String(p.text || DEFAULT_POWERED_BY.text),
      locked: p.locked == null ? true : Boolean(p.locked),
    },
  };
}

function readContingencyPayload(): BrandPayload | null {
  const raw = readContingencyJson<{
    branding?: Partial<PlatformBranding>;
    poweredBy?: Partial<PoweredByConfig>;
  }>(BRANDING_STORAGE_KEY);
  if (!raw) return null;
  return normalizePayload(raw);
}

function writeContingencyPayload(payload: BrandPayload): void {
  writeContingencyJson(BRANDING_STORAGE_KEY, payload);
}

async function fetchLiveBrandPayload(signal?: AbortSignal): Promise<BrandPayload> {
  const res = await fetch(apiUrl(`/api/config/branding?t=${Date.now()}`), {
    credentials: "include",
    cache: "no-store",
    signal,
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!res.ok) throw new Error("branding fetch failed");
  const data = (await res.json()) as {
    branding?: Partial<PlatformBranding>;
    poweredBy?: Partial<PoweredByConfig>;
  };
  return normalizePayload(data);
}

const DEFAULT_PAYLOAD: BrandPayload = {
  branding: { ...DEFAULT_BRANDING },
  poweredBy: { ...DEFAULT_POWERED_BY },
};

/**
 * Live-first branding fetch. Memory/localStorage are contingency only —
 * never returned ahead of a network attempt while online.
 */
export async function fetchPlatformBrandPayload(
  _force = true,
): Promise<BrandPayload & { source: LiveSource }> {
  if (inflight) return inflight;

  inflight = (async () => {
    const result = await liveFirstFetch({
      fetchLive: fetchLiveBrandPayload,
      readContingency: readContingencyPayload,
      defaults: DEFAULT_PAYLOAD,
      timeoutMs: 8_000,
    });
    if (result.source === "live") {
      memoryLive = result.data;
      writeContingencyPayload(result.data);
    } else if (!memoryLive) {
      memoryLive = result.data;
    }
    return { ...result.data, source: result.source };
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export async function fetchPlatformBranding(_force = true): Promise<PlatformBranding> {
  const payload = await fetchPlatformBrandPayload(true);
  return payload.branding;
}

export function invalidateBrandingCache(): void {
  memoryLive = null;
  inflight = null;
  try {
    sessionStorage.removeItem(SPLASH_SEEN_KEY);
  } catch {
    /* ignore */
  }
  clearContingency(BRANDING_STORAGE_KEY);
  invalidateLiveData("branding");
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<PlatformBranding>(DEFAULT_BRANDING);
  const [poweredBy, setPoweredBy] = useState<PoweredByConfig>(DEFAULT_POWERED_BY);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<LiveSource>("default");
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const liveConfirmedRef = useRef(false);

  const apply = useCallback((payload: BrandPayload, nextSource: LiveSource) => {
    setBranding(payload.branding);
    setPoweredBy(payload.poweredBy);
    setSource(nextSource);
    if (nextSource === "live") {
      liveConfirmedRef.current = true;
      setLiveConfirmed(true);
    }
    setLoading(false);
  }, []);

  const softRevalidate = useCallback(async () => {
    try {
      const next = await fetchPlatformBrandPayload(true);
      // Never replace a confirmed live payload with stale contingency after a blip.
      if (next.source === "live" || !liveConfirmedRef.current) {
        apply({ branding: next.branding, poweredBy: next.poweredBy }, next.source);
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [apply]);

  const refresh = useCallback(async () => {
    invalidateBrandingCache();
    liveConfirmedRef.current = false;
    setLiveConfirmed(false);
    setLoading(true);
    await softRevalidate();
  }, [softRevalidate]);

  // Live-first boot + focus/online/invalidate. Never paint contingency as "ready" before the attempt.
  useLiveRefresh(softRevalidate, { intervalMs: 60_000 });

  const value = useMemo(
    () => ({ branding, poweredBy, loading, source, liveConfirmed, refresh }),
    [branding, poweredBy, loading, source, liveConfirmed, refresh],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function usePlatformBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (ctx) return ctx;
  return {
    branding: memoryLive?.branding ?? DEFAULT_BRANDING,
    poweredBy: memoryLive?.poweredBy ?? DEFAULT_POWERED_BY,
    loading: !memoryLive,
    source: memoryLive ? "live" : "default",
    liveConfirmed: Boolean(memoryLive),
    refresh: async () => {
      await fetchPlatformBrandPayload(true);
    },
  };
}
