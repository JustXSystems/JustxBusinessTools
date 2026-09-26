"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { useToast } from "@/components/common/ToastProvider";
import { ToolPageHero } from "@/components/shell/ToolPageHero";
import { ColorField, FieldInput, Segmented } from "@/components/utilities/qr-generator/controls";
import { QrBatchPanel } from "@/components/utilities/qr-generator/QrBatchPanel";
import { trackEvent } from "@/lib/analytics";
import { fetchProfile } from "@/lib/api";
import { publicAssetUrl } from "@/lib/base-path";
import {
  eclAtLeast,
  maxEcl,
  QR_TOOL_ID,
  resolveQrGeneratorConfig,
  type QrExportFormat,
  type QrGeneratorConfig,
} from "@/lib/qr-generator/config";
import {
  blobToPngDataUrl,
  buildPosterPdf,
  downloadBlob,
  renderPngBlob,
  renderPngDataUrl,
  svgBlob,
  verifyCanvasDecodes,
} from "@/lib/qr-generator/export";
import {
  addHistoryEntry,
  historyLabel,
  readHistory,
  relativeTime,
  stripSecretFields,
  writeHistory,
  type QrHistoryEntry,
} from "@/lib/qr-generator/history";
import {
  buildQrPayload,
  getQrTypeDef,
  isQrType,
  QR_TYPES,
  qrFileStem,
  type QrFields,
  type QrType,
} from "@/lib/qr-generator/payloads";
import {
  CAPTION_MAX,
  createQrMatrix,
  DEFAULT_QR_DESIGN,
  designWarnings,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  normalizeHex,
  QrCapacityError,
  renderQrToCanvas,
  type QrDesign,
  type QrEcl,
  type QrEyeStyle,
  type QrModuleStyle,
} from "@/lib/qr-generator/render";
import type { BusinessProfile } from "@/lib/types/business-profile";
import "./qr-generator.css";

const STORAGE_KEY = "jbt.qrgen.v1";
const PREVIEW_PX = 720;
const LOGO_MAX_BYTES = 3 * 1024 * 1024;

type FieldsByType = Partial<Record<QrType, QrFields>>;
type Mode = "single" | "batch";

type StoredState = {
  type?: string;
  fieldsByType?: FieldsByType;
  design?: Partial<QrDesign>;
  downloadSize?: number;
};

const MODULE_STYLES: Array<{ value: QrModuleStyle; label: string }> = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "dots", label: "Dots" },
];

const EYE_STYLES: Array<{ value: QrEyeStyle; label: string }> = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
];

const ECL_OPTIONS: Array<{ value: QrEcl; label: string }> = [
  { value: "H", label: "H — High, 30% recovery (recommended)" },
  { value: "Q", label: "Q — Quartile, 25% recovery" },
  { value: "M", label: "M — Medium, 15% recovery (smallest code)" },
];

const UTM_KEYS = ["utmOn", "utmSource", "utmMedium", "utmCampaign"];

function readStored(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredState) : {};
  } catch {
    return {};
  }
}

function detectCapabilities() {
  let share = false;
  try {
    const probe = new File([new Blob()], "probe.png", { type: "image/png" });
    share = typeof navigator.share === "function" && !!navigator.canShare?.({ files: [probe] });
  } catch {
    /* Web Share with files unsupported */
  }
  return {
    copyImage: "ClipboardItem" in window && typeof navigator.clipboard?.write === "function",
    share,
  };
}

function brandDesign(cfg: QrGeneratorConfig, logoDataUrl: string | null): QrDesign {
  return { ...DEFAULT_QR_DESIGN, ...cfg.brand.design, caption: "", logoDataUrl };
}

function profileFill(type: QrType, p: BusinessProfile | null): QrFields {
  if (!p) return {};
  const address = [p.addressLine1, p.addressLine2].filter(Boolean).join(", ");
  const raw = ((): QrFields => {
    switch (type) {
      case "upi":
        return { pa: p.bankUpi ?? "", pn: p.businessName };
      case "bank":
        return {
          holder: p.businessName,
          account: p.bankAccount ?? "",
          ifsc: p.bankIfsc ?? "",
          bankName: p.bankName ?? "",
          branch: p.bankBranch ?? "",
          gstin: p.gstin ?? "",
        };
      case "vcard":
        return { org: p.businessName, mobile: p.phone ?? "", email: p.email ?? "", street: address, state: p.state ?? "" };
      case "phone":
      case "sms":
      case "whatsapp":
        return { phone: p.phone ?? "" };
      case "email":
        return { to: p.email ?? "" };
      case "maps":
        return address ? { mode: "search", query: [p.businessName, address, p.state].filter(Boolean).join(", ") } : {};
      default:
        return {};
    }
  })();
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => String(v ?? "").trim()));
}

/** Client-only (loaded with ssr: false) — reads localStorage and browser APIs during init. */
export function QrGeneratorTool() {
  const { config, loading, getToolDefinition } = usePlatformConfig();
  const definition = getToolDefinition(QR_TOOL_ID)?.definition;
  const cfg = useMemo(() => resolveQrGeneratorConfig(definition), [definition]);

  if (loading && !config) {
    return (
      <div className="empty-state">
        <div className="es-icon">⏳</div>
        <div className="es-title">Loading…</div>
      </div>
    );
  }
  return <QrWorkspace cfg={cfg} />;
}

function QrWorkspace({ cfg }: { cfg: QrGeneratorConfig }) {
  const { showToast } = useToast();
  const F = cfg.features;
  const locked = cfg.brand.lockDesign;

  const [stored] = useState<StoredState>(() => (F.rememberDrafts ? readStored() : {}));
  const [mode, setMode] = useState<Mode>("single");
  const [rawType, setType] = useState<QrType>(() =>
    isQrType(stored.type) && cfg.enabledTypes.includes(stored.type) ? stored.type : cfg.defaultType,
  );
  const [fieldsByType, setFieldsByType] = useState<FieldsByType>(() =>
    stored.fieldsByType && typeof stored.fieldsByType === "object" ? stored.fieldsByType : {},
  );
  const [design, setDesign] = useState<QrDesign>(() =>
    stored.design && typeof stored.design === "object"
      ? { ...brandDesign(cfg, null), ...stored.design, logoDataUrl: stored.design.logoDataUrl ?? null }
      : brandDesign(cfg, cfg.brand.logoSource === "custom" ? cfg.brand.logoDataUrl : null),
  );
  const [rawSize, setDownloadSize] = useState(() => stored.downloadSize ?? cfg.exports.defaultSize);
  const [caps] = useState(detectCapabilities);
  const [history, setHistory] = useState<QrHistoryEntry[]>(() => (F.history ? readHistory() : []));
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [businessLogo, setBusinessLogo] = useState<string | null>(null);
  const [loadedLogo, setLoadedLogo] = useState<{ src: string; img: HTMLImageElement } | null>(null);
  const [verify, setVerify] = useState<{ key: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const type = cfg.enabledTypes.includes(rawType) ? rawType : cfg.defaultType;
  const downloadSize = cfg.exports.sizes.includes(rawSize) ? rawSize : cfg.exports.defaultSize;
  const typeDef = getQrTypeDef(type);
  const enabledTypeDefs = QR_TYPES.filter((t) => cfg.enabledTypes.includes(t.id));
  const groups = [...new Set(enabledTypeDefs.map((t) => t.group))];
  const brandLogo =
    cfg.brand.logoSource === "custom" ? cfg.brand.logoDataUrl : cfg.brand.logoSource === "profile" ? businessLogo : null;

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then(async (p) => {
        if (cancelled) return;
        setProfile(p);
        if (!p.logo) return;
        const res = await fetch(publicAssetUrl(p.logo), { credentials: "include" });
        if (!res.ok) return;
        const dataUrl = await blobToPngDataUrl(await res.blob());
        if (cancelled) return;
        setBusinessLogo(dataUrl);
        if (cfg.brand.logoSource === "profile" && !stored.design) {
          setDesign((d) => (d.logoDataUrl ? d : { ...d, logoDataUrl: dataUrl }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cfg.brand.logoSource, stored.design]);

  useEffect(() => {
    if (!F.rememberDrafts) return;
    const t = setTimeout(() => {
      const clean: FieldsByType = {};
      for (const [k, v] of Object.entries(fieldsByType) as Array<[QrType, QrFields]>) clean[k] = stripSecretFields(v);
      const state: StoredState = { type, fieldsByType: clean, design, downloadSize };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Quota exceeded (usually a large logo) — keep everything except the logo.
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, design: { ...design, logoDataUrl: null } }));
        } catch {
          /* storage unavailable */
        }
      }
    }, 300);
    return () => clearTimeout(t);
  }, [F.rememberDrafts, type, fieldsByType, design, downloadSize]);

  const activeDesign = useMemo<QrDesign>(() => {
    const base = locked ? { ...brandDesign(cfg, brandLogo), caption: design.caption } : design;
    const ecl = base.logoDataUrl ? "H" : maxEcl(base.ecl, cfg.minEcl);
    return { ...base, ecl };
  }, [locked, cfg, brandLogo, design]);

  useEffect(() => {
    const src = activeDesign.logoDataUrl;
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setLoadedLogo({ src, img });
    };
    img.onerror = () => {
      if (cancelled) return;
      setDesign((d) => (d.logoDataUrl === src ? { ...d, logoDataUrl: null } : d));
      showToast("Couldn't load the logo — upload it again.");
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [activeDesign.logoDataUrl, showToast]);
  const logoImg = activeDesign.logoDataUrl && loadedLogo?.src === activeDesign.logoDataUrl ? loadedLogo.img : null;

  const fields = useMemo<QrFields>(() => {
    const utm = F.utm;
    const utmDefaults: QrFields =
      type === "url" && utm.enabled
        ? { utmOn: utm.defaultOn ? "1" : "", utmSource: utm.source, utmMedium: utm.medium, utmCampaign: utm.campaign }
        : {};
    const merged = { ...(typeDef.defaults ?? {}), ...utmDefaults, ...(cfg.fieldDefaults[type] ?? {}), ...(fieldsByType[type] ?? {}) };
    if (!utm.enabled) for (const k of UTM_KEYS) delete merged[k];
    return merged;
  }, [F.utm, type, typeDef, cfg.fieldDefaults, fieldsByType]);

  const result = useMemo(() => buildQrPayload(type, fields), [type, fields]);
  const payload = result.ok ? result.payload : null;
  const deferredPayload = useDeferredValue(payload);

  const qr = useMemo(() => {
    if (!deferredPayload) return { matrix: null, error: "" };
    try {
      return { matrix: createQrMatrix(deferredPayload, activeDesign.ecl), error: "" };
    } catch (err) {
      return {
        matrix: null,
        error:
          err instanceof QrCapacityError
            ? activeDesign.ecl === "M"
              ? "Too much content for one QR code — shorten it."
              : "Too much content at this error-correction level — shorten it, or remove the logo and choose a lower level."
            : "Could not generate this QR code.",
      };
    }
  }, [deferredPayload, activeDesign.ecl]);
  const matrix = qr.matrix;

  const verifyKey = useMemo(
    () =>
      JSON.stringify([
        deferredPayload,
        { ...activeDesign, logoDataUrl: activeDesign.logoDataUrl?.length ?? 0 },
        logoImg ? 1 : 0,
      ]),
    [deferredPayload, activeDesign, logoImg],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !matrix) return;
    if (activeDesign.logoDataUrl && !logoImg) return;
    renderQrToCanvas(canvas, matrix, activeDesign, PREVIEW_PX, logoImg);
    if (!F.verifyScan || !deferredPayload) return;
    let cancelled = false;
    const t = setTimeout(() => {
      verifyCanvasDecodes(canvas, deferredPayload)
        .then((ok) => {
          if (!cancelled) setVerify({ key: verifyKey, ok });
        })
        .catch(() => {
          if (!cancelled) setVerify({ key: verifyKey, ok: false });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [matrix, activeDesign, logoImg, F.verifyScan, deferredPayload, verifyKey]);

  const verifyStatus: "ok" | "fail" | "pending" | null =
    !F.verifyScan || !matrix ? null : verify?.key === verifyKey ? (verify.ok ? "ok" : "fail") : "pending";

  const warnings = useMemo(() => {
    const list = designWarnings(activeDesign);
    if (result.ok && result.warning) list.unshift(result.warning);
    if (matrix && matrix.version >= 15) list.push("Dense code — print it at least 3 cm wide, or shorten the content.");
    return list;
  }, [activeDesign, result, matrix]);

  const fillValues = useMemo(() => profileFill(type, profile), [type, profile]);
  const canFillFromProfile = F.fillFromProfile && Object.keys(fillValues).length > 0;
  const visibleHistory = history.filter((h) => cfg.enabledTypes.includes(h.type));

  function setField(key: string, value: string) {
    setFieldsByType((prev) => ({ ...prev, [type]: { ...(prev[type] ?? {}), [key]: value } }));
  }

  function patchDesign(patch: Partial<QrDesign>) {
    setDesign((d) => ({ ...d, ...patch }));
  }

  function fillFromProfile() {
    setFieldsByType((prev) => ({ ...prev, [type]: { ...(prev[type] ?? {}), ...fillValues } }));
    showToast("Filled from Business Profile");
  }

  function clearForm() {
    setFieldsByType((prev) => ({ ...prev, [type]: {} }));
  }

  function restore(entry: QrHistoryEntry) {
    setMode("single");
    setType(entry.type);
    setFieldsByType((prev) => ({ ...prev, [entry.type]: entry.fields }));
  }

  function clearHistory() {
    setHistory([]);
    writeHistory([]);
  }

  function locateMe() {
    if (!navigator.geolocation) {
      showToast("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setFieldsByType((prev) => ({
          ...prev,
          maps: {
            ...(prev.maps ?? {}),
            mode: "coords",
            lat: pos.coords.latitude.toFixed(6),
            lng: pos.coords.longitude.toFixed(6),
          },
        }));
      },
      () => {
        setLocating(false);
        showToast("Couldn't get your location — allow location access or type the coordinates.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function applyLogoBlob(blob: Blob) {
    if (!blob.type.startsWith("image/")) {
      showToast("Choose an image file (PNG, JPG, SVG or WebP).");
      return;
    }
    if (blob.size > LOGO_MAX_BYTES) {
      showToast("Logo is larger than 3 MB — choose a smaller image.");
      return;
    }
    try {
      patchDesign({ logoDataUrl: await blobToPngDataUrl(blob) });
    } catch {
      showToast("Couldn't read that image.");
    }
  }

  const fileStem = qrFileStem(type, fields, cfg.exports.filenamePrefix);
  const has = (f: QrExportFormat) => cfg.exports.formats.includes(f);

  function recordExport(format: string, count = 1) {
    trackEvent("record.export", { toolId: QR_TOOL_ID, properties: { qrType: type, format, count } });
  }

  async function runAction(format: string, action: () => Promise<void>) {
    if (!matrix || busy) return;
    setBusy(true);
    try {
      await action();
      recordExport(format);
      if (F.history) {
        const next = addHistoryEntry(history, type, fields, F.historyMax);
        setHistory(next);
        writeHistory(next);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        showToast(err instanceof Error && err.message ? err.message : "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  const pngBlob = () => renderPngBlob(matrix!, activeDesign, downloadSize, logoImg);

  const downloadPng = () => runAction("png", async () => downloadBlob(await pngBlob(), `${fileStem}.png`));
  const downloadSvg = () =>
    runAction("svg", async () => downloadBlob(svgBlob(matrix!, activeDesign, downloadSize), `${fileStem}.svg`));
  const downloadPdf = () =>
    runAction("pdf", async () => {
      const img = renderPngDataUrl(matrix!, { ...activeDesign, caption: "" }, 1200, logoImg);
      const heading = activeDesign.caption.trim() || cfg.captions[type] || "";
      downloadBlob(await buildPosterPdf(img, heading, historyLabel(type, fields)), `${fileStem}.pdf`);
    });
  const copyImage = () =>
    runAction("clipboard", async () => {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await pngBlob() })]);
      showToast("QR image copied — paste it into WhatsApp, email or a document.");
    });
  const shareImage = () =>
    runAction("share", async () => {
      const file = new File([await pngBlob()], `${fileStem}.png`, { type: "image/png" });
      await navigator.share({ files: [file], title: typeDef.label });
    });

  async function copyContent() {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      showToast("Encoded content copied");
    } catch {
      showToast("Couldn't copy");
    }
  }

  const visibleFields = typeDef.fields.filter((f) => !f.showIf || f.showIf(fields));
  const captionSuggestion = cfg.captions[type];
  const brandAccent = profile?.documentAccentColor ? normalizeHex(profile.documentAccentColor) : null;
  const presets = brandAccent ? [{ name: "Brand", fg: brandAccent }, ...cfg.brand.presets] : cfg.brand.presets;
  const incomplete = !result.ok && !result.error;
  const errorMessage = !result.ok ? result.error : qr.error;
  const eclOptions = ECL_OPTIONS.filter((o) => eclAtLeast(o.value, cfg.minEcl));

  const previewPanel = (
    <aside className="qrg-area-preview">
      <section className="panel qrg-preview-panel" aria-live="polite">
        <div className="qrg-panel-head">
          <h2 className="panel-title">Preview &amp; download</h2>
          {verifyStatus ? (
            <span
              className={`qrg-verify qrg-verify-${verifyStatus}`}
              title="The preview is decoded on this device to confirm it scans."
            >
              {verifyStatus === "ok" ? "✓ Scan verified" : verifyStatus === "fail" ? "⚠ Scan check failed" : "Checking…"}
            </span>
          ) : null}
        </div>

        <div className={`qrg-stage${matrix ? " is-live" : ""}`} style={{ background: matrix ? activeDesign.bg : undefined }}>
          {matrix ? (
            <canvas ref={canvasRef} className="qrg-canvas" role="img" aria-label={`${typeDef.label} QR code`} />
          ) : (
            <div className="empty-state qrg-empty">
              <div className="es-icon">{errorMessage ? "⚠️" : typeDef.icon}</div>
              <div className="es-title">{errorMessage ? "Can't generate yet" : "Your QR code will appear here"}</div>
              <div className="es-sub">{errorMessage || (incomplete ? "Fill in the required fields (*)." : "")}</div>
            </div>
          )}
        </div>

        {matrix ? (
          <p className="qrg-meta">
            Version {matrix.version} · {matrix.size}×{matrix.size} modules · Error correction {matrix.ecl}
          </p>
        ) : null}

        {verifyStatus === "fail" ? (
          <div className="qrg-alert qrg-alert-danger">
            This design didn&apos;t decode in our check. Increase contrast, shrink the logo or switch to square modules
            before printing.
          </div>
        ) : null}
        {matrix && errorMessage ? <div className="qrg-alert qrg-alert-danger">{errorMessage}</div> : null}
        {warnings.map((w) => (
          <div key={w} className="qrg-alert">
            {w}
          </div>
        ))}

        <div className="qrg-download">
          {has("png") || has("copy") || has("share") || has("svg") ? (
            <label className="field qrg-size" htmlFor="qrg-size">
              <span className="label">Image size</span>
              <select id="qrg-size" value={downloadSize} onChange={(e) => setDownloadSize(Number(e.target.value))}>
                {cfg.exports.sizes.map((s) => (
                  <option key={s} value={s}>
                    {s} px{s === 1024 ? " (print)" : s >= 2048 ? " (large print)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="qrg-actions">
            {has("png") ? (
              <button type="button" className="btn btn-primary" disabled={!matrix || busy} onClick={downloadPng}>
                ⬇ PNG
              </button>
            ) : null}
            {has("svg") ? (
              <button type="button" className="btn btn-secondary" disabled={!matrix || busy} onClick={downloadSvg}>
                ⬇ SVG
              </button>
            ) : null}
            {has("pdf") ? (
              <button type="button" className="btn btn-secondary" disabled={!matrix || busy} onClick={downloadPdf}>
                🖨 PDF poster
              </button>
            ) : null}
            {has("copy") && caps.copyImage ? (
              <button type="button" className="btn btn-secondary" disabled={!matrix || busy} onClick={copyImage}>
                📋 Copy image
              </button>
            ) : null}
            {has("share") && caps.share ? (
              <button type="button" className="btn btn-secondary" disabled={!matrix || busy} onClick={shareImage}>
                📤 Share
              </button>
            ) : null}
          </div>
          {cfg.exports.formats.length === 0 ? (
            <div className="qrg-alert">Downloads are turned off by your administrator.</div>
          ) : null}
        </div>

        {payload && F.showEncoded ? (
          <details className="qrg-advanced">
            <summary>Encoded content</summary>
            <pre className="qrg-payload">{payload}</pre>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyContent}>
              Copy text
            </button>
          </details>
        ) : null}

        <p className="section-note qrg-tip">
          Tip: test-scan with two different phones before printing. SVG and PDF stay sharp at any size — best for banners
          and packaging.
        </p>
      </section>
    </aside>
  );

  return (
    <div className="tool-workspace qrg-root" data-verify={verifyStatus ?? undefined}>
      <ToolPageHero
        eyebrow="Utilities"
        title={cfg.title}
        subtitle={cfg.subtitle}
        meta={
          <>
            <span className="tool-shell-chip">🔳 {enabledTypeDefs.length} QR types</span>
            {locked ? <span className="tool-shell-chip">🛡 Brand style applied</span> : null}
            <span className="tool-shell-chip tool-shell-chip-muted">Generated on this device</span>
          </>
        }
        actions={
          F.batch ? (
            <div className="qrg-seg qrg-mode" role="tablist" aria-label="Mode">
              <button type="button" role="tab" aria-selected={mode === "single"} className={mode === "single" ? "is-active" : ""} onClick={() => setMode("single")}>
                Single QR
              </button>
              <button type="button" role="tab" aria-selected={mode === "batch"} className={mode === "batch" ? "is-active" : ""} onClick={() => setMode("batch")}>
                Batch
              </button>
            </div>
          ) : null
        }
      />

      {mode === "batch" && F.batch ? (
        <QrBatchPanel
          cfg={cfg}
          initialType={type}
          design={activeDesign}
          logo={logoImg}
          onExported={({ type: t, format, count }) =>
            trackEvent("record.export", { toolId: QR_TOOL_ID, properties: { qrType: t, format: `batch-${format}`, count } })
          }
        />
      ) : (
        <div className="qrg-layout">
          <section className="panel qrg-area-content">
            <div className="qrg-panel-head">
              <h2 className="panel-title">Content</h2>
              <div className="qrg-head-actions">
                {canFillFromProfile ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={fillFromProfile}>
                    🏢 Fill from Business Profile
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearForm}>
                  Clear
                </button>
              </div>
            </div>

            <label className="field" htmlFor="qrg-type">
              <span className="label">QR type</span>
              <select id="qrg-type" value={type} onChange={(e) => setType(e.target.value as QrType)}>
                {groups.map((group) => (
                  <optgroup key={group} label={group}>
                    {enabledTypeDefs
                      .filter((t) => t.group === group)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.icon} {t.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <p className="section-note">{typeDef.hint}</p>

            {F.history && visibleHistory.length ? (
              <div className="qrg-recent">
                <span className="qrg-recent-label">Recent</span>
                <div className="qrg-recent-list">
                  {visibleHistory.slice(0, 6).map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="qrg-recent-chip"
                      title={`${getQrTypeDef(h.type).label} · ${relativeTime(h.at)}`}
                      onClick={() => restore(h)}
                    >
                      <span aria-hidden>{getQrTypeDef(h.type).icon}</span>
                      {h.label}
                    </button>
                  ))}
                  <button type="button" className="qrg-link" onClick={clearHistory}>
                    clear
                  </button>
                </div>
              </div>
            ) : null}

            <div className="qrg-grid" key={type}>
              {visibleFields.map((def) => (
                <FieldInput key={def.key} def={def} value={fields[def.key] ?? ""} onChange={(v) => setField(def.key, v)} />
              ))}
            </div>

            {type === "maps" && (fields.mode || "coords") === "coords" ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={locateMe} disabled={locating}>
                {locating ? "Locating…" : "📍 Use my current location"}
              </button>
            ) : null}

            {type === "url" && F.utm.enabled ? (
              <div className="qrg-utm">
                <label className="qrg-check">
                  <input
                    type="checkbox"
                    checked={fields.utmOn === "1"}
                    onChange={(e) => setField("utmOn", e.target.checked ? "1" : "")}
                  />
                  <span>Track scans in Google Analytics (add UTM tags)</span>
                </label>
                {fields.utmOn === "1" ? (
                  <div className="qrg-grid qrg-grid-3">
                    {(
                      [
                        ["utmSource", "Source", "qr"],
                        ["utmMedium", "Medium", "print, flyer, packaging"],
                        ["utmCampaign", "Campaign", "diwali-2026"],
                      ] as const
                    ).map(([key, label, ph]) => (
                      <label key={key} className="field" htmlFor={`qrg-${key}`}>
                        <span className="label">{label}</span>
                        <input
                          id={`qrg-${key}`}
                          type="text"
                          value={fields[key] ?? ""}
                          placeholder={ph}
                          onChange={(e) => setField(key, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {previewPanel}

          <section className="panel qrg-area-design">
            <div className="qrg-panel-head">
              <h2 className="panel-title">Design</h2>
              {!locked ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setDesign({ ...brandDesign(cfg, brandLogo), caption: design.caption })}
                >
                  Reset to brand defaults
                </button>
              ) : null}
            </div>

            {locked ? (
              <div className="qrg-locked">
                <span aria-hidden>🛡</span>
                <div>
                  <strong>Your organisation&apos;s brand style is applied.</strong>
                  <p>Colours, shapes and logo are set by your administrator so every QR code looks consistent.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="field">
                  <span className="label">Colour presets</span>
                  <div className="qrg-swatches">
                    {presets.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        className={`qrg-swatch${design.fg === p.fg && !design.eyeColor ? " is-active" : ""}`}
                        onClick={() => patchDesign({ fg: p.fg, eyeColor: "", bg: "#ffffff" })}
                        title={p.name}
                      >
                        <i style={{ background: p.fg }} aria-hidden />
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="qrg-grid qrg-grid-3">
                  <ColorField label="Code colour" value={design.fg} onChange={(fg) => patchDesign({ fg })} />
                  <ColorField label="Background" value={design.bg} onChange={(bg) => patchDesign({ bg })} />
                  <ColorField
                    label="Corner colour"
                    value={design.eyeColor || design.fg}
                    onChange={(eyeColor) => patchDesign({ eyeColor })}
                    action={
                      design.eyeColor ? (
                        <button type="button" className="qrg-link" onClick={() => patchDesign({ eyeColor: "" })}>
                          match code
                        </button>
                      ) : null
                    }
                  />
                </div>

                <div className="qrg-grid">
                  <Segmented label="Module shape" value={design.moduleStyle} options={MODULE_STYLES} onChange={(moduleStyle) => patchDesign({ moduleStyle })} />
                  <Segmented label="Corner shape" value={design.eyeStyle} options={EYE_STYLES} onChange={(eyeStyle) => patchDesign({ eyeStyle })} />
                </div>

                <div className="field">
                  <span className="label">Centre logo</span>
                  <div className="qrg-logo-row">
                    <div className="qrg-logo-thumb" aria-hidden>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                      {design.logoDataUrl ? <img src={design.logoDataUrl} alt="" /> : <span>🖼</span>}
                    </div>
                    <div className="btn-row">
                      {cfg.brand.allowLogoUpload ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => logoInputRef.current?.click()}>
                          Upload logo
                        </button>
                      ) : null}
                      {brandLogo && design.logoDataUrl !== brandLogo ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => patchDesign({ logoDataUrl: brandLogo })}>
                          Use brand logo
                        </button>
                      ) : null}
                      {businessLogo && businessLogo !== brandLogo && design.logoDataUrl !== businessLogo ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => patchDesign({ logoDataUrl: businessLogo })}>
                          Use business logo
                        </button>
                      ) : null}
                      {design.logoDataUrl ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => patchDesign({ logoDataUrl: null })}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void applyLogoBlob(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {design.logoDataUrl ? (
                    <label className="qrg-range">
                      <span>Logo size</span>
                      <input
                        type="range"
                        min={LOGO_SCALE_MIN}
                        max={LOGO_SCALE_MAX}
                        step={0.01}
                        value={design.logoScale}
                        onChange={(e) => patchDesign({ logoScale: Number(e.target.value) })}
                      />
                      <output>{Math.round(design.logoScale * 100)}%</output>
                    </label>
                  ) : null}
                </div>
              </>
            )}

            <label className="field" htmlFor="qrg-caption">
              <span className="label">
                Caption under the code
                {captionSuggestion && design.caption !== captionSuggestion ? (
                  <button type="button" className="qrg-link" onClick={() => patchDesign({ caption: captionSuggestion })}>
                    use “{captionSuggestion}”
                  </button>
                ) : null}
              </span>
              <input
                id="qrg-caption"
                type="text"
                value={design.caption}
                maxLength={CAPTION_MAX}
                placeholder="e.g. Scan me"
                onChange={(e) => patchDesign({ caption: e.target.value })}
              />
            </label>

            {!locked ? (
              <details className="qrg-advanced">
                <summary>Advanced</summary>
                <div className="qrg-grid">
                  <label className="field" htmlFor="qrg-ecl">
                    <span className="label">Error correction</span>
                    <select
                      id="qrg-ecl"
                      value={activeDesign.ecl}
                      disabled={!!design.logoDataUrl}
                      onChange={(e) => patchDesign({ ecl: e.target.value as QrEcl })}
                    >
                      {eclOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="qrg-hint">
                      {design.logoDataUrl
                        ? "Locked to H while a logo covers part of the code."
                        : cfg.minEcl !== "M"
                          ? `Your organisation requires at least level ${cfg.minEcl}.`
                          : "Higher levels survive dirt, glare and logos but make the code denser."}
                    </span>
                  </label>
                  <label className="field" htmlFor="qrg-margin">
                    <span className="label">Quiet zone (blank border): {design.margin} modules</span>
                    <input
                      id="qrg-margin"
                      type="range"
                      min={2}
                      max={8}
                      step={1}
                      value={design.margin}
                      onChange={(e) => patchDesign({ margin: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </details>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
