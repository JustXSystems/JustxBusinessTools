"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureNativeCameraPermission } from "@/components/capacitor/CapacitorInit";
import { useToast } from "@/components/common/ToastProvider";
import { fetchProfile } from "@/lib/api";

type QrMode = "generate" | "scan";

export function QrTool() {
  const { showToast } = useToast();
  const [mode, setMode] = useState<QrMode>("generate");
  const [text, setText] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopCamera = useCallback(() => {
    if (tickRef.current != null) {
      cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  }, []);

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        if (p.businessName) setText(`Business: ${p.businessName}`);
      })
      .catch(() => {});
    return () => stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (mode !== "generate" || !canvasRef.current) return;
    let cancelled = false;

    async function renderQr() {
      try {
        const QRCode = await import("qrcode");
        if (cancelled || !canvasRef.current) return;
        await QRCode.toCanvas(canvasRef.current, text || " ", {
          width: 280,
          margin: 1,
          errorCorrectionLevel: "M",
        });
      } catch {
        /* canvas draw failed */
      }
    }

    renderQr();
    return () => {
      cancelled = true;
    };
  }, [mode, text]);

  useEffect(() => {
    if (mode === "scan") {
      stopCamera();
      setScanResult(null);
      setScanPreview(null);
      setCameraError("");
    }
  }, [mode, stopCamera]);

  async function decodeImageData(imageData: ImageData): Promise<string | null> {
    const jsQR = (await import("jsqr")).default;
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    return code?.data ?? null;
  }

  function onScanFound(data: string) {
    stopCamera();
    setScanResult(data);
  }

  useEffect(() => {
    if (!cameraOn || mode !== "scan") return;

    let cancelled = false;

    async function runCamera() {
      setCameraError("");
      try {
        const allowed = await ensureNativeCameraPermission();
        if (!allowed) {
          setCameraError("Camera permission is required for scanning.");
          setCameraOn(false);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const tick = async () => {
          if (cancelled || !streamRef.current || !videoRef.current) return;
          const v = videoRef.current;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = await decodeImageData(imageData);
            if (data) {
              onScanFound(data);
              return;
            }
          }
          tickRef.current = requestAnimationFrame(tick);
        };
        tickRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setCameraError("Allow camera access, or use Upload Image instead.");
          setCameraOn(false);
        }
      }
    }

    runCamera();

    return () => {
      cancelled = true;
      if (tickRef.current != null) {
        cancelAnimationFrame(tickRef.current);
        tickRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [cameraOn, mode]);

  function startCamera() {
    setScanResult(null);
    setScanPreview(null);
    setCameraError("");
    setCameraOn(true);
  }

  async function handleUpload(file: File) {
    stopCamera();
    setCameraError("");
    const reader = new FileReader();
    reader.onload = async (e) => {
      const src = String(e.target?.result ?? "");
      setScanPreview(src);
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = await decodeImageData(imageData);
        if (data) onScanFound(data);
        else showToast("No QR code found in that image.");
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function downloadQr() {
    const canvas = canvasRef.current;
    if (!canvas) {
      showToast("QR not ready yet.");
      return;
    }
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "qr-code.png";
    a.click();
  }

  async function copyResult() {
    if (!scanResult) return;
    try {
      await navigator.clipboard.writeText(scanResult);
      showToast("Copied to clipboard");
    } catch {
      showToast("Could not copy");
    }
  }

  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">←</Link>
        <div className="tool-header-text">
          <div className="tool-header-title">🔳 QR Code Scanner</div>
          <div className="tool-header-sub">
            Generate a QR code, or scan one with your camera or an image.
          </div>
        </div>
      </div>

      <div className="btn-row mb-14">
        <button
          type="button"
          className={`btn btn-sm ${mode === "generate" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setMode("generate")}
        >
          ✨ Generate
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === "scan" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setMode("scan")}
        >
          📷 Scan
        </button>
      </div>

      {mode === "generate" ? (
        <div className="panel">
          <label className="field">
            <span className="label">Text, URL, or UPI details</span>
            <textarea
              rows={3}
              placeholder="e.g. https://justx.example.com or upi://pay?pa=you@bank"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="qr-gen-box">
            <canvas ref={canvasRef} />
          </div>
          <button type="button" className="btn btn-secondary btn-block mt-12" onClick={downloadQr}>
            ⬇ Download QR Image
          </button>
        </div>
      ) : (
        <div className="panel">
          <div className="btn-row mb-14">
            <button type="button" className="btn btn-primary flex-1" onClick={startCamera}>
              📷 Use Camera
            </button>
            <button
              type="button"
              className="btn btn-secondary flex-1"
              onClick={() => fileInputRef.current?.click()}
            >
              🖼 Upload Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
          </div>

          <div className="qr-scan-area">
            {scanPreview ? (
              <img src={scanPreview} alt="Uploaded" className="qr-scan-preview" />
            ) : cameraError ? (
              <div className="empty-state empty-pad-24">
                <div className="es-icon">🚫</div>
                <div className="es-title">Camera unavailable</div>
                <div className="es-sub">{cameraError}</div>
              </div>
            ) : cameraOn ? (
              <video ref={videoRef} playsInline className="qr-scan-video" />
            ) : (
              <span className="qr-scan-hint">
                Choose &quot;Use Camera&quot; or &quot;Upload Image&quot; to scan a QR code.
              </span>
            )}
          </div>

          {scanResult ? (
            <div className="result-box mt-14">
              <div className="result-label">Scanned Result</div>
              <div className="qr-scan-result-text">{scanResult}</div>
              <button type="button" className="btn btn-secondary btn-sm mt-10" onClick={copyResult}>
                📋 Copy
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
