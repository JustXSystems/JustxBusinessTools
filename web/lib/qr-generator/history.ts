import { getQrTypeDef, isQrType, type QrFields, type QrType } from "@/lib/qr-generator/payloads";

export const QR_HISTORY_KEY = "jbt.qrgen.history.v1";

/** Never written to history or drafts. */
export const QR_SECRET_KEYS = new Set(["password"]);

export type QrHistoryEntry = {
  id: string;
  type: QrType;
  fields: QrFields;
  label: string;
  at: number;
};

export function stripSecretFields(fields: QrFields): QrFields {
  return Object.fromEntries(Object.entries(fields).filter(([k]) => !QR_SECRET_KEYS.has(k)));
}

const LABEL_KEYS: Partial<Record<QrType, string[]>> = {
  url: ["url"],
  text: ["text"],
  upi: ["pn", "pa"],
  maps: ["query", "link", "lat"],
  review: ["place"],
  email: ["to"],
  phone: ["phone"],
  sms: ["phone"],
  whatsapp: ["phone"],
  vcard: ["firstName", "org"],
  wifi: ["ssid"],
  event: ["title"],
  social: ["handle"],
  app: ["app"],
  meeting: ["link"],
  bank: ["holder"],
  coupon: ["code", "offer"],
  asset: ["assetId", "name"],
};

export function historyLabel(type: QrType, fields: QrFields): string {
  const raw = (LABEL_KEYS[type] ?? []).map((k) => String(fields[k] ?? "").trim()).find(Boolean);
  const label = raw ? raw.replace(/^https?:\/\//i, "").replace(/\s+/g, " ") : getQrTypeDef(type).label;
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
}

export function addHistoryEntry(
  list: QrHistoryEntry[],
  type: QrType,
  fields: QrFields,
  max: number,
  now = Date.now(),
): QrHistoryEntry[] {
  const clean = stripSecretFields(fields);
  const signature = JSON.stringify([type, clean]);
  const rest = list.filter((e) => JSON.stringify([e.type, e.fields]) !== signature);
  const entry: QrHistoryEntry = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    fields: clean,
    label: historyLabel(type, clean),
    at: now,
  };
  return [entry, ...rest].slice(0, Math.max(1, max));
}

export function readHistory(): QrHistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(QR_HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is QrHistoryEntry =>
        !!e && typeof e === "object" && isQrType((e as QrHistoryEntry).type) && typeof (e as QrHistoryEntry).fields === "object",
    );
  } catch {
    return [];
  }
}

export function writeHistory(list: QrHistoryEntry[]): void {
  try {
    localStorage.setItem(QR_HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}
