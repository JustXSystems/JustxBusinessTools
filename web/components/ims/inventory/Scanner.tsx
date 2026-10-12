"use client";

import "./inventory-a.css";

import jsQR from "jsqr";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Input, Segmented, useToast } from "@/components/bos";
import { ImsApiError, errorText, ims, type ImsItem } from "@/lib/ims/api";
import { dateLabel, inr, num, qtyText, stockBadge, todayLocal } from "@/lib/ims/format";
import { createBarcodeDetector, scanFeedback, type TorchCapabilities, type TorchConstraint } from "@/lib/ims/inventory-a";
import { PageHeader, Stack, StatusBadge, useIms } from "../core";
import { ItemAvatar } from "./ItemDetail";

type Detector = Awaited<ReturnType<typeof createBarcodeDetector>>;
type Found = { code: string; item: ImsItem | null };
type SessionLine = { itemId: string; name: string; sku: string | null; unit: string; stock: number; qty: number };
type Mode = "lookup" | "batch";

const SESSION_KEY = "ims.scan.session";
const SCAN_INTERVAL_MS = 120;

function loadSession(): SessionLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((l): l is SessionLine => Boolean(l && typeof l === "object" && typeof (l as SessionLine).itemId === "string" && typeof (l as SessionLine).qty === "number"));
  } catch {
    return [];
  }
}

function cameraErrorText(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera permission was blocked. Allow camera access for this site in the browser's address bar, then try again — or type / photograph the code below.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Type the code, use a USB/Bluetooth barcode gun, or scan from a photo.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it there and try again.";
  return `Couldn't start the camera (${errorText(err)}).`;
}

/** Decodes one frame: native BarcodeDetector first (1D + QR), jsQR for QR when native is missing or lacks QR. */
async function decodeSource(source: HTMLVideoElement | ImageBitmap, width: number, height: number, detector: Detector, canvas: HTMLCanvasElement, thorough = false): Promise<string | null> {
  if (detector) {
    try {
      const hits = await detector.detect(source);
      const hit = hits.find((h) => h.rawValue);
      if (hit) return hit.rawValue;
    } catch {
      /* frame not ready */
    }
  }
  if (!width || !height) return null;
  const scale = Math.min(1, (thorough ? 1280 : 640) / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return jsQR(img.data, w, h, { inversionAttempts: thorough ? "attemptBoth" : "dontInvert" })?.data ?? null;
}

function Stepper({ value, onChange, label, min = 1 }: { value: string; onChange: (v: string) => void; label: string; min?: number }) {
  const n = num(value, min);
  return (
    <span className="ims-stepper">
      <Button size="sm" variant="secondary" iconOnly aria-label={`Decrease ${label}`} onClick={() => onChange(String(Math.max(min, n - 1)))} disabled={n <= min}>
        −
      </Button>
      <Input size="sm" inputMode="decimal" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      <Button size="sm" variant="secondary" iconOnly aria-label={`Increase ${label}`} onClick={() => onChange(String(n + 1))}>
        +
      </Button>
    </span>
  );
}

export function ScannerModule() {
  const { can, navigate, invalidate } = useIms();
  const { show } = useToast();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const detectorRef = useRef<Detector>(null);
  const pausedRef = useRef(false);
  const decodingRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const cacheRef = useRef(new Map<string, ImsItem | null>());
  const handleRef = useRef<(code: string) => void>(() => undefined);
  const manualRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const [camera, setCamera] = useState<"off" | "starting" | "on">("off");
  const [camError, setCamError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [torch, setTorch] = useState({ supported: false, on: false });
  const [engine, setEngine] = useState<"native" | "qr" | null>(null);
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<Mode>("lookup");
  const [found, setFound] = useState<Found | null>(null);
  const [looking, setLooking] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; n: number } | null>(null);
  const [manual, setManual] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<{ scope: "item" | "session"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [session, setSession] = useState<SessionLine[]>(loadSession);
  const [history, setHistory] = useState<Array<{ code: string; name: string | null }>>([]);

  const canIn = can("stockIn");
  const canOut = can("stockOut");
  const canCount = can("stockCheck");

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* storage full or blocked */
    }
  }, [session]);

  const stopTracks = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => {
    const timer = timerRef;
    const stream = streamRef;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, []);

  const tick = async () => {
    const video = videoRef.current;
    if (!streamRef.current || !video) return;
    if (!pausedRef.current && !decodingRef.current && video.readyState >= 2) {
      decodingRef.current = true;
      try {
        canvasRef.current ??= document.createElement("canvas");
        const code = await decodeSource(video, video.videoWidth, video.videoHeight, detectorRef.current, canvasRef.current);
        if (code && !pausedRef.current) handleRef.current(code);
      } finally {
        decodingRef.current = false;
      }
    }
    if (streamRef.current) timerRef.current = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
  };

  const stop = () => {
    stopTracks();
    setCamera("off");
    setTorch({ supported: false, on: false });
  };

  const start = async (face: "environment" | "user" = facing) => {
    stopTracks();
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError(window.isSecureContext ? "This browser can't open the camera. Type the code or scan from a photo instead." : "The camera needs a secure (https) connection. Type the code or scan from a photo instead.");
      return;
    }
    setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: face }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
      setTorch({ supported: Boolean(caps.torch), on: false });
      detectorRef.current ??= await createBarcodeDetector();
      setEngine(detectorRef.current ? "native" : "qr");
      pausedRef.current = false;
      setPaused(false);
      setCamera("on");
      void tick();
    } catch (err) {
      stopTracks();
      setCamera("off");
      setCamError(cameraErrorText(err));
    }
  };

  const flip = () => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void start(next);
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as TorchConstraint] });
      setTorch({ supported: true, on });
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  const resume = () => {
    setFound(null);
    setError(null);
    setQty("1");
    pausedRef.current = false;
    setPaused(false);
    if (camera === "off") manualRef.current?.focus();
  };

  const addToSession = (item: ImsItem, by: number) =>
    setSession((s) => {
      const hit = s.find((l) => l.itemId === item.id);
      if (hit) return s.map((l) => (l.itemId === item.id ? { ...l, qty: Math.max(0, l.qty + by), stock: item.currentStock } : l));
      return [{ itemId: item.id, name: item.name, sku: item.sku, unit: item.unit, stock: item.currentStock, qty: Math.max(0, by) }, ...s];
    });

  const lookup = async (raw: string, fresh = false) => {
    const code = raw.trim();
    if (!code) return;
    setLooking(true);
    setError(null);
    try {
      let item = fresh ? undefined : cacheRef.current.get(code);
      if (item === undefined) {
        item = (await ims.lookupItem(code)).item;
        cacheRef.current.set(code, item);
      }
      scanFeedback(Boolean(item));
      setFlash({ ok: Boolean(item), n: Date.now() });
      setHistory((h) => [{ code, name: item?.name ?? null }, ...h.filter((x) => x.code !== code)].slice(0, 8));
      setFound({ code, item });
      setQty("1");
      if (mode === "batch" && item) {
        addToSession(item, 1);
        pausedRef.current = false;
        setPaused(false);
      }
    } catch (err) {
      show({ tone: "coral", title: "Lookup failed", description: errorText(err) });
      pausedRef.current = false;
      setPaused(false);
    } finally {
      setLooking(false);
    }
  };

  const handleCode = (raw: string) => {
    const code = raw.trim().slice(0, 64);
    if (!code) return;
    const now = Date.now();
    if (lastRef.current.code === code && now - lastRef.current.at < (mode === "batch" ? 1500 : 2500)) return;
    lastRef.current = { code, at: now };
    if (mode === "lookup") {
      pausedRef.current = true;
      setPaused(true);
    }
    void lookup(code);
  };

  useEffect(() => {
    handleRef.current = handleCode;
  });

  const scanPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      detectorRef.current ??= await createBarcodeDetector();
      canvasRef.current ??= document.createElement("canvas");
      const code = await decodeSource(bitmap, bitmap.width, bitmap.height, detectorRef.current, canvasRef.current, true);
      bitmap.close();
      if (code) {
        lastRef.current = { code: "", at: 0 };
        handleCode(code);
      } else {
        scanFeedback(false);
        show({ tone: "amber", title: "No code found in that photo", description: "Fill the frame with the QR / barcode, keep it sharp and well lit." });
      }
    } catch (err) {
      show({ tone: "coral", title: "Couldn't read that image", description: errorText(err) });
    }
  };

  const post = async (type: "IN" | "OUT", lines: Array<{ itemId: string; qty: number }>, scope: "item" | "session") => {
    setBusy(`${scope}:${type}`);
    setError(null);
    try {
      const r = await ims.postMovements({ type, lines, notes: scope === "session" ? "QR scan session" : "QR stock scan" });
      const units = r.movements.reduce((s, m) => s + m.qty, 0);
      show({
        tone: "emerald",
        title: `${type === "IN" ? "Stock in" : "Stock out"} posted`,
        description: r.movements.length === 1 ? `${r.movements[0].itemName}: ${type === "IN" ? "+" : "−"}${qtyText(units)} → ${qtyText(r.movements[0].after)} left` : `${r.movements.length} items · ${qtyText(units)} units`,
      });
      for (const m of r.movements) for (const [code, it] of cacheRef.current) if (it?.id === m.itemId) cacheRef.current.delete(code);
      invalidate();
      return r;
    } catch (err) {
      if (err instanceof ImsApiError && err.insufficientStock) setError({ scope, text: err.message });
      else show({ tone: "coral", title: "Couldn't post that", description: errorText(err) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const postFound = async (type: "IN" | "OUT") => {
    if (!found?.item) return;
    const n = num(qty);
    if (!(n > 0)) {
      setError({ scope: "item", text: "Enter a quantity above zero." });
      return;
    }
    const r = await post(type, [{ itemId: found.item.id, qty: n }], "item");
    if (r) await lookup(found.code, true);
  };

  const postSession = async (type: "IN" | "OUT") => {
    const lines = session.filter((l) => l.qty > 0).map((l) => ({ itemId: l.itemId, qty: l.qty }));
    if (!lines.length) return;
    const r = await post(type, lines, "session");
    if (r) setSession([]);
  };

  const countSession = async () => {
    const lines = session.filter((l) => l.qty >= 0);
    if (!lines.length) return;
    setBusy("session:COUNT");
    setError(null);
    try {
      const { check } = await ims.createCheck({ title: `Scan count · ${dateLabel(todayLocal())}`, itemIds: lines.map((l) => l.itemId), notes: "Counted with QR Stock Scan" });
      await ims.saveCount(check.id, { lines: lines.map((l) => ({ itemId: l.itemId, physicalQty: l.qty })) });
      show({ tone: "emerald", title: `Stock check ${check.checkNo} created`, description: `${lines.length} counted item${lines.length === 1 ? "" : "s"} — review and submit it for approval.` });
      setSession([]);
      invalidate();
      navigate("checks", `open:${check.id}`);
    } catch (err) {
      show({ tone: "coral", title: "Couldn't create the stock check", description: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const sessionUnits = session.reduce((s, l) => s + l.qty, 0);
  const item = found?.item ?? null;
  const shortBy = item && num(qty) > item.currentStock ? num(qty) - item.currentStock : 0;

  let result: ReactNode = null;
  if (looking && !found) result = <p className="ims-faint">Looking up…</p>;
  else if (found && !item)
    result = (
      <Alert
        tone="amber"
        title="No item uses this code"
        actions={
          <>
            {can("items") ? (
              <Button size="sm" variant="primary" icon="plus" onClick={() => navigate("items", `new:${found.code}`)}>
                Create item with this code
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={resume}>
              Scan again
            </Button>
          </>
        }
      >
        Scanned <span className="bos-code">{found.code}</span>. Add it as a new item, or put this code in an existing item&apos;s barcode field.
      </Alert>
    );
  else if (item && found)
    result = (
      <Card interactive={false}>
        <div className="ims-between" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
          <span className="ims-row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <ItemAvatar item={item} size={46} />
            <span className="ims-cell-stack">
              <span className="ims-strong" style={{ fontSize: 15 }}>
                {item.name}
              </span>
              <small>{[item.sku, item.category, item.brand].filter(Boolean).join(" · ") || found.code}</small>
            </span>
          </span>
          <span className="ims-row" style={{ gap: 6 }}>
            <StatusBadge view={stockBadge(item.status)} />
            {item.active ? null : <Badge tone="neutral">ARCHIVED</Badge>}
          </span>
        </div>
        <div className="ims-inv-tiles" style={{ marginTop: 14 }}>
          <div className="ims-inv-tile">
            <small>In stock</small>
            <b className={item.currentStock <= 0 ? "ims-neg" : undefined}>{qtyText(item.currentStock, item.unit)}</b>
            <span>Min {qtyText(item.minStock)}</span>
          </div>
          <div className="ims-inv-tile">
            <small>Selling price</small>
            <b>{inr(item.sellingPrice)}</b>
            <span>{item.mrp != null ? `MRP ${inr(item.mrp)}` : `GST ${item.gstRate}%`}</span>
          </div>
          <div className="ims-inv-tile">
            <small>Location</small>
            <b style={{ fontSize: 14 }}>{item.location ?? "—"}</b>
            <span>{item.damagedStock ? `${qtyText(item.damagedStock)} damaged` : "No damaged units"}</span>
          </div>
        </div>

        {item.active && (canIn || canOut) ? (
          <div style={{ marginTop: 14 }}>
            <div className="ims-between">
              <Stepper value={qty} onChange={setQty} label="Quantity" />
              <span className="ims-row" style={{ gap: 6 }}>
                {canIn ? (
                  <Button variant="success" onClick={() => void postFound("IN")} disabled={busy !== null}>
                    {busy === "item:IN" ? "Posting…" : `⬇ In +${qtyText(num(qty))}`}
                  </Button>
                ) : null}
                {canOut ? (
                  <Button variant="secondary" onClick={() => void postFound("OUT")} disabled={busy !== null}>
                    {busy === "item:OUT" ? "Posting…" : `⬆ Out −${qtyText(num(qty))}`}
                  </Button>
                ) : null}
              </span>
            </div>
            {shortBy > 0 && canOut ? <p className="ims-faint" style={{ marginTop: 6 }}>Stock out of {qtyText(num(qty))} is {qtyText(shortBy)} more than on hand.</p> : null}
          </div>
        ) : null}
        {error?.scope === "item" ? (
          <div style={{ marginTop: 12 }}>
            <Alert tone="coral" title="Not enough stock">
              {error.text}
            </Alert>
          </div>
        ) : null}

        <div className="ims-inv-actions" style={{ marginTop: 14 }}>
          <Button size="sm" variant="ghost" onClick={() => addToSession(item, Math.max(1, num(qty, 1)))}>
            ＋ Add to session
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate("items", `open:${item.id}`)}>
            Open item
          </Button>
          {canIn ? (
            <Button size="sm" variant="ghost" onClick={() => navigate("stockin", `item:${item.id}`)}>
              Full stock-in form
            </Button>
          ) : null}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" onClick={resume}>
            Scan next
          </Button>
        </div>
      </Card>
    );

  return (
    <Stack>
      <PageHeader
        title="QR Stock Scan"
        sub="Scan a QR code or barcode to look up an item and move stock in seconds. Works with the camera, a barcode gun, or a photo."
        actions={
          <Segmented
            size="sm"
            role="radio"
            aria-label="Scan mode"
            value={mode}
            onChange={(m) => {
              setMode(m);
              if (m === "batch") resume();
            }}
            options={[
              { value: "lookup", label: "Look up & move" },
              { value: "batch", label: "Batch count" },
            ]}
          />
        }
      />

      <div className="ims-scan-layout">
        <Stack gap={14}>
          <div className="ims-scan-stage">
            <div className="ims-scanner ims-scan-box">
              <video ref={videoRef} muted playsInline aria-label="Camera preview" style={{ display: camera === "off" ? "none" : "block" }} />
              {camera !== "off" ? <div className="ims-scanner-frame" aria-hidden="true" /> : null}
              {camera === "on" && !paused ? <div className="ims-scan-laser" aria-hidden="true" /> : null}
              {flash ? <div key={flash.n} className={`ims-scan-flash${flash.ok ? "" : " is-miss"}`} aria-hidden="true" /> : null}
              {camera === "on" ? (
                <>
                  <span className="ims-scan-badge">
                    {paused ? "Paused" : mode === "batch" ? "Batch counting" : "Scanning"} · {engine === "native" ? "QR + barcodes" : "QR codes"}
                  </span>
                  <div className="ims-scan-tools">
                    {torch.supported ? (
                      <button type="button" className="ims-scan-tool" aria-pressed={torch.on} aria-label="Torch" onClick={() => void toggleTorch()}>
                        🔦
                      </button>
                    ) : null}
                    <button type="button" className="ims-scan-tool" aria-label="Switch camera" onClick={flip}>
                      ⇄
                    </button>
                  </div>
                </>
              ) : null}
              {camera === "off" ? (
                <div className="ims-scan-idle">
                  <span className="ims-scan-idle-ic" aria-hidden="true">
                    ⌗
                  </span>
                  <b>Point the camera at a QR code or barcode</b>
                  <span>Item labels from Items → Print labels scan straight in.</span>
                </div>
              ) : camera === "starting" ? (
                <div className="ims-scan-idle">
                  <b>Starting camera…</b>
                </div>
              ) : null}
            </div>
          </div>
          <div className="ims-row">
            {camera === "off" ? (
              <Button variant="primary" onClick={() => void start()}>
                📷 Start camera
              </Button>
            ) : (
              <Button variant="secondary" icon="x" onClick={stop}>
                Stop camera
              </Button>
            )}
            {camera === "on" && paused ? (
              <Button variant="ghost" icon="refresh" onClick={resume}>
                Resume scanning
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => photoRef.current?.click()}>
              🖼 Scan from photo
            </Button>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                void scanPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          {camError ? (
            <Alert tone="amber" title="Camera unavailable">
              {camError}
            </Alert>
          ) : null}
          <form
            className="ims-row"
            style={{ flexWrap: "nowrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              lastRef.current = { code: "", at: 0 };
              handleCode(manual);
              setManual("");
            }}
          >
            <Input ref={manualRef} placeholder="Type or scan a barcode / SKU and press Enter" aria-label="Item code" value={manual} onChange={(e) => setManual(e.target.value)} autoFocus maxLength={64} style={{ flex: 1 }} />
            <Button type="submit" disabled={!manual.trim() || looking}>
              Look up
            </Button>
          </form>
          {history.length ? (
            <div>
              <div className="ims-inv-subhead" style={{ marginTop: 0 }}>
                Recent scans
              </div>
              <div className="ims-scan-history">
                {history.map((h) => (
                  <button key={h.code} type="button" className="bos-filter-chip" onClick={() => void lookup(h.code, true)} title={h.code}>
                    {h.name ?? `Unknown · ${h.code}`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Stack>

        <Stack gap={14}>
          <div aria-live="polite">
            {result ?? (
              <Card interactive={false}>
                <EmptyState glyph="⌗" title={mode === "batch" ? "Batch count mode" : "Ready to scan"}>
                  {mode === "batch" ? "Every scan adds 1 to the session below. Post the session as stock in / out, or save it as a stock count." : "Scan an item to see its stock and move it in or out right here."}
                </EmptyState>
              </Card>
            )}
          </div>

          <Card interactive={false}>
            <div className="ims-between" style={{ marginBottom: 8 }}>
              <span className="ims-cell-stack">
                <span className="ims-strong">Scan session</span>
                <small>
                  {session.length} item{session.length === 1 ? "" : "s"} · {qtyText(sessionUnits)} units
                </small>
              </span>
              {session.length ? (
                <Button size="sm" variant="ghost" onClick={() => setSession([])}>
                  Clear
                </Button>
              ) : null}
            </div>
            {session.length ? (
              <>
                <div>
                  {session.map((l) => (
                    <div key={l.itemId} className="ims-scan-session-row">
                      <span className="ims-cell-stack">
                        <span className="ims-strong">{l.name}</span>
                        <small>
                          {l.sku ? `${l.sku} · ` : ""}
                          {qtyText(l.stock, l.unit)} in stock
                        </small>
                      </span>
                      <Stepper value={String(l.qty)} min={0} onChange={(v) => setSession((s) => s.map((x) => (x.itemId === l.itemId ? { ...x, qty: Math.max(0, num(v)) } : x)))} label={`Quantity of ${l.name}`} />
                      <IconButton icon="x" aria-label={`Remove ${l.name}`} onClick={() => setSession((s) => s.filter((x) => x.itemId !== l.itemId))} />
                    </div>
                  ))}
                </div>
                {error?.scope === "session" ? (
                  <div style={{ marginTop: 10 }}>
                    <Alert tone="coral" title="Not enough stock — nothing was posted">
                      {error.text}
                    </Alert>
                  </div>
                ) : null}
                <div className="ims-inv-actions" style={{ marginTop: 12 }}>
                  {canIn ? (
                    <Button size="sm" variant="success" onClick={() => void postSession("IN")} disabled={busy !== null || !sessionUnits}>
                      {busy === "session:IN" ? "Posting…" : "⬇ Post as stock in"}
                    </Button>
                  ) : null}
                  {canOut ? (
                    <Button size="sm" onClick={() => void postSession("OUT")} disabled={busy !== null || !sessionUnits}>
                      {busy === "session:OUT" ? "Posting…" : "⬆ Post as stock out"}
                    </Button>
                  ) : null}
                  {canCount ? (
                    <Button size="sm" variant="ghost" onClick={() => void countSession()} disabled={busy !== null}>
                      {busy === "session:COUNT" ? "Creating…" : "☑ Save as stock count"}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="ims-faint">Scanned items you add (or every scan in batch mode) collect here, so you can post them together.</p>
            )}
          </Card>
        </Stack>
      </div>
    </Stack>
  );
}
