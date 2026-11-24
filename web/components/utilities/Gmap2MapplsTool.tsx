"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  SAMPLE_FIXTURES,
  formatCoordPair,
  type OemHandoffSummary,
  type ResolveResult,
} from "@jbt/shared";
import { apiUrl } from "@/lib/api-base";
import "./gmap2mappls/gmap2mappls.css";

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

export function Gmap2MapplsTool() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [qr, setQr] = useState<QrState>(null);

  const onCopy = useCallback(async (label: string, text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? label : null);
    if (ok) window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1600);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!result?.paste?.geoUri) {
      setQr(null);
      return;
    }
    const payload = result.paste.geoUri;
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
  }, [result?.paste?.geoUri]);

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
    } catch {
      setResult(null);
      setError("Network error — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  const chips = meta?.samples?.length
    ? meta.samples
    : SAMPLE_FIXTURES.map((s) => ({
        id: s.id,
        label: s.label,
        input: s.input,
        coords: formatCoordPair(s.lat, s.lng),
      }));

  return (
    <div className="g2m tool-workspace">
      <section className="g2m-hero">
        <p className="tool-shell-eyebrow" style={{ margin: 0, color: "rgba(0,223,255,0.85)" }}>
          Justxsystems · Free utility
        </p>
        <h1 className="g2m-brand">GMAP2MAPPLS</h1>
        <p className="g2m-tag">
          Paste a Google Maps share link, a full Indian address, or lat,lng — we lock one shared
          geographic point and open that same point on Mappls.
        </p>
        <div className="g2m-tip" role="note">
          Best accuracy = Google Maps Share → Copy link · Mappls OEMs need Mappls Pin (not lat,lng)
        </div>
      </section>

      <section className="g2m-composer">
        <div className="g2m-input-wrap">
          <label className="sr-only" htmlFor="g2m-input">
            Google Maps link, address, or coordinates
          </label>
          <textarea
            id="g2m-input"
            className="g2m-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://maps.app.goo.gl/…  or  full address  or  12.8804,77.5958"
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
              "Find on Mappls"
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
            }}
          >
            Clear
          </button>
          {meta && !meta.hasToken ? (
            <span className="g2m-sample">Sample mode — Mappls token not bound</span>
          ) : null}
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
          Paste a share link for the exact pin, or try an example chip.
        </div>
      ) : null}

      {loading && !result ? (
        <div className="g2m-state">
          <strong>
            <span className="g2m-spinner" aria-hidden />
            Matching the same point…
          </strong>
          Expanding links, geocoding if needed, then Mappls reverse-geocode only.
        </div>
      ) : null}

      {result ? (
        <>
          <div className="g2m-banner" role="status">
            <div>
              <div className="g2m-banner-meta">Shared coordinates (Google = Mappls)</div>
              <strong>{formatCoordPair(result.lat, result.lng)}</strong>
            </div>
            <div className="g2m-banner-meta">
              {result.sampleMode ? "Sample / offline Mappls address" : "Live Mappls reverse-geocode"}
            </div>
          </div>

          <section className="g2m-paste" aria-label="Open or paste into Mappls OEM apps">
            <h3>SimpleOne / OEM handoff (tested path)</h3>
            <p className="g2m-paste-tip" role="status">
              {result.paste?.tip ||
                "SimpleOne: paste place name, or Open Google → Share/Push to Simple Connect. Pin/lat,lng in search often land wrong."}
            </p>

            {result.paste?.searchQuery ? (
              <div className="g2m-pin-hero">
                <div>
                  <div className="g2m-banner-meta">
                    SimpleOne search — paste this place name (not Pin / not lat,lng)
                  </div>
                  <strong className="g2m-pin-code g2m-place-query">{result.paste.searchQuery}</strong>
                </div>
                <div className="g2m-paste-row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void onCopy("search", result.paste?.searchQuery || "")}
                  >
                    {copied === "search" ? "Copied place name" : "Copy place name"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="g2m-paste-warn">
                Place name unavailable — use Open Google / geo → Share or Push to Simple Connect.
              </p>
            )}

            <div className="g2m-steps" aria-label="SimpleOne steps">
              <strong>SimpleOne (works when Pin search fails)</strong>
              <ol>
                <li>Copy place name → paste in SimpleOne / Simple Connect destination search, pick the matching POI.</li>
                <li>
                  Or on phone: Open Google / Open phone maps → Share or Push Navigation to Simple Connect
                  (official “WhatsApp locations → Simple Connect” path).
                </li>
                <li>Do not paste Mappls Pin or lat,lng into SimpleOne search — Pin is correct on mappls.com but SimpleOne often fuzzy-matches the wrong place.</li>
              </ol>
            </div>

            <div className="g2m-paste-row">
              <a
                className="btn btn-primary btn-sm"
                href={result.paste?.googleMapsUrl || result.google.mapsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Google → share to Simple Connect
              </a>
              <a
                className="btn btn-primary btn-sm"
                href={result.paste?.simpleConnectIntentUrl || result.paste?.geoUri}
              >
                Open Simple Connect (geo)
              </a>
              <a
                className="btn btn-secondary btn-sm"
                href={result.paste?.geoUri || `geo:${result.lat},${result.lng}?q=${result.lat},${result.lng}`}
              >
                Open on phone maps
              </a>
              <a
                className="btn btn-secondary btn-sm"
                href={result.paste?.mapplsNavBikingUrl}
                target="_blank"
                rel="noreferrer"
              >
                Navigate Mappls · 2W
              </a>
              <a
                className="btn btn-secondary btn-sm"
                href={result.paste?.mapplsNavDrivingUrl}
                target="_blank"
                rel="noreferrer"
              >
                Navigate Mappls · 4W
              </a>
              {(result.paste?.mapplsPin || result.mappls.mapplsPin) ? (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    title="Correct on mappls.com — SimpleOne search may still fuzzy-match wrong"
                    onClick={() =>
                      void onCopy(
                        "pin",
                        result.paste?.mapplsPin || result.mappls.mapplsPin || "",
                      )
                    }
                  >
                    {copied === "pin"
                      ? "Copied Mappls Pin"
                      : `Copy Pin (${result.paste?.mapplsPin || result.mappls.mapplsPin}) — other OEMs`}
                  </button>
                  {result.paste?.mapplsPinUrl ? (
                    <a
                      className="btn btn-secondary btn-sm"
                      href={result.paste.mapplsPinUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Verify pin on Mappls
                    </a>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void onCopy("share", result.paste?.shareText || formatCoordPair(result.lat, result.lng))}
              >
                {copied === "share" ? "Copied share text" : "Copy share text"}
              </button>
              {result.paste?.digipin || result.mappls.digipin ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    void onCopy("digipin", result.paste?.digipin || result.mappls.digipin || "")
                  }
                >
                  {copied === "digipin"
                    ? "Copied Digipin"
                    : `Copy Digipin (${result.paste?.digipin || result.mappls.digipin})`}
                </button>
              ) : null}
            </div>
            <p className="g2m-paste-note">
              Verified: Mappls Pin <code>kcf7zj</code> opens Zigma on mappls.com. SimpleOne failure is
              OEM search (no reliable eLoc), not the pin. Use place name or Push Navigation.
            </p>
            <div className="g2m-paste-footer">
              <code className="g2m-paste-code">
                {(result.paste?.mapplsPin || result.mappls.mapplsPin)
                  ? `Pin ${result.paste?.mapplsPin || result.mappls.mapplsPin} · ${result.paste?.latLng || formatCoordPair(result.lat, result.lng)}`
                  : result.paste?.latLng || formatCoordPair(result.lat, result.lng)}
              </code>
              {qr ? (
                <figure className="g2m-qr">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr.dataUrl} alt="QR for geo coordinates" width={120} height={120} />
                  <figcaption>Scan on phone → same point</figcaption>
                </figure>
              ) : null}
            </div>
          </section>

          {meta?.oem ? (
            <section className="g2m-oem" aria-label="OEM coverage matrix">
              <h3>OEM coverage — what to use where</h3>
              <ol className="g2m-oem-steps">
                {meta.oem.universalSteps.map((step) => (
                  <li key={step}>{step.replace(/^\d+\.\s*/, "")}</li>
                ))}
              </ol>
              <div className="g2m-oem-table-wrap">
                <table className="g2m-oem-table">
                  <thead>
                    <tr>
                      <th>Brand</th>
                      <th>Seg</th>
                      <th>Stack</th>
                      <th>Use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meta.oem.brands.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <strong>{b.name}</strong>
                          <div className="g2m-oem-ex">{b.examples}</div>
                        </td>
                        <td>{b.segment}</td>
                        <td>{b.stack === "mappls" ? "Mappls" : b.stack === "ola_maps" ? "Ola Maps" : b.stack === "mixed" ? "Mixed" : "—"}</td>
                        <td>
                          {b.id === "simple-energy"
                            ? "Place name / Push"
                            : b.stack === "ola_maps"
                              ? "Google / geo"
                              : b.stack === "mixed"
                                ? "Pin + Google"
                                : "Pin / place name"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div className="g2m-grid">
            <article className="g2m-card">
              <h3>Google input</h3>
              <p className="g2m-name">{result.google.name}</p>
              <p className="g2m-addr">{result.google.input}</p>
              <div className="g2m-coords">
                {formatCoordPair(result.google.lat, result.google.lng)}
              </div>
              <div className="g2m-links">
                <a
                  className="btn btn-secondary btn-sm"
                  href={result.google.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Same point on Google
                </a>
              </div>
            </article>

            <article className="g2m-card">
              <h3>Mappls at same lat/lng</h3>
              <p className="g2m-name">
                {[result.mappls.locality, result.mappls.city, result.mappls.state]
                  .filter(Boolean)
                  .join(" · ") || "Mappls address"}
              </p>
              <p className="g2m-addr">{result.mappls.formattedAddress}</p>
              <div className="g2m-coords">
                {formatCoordPair(result.mappls.lat, result.mappls.lng)}
              </div>
              <div className="g2m-links">
                <a
                  className="btn btn-primary btn-sm"
                  href={result.mappls.mapplsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on mappls.com
                </a>
              </div>
            </article>
          </div>

          <div className="g2m-map-panel">
            <MapPreview
              key={`${result.lat},${result.lng}`}
              lat={result.lat}
              lng={result.lng}
            />
            <div className="g2m-map-actions">
              <a
                className="btn btn-primary btn-sm"
                href={result.mappls.mapplsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open on mappls.com
              </a>
              <a
                className="btn btn-secondary btn-sm"
                href={result.google.mapsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Same point on Google
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
