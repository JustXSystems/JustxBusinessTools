import { isQrType, QR_TYPES, type QrFields, type QrType } from "@/lib/qr-generator/payloads";
import {
  CAPTION_MAX,
  DEFAULT_QR_DESIGN,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  normalizeHex,
  type QrDesign,
  type QrEcl,
  type QrEyeStyle,
  type QrModuleStyle,
} from "@/lib/qr-generator/render";

export const QR_TOOL_ID = "qrgenerator";

export type QrExportFormat = "png" | "svg" | "pdf" | "copy" | "share";

export const QR_EXPORT_FORMATS: Array<{ id: QrExportFormat; label: string }> = [
  { id: "png", label: "PNG image" },
  { id: "svg", label: "SVG vector" },
  { id: "pdf", label: "Print-ready PDF" },
  { id: "copy", label: "Copy image to clipboard" },
  { id: "share", label: "Share (mobile)" },
];

export const QR_SIZE_OPTIONS = [256, 512, 1024, 2048, 4096];

export type QrBrandLogoSource = "none" | "jbt" | "profile" | "custom";

/** Trimmed, transparent JBT mark sized for the centre of a QR code. */
export const JBT_QR_LOGO_URL = "/icons/justx-qr-mark.png";

export type QrBrandDesign = Omit<QrDesign, "logoDataUrl" | "caption">;

export type QrColorPreset = { name: string; fg: string };

export type QrGeneratorConfig = {
  title: string;
  subtitle: string;
  enabledTypes: QrType[];
  defaultType: QrType;
  /** Pre-filled values per QR type (e.g. company website, UPI ID, office Wi-Fi SSID). */
  fieldDefaults: Partial<Record<QrType, QrFields>>;
  /** One-tap caption suggestions per type. */
  captions: Partial<Record<QrType, string>>;
  brand: {
    design: QrBrandDesign;
    logoSource: QrBrandLogoSource;
    /** Downscaled PNG data URL when logoSource === "custom". */
    logoDataUrl: string | null;
    /** Operators can't change colours, shapes or the logo. */
    lockDesign: boolean;
    allowLogoUpload: boolean;
    presets: QrColorPreset[];
  };
  /** Operators can't pick an error-correction level below this. */
  minEcl: QrEcl;
  exports: {
    formats: QrExportFormat[];
    sizes: number[];
    defaultSize: number;
    filenamePrefix: string;
  };
  features: {
    batch: boolean;
    batchMaxRows: number;
    history: boolean;
    historyMax: number;
    verifyScan: boolean;
    fillFromProfile: boolean;
    showEncoded: boolean;
    rememberDrafts: boolean;
    utm: { enabled: boolean; defaultOn: boolean; source: string; medium: string; campaign: string };
  };
};

export const DEFAULT_CAPTIONS: Partial<Record<QrType, string>> = {
  url: "Scan to visit our website",
  upi: "Scan to pay with any UPI app",
  maps: "Scan for directions",
  review: "Loved us? Rate us on Google",
  email: "Scan to email us",
  phone: "Scan to call us",
  sms: "Scan to text us",
  whatsapp: "Chat with us on WhatsApp",
  vcard: "Scan to save our contact",
  wifi: "Scan to join our Wi-Fi",
  event: "Scan to add to calendar",
  social: "Follow us",
  app: "Download our app",
  meeting: "Scan to join the meeting",
  bank: "Scan for bank details",
  coupon: "Scan to claim your offer",
  asset: "Scan for asset details",
};

export const DEFAULT_COLOR_PRESETS: QrColorPreset[] = [
  { name: "Classic", fg: "#000000" },
  { name: "Navy", fg: "#0b2545" },
  { name: "Teal", fg: "#0f3d3e" },
  { name: "Forest", fg: "#1b4332" },
  { name: "Maroon", fg: "#6a040f" },
  { name: "Plum", fg: "#3c096c" },
];

export const DEFAULT_QR_CONFIG: QrGeneratorConfig = {
  title: "QR Code Generator",
  subtitle: "Branded QR codes for links, UPI payments, Wi-Fi, contacts, locations and more — generated on this device.",
  enabledTypes: QR_TYPES.map((t) => t.id),
  defaultType: "url",
  fieldDefaults: {},
  captions: DEFAULT_CAPTIONS,
  brand: {
    design: {
      fg: DEFAULT_QR_DESIGN.fg,
      bg: DEFAULT_QR_DESIGN.bg,
      eyeColor: DEFAULT_QR_DESIGN.eyeColor,
      ecl: DEFAULT_QR_DESIGN.ecl,
      margin: DEFAULT_QR_DESIGN.margin,
      moduleStyle: DEFAULT_QR_DESIGN.moduleStyle,
      eyeStyle: DEFAULT_QR_DESIGN.eyeStyle,
      logoScale: DEFAULT_QR_DESIGN.logoScale,
    },
    logoSource: "jbt",
    logoDataUrl: null,
    lockDesign: false,
    allowLogoUpload: true,
    presets: DEFAULT_COLOR_PRESETS,
  },
  minEcl: "M",
  exports: {
    formats: ["png", "svg", "pdf", "copy", "share"],
    sizes: [512, 1024, 2048],
    defaultSize: 1024,
    filenamePrefix: "qr",
  },
  features: {
    batch: true,
    batchMaxRows: 200,
    history: true,
    historyMax: 12,
    verifyScan: true,
    fillFromProfile: true,
    showEncoded: true,
    rememberDrafts: true,
    utm: { enabled: true, defaultOn: false, source: "qr", medium: "print", campaign: "" },
  },
};

const ECL_RANK: Record<QrEcl, number> = { M: 0, Q: 1, H: 2 };

export function isEcl(v: unknown): v is QrEcl {
  return v === "M" || v === "Q" || v === "H";
}

export function maxEcl(a: QrEcl, b: QrEcl): QrEcl {
  return ECL_RANK[a] >= ECL_RANK[b] ? a : b;
}

export function eclAtLeast(level: QrEcl, min: QrEcl): boolean {
  return ECL_RANK[level] >= ECL_RANK[min];
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function str(v: unknown, fallback: string, max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function hex(v: unknown, fallback: string, allowEmpty = false): string {
  if (allowEmpty && v === "") return "";
  return typeof v === "string" ? (normalizeHex(v) ?? fallback) : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

function stringMap(v: unknown, maxLen: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj(v))) {
    if (typeof val === "string") out[k] = val.slice(0, maxLen);
    else if (typeof val === "number" || typeof val === "boolean") out[k] = String(val);
  }
  return out;
}

function perType<T>(v: unknown, map: (raw: unknown) => T): Partial<Record<QrType, T>> {
  const out: Partial<Record<QrType, T>> = {};
  for (const [k, val] of Object.entries(obj(v))) {
    if (isQrType(k)) out[k] = map(val);
  }
  return out;
}

const MODULE_STYLES: readonly QrModuleStyle[] = ["square", "rounded", "dots"];
const EYE_STYLES: readonly QrEyeStyle[] = ["square", "rounded", "circle"];
const LOGO_SOURCES: readonly QrBrandLogoSource[] = ["none", "jbt", "profile", "custom"];

/** Sanitises an admin-published definition; anything missing or invalid falls back to defaults. */
export function resolveQrGeneratorConfig(definition: unknown): QrGeneratorConfig {
  const def = obj(definition);
  const D = DEFAULT_QR_CONFIG;

  const enabled = Array.isArray(def.enabledTypes)
    ? [...new Set(def.enabledTypes.filter(isQrType))]
    : D.enabledTypes;
  const enabledTypes = enabled.length ? enabled : D.enabledTypes;
  const defaultType = isQrType(def.defaultType) && enabledTypes.includes(def.defaultType) ? def.defaultType : enabledTypes[0];

  const brandRaw = obj(def.brand);
  const designRaw = obj(brandRaw.design);
  const bd = D.brand.design;
  const design: QrBrandDesign = {
    fg: hex(designRaw.fg, bd.fg),
    bg: hex(designRaw.bg, bd.bg),
    eyeColor: hex(designRaw.eyeColor, bd.eyeColor, true),
    ecl: isEcl(designRaw.ecl) ? designRaw.ecl : bd.ecl,
    margin: int(designRaw.margin, bd.margin, 2, 8),
    moduleStyle: oneOf(designRaw.moduleStyle, MODULE_STYLES, bd.moduleStyle),
    eyeStyle: oneOf(designRaw.eyeStyle, EYE_STYLES, bd.eyeStyle),
    logoScale: Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, Number(designRaw.logoScale) || bd.logoScale)),
  };
  const logoDataUrl =
    typeof brandRaw.logoDataUrl === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(brandRaw.logoDataUrl)
      ? brandRaw.logoDataUrl
      : null;
  let logoSource = oneOf(brandRaw.logoSource, LOGO_SOURCES, D.brand.logoSource);
  if (logoSource === "custom" && !logoDataUrl) logoSource = "none";

  const presets = Array.isArray(brandRaw.presets)
    ? brandRaw.presets
        .map((p) => {
          const row = obj(p);
          const fg = typeof row.fg === "string" ? normalizeHex(row.fg) : null;
          return fg ? { name: str(row.name, fg, 24).trim() || fg, fg } : null;
        })
        .filter((p): p is QrColorPreset => p != null)
        .slice(0, 12)
    : D.brand.presets;

  const minEcl = isEcl(def.minEcl) ? def.minEcl : D.minEcl;

  const exportsRaw = obj(def.exports);
  const formats = Array.isArray(exportsRaw.formats)
    ? QR_EXPORT_FORMATS.map((f) => f.id).filter((id) => (exportsRaw.formats as unknown[]).includes(id))
    : D.exports.formats;
  const sizes = Array.isArray(exportsRaw.sizes)
    ? QR_SIZE_OPTIONS.filter((s) => (exportsRaw.sizes as unknown[]).map(Number).includes(s))
    : D.exports.sizes;
  const safeSizes = sizes.length ? sizes : D.exports.sizes;
  const wantSize = Number(exportsRaw.defaultSize);
  const defaultSize = safeSizes.includes(wantSize) ? wantSize : safeSizes.includes(D.exports.defaultSize) ? D.exports.defaultSize : safeSizes[0];
  const prefix = str(exportsRaw.filenamePrefix, D.exports.filenamePrefix, 40)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const f = obj(def.features);
  const utmRaw = obj(f.utm);
  const DF = D.features;

  return {
    title: str(def.title, D.title, 80).trim() || D.title,
    subtitle: str(def.subtitle, D.subtitle, 240),
    enabledTypes,
    defaultType,
    fieldDefaults: perType(def.fieldDefaults, (v) => stringMap(v, 500)),
    captions: { ...D.captions, ...perType(def.captions, (v) => (typeof v === "string" ? v.slice(0, CAPTION_MAX) : "")) },
    brand: {
      design,
      logoSource,
      logoDataUrl: logoSource === "custom" ? logoDataUrl : null,
      lockDesign: bool(brandRaw.lockDesign, D.brand.lockDesign),
      allowLogoUpload: bool(brandRaw.allowLogoUpload, D.brand.allowLogoUpload),
      presets,
    },
    minEcl,
    exports: { formats, sizes: safeSizes, defaultSize, filenamePrefix: prefix || D.exports.filenamePrefix },
    features: {
      batch: bool(f.batch, DF.batch),
      batchMaxRows: int(f.batchMaxRows, DF.batchMaxRows, 1, 1000),
      history: bool(f.history, DF.history),
      historyMax: int(f.historyMax, DF.historyMax, 1, 50),
      verifyScan: bool(f.verifyScan, DF.verifyScan),
      fillFromProfile: bool(f.fillFromProfile, DF.fillFromProfile),
      showEncoded: bool(f.showEncoded, DF.showEncoded),
      rememberDrafts: bool(f.rememberDrafts, DF.rememberDrafts),
      utm: {
        enabled: bool(utmRaw.enabled, DF.utm.enabled),
        defaultOn: bool(utmRaw.defaultOn, DF.utm.defaultOn),
        source: str(utmRaw.source, DF.utm.source, 60),
        medium: str(utmRaw.medium, DF.utm.medium, 60),
        campaign: str(utmRaw.campaign, DF.utm.campaign, 80),
      },
    },
  };
}

/** Shape published to /admin/config/tools/qrgenerator. */
export function qrConfigToDefinition(cfg: QrGeneratorConfig): Record<string, unknown> {
  return { type: "utility", key: QR_TOOL_ID, ...cfg };
}
