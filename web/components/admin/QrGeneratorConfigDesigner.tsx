"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorField, FieldInput, Segmented } from "@/components/utilities/qr-generator/controls";
import { fetchProfile } from "@/lib/api";
import { publicAssetUrl } from "@/lib/base-path";
import {
  DEFAULT_QR_CONFIG,
  maxEcl,
  QR_EXPORT_FORMATS,
  QR_SIZE_OPTIONS,
  qrConfigToDefinition,
  resolveQrGeneratorConfig,
  type QrBrandLogoSource,
  type QrExportFormat,
  type QrGeneratorConfig,
} from "@/lib/qr-generator/config";
import { blobToPngDataUrl, loadImage, verifyCanvasDecodes } from "@/lib/qr-generator/export";
import { buildQrPayload, getQrTypeDef, QR_TYPES, type QrType } from "@/lib/qr-generator/payloads";
import {
  CAPTION_MAX,
  createQrMatrix,
  designWarnings,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  renderQrToCanvas,
  type QrDesign,
  type QrEcl,
  type QrEyeStyle,
  type QrModuleStyle,
} from "@/lib/qr-generator/render";
import "@/components/utilities/qr-generator.css";
import "./qr-generator-config.css";

type Tab = "brand" | "types" | "output" | "features";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "brand", label: "Brand kit" },
  { id: "types", label: "QR types" },
  { id: "output", label: "Output" },
  { id: "features", label: "Features & copy" },
];

const ECL_OPTIONS: Array<{ value: QrEcl; label: string }> = [
  { value: "M", label: "M · 15%" },
  { value: "Q", label: "Q · 25%" },
  { value: "H", label: "H · 30%" },
];

const MODULE_OPTIONS: Array<{ value: QrModuleStyle; label: string }> = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "dots", label: "Dots" },
];

const EYE_OPTIONS: Array<{ value: QrEyeStyle; label: string }> = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
];

const LOGO_OPTIONS: Array<{ value: QrBrandLogoSource; label: string }> = [
  { value: "none", label: "No logo" },
  { value: "profile", label: "Business profile logo" },
  { value: "custom", label: "Upload" },
];

const SAMPLE_PAYLOAD = "https://example.com/qr-preview";
const PREVIEW_PX = 480;
const LOGO_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
const BRAND_LOGO_PX = 320;

type Parsed = { source: string; cfg: QrGeneratorConfig; error: string };

function parse(jsonText: string): Parsed {
  try {
    return { source: jsonText, cfg: resolveQrGeneratorConfig(JSON.parse(jsonText)), error: "" };
  } catch {
    return {
      source: jsonText,
      cfg: DEFAULT_QR_CONFIG,
      error: "The JSON definition is invalid. Fix it in JSON mode, or change anything here to replace it with a valid config.",
    };
  }
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="qrgc-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint ? <em>{hint}</em> : null}
      </span>
    </label>
  );
}

export function QrGeneratorConfigDesigner({
  jsonText,
  onChange,
}: {
  jsonText: string;
  onChange: (next: string) => void;
}) {
  const [state, setState] = useState<Parsed>(() => parse(jsonText));
  if (state.source !== jsonText) setState(parse(jsonText));
  const cfg = state.cfg;

  const [tab, setTab] = useState<Tab>("brand");
  const [openType, setOpenType] = useState<QrType | null>(null);
  const [previewType, setPreviewType] = useState<QrType>(cfg.defaultType);
  const [profileLogo, setProfileLogo] = useState<string | null>(null);
  const [profileLogoMissing, setProfileLogoMissing] = useState(false);
  const [loadedLogo, setLoadedLogo] = useState<{ src: string; img: HTMLImageElement } | null>(null);
  const [verify, setVerify] = useState<{ key: string; ok: boolean } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  function update(fn: (c: QrGeneratorConfig) => QrGeneratorConfig) {
    const next = fn(cfg);
    const text = JSON.stringify(qrConfigToDefinition(next), null, 2);
    setState({ source: text, cfg: next, error: "" });
    onChange(text);
  }

  const patchBrand = (p: Partial<QrGeneratorConfig["brand"]>) => update((c) => ({ ...c, brand: { ...c.brand, ...p } }));
  const patchDesign = (p: Partial<QrGeneratorConfig["brand"]["design"]>) =>
    update((c) => ({ ...c, brand: { ...c.brand, design: { ...c.brand.design, ...p } } }));
  const patchExports = (p: Partial<QrGeneratorConfig["exports"]>) => update((c) => ({ ...c, exports: { ...c.exports, ...p } }));
  const patchFeatures = (p: Partial<QrGeneratorConfig["features"]>) =>
    update((c) => ({ ...c, features: { ...c.features, ...p } }));
  const patchUtm = (p: Partial<QrGeneratorConfig["features"]["utm"]>) =>
    update((c) => ({ ...c, features: { ...c.features, utm: { ...c.features.utm, ...p } } }));

  const needsProfileLogo = cfg.brand.logoSource === "profile";
  useEffect(() => {
    if (!needsProfileLogo) return;
    let cancelled = false;
    fetchProfile()
      .then(async (p) => {
        if (!p.logo) {
          if (!cancelled) setProfileLogoMissing(true);
          return;
        }
        const res = await fetch(publicAssetUrl(p.logo), { credentials: "include" });
        if (!res.ok) throw new Error("logo fetch failed");
        const dataUrl = await blobToPngDataUrl(await res.blob());
        if (!cancelled) {
          setProfileLogo(dataUrl);
          setProfileLogoMissing(false);
        }
      })
      .catch(() => {
        if (!cancelled) setProfileLogoMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needsProfileLogo]);

  const brandLogo =
    cfg.brand.logoSource === "custom" ? cfg.brand.logoDataUrl : cfg.brand.logoSource === "profile" ? profileLogo : null;

  useEffect(() => {
    if (!brandLogo) return;
    let cancelled = false;
    loadImage(brandLogo)
      .then((img) => {
        if (!cancelled) setLoadedLogo({ src: brandLogo, img });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandLogo]);
  const logoImg = brandLogo && loadedLogo?.src === brandLogo ? loadedLogo.img : null;

  const activePreviewType = cfg.enabledTypes.includes(previewType) ? previewType : cfg.defaultType;
  const previewDef = getQrTypeDef(activePreviewType);
  const previewFields = { ...(previewDef.defaults ?? {}), ...(cfg.fieldDefaults[activePreviewType] ?? {}) };
  const built = buildQrPayload(activePreviewType, previewFields);
  const payload = built.ok ? built.payload : SAMPLE_PAYLOAD;
  const usingSample = !built.ok;

  const design: QrDesign = useMemo(
    () => ({
      ...cfg.brand.design,
      ecl: brandLogo ? "H" : maxEcl(cfg.brand.design.ecl, cfg.minEcl),
      caption: cfg.captions[activePreviewType] ?? "",
      logoDataUrl: brandLogo,
    }),
    [cfg.brand.design, cfg.minEcl, cfg.captions, activePreviewType, brandLogo],
  );
  const warnings = designWarnings(design);

  const renderKey = `${payload}|${JSON.stringify({ ...design, logoDataUrl: brandLogo ? brandLogo.length : 0 })}|${logoImg ? 1 : 0}`;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (design.logoDataUrl && !logoImg) return;
    let cancelled = false;
    try {
      renderQrToCanvas(canvas, createQrMatrix(payload, design.ecl), design, PREVIEW_PX, logoImg);
    } catch {
      return;
    }
    const t = setTimeout(() => {
      verifyCanvasDecodes(canvas, payload)
        .then((ok) => {
          if (!cancelled) setVerify({ key: renderKey, ok });
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // renderKey captures payload, design and logo readiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);
  const verifyStatus = verify?.key === renderKey ? (verify.ok ? "ok" : "fail") : "pending";

  async function onLogoFile(file: File) {
    setUploadError("");
    if (!file.type.startsWith("image/")) {
      setUploadError("Choose an image file (PNG, JPG, WebP or SVG).");
      return;
    }
    if (file.size > LOGO_UPLOAD_MAX_BYTES) {
      setUploadError("Logo must be under 3 MB.");
      return;
    }
    try {
      const dataUrl = await blobToPngDataUrl(file, BRAND_LOGO_PX);
      patchBrand({ logoSource: "custom", logoDataUrl: dataUrl });
    } catch {
      setUploadError("Couldn't read that image.");
    }
  }

  function toggleType(id: QrType, on: boolean) {
    update((c) => {
      const set = new Set(c.enabledTypes);
      if (on) set.add(id);
      else set.delete(id);
      const enabledTypes = QR_TYPES.map((t) => t.id).filter((t) => set.has(t));
      if (!enabledTypes.length) return c;
      const defaultType = enabledTypes.includes(c.defaultType) ? c.defaultType : enabledTypes[0];
      return { ...c, enabledTypes, defaultType };
    });
  }

  function setFieldDefault(type: QrType, key: string, value: string) {
    update((c) => {
      const current = { ...(c.fieldDefaults[type] ?? {}) };
      if (value) current[key] = value;
      else delete current[key];
      const fieldDefaults = { ...c.fieldDefaults };
      if (Object.keys(current).length) fieldDefaults[type] = current;
      else delete fieldDefaults[type];
      return { ...c, fieldDefaults };
    });
  }

  function toggleFormat(id: QrExportFormat, on: boolean) {
    const set = new Set(cfg.exports.formats);
    if (on) set.add(id);
    else set.delete(id);
    patchExports({ formats: QR_EXPORT_FORMATS.map((f) => f.id).filter((f) => set.has(f)) });
  }

  function toggleSize(size: number, on: boolean) {
    const set = new Set(cfg.exports.sizes);
    if (on) set.add(size);
    else set.delete(size);
    const sizes = QR_SIZE_OPTIONS.filter((s) => set.has(s));
    if (!sizes.length) return;
    patchExports({ sizes, defaultSize: sizes.includes(cfg.exports.defaultSize) ? cfg.exports.defaultSize : sizes[0] });
  }

  const presets = cfg.brand.presets;
  const setPreset = (idx: number, p: Partial<(typeof presets)[number]>) =>
    patchBrand({ presets: presets.map((row, i) => (i === idx ? { ...row, ...p } : row)) });

  const enabledTypeDefs = QR_TYPES.filter((t) => cfg.enabledTypes.includes(t.id));
  const noOperatorExport = !cfg.exports.formats.some((f) => f === "png" || f === "svg" || f === "pdf");

  const preview = (
    <aside className="qrgc-preview panel" aria-label="Live preview">
      <div className="qrg-panel-head">
        <strong>Live preview</strong>
        <span className={`qrg-verify qrg-verify-${verifyStatus}`} role="status">
          {verifyStatus === "ok" ? "✓ Scans" : verifyStatus === "fail" ? "⚠ Won't scan" : "Checking…"}
        </span>
      </div>
      <label className="field" htmlFor="qrgc-preview-type">
        <span className="label">Sample type</span>
        <select id="qrgc-preview-type" value={activePreviewType} onChange={(e) => setPreviewType(e.target.value as QrType)}>
          {enabledTypeDefs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.icon} {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="qrg-stage is-live">
        <canvas ref={canvasRef} className="qrg-canvas" role="img" aria-label="Brand style preview" />
      </div>
      <p className="qrg-hint">
        {usingSample
          ? "Showing sample content — add field defaults for this type to preview real data."
          : "Using this type's field defaults."}{" "}
        Error correction {design.ecl}
        {brandLogo ? " (forced to H because of the logo)" : ""}.
      </p>
      {warnings.map((w) => (
        <p key={w} className="qrg-alert">
          {w}
        </p>
      ))}
      {verifyStatus === "fail" ? (
        <p className="qrg-alert qrg-alert-danger">
          This style didn&apos;t decode in a test scan. Increase contrast, use square modules or shrink the logo.
        </p>
      ) : null}
      {cfg.brand.lockDesign ? <p className="pill">🛡 Operators get exactly this style</p> : null}
    </aside>
  );

  return (
    <div className="qrg-root qrgc" data-verify={verifyStatus}>
      {state.error ? <p className="field-error">{state.error}</p> : null}

      <div className="qrgc-toolbar">
        <div className="admin-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (window.confirm("Reset every QR generator setting to the product defaults?")) update(() => DEFAULT_QR_CONFIG);
          }}
        >
          Reset to defaults
        </button>
      </div>

      <div className="qrgc-layout">
        <div className="qrgc-main">
          {tab === "brand" ? (
            <section className="qrgc-section" aria-label="Brand kit">
              <h3>Colours & shape</h3>
              <div className="qrg-grid qrg-grid-3">
                <ColorField label="Foreground" value={cfg.brand.design.fg} onChange={(fg) => patchDesign({ fg })} />
                <ColorField label="Background" value={cfg.brand.design.bg} onChange={(bg) => patchDesign({ bg })} />
                <ColorField
                  label="Eye colour"
                  value={cfg.brand.design.eyeColor || cfg.brand.design.fg}
                  onChange={(eyeColor) => patchDesign({ eyeColor })}
                  action={
                    cfg.brand.design.eyeColor ? (
                      <button type="button" className="qrg-link" onClick={() => patchDesign({ eyeColor: "" })}>
                        match foreground
                      </button>
                    ) : null
                  }
                />
              </div>
              <div className="qrg-grid">
                <Segmented
                  label="Module shape"
                  value={cfg.brand.design.moduleStyle}
                  options={MODULE_OPTIONS}
                  onChange={(moduleStyle) => patchDesign({ moduleStyle })}
                />
                <Segmented
                  label="Corner eyes"
                  value={cfg.brand.design.eyeStyle}
                  options={EYE_OPTIONS}
                  onChange={(eyeStyle) => patchDesign({ eyeStyle })}
                />
                <Segmented
                  label="Default error correction"
                  value={cfg.brand.design.ecl}
                  options={ECL_OPTIONS}
                  onChange={(ecl) => patchDesign({ ecl })}
                />
                <label className="qrg-range">
                  <span>Quiet zone</span>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={1}
                    value={cfg.brand.design.margin}
                    onChange={(e) => patchDesign({ margin: Number(e.target.value) })}
                  />
                  <output>{cfg.brand.design.margin}</output>
                </label>
              </div>

              <h3>Logo</h3>
              <Segmented
                label="Centre logo"
                value={cfg.brand.logoSource === "custom" && !cfg.brand.logoDataUrl ? "none" : cfg.brand.logoSource}
                options={LOGO_OPTIONS}
                onChange={(logoSource) => {
                  if (logoSource === "custom" && !cfg.brand.logoDataUrl) logoInputRef.current?.click();
                  else patchBrand({ logoSource });
                }}
              />
              {cfg.brand.logoSource === "profile" && profileLogoMissing ? (
                <p className="qrg-alert">
                  The active business profile has no logo yet — operators will get a plain code until one is added in
                  Business Profile.
                </p>
              ) : null}
              <div className="qrg-logo-row">
                <div className="qrg-logo-thumb" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                  {brandLogo ? <img src={brandLogo} alt="" /> : <span>🖼</span>}
                </div>
                <div className="btn-row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => logoInputRef.current?.click()}>
                    {cfg.brand.logoDataUrl ? "Replace uploaded logo" : "Upload logo"}
                  </button>
                  {cfg.brand.logoDataUrl ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => patchBrand({ logoSource: "none", logoDataUrl: null })}
                    >
                      Remove upload
                    </button>
                  ) : null}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onLogoFile(file);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              {uploadError ? <p className="field-error">{uploadError}</p> : null}
              <p className="qrg-hint">Uploaded logos are downscaled to {BRAND_LOGO_PX}px and stored with this config.</p>
              {brandLogo ? (
                <label className="qrg-range">
                  <span>Logo size</span>
                  <input
                    type="range"
                    min={LOGO_SCALE_MIN}
                    max={LOGO_SCALE_MAX}
                    step={0.01}
                    value={cfg.brand.design.logoScale}
                    onChange={(e) => patchDesign({ logoScale: Number(e.target.value) })}
                  />
                  <output>{Math.round(cfg.brand.design.logoScale * 100)}%</output>
                </label>
              ) : null}

              <h3>Governance</h3>
              <Toggle
                label="Lock brand style"
                hint="Operators can't change colours, shapes or the logo — every code matches your brand."
                checked={cfg.brand.lockDesign}
                onChange={(lockDesign) => patchBrand({ lockDesign })}
              />
              {!cfg.brand.lockDesign ? (
                <Toggle
                  label="Let operators upload their own logo"
                  checked={cfg.brand.allowLogoUpload}
                  onChange={(allowLogoUpload) => patchBrand({ allowLogoUpload })}
                />
              ) : null}

              {!cfg.brand.lockDesign ? (
                <>
                  <h3>Colour presets offered to operators</h3>
                  <ul className="qrgc-presets">
                    {presets.map((p, idx) => (
                      <li key={idx}>
                        <input
                          type="color"
                          aria-label={`${p.name} colour`}
                          value={p.fg}
                          onChange={(e) => setPreset(idx, { fg: e.target.value })}
                        />
                        <input
                          type="text"
                          aria-label="Preset name"
                          value={p.name}
                          maxLength={24}
                          onChange={(e) => setPreset(idx, { name: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => patchBrand({ presets: presets.filter((_, i) => i !== idx) })}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="btn-row">
                    {presets.length < 12 ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          patchBrand({ presets: [...presets, { name: `Brand ${presets.length + 1}`, fg: cfg.brand.design.fg }] })
                        }
                      >
                        + Add current foreground
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {tab === "types" ? (
            <section className="qrgc-section" aria-label="QR types">
              <p className="muted">
                Pick which QR types operators see, the one that opens first, and pre-fill company details (website, UPI
                ID, office Wi-Fi, address) so staff only type what changes.
              </p>
              <ul className="qrgc-types">
                {QR_TYPES.map((t) => {
                  const enabled = cfg.enabledTypes.includes(t.id);
                  const open = openType === t.id;
                  const defaults = cfg.fieldDefaults[t.id] ?? {};
                  const filled = Object.keys(defaults).length;
                  return (
                    <li key={t.id} className={`qrgc-type${enabled ? "" : " is-off"}${open ? " is-open" : ""}`}>
                      <div className="qrgc-type-row">
                        <label className="qrgc-type-name">
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={enabled && cfg.enabledTypes.length === 1}
                            onChange={(e) => toggleType(t.id, e.target.checked)}
                          />
                          <span aria-hidden>{t.icon}</span>
                          <strong>{t.label}</strong>
                          <em>{t.group}</em>
                        </label>
                        <div className="qrgc-type-meta">
                          {filled ? <span className="pill">{filled} pre-filled</span> : null}
                          {enabled ? (
                            <label className="qrgc-default">
                              <input
                                type="radio"
                                name="qrgc-default-type"
                                checked={cfg.defaultType === t.id}
                                onChange={() => update((c) => ({ ...c, defaultType: t.id }))}
                              />
                              Opens first
                            </label>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-expanded={open}
                            onClick={() => {
                              setOpenType(open ? null : t.id);
                              if (!open && enabled) setPreviewType(t.id);
                            }}
                          >
                            {open ? "Done" : "Configure"}
                          </button>
                        </div>
                      </div>
                      {open ? (
                        <div className="qrgc-type-detail">
                          <label className="field" htmlFor={`qrgc-cap-${t.id}`}>
                            <span className="label">Suggested caption</span>
                            <input
                              id={`qrgc-cap-${t.id}`}
                              type="text"
                              value={cfg.captions[t.id] ?? ""}
                              maxLength={CAPTION_MAX}
                              placeholder="e.g. Scan to pay"
                              onChange={(e) => update((c) => ({ ...c, captions: { ...c.captions, [t.id]: e.target.value } }))}
                            />
                          </label>
                          <p className="qrg-hint">Field defaults — leave blank for operators to fill in.</p>
                          <div className="qrg-grid">
                            {t.fields
                              .filter((f) => !f.showIf || f.showIf({ ...(t.defaults ?? {}), ...defaults }))
                              .map((f) => (
                                <FieldInput
                                  key={f.key}
                                  idPrefix={`qrgc-${t.id}`}
                                  def={{ ...f, required: false }}
                                  value={defaults[f.key] ?? t.defaults?.[f.key] ?? ""}
                                  onChange={(v) => setFieldDefault(t.id, f.key, v)}
                                />
                              ))}
                          </div>
                          {t.id === "wifi" ? (
                            <p className="qrg-hint">
                              A default Wi-Fi password is visible to everyone who can open this tool — use it for guest
                              networks only.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {tab === "output" ? (
            <section className="qrgc-section" aria-label="Output">
              <h3>Minimum error correction</h3>
              <Segmented
                label="Operators can't go below"
                value={cfg.minEcl}
                options={ECL_OPTIONS}
                onChange={(minEcl) => update((c) => ({ ...c, minEcl }))}
              />
              <p className="qrg-hint">Codes with a logo always use H. Higher levels survive print damage but make denser codes.</p>

              <h3>Export options</h3>
              <div className="qrgc-checks">
                {QR_EXPORT_FORMATS.map((f) => (
                  <Toggle
                    key={f.id}
                    label={f.label}
                    checked={cfg.exports.formats.includes(f.id)}
                    onChange={(on) => toggleFormat(f.id, on)}
                  />
                ))}
              </div>
              {noOperatorExport ? (
                <p className="qrg-alert">Operators won&apos;t be able to download files — only copy or share.</p>
              ) : null}

              <h3>Download sizes</h3>
              <div className="qrgc-chips">
                {QR_SIZE_OPTIONS.map((s) => (
                  <label key={s} className={`qrgc-chip${cfg.exports.sizes.includes(s) ? " is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={cfg.exports.sizes.includes(s)}
                      disabled={cfg.exports.sizes.includes(s) && cfg.exports.sizes.length === 1}
                      onChange={(e) => toggleSize(s, e.target.checked)}
                    />
                    {s}px
                  </label>
                ))}
              </div>
              <div className="qrg-grid">
                <label className="field" htmlFor="qrgc-default-size">
                  <span className="label">Default size</span>
                  <select
                    id="qrgc-default-size"
                    value={cfg.exports.defaultSize}
                    onChange={(e) => patchExports({ defaultSize: Number(e.target.value) })}
                  >
                    {cfg.exports.sizes.map((s) => (
                      <option key={s} value={s}>
                        {s} px
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" htmlFor="qrgc-prefix">
                  <span className="label">File name prefix</span>
                  <input
                    id="qrgc-prefix"
                    type="text"
                    value={cfg.exports.filenamePrefix}
                    maxLength={40}
                    placeholder="qr"
                    onChange={(e) => patchExports({ filenamePrefix: e.target.value })}
                  />
                  <span className="qrg-hint">
                    e.g. <code>{(cfg.exports.filenamePrefix || "qr").toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-upi-shop.png</code>
                  </span>
                </label>
              </div>
            </section>
          ) : null}

          {tab === "features" ? (
            <section className="qrgc-section" aria-label="Features and copy">
              <h3>Page copy</h3>
              <div className="qrg-grid">
                <label className="field" htmlFor="qrgc-title">
                  <span className="label">Title</span>
                  <input
                    id="qrgc-title"
                    type="text"
                    value={cfg.title}
                    maxLength={80}
                    onChange={(e) => update((c) => ({ ...c, title: e.target.value }))}
                  />
                </label>
                <label className="field qrg-span-2" htmlFor="qrgc-subtitle">
                  <span className="label">Subtitle</span>
                  <textarea
                    id="qrgc-subtitle"
                    rows={2}
                    value={cfg.subtitle}
                    maxLength={240}
                    onChange={(e) => update((c) => ({ ...c, subtitle: e.target.value }))}
                  />
                </label>
              </div>

              <h3>Productivity</h3>
              <Toggle
                label="Bulk generation"
                hint="Upload a CSV or paste from Excel to produce a ZIP of codes or a printable label sheet."
                checked={cfg.features.batch}
                onChange={(batch) => patchFeatures({ batch })}
              />
              {cfg.features.batch ? (
                <label className="field qrgc-inline-num" htmlFor="qrgc-batch-max">
                  <span className="label">Max rows per batch</span>
                  <input
                    id="qrgc-batch-max"
                    type="number"
                    min={1}
                    max={1000}
                    value={cfg.features.batchMaxRows}
                    onChange={(e) => patchFeatures({ batchMaxRows: Math.min(1000, Math.max(1, Number(e.target.value) || 1)) })}
                  />
                </label>
              ) : null}
              <Toggle
                label="Recent codes"
                hint="One-tap chips to reopen recently exported codes. Stored on the operator's device; passwords are never kept."
                checked={cfg.features.history}
                onChange={(history) => patchFeatures({ history })}
              />
              {cfg.features.history ? (
                <label className="field qrgc-inline-num" htmlFor="qrgc-history-max">
                  <span className="label">Keep last</span>
                  <input
                    id="qrgc-history-max"
                    type="number"
                    min={1}
                    max={50}
                    value={cfg.features.historyMax}
                    onChange={(e) => patchFeatures({ historyMax: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })}
                  />
                </label>
              ) : null}
              <Toggle
                label="Remember drafts"
                hint="Keep in-progress fields and design on the device between visits."
                checked={cfg.features.rememberDrafts}
                onChange={(rememberDrafts) => patchFeatures({ rememberDrafts })}
              />
              <Toggle
                label="Fill from business profile"
                hint="Offer a button that pre-fills phone, email, address, website and UPI from the business profile."
                checked={cfg.features.fillFromProfile}
                onChange={(fillFromProfile) => patchFeatures({ fillFromProfile })}
              />

              <h3>Quality</h3>
              <Toggle
                label="Scan verification"
                hint="Decode every preview on-device and show a ✓ Scan verified badge before export."
                checked={cfg.features.verifyScan}
                onChange={(verifyScan) => patchFeatures({ verifyScan })}
              />
              <Toggle
                label="Show encoded content"
                hint="Let operators inspect and copy the raw text inside the code."
                checked={cfg.features.showEncoded}
                onChange={(showEncoded) => patchFeatures({ showEncoded })}
              />

              <h3>Campaign tracking (UTM)</h3>
              <Toggle
                label="Offer UTM tagging on website links"
                hint="Adds utm_source / utm_medium / utm_campaign so scans show up in Google Analytics."
                checked={cfg.features.utm.enabled}
                onChange={(enabled) => patchUtm({ enabled })}
              />
              {cfg.features.utm.enabled ? (
                <>
                  <Toggle
                    label="Tag links by default"
                    checked={cfg.features.utm.defaultOn}
                    onChange={(defaultOn) => patchUtm({ defaultOn })}
                  />
                  <div className="qrg-grid qrg-grid-3">
                    {(
                      [
                        ["source", "Source", "qr"],
                        ["medium", "Medium", "print"],
                        ["campaign", "Campaign", "diwali-2026"],
                      ] as const
                    ).map(([key, label, ph]) => (
                      <label key={key} className="field" htmlFor={`qrgc-utm-${key}`}>
                        <span className="label">{label}</span>
                        <input
                          id={`qrgc-utm-${key}`}
                          type="text"
                          value={cfg.features.utm[key]}
                          placeholder={ph}
                          maxLength={key === "campaign" ? 80 : 60}
                          onChange={(e) => patchUtm({ [key]: e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </div>

        {preview}
      </div>
    </div>
  );
}
