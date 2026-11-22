"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SAMPLE_FIXTURES, formatCoordPair, type ResolveResult } from "@jbt/shared";
import { apiUrl } from "@/lib/api-base";
import "./gmap2mappls/gmap2mappls.css";

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
};

export function Gmap2MapplsTool() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);

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
          Best accuracy = Google Maps Share → Copy link
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
