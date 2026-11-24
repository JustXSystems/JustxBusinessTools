"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  OEM_BRANDS,
  SAMPLE_FIXTURES,
  buildBrandPlaybook,
  buildToolDeepLink,
  buildWhatsAppToolShareUrl,
  brandChipLabel,
  emptyStateHint,
  filterOemBrands,
  formatCoordPair,
  G2M_BRAND_STORAGE_KEY,
  G2M_RECENT_STORAGE_KEY,
  G2M_WALKTHROUGH,
  isMahindraFamily,
  looksLikeMapsInput,
  parseRecentPlaces,
  playStoreUrlForBrand,
  PINWAY_PRODUCT_NAME,
  PINWAY_TAGLINE,
  pushRecentPlace,
  recentPlaceLabel,
  resolveFindButtonLabel,
  resolveOemBrandId,
  type BrandSegmentFilter,
  type G2mRecentPlace,
  type OemHandoffSummary,
  type PinwayStage,
  type ResolveResult,
} from "@jbt/shared";
import { apiUrl } from "@/lib/api-base";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/components/common/ToastProvider";
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
  const [brandQuery, setBrandQuery] = useState("");
  const [recents, setRecents] = useState<G2mRecentPlace[]>([]);
  const [pinPulse, setPinPulse] = useState(false);
  const [showAppHelp, setShowAppHelp] = useState(false);
  const [clipboardHint, setClipboardHint] = useState(false);
  const [showA2hs, setShowA2hs] = useState(false);
  const brandIdRef = useRef(brandId);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
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

  // First open after registration: start the 14-day Pinway trial automatically.
  useEffect(() => {
    if (subLoading || pinwayLicensed || !pinwayTrialEligible || autoTrialRef.current) return;
    autoTrialRef.current = true;
    void startTrial(PINWAY_TOOL_ID)
      .then(() => {
        showToast("Pinway 14-day free trial started");
      })
      .catch((err) => {
        autoTrialRef.current = false;
        showToast(err instanceof Error ? err.message : "Could not start Pinway trial");
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
    const list = filterOemBrands(brands, { segment, query: brandQuery });
    if (list.some((b) => b.id === brandId)) return list;
    const current = brands.find((b) => b.id === brandId);
    return current ? [current, ...list] : list;
  }, [brands, segment, brandQuery, brandId]);

  const findLabel = useMemo(() => resolveFindButtonLabel(brandId), [brandId]);
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
            showToast("Pinway 14-day free trial started");
          } catch (err) {
            autoTrialRef.current = false;
            setError(err instanceof Error ? err.message : "Could not start trial");
            return;
          }
        } else {
          setError("Subscribe to Pinway (₹100/mo or ₹1000/yr) to resolve places.");
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
            setError(data.error || "Pinway subscription required.");
            openUpgrade(PINWAY_TOOL_ID);
          } else if ("code" in data && data.code === "auth_required") {
            setError(data.error || "Sign in to use Pinway.");
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

  const chips = meta?.samples?.length
    ? meta.samples
    : SAMPLE_FIXTURES.map((s) => ({
        id: s.id,
        label: s.label,
        input: s.input,
        coords: formatCoordPair(s.lat, s.lng),
      }));

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

  return (
    <div
      className={`g2m tool-workspace ${deviceClass(onAndroid, onIos)} g2m--${variant}`}
    >
      <section className="g2m-hero">
        <div className="g2m-hero-top">
          <div>
            <p className="g2m-eyebrow">Justxsystems</p>
            <h1 className="g2m-brand">{PINWAY_PRODUCT_NAME}</h1>
            <p className="g2m-tag">{PINWAY_TAGLINE}</p>
          </div>
        </div>
        {showA2hs ? (
          <p className="g2m-a2hs" role="note">
            <strong>Add to Home Screen</strong>
            {onIos
              ? " — Share → Add to Home Screen for a full-screen Pinway app."
              : " — Browser menu → Install / Add to Home screen."}{" "}
            <button type="button" className="g2m-linkish" onClick={dismissA2hs}>
              Got it
            </button>
          </p>
        ) : null}
      </section>

      <ol className="g2m-stages" aria-label="Pinway steps">
        {(
          [
            ["brand", "Brand"],
            ["place", "Place"],
            ["open", "Open"],
          ] as const
        ).map(([id, label], i) => {
          const order = { brand: 0, place: 1, open: 2 } as const;
          const current = order[stage];
          const mine = order[id];
          return (
            <li
              key={id}
              className={`g2m-stage${stage === id ? " is-active" : ""}${mine < current ? " is-done" : ""}`}
            >
              <span className="g2m-stage-num">{i + 1}</span>
              {label}
            </li>
          );
        })}
      </ol>

      {pinwayLocked ? (
        <section className="g2m-paywall" aria-label="Pinway subscription">
          <strong>{pinwayTrialEligible ? "Start your free trial" : "Subscribe to Pinway"}</strong>
          <p className="g2m-auto-note">
            {pinwayTrialEligible
              ? "New accounts get 14 days free. After that: ₹100/month or ₹1000/year."
              : "Your free trial has ended. Continue for ₹100/month or ₹1000/year."}
          </p>
          <div className="g2m-actions">
            {pinwayTrialEligible ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void startTrial(PINWAY_TOOL_ID)
                    .then(() => showToast("Pinway 14-day free trial started"))
                    .catch((err) =>
                      showToast(err instanceof Error ? err.message : "Could not start trial"),
                    );
                }}
              >
                Start 14-day free trial
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openUpgrade(PINWAY_TOOL_ID)}
            >
              Subscribe · {inr(pinwaySku?.priceInr ?? 100)}/mo
              {pinwaySku?.annualPriceInr
                ? ` or ${inr(pinwaySku.annualPriceInr)}/yr`
                : " or ₹1,000/yr"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="g2m-composer">
        <div className="g2m-brand-picker" aria-label="Vehicle brand">
          <div className="g2m-seg" role="group" aria-label="Segment">
            {(
              [
                ["all", "All"],
                ["2W", "2W"],
                ["4W", "4W"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`g2m-seg-btn${segment === id ? " is-active" : ""}`}
                aria-pressed={segment === id}
                onClick={() => setSegment(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {isMahindraFamily(brandId) || segment === "4W" ? (
            <div className="g2m-mahindra-row" role="group" aria-label="Mahindra app">
              <span className="g2m-brand-label">Mahindra</span>
              <button
                type="button"
                className={`g2m-chip${brandId === "mahindra" ? " is-active" : ""}`}
                aria-pressed={brandId === "mahindra"}
                onClick={() => onBrandChange("mahindra", result?.paste)}
              >
                Adrenox · ICE
              </button>
              <button
                type="button"
                className={`g2m-chip${brandId === "mahindra-me4u" ? " is-active" : ""}`}
                aria-pressed={brandId === "mahindra-me4u"}
                onClick={() => onBrandChange("mahindra-me4u", result?.paste)}
              >
                Me4U · Born Electric
              </button>
            </div>
          ) : null}

          <label className="g2m-brand-label" htmlFor="g2m-brand-filter">
            Search brands
          </label>
          <input
            id="g2m-brand-filter"
            className="g2m-brand-filter"
            type="search"
            value={brandQuery}
            onChange={(e) => setBrandQuery(e.target.value)}
            placeholder="Adrenox, Me4U, Bluelink, Simple…"
            autoComplete="off"
          />

          <div className="g2m-brand-chips" role="listbox" aria-label="Quick brands">
            {filteredBrands.slice(0, 12).map((b) => (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={brandId === b.id}
                className={`g2m-chip${brandId === b.id ? " is-active" : ""}`}
                onClick={() => onBrandChange(b.id, result?.paste)}
              >
                {brandChipLabel(b)}
              </button>
            ))}
          </div>

          <label className="g2m-brand-label" htmlFor="g2m-brand-top">
            Vehicle brand
            {selectedBrand?.companionApp ? ` → ${selectedBrand.companionApp.name}` : ""}
          </label>
          <select
            id="g2m-brand-top"
            className="g2m-brand-select"
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
          </select>
        </div>

        <div className="g2m-input-wrap">
          <label className="sr-only" htmlFor="g2m-input">
            Google Maps link, address, or coordinates
          </label>
          <textarea
            id="g2m-input"
            ref={inputRef}
            className="g2m-input"
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
            <p className="g2m-clip-hint" role="status">
              Maps link detected on clipboard.{" "}
              <button type="button" className="g2m-linkish" onClick={() => void pasteAndFind()}>
                Paste &amp; find
              </button>
            </p>
          ) : null}
        </div>

        <div className="g2m-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading}
            onClick={() => void resolve(input)}
          >
            {loading ? (
              <>
                <span className="g2m-spinner" aria-hidden />
                Finding same point…
              </>
            ) : (
              findLabel
            )}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={() => void pasteAndFind()}
          >
            Paste &amp; find
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || (!input && !result)}
            onClick={clearAll}
          >
            Clear
          </button>
        </div>

        {recents.length > 0 ? (
          <div className="g2m-recents" aria-label="Recent destinations">
            <span className="g2m-brand-label">Recent</span>
            <div className="g2m-chips">
              {recents.map((r) => (
                <button
                  key={`${r.at}-${r.lat}-${r.brandId}`}
                  type="button"
                  className="g2m-chip"
                  title={r.input}
                  onClick={() => {
                    if (r.brandId !== brandId) onBrandChange(r.brandId);
                    setInput(r.input);
                    void resolve(r.input);
                  }}
                >
                  {r.pin ? `${r.label} · ${r.pin}` : r.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="g2m-chips" aria-label="Examples">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className="g2m-chip"
              onClick={() => {
                setInput(c.input);
                void resolve(c.input);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {whatsappDriverUrl ? (
          <p className="g2m-driver-share">
            <a className="g2m-linkish" href={whatsappDriverUrl} target="_blank" rel="noreferrer">
              WhatsApp this tool link to the driver’s phone
            </a>
            <span className="g2m-banner-meta"> (brand + place prefilled)</span>
          </p>
        ) : null}
      </section>

      {error ? (
        <div className="g2m-error" role="alert">
          {error}
        </div>
      ) : null}

      {!result && !loading && !error ? (
        <div className="g2m-state g2m-walkthrough">
          <strong>How Pinway works</strong>
          <ol className="g2m-walk-steps">
            {G2M_WALKTHROUGH.map((step) => (
              <li key={step.id}>
                <span className="g2m-walk-title">{step.title}</span>
                <span className="g2m-walk-body">{step.body}</span>
              </li>
            ))}
          </ol>
          <p className="g2m-auto-note">{emptyStateHint(brandId)}</p>
        </div>
      ) : null}

      {loading && !result ? (
        <div className="g2m-state">
          <strong>
            <span className="g2m-spinner" aria-hidden />
            Matching the same point…
          </strong>
        </div>
      ) : null}

      {result && playbook ? (
        <>
          <div className="g2m-banner" role="status">
            <div>
              <div className="g2m-banner-meta">Exact point locked</div>
              <strong>{formatCoordPair(result.lat, result.lng)}</strong>
              {result.paste.searchQuery ? (
                <div className="g2m-banner-meta">{result.paste.searchQuery}</div>
              ) : null}
            </div>
            <div className="g2m-banner-meta">
              {result.paste.mapplsPin ? `Pin ${result.paste.mapplsPin}` : "Point ready"}
            </div>
          </div>

          <section className="g2m-guide" aria-label="Final action in brand app">
            <h3>Your only step → {appName}</h3>

            {isPinPasteBrand && pinReady ? (
              <div
                className={`g2m-pin-hero${pinPulse ? " is-pulse" : ""}`}
                role="status"
                aria-live="polite"
              >
                <div>
                  <span className="g2m-banner-meta">Mappls Pin ready</span>
                  <span className="g2m-pin-code">{result.paste.mapplsPin}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    void onCopy("pinhero", result.paste.mapplsPin || "", result.paste.mapplsPin)
                  }
                >
                  {copied === "pinhero" || pinPulse ? "Copied!" : "Copy Pin"}
                </button>
              </div>
            ) : null}

            <p className="g2m-auto-note" role="status">
              {statusNote}
              {autoCopied ? ` · Clipboard: ${autoCopied}` : ""}
            </p>

            {playbook.rejectLatLngPaste ? (
              <p className="g2m-auto-note" role="note">
                Do not paste coordinates into {appName} search — use Pin / place name only.
              </p>
            ) : null}

            <ol className="g2m-guide-steps">
              {playbook.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <div className="g2m-guide-layout">
              <div className="g2m-guide-primary">
                <div className="g2m-guide-cta">
                  {playbook.primary.kind === "open" && playbook.primary.href ? (
                    <a
                      className="btn btn-primary"
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
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void runPrimary()}
                    >
                      {copied === "primary" && playbook.primary.kind === "copy"
                        ? "Copied — paste in your app now"
                        : playbook.primary.label}
                    </button>
                  )}
                  {playbook.autoCopyText ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
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
                        : result.paste.mapplsPin &&
                            playbook.autoCopyText === result.paste.mapplsPin
                          ? `Copy Pin (${result.paste.mapplsPin})`
                          : "Copy again for paste"}
                    </button>
                  ) : null}
                </div>

                {showAppHelp && playStoreHref ? (
                  <div className="g2m-app-help" role="status">
                    <strong>App didn’t open?</strong>
                    <p className="g2m-auto-note">
                      Install {appName} from Play Store, then come back and tap the button again.
                      Pin / QR still work if the app is already installed.
                    </p>
                    <div className="g2m-paste-row">
                      <a
                        className="btn btn-secondary btn-sm"
                        href={playStoreHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Install {appName}
                      </a>
                      {result.paste.mapplsPin ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            void onCopy(
                              "help-pin",
                              result.paste.mapplsPin || "",
                              result.paste.mapplsPin,
                            )
                          }
                        >
                          {copied === "help-pin" ? "Copied Pin" : "Copy Pin instead"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setShowAppHelp(false)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="g2m-qr-panel">
                {qr ? (
                  <figure className="g2m-qr">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qr.dataUrl}
                      alt={
                        isPinPasteBrand && pinReady
                          ? `QR for Mappls Pin ${result.paste.mapplsPin}`
                          : `QR to open ${appName}`
                      }
                      width={140}
                      height={140}
                    />
                    <figcaption>
                      {isPinPasteBrand && pinReady
                        ? `Scan → Pin ${result.paste.mapplsPin}`
                        : `Scan → open ${appName}`}
                    </figcaption>
                  </figure>
                ) : null}
              </div>
            </div>

            <details className="g2m-secondary">
              <summary>More ways (Share, in-car, backup)</summary>
              <div className="g2m-paste-row">
                {canNativeShare && playbook.share ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void onShare()}
                  >
                    {copied === "share" ? "Shared" : "Share Pin / link…"}
                  </button>
                ) : null}
                {playbook.inCar ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      void onCopy(
                        "incar",
                        playbook.inCar?.copyText || "",
                        result.paste.mapplsPin,
                      )
                    }
                  >
                    {copied === "incar" ? "Copied for vehicle" : playbook.inCar.label}
                  </button>
                ) : null}
                {whatsappDriverUrl ? (
                  <a
                    className="btn btn-secondary btn-sm"
                    href={whatsappDriverUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp to driver
                  </a>
                ) : null}
                {playbook.backup?.href ? (
                  <a
                    className="btn btn-secondary btn-sm"
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
                {playbook.backup?.kind === "copy" && playbook.backup.copyText ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void onCopy("backup", playbook.backup?.copyText || "")}
                  >
                    {copied === "backup" ? "Copied" : playbook.backup.label}
                  </button>
                ) : null}
                {result.paste.mapplsPin ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      void onCopy("pin", result.paste.mapplsPin || "", result.paste.mapplsPin)
                    }
                  >
                    {copied === "pin" ? "Copied Pin" : `Copy Pin (${result.paste.mapplsPin})`}
                  </button>
                ) : null}
                {result.paste.mapplsPinUrl ? (
                  <a
                    className="btn btn-secondary btn-sm"
                    href={result.paste.mapplsPinUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Pin on Mappls
                  </a>
                ) : null}
                {result.paste.searchQuery ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void onCopy("search", result.paste.searchQuery || "")}
                  >
                    {copied === "search" ? "Copied place name" : "Copy place name"}
                  </button>
                ) : null}
                {playStoreHref ? (
                  <a
                    className="btn btn-secondary btn-sm"
                    href={playStoreHref}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Play Store · {appName}
                  </a>
                ) : null}
                <a
                  className="btn btn-secondary btn-sm"
                  href={result.paste.mapplsNavDrivingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Mappls 4W nav
                </a>
                <a
                  className="btn btn-secondary btn-sm"
                  href={result.paste.mapplsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Verify on Mappls
                </a>
                <a
                  className="btn btn-secondary btn-sm"
                  href={result.paste.googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Verify on Google
                </a>
              </div>
            </details>
          </section>

          <div className="g2m-map-panel">
            <MapPreview
              key={`${result.lat},${result.lng}`}
              lat={result.lat}
              lng={result.lng}
            />
          </div>
        </>
      ) : null}

      {variant === "standalone" || onAndroid || onIos ? (
        <div className="g2m-dock" aria-label="Primary actions">
          <div className="g2m-dock-inner">
            {result && playbook?.primary.href ? (
              <a
                className="btn btn-primary"
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
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={() => void resolve(input)}
                >
                  {loading ? "Finding…" : findLabel}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={loading}
                  onClick={() => void pasteAndFind()}
                >
                  Paste
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Preferred export name for the Pinway product UI. */
export { Gmap2MapplsTool as PinwayApp };
