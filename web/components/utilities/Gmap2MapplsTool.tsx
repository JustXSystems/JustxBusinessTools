"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  OEM_BRANDS,
  SAMPLE_FIXTURES,
  buildBrandPlaybook,
  formatCoordPair,
  type OemHandoffSummary,
  type ResolveResult,
} from "@jbt/shared";
import { apiUrl } from "@/lib/api-base";
import "./gmap2mappls/gmap2mappls.css";

type QrState = { dataUrl: string; payload: string } | null;

const BRAND_STORAGE_KEY = "g2m.oemBrand";

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

function shortenCopied(text: string, pin?: string): string {
  if (pin && text === pin) return `Pin ${pin}`;
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

export function Gmap2MapplsTool() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [qr, setQr] = useState<QrState | null>(null);
  const [brandId, setBrandId] = useState("simple-energy");
  const [autoOpenStatus, setAutoOpenStatus] = useState<"opened" | "blocked" | null>(null);
  const [autoCopied, setAutoCopied] = useState<string | null>(null);
  const [onAndroid, setOnAndroid] = useState(false);

  const brands = meta?.oem?.brands?.length ? meta.oem.brands : OEM_BRANDS;

  useEffect(() => {
    setOnAndroid(isAndroidUa());
    try {
      const saved = window.localStorage.getItem(BRAND_STORAGE_KEY);
      if (saved && OEM_BRANDS.some((b) => b.id === saved)) setBrandId(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const openAutoUrl = useCallback((url: string) => {
    // intent://, intent:#Intent, geo:, mappls: need top-level navigation —
    // window.open(_blank) often fails on Android Chrome (Simple Connect lesson).
    const isAppScheme = /^(intent|geo|mappls):/i.test(url);
    if (isAppScheme) {
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setAutoOpenStatus("opened");
      return;
    }
    const w = window.open(url, "_blank", "noopener,noreferrer");
    setAutoOpenStatus(w ? "opened" : "blocked");
  }, []);

  const autoAssistPaste = useCallback(async (paste: ResolveResult["paste"], id: string) => {
    const guide = buildBrandPlaybook(id, paste);
    const text = guide?.autoCopyText;
    if (!text) {
      setAutoCopied(null);
      return;
    }
    // Best-effort after resolve — may fail without lasting user-gesture.
    // Primary CTA always re-copies under a fresh tap (Mahindra-critical).
    const ok = await copyText(text);
    setAutoCopied(ok ? shortenCopied(text, paste.mapplsPin) : null);
  }, []);

  const runOpenPrimary = useCallback(
    async (href: string, copyTextValue?: string, pin?: string) => {
      // Re-copy under the same tap as open — clipboard after async fetch is flaky.
      if (copyTextValue) {
        const ok = await copyText(copyTextValue);
        if (ok) setAutoCopied(shortenCopied(copyTextValue, pin));
      }
      openAutoUrl(href);
    },
    [openAutoUrl],
  );

  const onBrandChange = useCallback(
    (id: string, paste?: ResolveResult["paste"]) => {
      setBrandId(id);
      try {
        window.localStorage.setItem(BRAND_STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      if (paste) {
        const guide = buildBrandPlaybook(id, paste);
        if (guide) openAutoUrl(guide.autoOpenUrl);
        void autoAssistPaste(paste, id);
      }
    },
    [openAutoUrl, autoAssistPaste],
  );

  const onCopy = useCallback(async (label: string, text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? label : null);
    if (ok) window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1600);
  }, []);

  const playbook = useMemo(() => {
    if (!result?.paste) return null;
    return buildBrandPlaybook(brandId, result.paste);
  }, [result?.paste, brandId]);

  // QR: prefer playbook.qrPayload (Pin text / HTTPS). Avoid encoding LAUNCHER
  // intent:# URLs that many camera scanners reject.
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

  const resolve = useCallback(async (value: string) => {
    const q = value.trim();
    if (!q) {
      setError("Paste a Google Maps share link, an Indian address, or lat,lng.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    setAutoOpenStatus(null);
    setAutoCopied(null);
    try {
      const res = await fetch(apiUrl("/api/public/gmap2mappls/resolve"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: q }),
      });
      const data = (await res.json()) as ResolveResult | { ok: false; error: string };
      if (!res.ok || !data.ok) {
        setResult(null);
        setError(("error" in data && data.error) || "Could not resolve that location.");
        return;
      }
      setResult(data);
      const guide = buildBrandPlaybook(brandId, data.paste);
      if (guide) openAutoUrl(guide.autoOpenUrl);
      void autoAssistPaste(data.paste, brandId);
    } catch {
      setResult(null);
      setError("Network error — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [brandId, openAutoUrl, autoAssistPaste]);

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
      await onCopy("primary", playbook.primary.copyText);
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

  const statusNote = (() => {
    if (!playbook) return "";
    if (!onAndroid) {
      return isPinPasteBrand && pinReady
        ? `On desktop: scan the QR for Pin “${result?.paste.mapplsPin}”, then open ${appName} on Android and Push to car.`
        : "On desktop: scan the QR with your Android phone (app must be installed).";
    }
    if (autoOpenStatus === "blocked") return "Open was blocked — tap the button below.";
    if (isPinPasteBrand) {
      if (pinReady) {
        return autoOpenStatus === "opened"
          ? `${appName} opened. Paste Pin “${result?.paste.mapplsPin}” in search → Push to car.`
          : `Opens ${appName}. Paste the Pin (auto-copied) → Push to car — never paste lat,lng.`;
      }
      return autoOpenStatus === "opened"
        ? `Opened handoff for ${appName}. Follow the step below (never paste lat,lng).`
        : `Preparing ${appName} handoff…`;
    }
    if (autoOpenStatus === "opened") {
      return `${appName} should have opened with this location.`;
    }
    return `Opening ${appName} with this location…`;
  })();

  return (
    <div className="g2m tool-workspace">
      <section className="g2m-hero">
        <p className="tool-shell-eyebrow" style={{ margin: 0, color: "rgba(0,223,255,0.85)" }}>
          Justxsystems · Free utility
        </p>
        <h1 className="g2m-brand">GMAP2MAPPLS</h1>
        <p className="g2m-tag">
          Pick brand → paste Google link → we open that brand’s app. You only confirm / push
          navigation in the app.
        </p>
      </section>

      <section className="g2m-composer">
        <label className="g2m-brand-label" htmlFor="g2m-brand-top">
          Vehicle brand
        </label>
        <select
          id="g2m-brand-top"
          className="g2m-brand-select"
          value={brandId}
          onChange={(e) => onBrandChange(e.target.value, result?.paste)}
        >
          <optgroup label="2W">
            {brands
              .filter((b) => b.segment === "2W")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.companionApp ? ` → ${b.companionApp.name}` : ""}
                </option>
              ))}
          </optgroup>
          <optgroup label="4W">
            {brands
              .filter((b) => b.segment === "4W")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.companionApp ? ` → ${b.companionApp.name}` : ""}
                </option>
              ))}
          </optgroup>
        </select>

        <div className="g2m-input-wrap">
          <label className="sr-only" htmlFor="g2m-input">
            Google Maps link, address, or coordinates
          </label>
          <textarea
            id="g2m-input"
            className="g2m-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste Google Maps link, address, or lat,lng"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void resolve(input);
              }
            }}
          />
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
              "Find & open brand app"
            )}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || (!input && !result)}
            onClick={() => {
              setInput("");
              setResult(null);
              setError(null);
              setAutoOpenStatus(null);
              setAutoCopied(null);
            }}
          >
            Clear
          </button>
        </div>
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
      </section>

      {error ? (
        <div className="g2m-error" role="alert">
          {error}
        </div>
      ) : null}

      {!result && !loading && !error ? (
        <div className="g2m-state">
          <strong>Waiting for a place</strong>
          Paste a Google Share link for the exact pin.
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
                <button type="button" className="btn btn-primary" onClick={() => void runPrimary()}>
                  {copied === "primary" && playbook.primary.kind === "copy"
                    ? "Copied — paste in your app now"
                    : playbook.primary.label}
                </button>
              )}
              {playbook.autoCopyText ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void onCopy("autocopy", playbook.autoCopyText || "")}
                >
                  {copied === "autocopy"
                    ? "Copied"
                    : result.paste.mapplsPin && playbook.autoCopyText === result.paste.mapplsPin
                      ? `Copy Pin (${result.paste.mapplsPin})`
                      : "Copy again for paste"}
                </button>
              ) : null}
            </div>

            <div className="g2m-paste-footer">
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

            <details className="g2m-secondary">
              <summary>Need a backup?</summary>
              <div className="g2m-paste-row">
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
                    onClick={() => void onCopy("pin", result.paste.mapplsPin || "")}
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
    </div>
  );
}
