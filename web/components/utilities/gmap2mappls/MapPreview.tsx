"use client";

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

type Props = {
  lat: number;
  lng: number;
  zoom?: number;
};

export function MapPreview({ lat, lng, zoom = 16 }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const kit = useRef<{ map: Leaflet.Map; marker: Leaflet.CircleMarker } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!host.current || kit.current) return;
      const mod = await import("leaflet");
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      if (cancelled || !host.current) return;
      const map = L.map(host.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([lat, lng], zoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      }).addTo(map);
      const marker = L.circleMarker([lat, lng], {
        radius: 10,
        color: "#00dfff",
        weight: 3,
        fillColor: "#1a6fd4",
        fillOpacity: 0.85,
      }).addTo(map);
      kit.current = { map, marker };
      setTimeout(() => map.invalidateSize(), 80);
    }
    void boot();
    return () => {
      cancelled = true;
      if (kit.current) {
        kit.current.map.remove();
        kit.current = null;
      }
    };
    // Mount once; parent remounts via key when coords change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const k = kit.current;
    if (!k) return;
    k.map.setView([lat, lng], zoom);
    k.marker.setLatLng([lat, lng]);
  }, [lat, lng, zoom]);

  return <div ref={host} className="g2m-map" role="img" aria-label={`Map at ${lat}, ${lng}`} />;
}
