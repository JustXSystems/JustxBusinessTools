import { pool } from "../db.js";

/** Stable ids stored on business_profiles.clock_display_format */
export const CLOCK_DISPLAY_FORMATS = [
  { id: "dd_mm_yyyy_hm", label: "DD/MM/YYYY HH:mm", example: "09/09/2026 14:30" },
  { id: "dd_mm_yyyy_hm_a", label: "DD/MM/YYYY hh:mm AM/PM", example: "09/09/2026 02:30 PM" },
  { id: "dd_mm_yyyy_hms", label: "DD/MM/YYYY HH:mm:ss", example: "09/09/2026 14:30:45" },
  { id: "yyyy_mm_dd_hm", label: "YYYY-MM-DD HH:mm", example: "2026-09-09 14:30" },
  { id: "dd_mmm_yyyy_hm", label: "DD MMM YYYY, HH:mm", example: "09 Sep 2026, 14:30" },
  { id: "dd_mmm_yyyy_hm_a", label: "DD MMM YYYY, hh:mm AM/PM", example: "09 Sep 2026, 02:30 PM" },
  {
    id: "ddd_dd_mmm_yyyy_hm_a",
    label: "Day, DD MMM YYYY · hh:mm AM/PM",
    example: "Wed, 09 Sep 2026 · 02:30 PM",
  },
  {
    id: "ddd_dd_mmm_yyyy_hm_a_ist",
    label: "Day, DD MMM YYYY · hh:mm AM/PM IST",
    example: "Wed, 09 Sep 2026 · 02:30 PM IST",
  },
  { id: "hm_a", label: "Time only (hh:mm AM/PM)", example: "02:30 PM" },
  { id: "hms", label: "Time only (HH:mm:ss)", example: "14:30:45" },
  { id: "dd_mm_yyyy", label: "Date only (DD/MM/YYYY)", example: "09/09/2026" },
] as const;

export type ClockDisplayFormatId = (typeof CLOCK_DISPLAY_FORMATS)[number]["id"];

export const DEFAULT_CLOCK_DISPLAY_FORMAT: ClockDisplayFormatId = "dd_mmm_yyyy_hm_a";
export const DEFAULT_CLOCK_DISPLAY_VISIBLE = true;

/** App displays wall-clock in IST (matches audit / payments). */
export const CLOCK_DISPLAY_TIMEZONE = "Asia/Kolkata";

export type ClockDisplaySettings = {
  visible: boolean;
  format: ClockDisplayFormatId;
};

const FORMAT_IDS = new Set<string>(CLOCK_DISPLAY_FORMATS.map((f) => f.id));

let columnReady: Promise<void> | null = null;

export async function ensureClockDisplayColumns(): Promise<void> {
  if (!columnReady) {
    columnReady = (async () => {
      for (const sql of [
        `ALTER TABLE business_profiles ADD COLUMN clock_display_visible TINYINT(1) NOT NULL DEFAULT 1`,
        `ALTER TABLE business_profiles ADD COLUMN clock_display_format VARCHAR(48) NOT NULL DEFAULT 'dd_mmm_yyyy_hm_a'`,
      ]) {
        try {
          await pool.query(sql);
        } catch (err) {
          const e = err as { code?: string; errno?: number };
          if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
        }
      }
    })().catch((err) => {
      columnReady = null;
      throw err;
    });
  }
  await columnReady;
}

export function normalizeClockDisplayFormat(raw: unknown): ClockDisplayFormatId {
  const id = String(raw ?? "").trim();
  if (FORMAT_IDS.has(id)) return id as ClockDisplayFormatId;
  return DEFAULT_CLOCK_DISPLAY_FORMAT;
}

export function normalizeClockDisplayVisible(raw: unknown): boolean {
  if (raw === false || raw === 0 || raw === "0" || raw === "false") return false;
  if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
  return DEFAULT_CLOCK_DISPLAY_VISIBLE;
}

export function normalizeClockDisplaySettings(input: {
  visible?: unknown;
  format?: unknown;
} | null | undefined): ClockDisplaySettings {
  return {
    visible: normalizeClockDisplayVisible(input?.visible),
    format: normalizeClockDisplayFormat(input?.format),
  };
}

function partsFor(date: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLOCK_DISPLAY_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const monthNum = Number(bag.month || "1");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hour24 = Number(bag.hour || "0");
  const hour12 = hour24 % 12 || 12;
  const ampm = hour24 >= 12 ? "PM" : "AM";
  return {
    weekday: bag.weekday || "",
    day: bag.day || "01",
    month: bag.month || "01",
    monthShort: months[monthNum - 1] || "Jan",
    year: bag.year || "1970",
    hour24: String(hour24).padStart(2, "0"),
    hour12: String(hour12).padStart(2, "0"),
    minute: bag.minute || "00",
    second: bag.second || "00",
    ampm,
  };
}

/** Format a Date for footer chrome (server-side preview / tests). */
export function formatClockDisplay(date: Date, formatId: ClockDisplayFormatId): string {
  const p = partsFor(date);
  switch (formatId) {
    case "dd_mm_yyyy_hm":
      return `${p.day}/${p.month}/${p.year} ${p.hour24}:${p.minute}`;
    case "dd_mm_yyyy_hm_a":
      return `${p.day}/${p.month}/${p.year} ${p.hour12}:${p.minute} ${p.ampm}`;
    case "dd_mm_yyyy_hms":
      return `${p.day}/${p.month}/${p.year} ${p.hour24}:${p.minute}:${p.second}`;
    case "yyyy_mm_dd_hm":
      return `${p.year}-${p.month}-${p.day} ${p.hour24}:${p.minute}`;
    case "dd_mmm_yyyy_hm":
      return `${p.day} ${p.monthShort} ${p.year}, ${p.hour24}:${p.minute}`;
    case "dd_mmm_yyyy_hm_a":
      return `${p.day} ${p.monthShort} ${p.year}, ${p.hour12}:${p.minute} ${p.ampm}`;
    case "ddd_dd_mmm_yyyy_hm_a":
      return `${p.weekday}, ${p.day} ${p.monthShort} ${p.year} · ${p.hour12}:${p.minute} ${p.ampm}`;
    case "ddd_dd_mmm_yyyy_hm_a_ist":
      return `${p.weekday}, ${p.day} ${p.monthShort} ${p.year} · ${p.hour12}:${p.minute} ${p.ampm} IST`;
    case "hm_a":
      return `${p.hour12}:${p.minute} ${p.ampm}`;
    case "hms":
      return `${p.hour24}:${p.minute}:${p.second}`;
    case "dd_mm_yyyy":
      return `${p.day}/${p.month}/${p.year}`;
    default:
      return formatClockDisplay(date, DEFAULT_CLOCK_DISPLAY_FORMAT);
  }
}
