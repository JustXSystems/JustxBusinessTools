"use client";

import "leaflet/dist/leaflet.css";
import "./field.css";
import type * as Leaflet from "leaflet";
import type * as Protomaps from "protomaps-leaflet";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { EmptyState } from "@/components/bos";
import { escapeHtml, fitView, initialsOf, kmLabel, loadMapSettings, niceKm, probePmtiles, safeColor, toKm, type LatLng, type MapSettings } from "@/lib/ims/fieldmap";

export type MapMarker = { id: string; lat: number; lng: number; label: string; color: string; detail?: string };

type MapProps = {
  markers: ReadonlyArray<MapMarker>;
  /** A day's trail, drawn as a line under the markers. */
  path?: ReadonlyArray<LatLng>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  title: string;
};

function useMapSettings(override?: MapSettings): MapSettings | null {
  const [loaded, setLoaded] = useState<MapSettings | null>(null);
  useEffect(() => {
    if (override) return;
    let live = true;
    void loadMapSettings().then((m) => {
      if (live) setLoaded(m);
    });
    return () => {
      live = false;
    };
  }, [override]);
  return override ?? loaded;
}

/** Team positions on the map source chosen in Settings → Field map; the built-in map when none is set or tiles fail. */
export function TeamMap({ settings: override, empty, ...props }: MapProps & { settings?: MapSettings; empty?: ReactNode }) {
  const settings = useMapSettings(override);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  if (!props.markers.length && !props.path?.length) {
    return (
      empty ?? (
        <EmptyState glyph="🗺" title="No location yet">
          Locations appear once someone checks in with GPS or turns on live location.
        </EmptyState>
      )
    );
  }
  if (!settings) return <div className="ims-map ims-map-loading" aria-busy="true" aria-label={props.title} />;
  const key = [settings.source, settings.tileUrl, settings.pmtilesUrl, settings.flavor].join("|");
  if (settings.source === "builtin" || failedKey === key) return <BuiltinMap {...props} note={failedKey === key ? "Map tiles couldn't load — showing the built-in map" : undefined} />;
  return <TileMap key={key} {...props} settings={settings} onFail={() => setFailedKey(key)} />;
}

/* ---------- Built-in map: positions only, drawn in the browser ---------- */

const W = 800;
const H = 360;
type View = { key: string; sel: string | null; zoom: number; center: { x: number; y: number } | null };

function BuiltinMap({ markers, path = [], selectedId = null, onSelect, title, note }: MapProps & { note?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; center: { x: number; y: number }; moved: boolean } | null>(null);
  const fitKey = `${markers.map((m) => m.id).join(",")}|${path.length}`;
  const [view, setView] = useState<View>({ key: fitKey, sel: selectedId, zoom: 1, center: null });

  const all = [...markers, ...path];
  const origin = { lat: all.reduce((s, p) => s + p.lat, 0) / all.length, lng: all.reduce((s, p) => s + p.lng, 0) / all.length };
  const pts = markers.map((m) => ({ m, ...toKm(m, origin) }));
  const line = path.map((p) => toKm(p, origin));
  const fit = fitView([...pts, ...line], W, H);

  let v = view;
  if (v.key !== fitKey || v.sel !== selectedId) {
    const target = pts.find((p) => p.m.id === selectedId);
    v = v.key !== fitKey ? { key: fitKey, sel: selectedId, zoom: 1, center: null } : { ...v, sel: selectedId, center: target ? { x: target.x, y: target.y } : v.center };
    setView(v);
  }

  const scale = fit.scale * v.zoom;
  const center = v.center ?? { x: fit.cx, y: fit.cy };
  const px = (p: { x: number; y: number }) => ({ X: W / 2 + (p.x - center.x) * scale, Y: H / 2 + (p.y - center.y) * scale });
  const step = niceKm(W / 5 / scale);
  const grid = (c: number, half: number) => {
    const out: number[] = [];
    for (let k = Math.floor((c - half) / step) * step; k <= c + half && out.length < 40; k += step) out.push(k);
    return out;
  };

  const zoomBy = (f: number) => setView({ ...v, zoom: Math.min(64, Math.max(0.25, v.zoom * f)), center });
  const ratio = () => {
    const r = svgRef.current?.getBoundingClientRect();
    return r && r.width && r.height ? Math.max(W / r.width, H / r.height) : 1;
  };
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, center, moved: false };
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) e.currentTarget.setPointerCapture?.(e.pointerId);
    d.moved = true;
    const f = ratio() / scale;
    setView({ ...v, center: { x: d.center.x - dx * f, y: d.center.y - dy * f } });
  };
  const onUp = () => {
    window.setTimeout(() => {
      drag.current = null;
    }, 0);
  };
  const choose = (id: string) => {
    if (!drag.current?.moved) onSelect?.(id);
  };
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(id);
    }
  };

  const ordered = [...pts].sort((a, b) => Number(a.m.id === selectedId) - Number(b.m.id === selectedId));
  const linePx = line.map(px);
  const start = linePx[0];

  return (
    <div className="ims-map ims-map-builtin">
      <svg ref={svgRef} className="ims-map-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={title} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {grid(center.x, W / 2 / scale).map((k) => (
          <line key={`x${k}`} className="ims-map-grid" x1={px({ x: k, y: 0 }).X} x2={px({ x: k, y: 0 }).X} y1={0} y2={H} />
        ))}
        {grid(center.y, H / 2 / scale).map((k) => (
          <line key={`y${k}`} className="ims-map-grid" y1={px({ x: 0, y: k }).Y} y2={px({ x: 0, y: k }).Y} x1={0} x2={W} />
        ))}
        {linePx.length > 1 ? <polyline className="ims-map-path" points={linePx.map((p) => `${p.X},${p.Y}`).join(" ")} /> : null}
        {start && linePx.length > 1 ? <circle className="ims-map-start" cx={start.X} cy={start.Y} r={5} /> : null}
        {ordered.map(({ m, ...p }) => {
          const { X, Y } = px(p);
          const sel = m.id === selectedId;
          const r = sel ? 17 : 14;
          return (
            <g
              key={m.id}
              className={`ims-map-marker${sel ? " is-selected" : ""}${onSelect ? " is-button" : ""}`}
              transform={`translate(${X} ${Y})`}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `${m.label}${m.detail ? ` — ${m.detail}` : ""}` : undefined}
              aria-pressed={onSelect ? sel : undefined}
              onClick={() => choose(m.id)}
              onKeyDown={(e) => onKey(e, m.id)}
            >
              <title>{m.detail ? `${m.label} — ${m.detail}` : m.label}</title>
              {sel ? <circle r={r + 6} className="ims-map-halo" /> : null}
              <circle r={r} fill={safeColor(m.color)} className="ims-map-dot" />
              <text className="ims-map-initials" dy="0.35em" textAnchor="middle">
                {initialsOf(m.label)}
              </text>
              <text className="ims-map-label" y={r + 14} textAnchor="middle">
                {m.label.length > 24 ? `${m.label.slice(0, 23)}…` : m.label}
              </text>
            </g>
          );
        })}
        <g className="ims-map-scale" transform={`translate(16 ${H - 18})`}>
          <line x1={0} x2={step * scale} y1={0} y2={0} />
          <line x1={0} x2={0} y1={-5} y2={0} />
          <line x1={step * scale} x2={step * scale} y1={-5} y2={0} />
          <text x={(step * scale) / 2} y={-8} textAnchor="middle">
            {kmLabel(step)}
          </text>
        </g>
        <text className="ims-map-north" x={20} y={26} textAnchor="middle">
          N ↑
        </text>
      </svg>
      <div className="ims-map-ctl">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setView({ ...v, zoom: 1, center: null })} aria-label="Fit everyone in view" title="Fit everyone">
          ⤢
        </button>
      </div>
      <span className="ims-map-note">{note ?? "Built-in map · positions only, no street layer"}</span>
    </div>
  );
}

/* ---------- Tile map (opt-in): Leaflet + a tile server or a self-hosted PMTiles file ---------- */

type LeafletKit = { L: typeof Leaflet; map: Leaflet.Map; layer: Leaflet.LayerGroup };

function TileMap({ settings, markers, path = [], selectedId = null, onSelect, title, onFail }: MapProps & { settings: MapSettings; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const kit = useRef<LeafletKit | null>(null);
  const lastFit = useRef<string | null>(null);
  const lastSel = useRef<string | null>(null);
  const failRef = useRef(onFail);
  const selectRef = useRef(onSelect);
  const [gen, setGen] = useState(0);
  const { source, tileUrl, pmtilesUrl, attribution, maxZoom, flavor } = settings;

  useEffect(() => {
    failRef.current = onFail;
    selectRef.current = onSelect;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("leaflet");
        const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
        let pm: typeof Protomaps | null = null;
        if (source === "pmtiles") {
          if (!pmtilesUrl || (await probePmtiles(pmtilesUrl))) throw new Error("PMTiles unavailable");
          (window as unknown as { L?: typeof Leaflet }).L ??= L;
          pm = await import("protomaps-leaflet");
        } else if (!tileUrl) throw new Error("No tile address");
        if (cancelled || !box.current) return;
        const map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true, zoomControl: true }).setView([22.5, 79], 4);
        map.attributionControl.setPrefix(false);
        const credit = escapeHtml(attribution ?? "");
        if (pm && pmtilesUrl) pm.leafletLayer({ url: pmtilesUrl, flavor, lang: "en", attribution: credit, maxZoom }).addTo(map);
        else if (tileUrl) {
          let loaded = 0;
          let errors = 0;
          L.tileLayer(tileUrl, { attribution: credit, maxZoom })
            .on("tileload", () => {
              loaded += 1;
            })
            .on("tileerror", () => {
              errors += 1;
              if (!loaded && errors >= 4) failRef.current();
            })
            .addTo(map);
        }
        kit.current = { L, map, layer: L.layerGroup().addTo(map) };
        lastFit.current = null;
        setGen((g) => g + 1);
      } catch {
        if (!cancelled) failRef.current();
      }
    })();
    return () => {
      cancelled = true;
      kit.current?.map.remove();
      kit.current = null;
    };
  }, [source, tileUrl, pmtilesUrl, attribution, maxZoom, flavor]);

  const fitKey = `${markers.map((m) => m.id).join(",")}|${path.length}`;
  useEffect(() => {
    const k = kit.current;
    if (!k) return;
    const { L, map, layer } = k;
    layer.clearLayers();
    if (path.length > 1) L.polyline(path.map((p) => [p.lat, p.lng] as [number, number]), { color: "#4C6FF5", weight: 3, opacity: 0.85 }).addTo(layer);
    const ordered = [...markers].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
    for (const m of ordered) {
      const sel = m.id === selectedId;
      const icon = L.divIcon({
        className: `ims-map-pin${sel ? " is-selected" : ""}`,
        html: `<span style="background:${safeColor(m.color)}">${escapeHtml(initialsOf(m.label))}</span><em>${escapeHtml(m.label)}</em>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const mk = L.marker([m.lat, m.lng], { icon, title: m.label, keyboard: true, zIndexOffset: sel ? 1000 : 0 }).addTo(layer);
      if (m.detail) mk.bindTooltip(escapeHtml(m.detail), { direction: "top", offset: [0, -18] });
      mk.on("click", () => selectRef.current?.(m.id));
    }
    if (lastFit.current !== fitKey) {
      lastFit.current = fitKey;
      lastSel.current = selectedId;
      const pts = [...markers, ...path].map((p) => [p.lat, p.lng] as [number, number]);
      if (pts.length === 1) map.setView(pts[0], Math.min(15, maxZoom));
      else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: Math.min(16, maxZoom) });
    } else if (lastSel.current !== selectedId) {
      lastSel.current = selectedId;
      const target = markers.find((m) => m.id === selectedId);
      if (target) map.panTo([target.lat, target.lng]);
    }
  }, [gen, markers, path, selectedId, fitKey, maxZoom]);

  return <div ref={box} className="ims-map ims-map-tiles" role="region" aria-label={title} />;
}
