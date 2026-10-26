"use client";

import { useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/ims/api";
import { field, type GeoFix } from "@/lib/ims/field";

export type GeoError = { kind: "error"; reason: "unsupported" | "denied" | "unavailable" | "timeout"; message: string };
export type GeoState = { kind: "locating" } | { kind: "ok"; fix: GeoFix; at: number } | GeoError;

export const geoSupported = (): boolean => typeof navigator !== "undefined" && "geolocation" in navigator;

const fixOf = (pos: GeolocationPosition): GeoFix => ({
  lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
  lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
  accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
});

function geoError(err: GeolocationPositionError): GeoError {
  if (err.code === err.PERMISSION_DENIED) {
    return { kind: "error", reason: "denied", message: "Location permission is blocked. Allow location for this site in your browser settings, then retry." };
  }
  if (err.code === err.TIMEOUT) return { kind: "error", reason: "timeout", message: "Couldn't get a GPS fix in time. Move near a window or open sky and retry." };
  return { kind: "error", reason: "unavailable", message: "Your device couldn't determine its location right now." };
}

function unsupported(): GeoError | null {
  if (!geoSupported()) return { kind: "error", reason: "unsupported", message: "This browser can't share location." };
  if (typeof window !== "undefined" && !window.isSecureContext) return { kind: "error", reason: "unsupported", message: "Location needs a secure (https) connection." };
  return null;
}

/** One-shot high-accuracy fix; never rejects. */
export function getFix(timeoutMs = 15_000): Promise<GeoState> {
  const blocked = unsupported();
  if (blocked) return Promise.resolve(blocked);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ kind: "ok", fix: fixOf(pos), at: Date.now() }),
      (err) => resolve(geoError(err)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/** `GeoFix` for a request body, or nulls when there is no fix. */
export const fixBody = (geo: GeoState): { lat: number | null; lng: number | null; accuracy: number | null } =>
  geo.kind === "ok" ? geo.fix : { lat: null, lng: null, accuracy: null };

const LIVE_KEY = "ims.field.live";
const PING_EVERY_MS = 60_000;

/**
 * Live location sharing while this tab is open: watches the position and posts the
 * latest fix every minute. The on/off choice survives module switches for the session.
 */
export function useLiveShare(onSent?: () => void) {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.sessionStorage.getItem(LIVE_KEY) === "1" && !unsupported());
  const [status, setStatus] = useState<{ lastSentAt: number | null; accuracy: number | null; error: string | null }>({ lastSentAt: null, accuracy: null, error: null });
  const latest = useRef<GeoFix | null>(null);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  useEffect(() => {
    if (!on) return;
    let alive = true;
    const send = async () => {
      const fix = latest.current;
      if (!fix || !alive) return;
      try {
        await field.ping(fix);
        if (!alive) return;
        setStatus((s) => ({ ...s, lastSentAt: Date.now(), error: null }));
        onSentRef.current?.();
      } catch (err) {
        if (alive) setStatus((s) => ({ ...s, error: errorText(err) }));
      }
    };
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const first = latest.current === null;
        latest.current = fixOf(pos);
        setStatus((s) => ({ ...s, accuracy: latest.current?.accuracy ?? null, error: null }));
        if (first) void send();
      },
      (err) => {
        const e = geoError(err);
        setStatus((s) => ({ ...s, error: e.message }));
        if (e.reason === "denied") {
          window.sessionStorage.removeItem(LIVE_KEY);
          setOn(false);
        }
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 },
    );
    const timer = window.setInterval(() => void send(), PING_EVERY_MS);
    return () => {
      alive = false;
      navigator.geolocation.clearWatch(watch);
      window.clearInterval(timer);
      latest.current = null;
    };
  }, [on]);

  const toggle = (next: boolean) => {
    const blocked = next ? unsupported() : null;
    if (blocked) {
      setStatus((s) => ({ ...s, error: blocked.message }));
      return;
    }
    if (next) window.sessionStorage.setItem(LIVE_KEY, "1");
    else window.sessionStorage.removeItem(LIVE_KEY);
    setStatus({ lastSentAt: null, accuracy: null, error: null });
    setOn(next);
  };

  return { on, toggle, ...status };
}
