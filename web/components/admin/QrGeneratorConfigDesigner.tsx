"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Field,
  FormGrid,
  Input,
  Segmented,
  Switch,
  cx,
  type BosSegmentOption,
} from "@/components/bos";
import { AdminTabs } from "@/components/admin/ui";
import { SelectField, TextareaField, TextField } from "@/components/admin/ui/AdminFields";
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
import { blobToPngDataUrl, loadImage, loadJbtQrLogo, verifyCanvasDecodes } from "@/lib/qr-generator/export";
import { buildQrPayload, getQrTypeDef, QR_TYPES, type QrFieldDef, type QrType } from "@/lib/qr-generator/payloads";
import {
  CAPTION_MAX,
  createQrMatrix,
  designWarnings,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  normalizeHex,
  renderQrToCanvas,
  type QrDesign,
  type QrEcl,
  type QrEyeStyle,
  type QrModuleStyle,
} from "@/lib/qr-generator/render";
import "./qr-generator-config.css";

type Tab = "brand" | "types" | "output" | "features";

const TABS: ReadonlyArray<BosSegmentOption<Tab>> = [
  { value: "brand", label: "Brand kit" },
  { value: "types", label: "QR types" },
  { value: "output", label: "Output" },
  { value: "features", label: "Features & copy" },
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
  { value: "jbt", label: "JBT logo" },
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

const AUTO_COLS = "repeat(auto-fit, minmax(240px, 1fr))";
const COLOR_COLS = "repeat(auto-fit, minmax(200px, 1fr))";

/** BOS switch row: title + hint on the left, Switch on the right. */
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
    <div className="admin-cc-row" style={{ cursor: "default", alignItems: "center" }}>
      <div className="admin-cc-row-main">
        <div className="admin-cc-cell-title">{label}</div>
        {hint ? <div className="admin-cc-cell-sub">{hint}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

/** Labelled BOS segmented control (radio semantics). */
function SegField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<BosSegmentOption<T>>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bos-field">
      <span className="bos-field-label">{label}</span>
      <Segmented<T> role="radio" size="sm" wrap aria-label={label} options={options} value={value} onChange={onChange} />
    </div>
  );
}

/** Colour picker + hex input (BOS Field + Input). */
function ColorField({
  label,
  value,
  onChange,
  action,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  action?: ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    setDraft(value);
  }
  return (
    <Field label={label} hint={action}>
      {({ id, describedBy }) => (
        <div className="admin-cc-color-row">
          <input
            type="color"
            aria-label={`${label} picker`}
            value={normalizeHex(value) ?? "#000000"}
            onChange={(e) => onChange(e.target.value)}
          />
          <Input
            id={id}
            aria-describedby={describedBy}
            value={draft}
            maxLength={7}
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              const hex = normalizeHex(e.target.value);
              if (hex) onChange(hex);
            }}
            onBlur={() => setDraft(value)}
          />
        </div>
      )}
    </Field>
  );
}

/** Range slider with a live readout (BOS Field wrapper). */
function RangeField({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      {({ id }) => (
        <div className="qrgc-range">
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <output htmlFor={id}>{display}</output>
        </div>
      )}
    </Field>
  );
}

/** One QR type field default, rendered with BOS form controls. */
function QrFieldInput({
  def,
  value,
  onChange,
}: {
  def: QrFieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const full = !def.half;
  if (def.type === "checkbox") {
    return (
      <label className={cx("admin-cc-check", full && "bos-form-grid-full")}>
        <Checkbox checked={value === "1"} onChange={(on) => onChange(on ? "1" : "")} aria-label={def.label} />
        <span>{def.label}</span>
      </label>
    );
  }
  const label = (
    <>
      {def.label}
      {def.required ? " *" : null}
    </>
  );
  if (def.type === "textarea") {
    return (
      <TextareaField
        full={full}
        label={label}
        hint={def.hint}
        rows={3}
        value={value}
        placeholder={def.placeholder}
        maxLength={def.maxLength}
        required={def.required}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (def.type === "select") {
    return (
      <SelectField full={full} label={label} hint={def.hint} value={value} onChange={(e) => onChange(e.target.value)}>
        {def.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectField>
    );
  }
  return (
    <TextField
      full={full}
      label={label}
      hint={def.hint}
      value={value}
      placeholder={def.placeholder}
      maxLength={def.maxLength}
      required={def.required}
      autoComplete="off"
      type={def.type === "number" ? "text" : def.type}
      inputMode={def.type === "number" ? "decimal" : undefined}
      spellCheck={def.type === "text" ? undefined : false}
      onChange={(e) => onChange(e.target.value)}
    />
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
  const [jbtLogo, setJbtLogo] = useState<string | null>(null);
  const [loadedLogo, setLoadedLogo] = useState<{ src: string; img: HTMLImageElement } | null>(null);
  const [verify, setVerify] = useState<{ key: string; ok: boolean } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
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

  const needsJbtLogo = cfg.brand.logoSource === "jbt";
  useEffect(() => {
    if (!needsJbtLogo) return;
    let cancelled = false;
    loadJbtQrLogo()
      .then((dataUrl) => {
        if (!cancelled) setJbtLogo(dataUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needsJbtLogo]);

  const brandLogo =
    cfg.brand.logoSource === "custom"
      ? cfg.brand.logoDataUrl
      : cfg.brand.logoSource === "profile"
        ? profileLogo
        : cfg.brand.logoSource === "jbt"
          ? jbtLogo
          : null;

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
    <Card className="qrgc-preview" role="complementary" aria-label="Live preview">
      <div className="qrgc-preview-head">
        <strong>Live preview</strong>
        <Badge
          auto
          role="status"
          tone={verifyStatus === "ok" ? "emerald" : verifyStatus === "fail" ? "coral" : "neutral"}
        >
          {verifyStatus === "ok" ? "✓ Scans" : verifyStatus === "fail" ? "⚠ Won't scan" : "Checking…"}
        </Badge>
      </div>
      <SelectField
        label="Sample type"
        value={activePreviewType}
        onChange={(e) => setPreviewType(e.target.value as QrType)}
      >
        {enabledTypeDefs.map((t) => (
          <option key={t.id} value={t.id}>
            {t.icon} {t.label}
          </option>
        ))}
      </SelectField>
      <div className="qrgc-stage">
        <canvas ref={canvasRef} className="qrgc-canvas" role="img" aria-label="Brand style preview" />
      </div>
      <p className="admin-cc-note-text">
        {usingSample
          ? "Showing sample content — add field defaults for this type to preview real data."
          : "Using this type's field defaults."}{" "}
        Error correction {design.ecl}
        {brandLogo ? " — always H with a logo" : ""}.
      </p>
      {warnings.map((w) => (
        <Alert key={w} tone="amber" title={w} />
      ))}
      {verifyStatus === "fail" ? (
        <Alert tone="coral" title="Style didn’t decode in a test scan">
          Increase contrast, use square modules or shrink the logo.
        </Alert>
      ) : null}
      {cfg.brand.lockDesign ? (
        <Badge auto tone="blue">
          🛡 Operators get exactly this style
        </Badge>
      ) : null}
    </Card>
  );

  return (
    <div className="qrgc" data-verify={verifyStatus}>
      {state.error ? (
        <Alert tone="coral" title="Definition JSON is invalid">
          {state.error}
        </Alert>
      ) : null}

      <div className="qrgc-toolbar">
        <AdminTabs<Tab> aria-label="QR generator settings" options={TABS} value={tab} onChange={setTab} />
        <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
          Reset to defaults
        </Button>
      </div>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset QR generator settings?"
        description="Every QR generator setting returns to the product defaults. Publish a revision to roll the change out."
        icon={{ tone: "amber" }}
        actions={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setResetOpen(false);
                update(() => DEFAULT_QR_CONFIG);
              }}
            >
              Reset to defaults
            </Button>
          </>
        }
      />

      <div className="qrgc-layout">
        <div className="qrgc-main">
          {tab === "brand" ? (
            <section className="qrgc-section" aria-label="Brand kit">
              <h3 className="qrgc-section-title">Colours &amp; shape</h3>
              <FormGrid columns={COLOR_COLS}>
                <ColorField label="Foreground" value={cfg.brand.design.fg} onChange={(fg) => patchDesign({ fg })} />
                <ColorField label="Background" value={cfg.brand.design.bg} onChange={(bg) => patchDesign({ bg })} />
                <ColorField
                  label="Eye colour"
                  value={cfg.brand.design.eyeColor || cfg.brand.design.fg}
                  onChange={(eyeColor) => patchDesign({ eyeColor })}
                  action={
                    cfg.brand.design.eyeColor ? (
                      <Button variant="ghost" size="sm" onClick={() => patchDesign({ eyeColor: "" })}>
                        Match foreground
                      </Button>
                    ) : null
                  }
                />
              </FormGrid>
              <FormGrid columns={AUTO_COLS}>
                <SegField
                  label="Module shape"
                  value={cfg.brand.design.moduleStyle}
                  options={MODULE_OPTIONS}
                  onChange={(moduleStyle) => patchDesign({ moduleStyle })}
                />
                <SegField
                  label="Corner eyes"
                  value={cfg.brand.design.eyeStyle}
                  options={EYE_OPTIONS}
                  onChange={(eyeStyle) => patchDesign({ eyeStyle })}
                />
                <SegField
                  label="Default error correction"
                  value={cfg.brand.design.ecl}
                  options={ECL_OPTIONS}
                  onChange={(ecl) => patchDesign({ ecl })}
                />
                <RangeField
                  label="Quiet zone"
                  min={2}
                  max={8}
                  step={1}
                  value={cfg.brand.design.margin}
                  display={String(cfg.brand.design.margin)}
                  onChange={(margin) => patchDesign({ margin })}
                />
              </FormGrid>

              <h3 className="qrgc-section-title">Logo</h3>
              <SegField
                label="Centre logo"
                value={cfg.brand.logoSource === "custom" && !cfg.brand.logoDataUrl ? "none" : cfg.brand.logoSource}
                options={LOGO_OPTIONS}
                onChange={(logoSource) => {
                  if (logoSource === "custom" && !cfg.brand.logoDataUrl) logoInputRef.current?.click();
                  else patchBrand({ logoSource });
                }}
              />
              {cfg.brand.logoSource === "profile" && profileLogoMissing ? (
                <Alert tone="amber" title="Business profile has no logo">
                  The active business profile has no logo yet — operators will get a plain code until one is added in
                  Business Profile.
                </Alert>
              ) : null}
              <div className="qrgc-logo-row">
                <div className="qrgc-logo-thumb" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                  {brandLogo ? <img src={brandLogo} alt="" /> : <span>🖼</span>}
                </div>
                <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
                  <Button variant="secondary" size="sm" onClick={() => logoInputRef.current?.click()}>
                    {cfg.brand.logoDataUrl ? "Replace uploaded logo" : "Upload logo"}
                  </Button>
                  {cfg.brand.logoDataUrl ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => patchBrand({ logoSource: "none", logoDataUrl: null })}
                    >
                      Remove upload
                    </Button>
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
              {uploadError ? <Alert tone="coral" title={uploadError} /> : null}
              <p className="admin-cc-note-text">
                Uploaded logos are downscaled to {BRAND_LOGO_PX}px and stored with this config.
              </p>
              {brandLogo ? (
                <FormGrid columns="minmax(0, 360px)">
                  <RangeField
                    label="Logo size"
                    min={LOGO_SCALE_MIN}
                    max={LOGO_SCALE_MAX}
                    step={0.01}
                    value={cfg.brand.design.logoScale}
                    display={`${Math.round(cfg.brand.design.logoScale * 100)}%`}
                    onChange={(logoScale) => patchDesign({ logoScale })}
                  />
                </FormGrid>
              ) : null}

              <h3 className="qrgc-section-title">Governance</h3>
              <div className="admin-cc-stack">
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
              </div>

              {!cfg.brand.lockDesign ? (
                <>
                  <h3 className="qrgc-section-title">Colour presets offered to operators</h3>
                  <ul className="qrgc-presets">
                    {presets.map((p, idx) => (
                      <li key={idx}>
                        <input
                          type="color"
                          aria-label={`${p.name} colour`}
                          value={p.fg}
                          onChange={(e) => setPreset(idx, { fg: e.target.value })}
                        />
                        <Input
                          size="sm"
                          aria-label="Preset name"
                          value={p.name}
                          maxLength={24}
                          onChange={(e) => setPreset(idx, { name: e.target.value })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => patchBrand({ presets: presets.filter((_, i) => i !== idx) })}
                        >
                          ✕
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {presets.length < 12 ? (
                    <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="plus"
                        onClick={() =>
                          patchBrand({ presets: [...presets, { name: `Brand ${presets.length + 1}`, fg: cfg.brand.design.fg }] })
                        }
                      >
                        Add current foreground
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {tab === "types" ? (
            <section className="qrgc-section" aria-label="QR types">
              <p className="admin-cc-note-text">
                Pick which QR types operators see, the one that opens first, and pre-fill company details (website, UPI
                ID, office Wi-Fi, address) so staff only type what changes.
              </p>
              <ul className="qrgc-types">
                {QR_TYPES.map((t) => {
                  const enabled = cfg.enabledTypes.includes(t.id);
                  const open = openType === t.id;
                  const defaults = cfg.fieldDefaults[t.id] ?? {};
                  const filled = Object.keys(defaults).length;
                  const isDefault = cfg.defaultType === t.id;
                  return (
                    <li key={t.id} className={cx("qrgc-type", !enabled && "is-off", open && "is-open")}>
                      <div className="qrgc-type-row">
                        <label className="qrgc-type-name">
                          <Checkbox
                            checked={enabled}
                            disabled={enabled && cfg.enabledTypes.length === 1}
                            onChange={(on) => toggleType(t.id, on)}
                            aria-label={`Offer ${t.label}`}
                          />
                          <span aria-hidden>{t.icon}</span>
                          <strong>{t.label}</strong>
                          <em>{t.group}</em>
                        </label>
                        <div className="qrgc-type-meta">
                          {filled ? (
                            <Badge auto tone="blue">
                              {filled} pre-filled
                            </Badge>
                          ) : null}
                          {enabled ? (
                            <Button
                              variant={isDefault ? "primary" : "ghost"}
                              size="sm"
                              icon={isDefault ? "check" : undefined}
                              aria-pressed={isDefault}
                              onClick={() => update((c) => ({ ...c, defaultType: t.id }))}
                            >
                              {isDefault ? "Opens first" : "Open first"}
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={open}
                            onClick={() => {
                              setOpenType(open ? null : t.id);
                              if (!open && enabled) setPreviewType(t.id);
                            }}
                          >
                            {open ? "Done" : "Configure"}
                          </Button>
                        </div>
                      </div>
                      {open ? (
                        <div className="qrgc-type-detail">
                          <TextField
                            label="Suggested caption"
                            value={cfg.captions[t.id] ?? ""}
                            maxLength={CAPTION_MAX}
                            placeholder="e.g. Scan to pay"
                            onChange={(e) => update((c) => ({ ...c, captions: { ...c.captions, [t.id]: e.target.value } }))}
                          />
                          <p className="admin-cc-note-text">Field defaults — leave blank for operators to fill in.</p>
                          <FormGrid columns={AUTO_COLS}>
                            {t.fields
                              .filter((f) => !f.showIf || f.showIf({ ...(t.defaults ?? {}), ...defaults }))
                              .map((f) => (
                                <QrFieldInput
                                  key={f.key}
                                  def={{ ...f, required: false }}
                                  value={defaults[f.key] ?? t.defaults?.[f.key] ?? ""}
                                  onChange={(v) => setFieldDefault(t.id, f.key, v)}
                                />
                              ))}
                          </FormGrid>
                          {t.id === "wifi" ? (
                            <Alert tone="amber" title="Guest networks only">
                              A default Wi-Fi password is visible to everyone who can open this tool — use it for guest
                              networks only.
                            </Alert>
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
              <h3 className="qrgc-section-title">Minimum error correction</h3>
              <SegField
                label="Operators can't go below"
                value={cfg.minEcl}
                options={ECL_OPTIONS}
                onChange={(minEcl) => update((c) => ({ ...c, minEcl }))}
              />
              <p className="admin-cc-note-text">
                Codes with a logo always use H. Higher levels survive print damage but make denser codes.
              </p>

              <h3 className="qrgc-section-title">Export options</h3>
              <div className="admin-cc-stack">
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
                <Alert tone="amber" title="No file downloads">
                  Operators won&apos;t be able to download files — only copy or share.
                </Alert>
              ) : null}

              <h3 className="qrgc-section-title">Download sizes</h3>
              <div className="admin-cc-checklist">
                {QR_SIZE_OPTIONS.map((s) => (
                  <label key={s} className="admin-cc-check">
                    <Checkbox
                      checked={cfg.exports.sizes.includes(s)}
                      disabled={cfg.exports.sizes.includes(s) && cfg.exports.sizes.length === 1}
                      onChange={(on) => toggleSize(s, on)}
                      aria-label={`${s}px`}
                    />
                    <span>{s}px</span>
                  </label>
                ))}
              </div>
              <FormGrid columns={AUTO_COLS}>
                <SelectField
                  label="Default size"
                  value={cfg.exports.defaultSize}
                  onChange={(e) => patchExports({ defaultSize: Number(e.target.value) })}
                >
                  {cfg.exports.sizes.map((s) => (
                    <option key={s} value={s}>
                      {s} px
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="File name prefix"
                  value={cfg.exports.filenamePrefix}
                  maxLength={40}
                  placeholder="qr"
                  onChange={(e) => patchExports({ filenamePrefix: e.target.value })}
                  hint={
                    <>
                      e.g.{" "}
                      <code className="admin-cc-code">
                        {(cfg.exports.filenamePrefix || "qr").toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-upi-shop.png
                      </code>
                    </>
                  }
                />
              </FormGrid>
            </section>
          ) : null}

          {tab === "features" ? (
            <section className="qrgc-section" aria-label="Features and copy">
              <h3 className="qrgc-section-title">Page copy</h3>
              <FormGrid columns={AUTO_COLS}>
                <TextField
                  label="Title"
                  value={cfg.title}
                  maxLength={80}
                  onChange={(e) => update((c) => ({ ...c, title: e.target.value }))}
                />
                <TextareaField
                  full
                  label="Subtitle"
                  rows={2}
                  value={cfg.subtitle}
                  maxLength={240}
                  onChange={(e) => update((c) => ({ ...c, subtitle: e.target.value }))}
                />
              </FormGrid>

              <h3 className="qrgc-section-title">Productivity</h3>
              <div className="admin-cc-stack">
                <Toggle
                  label="Bulk generation"
                  hint="Upload a CSV or paste from Excel to produce a ZIP of codes or a printable label sheet."
                  checked={cfg.features.batch}
                  onChange={(batch) => patchFeatures({ batch })}
                />
                {cfg.features.batch ? (
                  <FormGrid columns="minmax(0, 200px)">
                    <TextField
                      label="Max rows per batch"
                      type="number"
                      min={1}
                      max={1000}
                      value={cfg.features.batchMaxRows}
                      onChange={(e) =>
                        patchFeatures({ batchMaxRows: Math.min(1000, Math.max(1, Number(e.target.value) || 1)) })
                      }
                    />
                  </FormGrid>
                ) : null}
                <Toggle
                  label="Recent codes"
                  hint="One-tap chips to reopen recently exported codes. Stored on the operator's device; passwords are never kept."
                  checked={cfg.features.history}
                  onChange={(history) => patchFeatures({ history })}
                />
                {cfg.features.history ? (
                  <FormGrid columns="minmax(0, 200px)">
                    <TextField
                      label="Keep last"
                      type="number"
                      min={1}
                      max={50}
                      value={cfg.features.historyMax}
                      onChange={(e) =>
                        patchFeatures({ historyMax: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })
                      }
                    />
                  </FormGrid>
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
              </div>

              <h3 className="qrgc-section-title">Quality</h3>
              <div className="admin-cc-stack">
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
              </div>

              <h3 className="qrgc-section-title">Campaign tracking (UTM)</h3>
              <div className="admin-cc-stack">
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
                    <FormGrid columns={COLOR_COLS}>
                      {(
                        [
                          ["source", "Source", "qr"],
                          ["medium", "Medium", "print"],
                          ["campaign", "Campaign", "diwali-2026"],
                        ] as const
                      ).map(([key, label, ph]) => (
                        <TextField
                          key={key}
                          label={label}
                          value={cfg.features.utm[key]}
                          placeholder={ph}
                          maxLength={key === "campaign" ? 80 : 60}
                          onChange={(e) => patchUtm({ [key]: e.target.value })}
                        />
                      ))}
                    </FormGrid>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        {preview}
      </div>
    </div>
  );
}
