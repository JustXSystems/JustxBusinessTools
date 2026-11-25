"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import {
  OEM_BRANDS,
  buildBrandPlaybook,
  buildToolDeepLink,
  buildWhatsAppToolShareUrl,
  emptyStateHint,
  filterOemBrands,
  formatCoordPair,
  G2M_BRAND_STORAGE_KEY,
  G2M_RECENT_STORAGE_KEY,
  isMahindraFamily,
  looksLikeMapsInput,
  parseRecentPlaces,
  playStoreUrlForBrand,
  PINWAY_BRAND_NAME,
  PINWAY_PRODUCT_NAME,
  pushRecentPlace,
  recentPlaceLabel,
  resolveOemBrandId,
  type BrandSegmentFilter,
  type G2mRecentPlace,
  type OemHandoffSummary,
  type PinwayStage,
  type ResolveResult,
} from "@jbt/shared";
import { apiUrl } from "@/lib/api-base";
import { withBasePath } from "@/lib/base-path";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/components/common/ToastProvider";
import {
  Alert,
  BosRoot,
  Button,
  FilterChip,
  Segmented,
  Select,
  Textarea,
  useBosTheme,
} from "@/components/bos";
import "./gmap2mappls/gmap2mappls.css";

const PINWAY_TOOL_ID = "gmap2mappls";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

type QrState = { dataUrl: string; payload: string } | null;

const MapPreview = dynamic(
  () => import("./gmap2mappls/MapPreview").then((m) => m.MapPreview),
  {
    ssr: false,
    loading: () => <div className="g2m-map" aria-hidden />,
  },
);

type Meta = {
  hasToken: boolean;
  tip: string;
  samples: Array<{ id: string; label: string; input: string; coords: string }>;
  oem?: OemHandoffSummary;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function isAndroidUa(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

function isIosUa(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function shortenCopied(text: string, pin?: string): string {
  if (pin && text === pin) return `Pin ${pin}`;
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

function deviceClass(onAndroid: boolean, onIos: boolean): string {
  if (onAndroid) return "g2m--android";
  if (onIos) return "g2m--ios";
  return "g2m--desktop";
}

function PinwayThemeToggle() {
  const { theme, setTheme } = useBosTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="g2m-theme-btn"
      aria-label={next === "dark" ? "Switch to dark mode" : "Switch to light mode"}
      onClick={() => setTheme(next)}
    >
      {theme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

export function Gmap2MapplsTool({
  variant = "embedded",
}: {
  variant?: "embedded" | "standalone";
} = {}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [qr, setQr] = useState<QrState | null>(null);
  const [brandId, setBrandId] = useState("simple-energy");
  const [autoOpenStatus, setAutoOpenStatus] = useState<"opened" | "blocked" | "ready" | null>(null);
  const [autoCopied, setAutoCopied] = useState<string | null>(null);
  const [onAndroid, setOnAndroid] = useState(false);
  const [onIos, setOnIos] = useState(false);
  const [segment, setSegment] = useState<BrandSegmentFilter>("all");
  const [recents, setRecents] = useState<G2mRecentPlace[]>([]);
  const [pinPulse, setPinPulse] = useState(false);
  const [showAppHelp, setShowAppHelp] = useState(false);
  const [clipboardHint, setClipboardHint] = useState(false);
  const [showA2hs, setShowA2hs] = useState(false);
  const [pointer, setPointer] = useState({ x: 50, y: 28 });
  const brandIdRef = useRef(brandId);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const appHelpTimerRef = useRef<number | null>(null);
  const autoTrialRef = useRef(false);

  const { subscription, loading: subLoading, isToolLicensed, startTrial, openUpgrade } =
    useSubscription();
  const { showToast } = useToast();
  const pinwaySku = subscription?.catalog?.find((s) => s.toolId === PINWAY_TOOL_ID);
  const pinwayLicensed = isToolLicensed(PINWAY_TOOL_ID);
  const pinwayTrialEligible = Boolean(
    pinwaySku?.trialEligible && (pinwaySku.trialDays ?? 0) > 0 && !pinwayLicensed,
  );
  const pinwayLocked = !subLoading && !pinwayLicensed;

  const brands = OEM_BRANDS;

  // First open after registration: start the 14-day trial automatically.
  useEffect(() => {
    if (subLoading || pinwayLicensed || !pinwayTrialEligible || autoTrialRef.current) return;
    autoTrialRef.current = true;
    void startTrial(PINWAY_TOOL_ID)
      .then(() => {
        showToast(`${PINWAY_PRODUCT_NAME} 14-day free trial started`);
      })
      .catch((err) => {
        autoTrialRef.current = false;
        showToast(err instanceof Error ? err.message : `Could not start ${PINWAY_PRODUCT_NAME} trial`);
      });
  }, [subLoading, pinwayLicensed, pinwayTrialEligible, startTrial, showToast]);

  useEffect(() => {
    brandIdRef.current = brandId;
  }, [brandId]);

  const bootstrappedRef = useRef(false);

  useEffect(() => {
    const android = isAndroidUa();
    const ios = isIosUa();
    setOnAndroid(android);
    setOnIos(ios);
    try {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari home-screen
        ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
      if (variant === "standalone" && (android || ios) && !standalone) {
        const dismissed = window.localStorage.getItem("pinway.a2hsDismissed");
        if (!dismissed) setShowA2hs(true);
      }
    } catch {
      /* ignore */
    }
    let pendingQ: string | null = null;
    try {
      const saved = window.localStorage.getItem(G2M_BRAND_STORAGE_KEY);
      if (saved && OEM_BRANDS.some((b) => b.id === saved)) {
        setBrandId(saved);
        brandIdRef.current = saved;
      }
      setRecents(parseRecentPlaces(window.localStorage.getItem(G2M_RECENT_STORAGE_KEY)));
      const sp = new URLSearchParams(window.location.search);
      const brandParam = resolveOemBrandId(sp.get("brand") || sp.get("oem") || "");
      if (brandParam) {
        setBrandId(brandParam);
        brandIdRef.current = brandParam;
        window.localStorage.setItem(G2M_BRAND_STORAGE_KEY, brandParam);
        if (OEM_BRANDS.find((b) => b.id === brandParam)?.segment === "2W") setSegment("2W");
        else if (OEM_BRANDS.find((b) => b.id === brandParam)?.segment === "4W") setSegment("4W");
      }
      const qParam = (sp.get("q") || sp.get("input") || "").trim();
      if (qParam) {
        setInput(qParam);
        pendingQ = qParam;
      }
    } catch {
      /* ignore */
    }
    if (pendingQ && !bootstrappedRef.current) {
      bootstrappedRef.current = true;
      window.setTimeout(() => {
        void resolve(pendingQ!);
      }, 0);
    } else {
      // Automation: offer clipboard Maps links without making the user hunt for Paste.
      window.setTimeout(() => {
        void (async () => {
          try {
            if (!navigator.clipboard?.readText) return;
            const text = (await navigator.clipboard.readText()).trim();
            if (looksLikeMapsInput(text)) setClipboardHint(true);
          } catch {
            /* permission / insecure context */
          }
        })();
      }, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once on mount
  }, []);

  useEffect(() => {
    return () => {
      if (appHelpTimerRef.current) window.clearTimeout(appHelpTimerRef.current);
    };
  }, []);

  const syncBrandToUrl = useCallback((id: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("brand", id);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }, []);

  const rememberPlace = useCallback((entry: Omit<G2mRecentPlace, "at"> & { at?: number }) => {
    setRecents((prev) => {
      const next = pushRecentPlace(prev, entry);
      try {
        window.localStorage.setItem(G2M_RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const scheduleAppHelp = useCallback(() => {
    setShowAppHelp(false);
    if (appHelpTimerRef.current) window.clearTimeout(appHelpTimerRef.current);
    // If the OEM app took focus, the tab is hidden — don't nag. Only show when
    // Intent likely failed and the user is still staring at this page.
    appHelpTimerRef.current = window.setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        setShowAppHelp(true);
      }
    }, 2200);
  }, []);

  const openAutoUrl = useCallback(
    (url: string) => {
      const isAppScheme = /^(intent|geo|mappls):/i.test(url);
      if (isAppScheme) {
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setAutoOpenStatus("opened");
        scheduleAppHelp();
        return;
      }
      const w = window.open(url, "_blank", "noopener,noreferrer");
      setAutoOpenStatus(w ? "opened" : "blocked");
      if (!w) setShowAppHelp(true);
    },
    [scheduleAppHelp],
  );

  const pulsePinIfNeeded = useCallback((copyTextValue?: string, pin?: string) => {
    if (pin && copyTextValue === pin) {
      setPinPulse(true);
      window.setTimeout(() => setPinPulse(false), 1600);
    }
  }, []);

  const runOpenPrimary = useCallback(
    async (href: string, copyTextValue?: string, pin?: string) => {
      if (copyTextValue) {
        const ok = await copyText(copyTextValue);
        if (ok) {
          setAutoCopied(shortenCopied(copyTextValue, pin));
          pulsePinIfNeeded(copyTextValue, pin);
        }
      }
      openAutoUrl(href);
    },
    [openAutoUrl, pulsePinIfNeeded],
  );

  const onBrandChange = useCallback(
    (id: string, paste?: ResolveResult["paste"]) => {
      setBrandId(id);
      brandIdRef.current = id;
      setShowAppHelp(false);
      try {
        window.localStorage.setItem(G2M_BRAND_STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      syncBrandToUrl(id);
      if (!paste) return;
      const guide = buildBrandPlaybook(id, paste);
      if (!guide) return;
      if (guide.deferAutoOpen) {
        setAutoOpenStatus("ready");
        if (guide.autoCopyText) {
          void copyText(guide.autoCopyText).then((ok) => {
            if (ok) {
              setAutoCopied(shortenCopied(guide.autoCopyText!, paste.mapplsPin));
              pulsePinIfNeeded(guide.autoCopyText, paste.mapplsPin);
            }
          });
        } else {
          setAutoCopied(null);
        }
      } else {
        openAutoUrl(guide.autoOpenUrl);
        if (guide.autoCopyText) {
          void copyText(guide.autoCopyText).then((ok) => {
            if (ok) setAutoCopied(shortenCopied(guide.autoCopyText!, paste.mapplsPin));
          });
        } else {
          setAutoCopied(null);
        }
      }
    },
    [openAutoUrl, pulsePinIfNeeded, syncBrandToUrl],
  );

  const onCopy = useCallback(
    async (label: string, text: string, pin?: string) => {
      const ok = await copyText(text);
      setCopied(ok ? label : null);
      if (ok) {
        pulsePinIfNeeded(text, pin);
        window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1600);
      }
    },
    [pulsePinIfNeeded],
  );

  const playbook = useMemo(() => {
    if (!result?.paste) return null;
    return buildBrandPlaybook(brandId, result.paste);
  }, [result?.paste, brandId]);

  const filteredBrands = useMemo(() => {
    const list = filterOemBrands(brands, { segment });
    if (list.some((b) => b.id === brandId)) return list;
    const current = brands.find((b) => b.id === brandId);
    return current ? [current, ...list] : list;
  }, [brands, segment, brandId]);

  const playStoreHref = useMemo(() => playStoreUrlForBrand(brandId), [brandId]);

  const toolShareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return buildToolDeepLink(
      window.location.href,
      brandId,
      input || result?.google?.input,
    );
  }, [brandId, input, result?.google?.input]);

  const whatsappDriverUrl = useMemo(() => {
    if (!toolShareUrl) return "";
    const brand = brands.find((b) => b.id === brandId);
    const label = brand?.companionApp?.name || brand?.name || "your vehicle app";
    return buildWhatsAppToolShareUrl(toolShareUrl, label);
  }, [toolShareUrl, brandId, brands]);

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const onShare = useCallback(async () => {
    if (!playbook?.share || !canNativeShare) return;
    try {
      await navigator.share({
        title: playbook.share.title,
        text: playbook.share.text,
        url: playbook.share.url,
      });
      setCopied("share");
      window.setTimeout(() => setCopied((c) => (c === "share" ? null : c)), 1600);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (playbook.autoCopyText) {
        await onCopy("share", playbook.autoCopyText, result?.paste.mapplsPin);
      }
    }
  }, [playbook, canNativeShare, onCopy, result?.paste.mapplsPin]);

  useEffect(() => {
    let cancelled = false;
    if (!playbook || !result?.paste) {
      setQr(null);
      return;
    }
    const payload =
      playbook.qrPayload ||
      playbook.primary.href ||
      playbook.autoOpenUrl ||
      result.paste.whatsappGeoUri ||
      result.paste.geoUri;
    void import("qrcode")
      .then((QRCode) => QRCode.toDataURL(payload, { margin: 1, width: 180, errorCorrectionLevel: "M" }))
      .then((dataUrl) => {
        if (!cancelled) setQr({ dataUrl, payload });
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [playbook, result?.paste]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/public/gmap2mappls/meta"), { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as Meta;
        if (!cancelled) setMeta(data);
      } catch {
        /* meta is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolve = useCallback(
    async (value: string) => {
      const q = value.trim();
      if (!q) {
        setError("Paste a Google Maps share link, an Indian address, or lat,lng.");
        setResult(null);
        return;
      }
      if (!isToolLicensed(PINWAY_TOOL_ID)) {
        if (pinwayTrialEligible) {
          try {
            autoTrialRef.current = true;
            await startTrial(PINWAY_TOOL_ID);
            showToast(`${PINWAY_PRODUCT_NAME} 14-day free trial started`);
          } catch (err) {
            autoTrialRef.current = false;
            setError(err instanceof Error ? err.message : "Could not start trial");
            return;
          }
        } else {
          setError(`Subscribe to ${PINWAY_PRODUCT_NAME} (₹100/mo or ₹1000/yr) to resolve places.`);
          openUpgrade(PINWAY_TOOL_ID);
          return;
        }
      }
      const brandAtStart = brandIdRef.current;
      setLoading(true);
      setError(null);
      setAutoOpenStatus(null);
      setAutoCopied(null);
      setShowAppHelp(false);
      setClipboardHint(false);
      try {
        const res = await fetch(apiUrl("/api/public/gmap2mappls/resolve"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: q }),
        });
        const data = (await res.json()) as ResolveResult | { ok: false; error: string; code?: string };
        if (!res.ok || !data.ok) {
          setResult(null);
          if ("code" in data && data.code === "license_required") {
            setError(data.error || `${PINWAY_PRODUCT_NAME} subscription required.`);
            openUpgrade(PINWAY_TOOL_ID);
          } else if ("code" in data && data.code === "auth_required") {
            setError(data.error || `Sign in to use ${PINWAY_PRODUCT_NAME}.`);
          } else {
            setError(("error" in data && data.error) || "Could not resolve that location.");
          }
          return;
        }
        setResult(data);
        rememberPlace({
          input: q,
          label: recentPlaceLabel({
            placeName: data.paste.searchQuery,
            pin: data.paste.mapplsPin,
            lat: data.lat,
            lng: data.lng,
          }),
          lat: data.lat,
          lng: data.lng,
          pin: data.paste.mapplsPin,
          brandId: brandAtStart,
        });
        const guide = buildBrandPlaybook(brandAtStart, data.paste);
        if (!guide) return;
        if (guide.deferAutoOpen) {
          setAutoOpenStatus("ready");
          if (guide.autoCopyText) {
            void copyText(guide.autoCopyText).then((ok) => {
              if (ok) {
                setAutoCopied(shortenCopied(guide.autoCopyText!, data.paste.mapplsPin));
                pulsePinIfNeeded(guide.autoCopyText, data.paste.mapplsPin);
              }
            });
          }
        } else {
          openAutoUrl(guide.autoOpenUrl);
          if (guide.autoCopyText) {
            void copyText(guide.autoCopyText).then((ok) => {
              if (ok) setAutoCopied(shortenCopied(guide.autoCopyText!, data.paste.mapplsPin));
            });
          }
        }
      } catch {
        setResult(null);
        setError("Network error — try again in a moment.");
      } finally {
        setLoading(false);
      }
    },
    [
      openAutoUrl,
      pulsePinIfNeeded,
      rememberPlace,
      isToolLicensed,
      pinwayTrialEligible,
      startTrial,
      showToast,
      openUpgrade,
    ],
  );

  const pasteAndFind = useCallback(async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setError("Clipboard is empty — copy a Google Maps link first.");
        return;
      }
      setInput(text);
      setClipboardHint(false);
      await resolve(text);
    } catch {
      setError("Could not read clipboard — paste into the box, then tap Find.");
      inputRef.current?.focus();
    }
  }, [resolve]);

  const onInputFocus = useCallback(async () => {
    if (input.trim() || result || loading) return;
    try {
      if (!navigator.clipboard?.readText) return;
      const text = (await navigator.clipboard.readText()).trim();
      if (looksLikeMapsInput(text)) setClipboardHint(true);
    } catch {
      /* permission denied — ignore */
    }
  }, [input, result, loading]);

  const runPrimary = useCallback(async () => {
    if (!playbook) return;
    if (playbook.primary.kind === "copy" && playbook.primary.copyText) {
      await onCopy("primary", playbook.primary.copyText, result?.paste.mapplsPin);
      return;
    }
    if (playbook.primary.href) {
      await runOpenPrimary(
        playbook.primary.href,
        playbook.autoCopyText,
        result?.paste.mapplsPin,
      );
    }
  }, [playbook, onCopy, runOpenPrimary, result?.paste.mapplsPin]);

  const appName = playbook?.brand.companionApp?.name || playbook?.brand.name;
  const isPinPasteBrand = playbook?.brand.companionApp?.handoff === "geo_with_pin";
  const pinReady = Boolean(playbook?.autoCopyText && result?.paste.mapplsPin);
  const finalAction =
    playbook?.brand.companionApp?.finalAction?.trim() || "Push to car";
  const selectedBrand = brands.find((b) => b.id === brandId);

  const stage: PinwayStage = result && playbook ? "open" : input.trim() ? "place" : "brand";

  const statusNote = (() => {
    if (!playbook) return "";
    if (onIos) {
      return isPinPasteBrand && pinReady
        ? `iPhone: Android Intents won’t open ${appName}. Copy/scan Pin “${result?.paste.mapplsPin}”, open ${appName} manually → ${finalAction}.`
        : `iPhone: open ${appName} from the App Store / home screen, then use the copied Pin or place name.`;
    }
    if (!onAndroid) {
      return isPinPasteBrand && pinReady
        ? `Desktop: scan QR for Pin “${result?.paste.mapplsPin}”, open ${appName} on Android → paste → ${finalAction}.`
        : "Desktop: scan the QR with your Android phone (app must be installed).";
    }
    if (autoOpenStatus === "blocked") return "Open was blocked — tap the button below.";
    if (isPinPasteBrand) {
      if (autoOpenStatus === "opened") {
        return pinReady
          ? `${appName} opened. Paste Pin “${result?.paste.mapplsPin}” in search → ${finalAction}.`
          : `${appName} opened. Follow the step below — never paste lat,lng.`;
      }
      return pinReady
        ? `Tap the button to copy Pin “${result?.paste.mapplsPin}” and open ${appName}, then ${finalAction}.`
        : `Tap the button to open ${appName}, then set destination → ${finalAction}.`;
    }
    if (autoOpenStatus === "opened") {
      return `${appName} should have opened with this location.`;
    }
    return `Opening ${appName} with this location…`;
  })();

  const clearAll = () => {
    setInput("");
    setResult(null);
    setError(null);
    setAutoOpenStatus(null);
    setAutoCopied(null);
    setShowAppHelp(false);
    setClipboardHint(false);
    setPinPulse(false);
  };

  const dismissA2hs = () => {
    setShowA2hs(false);
    try {
      window.localStorage.setItem("pinway.a2hsDismissed", "1");
    } catch {
      /* ignore */
    }
  };

  const onShellPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = shellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    setPointer({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  };

  const stageOrder = { brand: 0, place: 1, open: 2 } as const;

  const liveState: "ready" | "busy" | "locked" = loading ? "busy" : result ? "locked" : "ready";
  const liveLabel = liveState === "busy" ? "Matching" : liveState === "locked" ? "Locked" : "Ready";

  const nav = (
    <header className="g2m-nav">
      <div className="g2m-nav-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="g2m-logo"
          src={withBasePath("/icons/googlemaps2mappls-icon.png")}
          alt=""
          width={36}
          height={36}
        />
        <div className="g2m-brandmark-copy">
          <h1 className="g2m-title">{PINWAY_BRAND_NAME}</h1>
          <p className="g2m-eyebrow">{PINWAY_PRODUCT_NAME}</p>
        </div>
      </div>
      <div className="g2m-nav-actions">
        <span
          className={`g2m-livepill${liveState === "busy" ? " is-busy" : ""}${liveState === "locked" ? " is-locked" : ""}`}
          role="status"
        >
          <span className="g2m-livepill-dot" aria-hidden />
          <span className="g2m-livepill-text">{liveLabel}</span>
        </span>
        <PinwayThemeToggle />
      </div>
    </header>
  );

  const body = (
    <div
      ref={shellRef}
      className={`g2m ${deviceClass(onAndroid, onIos)} g2m--${variant}`}
      style={{ "--g2m-mx": `${pointer.x}%`, "--g2m-my": `${pointer.y}%` } as CSSProperties}
      onPointerMove={onShellPointerMove}
    >
      <div className="g2m-space" aria-hidden>
        <span className="g2m-space-orb" />
        <span className="g2m-space-orb g2m-space-orb--2" />
      </div>

      {showA2hs ? (
        <p className="g2m-a2hs" role="note">
          Install as an app —{" "}
          {onIos ? "Share → Add to Home Screen." : "browser menu → Install app."}{" "}
          <button type="button" className="g2m-linkish" onClick={dismissA2hs}>
            Dismiss
          </button>
        </p>
      ) : null}

      <ol className="g2m-beam" aria-label="Progress">
        {(
          [
            ["brand", "Brand"],
            ["place", "Place"],
            ["open", "Send"],
          ] as const
        ).map(([id, label]) => {
          const mine = stageOrder[id];
          const current = stageOrder[stage];
          return (
            <li
              key={id}
              className={`g2m-beam-step${stage === id ? " is-active" : ""}${mine < current ? " is-done" : ""}`}
            >
              <span className="g2m-beam-track" aria-hidden>
                <span className="g2m-beam-fill" />
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      {pinwayLocked ? (
        <section className="g2m-tile g2m-paywall" aria-label={`${PINWAY_PRODUCT_NAME} subscription`}>
          <strong>{pinwayTrialEligible ? "Start your free trial" : `Subscribe to continue`}</strong>
          <p className="g2m-hint">
            {pinwayTrialEligible
              ? "14 days free, then ₹100/month or ₹1000/year."
              : "Trial ended. Continue for ₹100/month or ₹1000/year."}
          </p>
          <div className="g2m-actions">
            {pinwayTrialEligible ? (
              <Button
                variant="primary"
                onClick={() => {
                  void startTrial(PINWAY_TOOL_ID)
                    .then(() => showToast(`${PINWAY_PRODUCT_NAME} 14-day free trial started`))
                    .catch((err) =>
                      showToast(err instanceof Error ? err.message : "Could not start trial"),
                    );
                }}
              >
                Start 14-day free trial
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => openUpgrade(PINWAY_TOOL_ID)}>
              Subscribe · {inr(pinwaySku?.priceInr ?? 100)}/mo
              {pinwaySku?.annualPriceInr ? ` or ${inr(pinwaySku.annualPriceInr)}/yr` : ""}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="g2m-tile g2m-command" aria-label="Send place to vehicle app">
        <div>
          <label className="g2m-field-label" htmlFor="g2m-brand-top">
            Vehicle brand
            {selectedBrand?.companionApp ? ` → ${selectedBrand.companionApp.name}` : ""}
          </label>
          <Select
            id="g2m-brand-top"
            value={brandId}
            onChange={(e) => onBrandChange(e.target.value, result?.paste)}
          >
            {filteredBrands.length === 0 ? (
              <option value={brandId}>{selectedBrand?.name || brandId}</option>
            ) : (
              <>
                {filteredBrands.some((b) => b.segment === "2W") ? (
                  <optgroup label="2W">
                    {filteredBrands
                      .filter((b) => b.segment === "2W")
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                          {b.companionApp ? ` → ${b.companionApp.name}` : ""}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                {filteredBrands.some((b) => b.segment === "4W") ? (
                  <optgroup label="4W">
                    {filteredBrands
                      .filter((b) => b.segment === "4W")
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                          {b.companionApp ? ` → ${b.companionApp.name}` : ""}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </>
            )}
          </Select>
        </div>

        {isMahindraFamily(brandId) ? (
          <div className="g2m-mahindra-row" role="group" aria-label="Mahindra app">
            <FilterChip active={brandId === "mahindra"} onClick={() => onBrandChange("mahindra", result?.paste)}>
              Adrenox · ICE
            </FilterChip>
            <FilterChip
              active={brandId === "mahindra-me4u"}
              onClick={() => onBrandChange("mahindra-me4u", result?.paste)}
            >
              Me4U · EV
            </FilterChip>
          </div>
        ) : null}

        <div className="g2m-spotlight">
          <label className="g2m-field-label" htmlFor="g2m-input">
            Google place
          </label>
          <Textarea
            id="g2m-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => void onInputFocus()}
            placeholder="Paste Google Maps link, address, or lat,lng"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void resolve(input);
              }
            }}
          />
          {clipboardHint ? (
            <div className="g2m-clip-banner" role="status">
              <span>Maps link ready on clipboard</span>
              <button type="button" className="g2m-linkish" onClick={() => void pasteAndFind()}>
                Use it
              </button>
            </div>
          ) : null}
        </div>

        <div aria-live="polite" className="g2m-live">
          {error ? <Alert tone="coral" title={error} /> : null}

          {loading && !result ? (
            <div className="g2m-loading g2m-loading--compact">
              <span className="g2m-radar" aria-hidden />
              Matching the same geographic point…
            </div>
          ) : null}

          {result && playbook ? (
            <div className="g2m-result">
              <div className="g2m-lock" role="status">
                <p className="g2m-lock-meta">Exact point locked</p>
                <strong>{formatCoordPair(result.lat, result.lng)}</strong>
                <p>
                  {result.paste.mapplsPin
                    ? `Mappls Pin ${result.paste.mapplsPin}`
                    : result.paste.searchQuery || "Ready for handoff"}
                </p>
              </div>

              {isPinPasteBrand && pinReady ? (
                <div className={`g2m-pin-hero${pinPulse ? " is-pulse" : ""}`} role="status">
                  <div>
                    <p className="g2m-kicker">Mappls Pin</p>
                    <span className="g2m-pin-code">{result.paste.mapplsPin}</span>
                  </div>
                </div>
              ) : null}

              {showAppHelp && playStoreHref ? (
                <div className="g2m-app-help" role="status">
                  <strong>App didn’t open?</strong>
                  <p className="g2m-hint">Install {appName}, then tap Send again.</p>
                  <div className="g2m-paste-row">
                    <a
                      className="bos-btn bos-btn-secondary bos-btn-sm"
                      href={playStoreHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Play Store
                    </a>
                    <Button variant="ghost" size="sm" onClick={() => setShowAppHelp(false)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <details
          className="g2m-secondary"
          onToggle={(e) => {
            const el = e.currentTarget;
            if (!el.open) return;
            // Wait for details layout, then keep the block inside the scroll pane.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const pane = el.closest(".g2m");
                if (!(pane instanceof HTMLElement)) {
                  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  return;
                }
                const pad = 20;
                const elRect = el.getBoundingClientRect();
                const paneRect = pane.getBoundingClientRect();
                if (elRect.bottom > paneRect.bottom - pad) {
                  pane.scrollBy({ top: elRect.bottom - paneRect.bottom + pad, behavior: "smooth" });
                } else if (elRect.top < paneRect.top + pad) {
                  pane.scrollBy({ top: elRect.top - paneRect.top - pad, behavior: "smooth" });
                }
              });
            });
          }}
        >
          <summary>More options</summary>
          <div className="g2m-more">
            <div className="g2m-segment-row">
              <Segmented
                aria-label="Vehicle segment"
                role="radio"
                size="sm"
                value={segment}
                onChange={setSegment}
                options={[
                  { value: "all", label: "All" },
                  { value: "2W", label: "2W" },
                  { value: "4W", label: "4W" },
                ]}
              />
            </div>

            {!result ? <p className="g2m-hint">{emptyStateHint(brandId)}</p> : null}
            {!result && meta?.tip ? <p className="g2m-hint">{meta.tip}</p> : null}

            {result && playbook ? (
              <>
                {statusNote || autoCopied ? (
                  <p className="g2m-status">
                    {statusNote}
                    {autoCopied ? ` · Clipboard: ${autoCopied}` : ""}
                  </p>
                ) : null}
                {playbook.rejectLatLngPaste ? (
                  <p className="g2m-hint" role="note">
                    Do not paste coordinates into {appName} — use Pin / place name only.
                  </p>
                ) : null}
              </>
            ) : null}

            {recents.length > 0 ? (
              <div aria-label="Recent destinations">
                <p className="g2m-field-label">Recent</p>
                <div className="g2m-recent-row">
                  {recents.slice(0, 4).map((r) => (
                    <FilterChip
                      key={`${r.at}-${r.lat}-${r.brandId}`}
                      title={r.input}
                      onClick={() => {
                        if (r.brandId !== brandId) onBrandChange(r.brandId);
                        setInput(r.input);
                        void resolve(r.input);
                      }}
                    >
                      {r.pin ? `${r.label} · ${r.pin}` : r.label}
                    </FilterChip>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="g2m-paste-row">
              <Button
                variant="ghost"
                size="sm"
                disabled={loading || (!input && !result)}
                onClick={clearAll}
              >
                Clear
              </Button>
              {whatsappDriverUrl ? (
                <a
                  className="bos-btn bos-btn-secondary bos-btn-sm"
                  href={whatsappDriverUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp driver
                </a>
              ) : null}
              {result && playbook ? (
                <>
                  {playbook.autoCopyText ? (
                    <button
                      type="button"
                      className="bos-btn bos-btn-secondary bos-btn-sm"
                      onClick={() =>
                        void onCopy(
                          "autocopy",
                          playbook.autoCopyText || "",
                          result.paste.mapplsPin,
                        )
                      }
                    >
                      {copied === "autocopy"
                        ? "Copied"
                        : result.paste.mapplsPin && playbook.autoCopyText === result.paste.mapplsPin
                          ? "Copy Pin again"
                          : "Copy again"}
                    </button>
                  ) : null}
                  {canNativeShare && playbook.share ? (
                    <button
                      type="button"
                      className="bos-btn bos-btn-secondary bos-btn-sm"
                      onClick={() => void onShare()}
                    >
                      {copied === "share" ? "Shared" : "Share…"}
                    </button>
                  ) : null}
                  {playbook.inCar ? (
                    <button
                      type="button"
                      className="bos-btn bos-btn-secondary bos-btn-sm"
                      onClick={() =>
                        void onCopy("incar", playbook.inCar?.copyText || "", result.paste.mapplsPin)
                      }
                    >
                      {copied === "incar" ? "Copied" : playbook.inCar.label}
                    </button>
                  ) : null}
                  {playbook.backup?.href ? (
                    <a
                      className="bos-btn bos-btn-secondary bos-btn-sm"
                      href={playbook.backup.href}
                      {...(/^(intent|geo|mappls):/i.test(playbook.backup.href)
                        ? {}
                        : { target: "_blank", rel: "noreferrer" })}
                      onClick={(e) => {
                        if (/^(intent|geo|mappls):/i.test(playbook.backup?.href || "")) {
                          e.preventDefault();
                          openAutoUrl(playbook.backup!.href!);
                        }
                      }}
                    >
                      {playbook.backup.label}
                    </a>
                  ) : null}
                  {result.paste.mapplsPin ? (
                    <button
                      type="button"
                      className="bos-btn bos-btn-secondary bos-btn-sm"
                      onClick={() =>
                        void onCopy("pin", result.paste.mapplsPin || "", result.paste.mapplsPin)
                      }
                    >
                      {copied === "pin" ? "Copied Pin" : "Copy Pin"}
                    </button>
                  ) : null}
                  <a
                    className="bos-btn bos-btn-secondary bos-btn-sm"
                    href={result.paste.mapplsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Verify Mappls
                  </a>
                  <a
                    className="bos-btn bos-btn-secondary bos-btn-sm"
                    href={result.paste.googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Verify Google
                  </a>
                </>
              ) : null}
            </div>

            {result && playbook && qr ? (
              <figure className="g2m-qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr.dataUrl}
                  alt={
                    isPinPasteBrand && pinReady
                      ? `QR for Mappls Pin ${result.paste.mapplsPin}`
                      : `QR to open ${appName}`
                  }
                  width={128}
                  height={128}
                />
                <figcaption>
                  {isPinPasteBrand && pinReady
                    ? `Scan → Pin ${result.paste.mapplsPin}`
                    : `Scan → ${appName}`}
                </figcaption>
              </figure>
            ) : null}

            {result ? (
              <div className="g2m-map-panel">
                <MapPreview key={`${result.lat},${result.lng}`} lat={result.lat} lng={result.lng} />
              </div>
            ) : null}
          </div>
        </details>
      </section>

    </div>
  );

  const island = (
    <div className="g2m-island-bar">
      <div className="g2m-island" aria-label="Primary actions">
        {result && playbook?.primary.kind === "open" && playbook.primary.href ? (
          <a
            className="bos-btn bos-btn-primary g2m-cta"
            href={playbook.primary.href}
            onClick={(e) => {
              e.preventDefault();
              void runOpenPrimary(
                playbook.primary.href!,
                playbook.autoCopyText,
                result.paste.mapplsPin,
              );
            }}
          >
            {playbook.primary.label}
          </a>
        ) : result && playbook ? (
          <Button
            variant="primary"
            className="g2m-cta"
            disabled={loading || pinwayLocked}
            onClick={() => void runPrimary()}
          >
            {copied === "primary" && playbook.primary.kind === "copy"
              ? "Copied — paste in app"
              : playbook.primary.label}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="g2m-cta"
            disabled={loading || pinwayLocked}
            onClick={() => void resolve(input)}
          >
            {loading ? "Matching…" : "Convert & open"}
          </Button>
        )}
        <Button
          variant="secondary"
          className="g2m-cta-secondary"
          disabled={loading || pinwayLocked}
          onClick={() => void pasteAndFind()}
        >
          Paste
        </Button>
      </div>
      <div className="g2m-home-indicator" aria-hidden />
    </div>
  );

  return (
    <BosRoot
      skin="ims"
      canvas
      className={
        variant === "standalone" ? "pinway-ims pinway-ims--standalone" : "pinway-ims pinway-ims--embedded"
      }
      defaultTheme="light"
    >
      <div className={`g2m-app g2m-app--${variant}`}>
        {nav}
        {body}
        {island}
      </div>
    </BosRoot>
  );
}

/** Preferred export name for the Google Maps to Mappls product UI. */
export { Gmap2MapplsTool as PinwayApp };
