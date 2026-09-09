/** Stable ids — keep in sync with `server/src/lib/clock-display.ts`. */

export type ClockDisplayFormatGroup = "recommended" | "business" | "compact";

export const CLOCK_DISPLAY_FORMATS = [
  {
    id: "dd_mmm_yyyy_hm_a",
    label: "Corporate",
    group: "recommended" as const,
    tone: "Clear for desk and board reviews",
    example: "09 Sep 2026, 02:30 PM",
  },
  {
    id: "ddd_dd_mmm_yyyy_hm_a_ist",
    label: "Executive",
    group: "recommended" as const,
    tone: "Weekday + IST — ideal for multi-site teams",
    example: "Wed, 09 Sep 2026 · 02:30 PM IST",
  },
  {
    id: "ddd_dd_mmm_yyyy_hm_a",
    label: "Formal",
    group: "recommended" as const,
    tone: "Weekday emphasis without timezone label",
    example: "Wed, 09 Sep 2026 · 02:30 PM",
  },
  {
    id: "dd_mm_yyyy_hm",
    label: "Numeric 24h",
    group: "business" as const,
    tone: "Strict DD/MM with 24-hour clock",
    example: "09/09/2026 14:30",
  },
  {
    id: "dd_mm_yyyy_hm_a",
    label: "Numeric 12h",
    group: "business" as const,
    tone: "DD/MM with AM/PM",
    example: "09/09/2026 02:30 PM",
  },
  {
    id: "dd_mm_yyyy_hms",
    label: "Numeric + seconds",
    group: "business" as const,
    tone: "Audit-friendly second precision",
    example: "09/09/2026 14:30:45",
  },
  {
    id: "yyyy_mm_dd_hm",
    label: "ISO-style",
    group: "business" as const,
    tone: "Sortable year-first notation",
    example: "2026-09-09 14:30",
  },
  {
    id: "dd_mmm_yyyy_hm",
    label: "Business 24h",
    group: "business" as const,
    tone: "Month name with 24-hour time",
    example: "09 Sep 2026, 14:30",
  },
  {
    id: "hm_a",
    label: "Time only",
    group: "compact" as const,
    tone: "Minimal — time at a glance",
    example: "02:30 PM",
  },
  {
    id: "hms",
    label: "Time + seconds",
    group: "compact" as const,
    tone: "Ops desks that watch the second",
    example: "14:30:45",
  },
  {
    id: "dd_mm_yyyy",
    label: "Date only",
    group: "compact" as const,
    tone: "Business day without the clock",
    example: "09/09/2026",
  },
] as const;

export type ClockDisplayFormatId = (typeof CLOCK_DISPLAY_FORMATS)[number]["id"];

export const DEFAULT_CLOCK_DISPLAY_FORMAT: ClockDisplayFormatId = "dd_mmm_yyyy_hm_a";
export const DEFAULT_CLOCK_DISPLAY_VISIBLE = true;
export const CLOCK_DISPLAY_TIMEZONE = "Asia/Kolkata";
export const CLOCK_DISPLAY_TZ_LABEL = "IST";

export type ClockDisplaySettings = {
  visible: boolean;
  format: ClockDisplayFormatId;
};

const FORMAT_IDS = new Set<string>(CLOCK_DISPLAY_FORMATS.map((f) => f.id));

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

export function normalizeClockDisplaySettings(
  input: { visible?: unknown; format?: unknown } | null | undefined,
): ClockDisplaySettings {
  return {
    visible: normalizeClockDisplayVisible(input?.visible),
    format: normalizeClockDisplayFormat(input?.format),
  };
}

export function getClockDisplayFormatMeta(id: ClockDisplayFormatId) {
  return CLOCK_DISPLAY_FORMATS.find((f) => f.id === id) ?? CLOCK_DISPLAY_FORMATS[0];
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

/** Structured chrome segments for elegant footer rendering. */
export type ClockChromeParts = {
  stamp: string;
  /** Optional leading weekday (uppercase short). */
  weekday: string | null;
  dateLine: string | null;
  timeLine: string | null;
  showTzChip: boolean;
  live: boolean;
};

export function getClockChromeParts(date: Date, formatId: ClockDisplayFormatId): ClockChromeParts {
  const p = partsFor(date);
  const stamp = formatClockDisplay(date, formatId);
  const live = clockDisplayNeedsSeconds(formatId);

  switch (formatId) {
    case "dd_mm_yyyy":
      return {
        stamp,
        weekday: null,
        dateLine: `${p.day}/${p.month}/${p.year}`,
        timeLine: null,
        showTzChip: false,
        live,
      };
    case "hm_a":
      return {
        stamp,
        weekday: null,
        dateLine: null,
        timeLine: `${p.hour12}:${p.minute} ${p.ampm}`,
        showTzChip: true,
        live,
      };
    case "hms":
      return {
        stamp,
        weekday: null,
        dateLine: null,
        timeLine: `${p.hour24}:${p.minute}:${p.second}`,
        showTzChip: true,
        live,
      };
    case "ddd_dd_mmm_yyyy_hm_a":
    case "ddd_dd_mmm_yyyy_hm_a_ist":
      return {
        stamp,
        weekday: p.weekday.toUpperCase(),
        dateLine: `${p.day} ${p.monthShort} ${p.year}`,
        timeLine: `${p.hour12}:${p.minute} ${p.ampm}`,
        showTzChip: true,
        live,
      };
    case "dd_mmm_yyyy_hm_a":
      return {
        stamp,
        weekday: null,
        dateLine: `${p.day} ${p.monthShort} ${p.year}`,
        timeLine: `${p.hour12}:${p.minute} ${p.ampm}`,
        showTzChip: true,
        live,
      };
    case "dd_mmm_yyyy_hm":
      return {
        stamp,
        weekday: null,
        dateLine: `${p.day} ${p.monthShort} ${p.year}`,
        timeLine: `${p.hour24}:${p.minute}`,
        showTzChip: true,
        live,
      };
    case "dd_mm_yyyy_hm":
      return {
        stamp,
        weekday: null,
        dateLine: `${p.day}/${p.month}/${p.year}`,
        timeLine: `${p.hour24}:${p.minute}`,
        showTzChip: true,
        live,
      };
    case "dd_mm_yyyy_hm_a":
      return {
        stamp,
        weekday: null,
        dateLine: `${p.day}/${p.month}/${p.year}`,
        timeLine: `${p.hour12}:${p.minute} ${p.ampm}`,
        showTzChip: true,
        live,
      };
    case "dd_mm_yyyy_hms":
      return {
        stamp,
        weekday: null,
        dateLine: `${p.day}/${p.month}/${p.year}`,
        timeLine: `${p.hour24}:${p.minute}:${p.second}`,
        showTzChip: true,
        live,
      };
    case "yyyy_mm_dd_hm":
      return {
        stamp,
        weekday: null,
        dateLine: `${p.year}-${p.month}-${p.day}`,
        timeLine: `${p.hour24}:${p.minute}`,
        showTzChip: true,
        live,
      };
    default:
      return {
        stamp,
        weekday: null,
        dateLine: null,
        timeLine: null,
        showTzChip: true,
        live,
      };
  }
}

/** True when the chosen format updates every second (needs 1s tick). */
export function clockDisplayNeedsSeconds(formatId: ClockDisplayFormatId): boolean {
  return formatId === "dd_mm_yyyy_hms" || formatId === "hms";
}

export const CLOCK_FORMAT_GROUPS: Array<{
  id: ClockDisplayFormatGroup;
  label: string;
  hint: string;
}> = [
  { id: "recommended", label: "Recommended", hint: "Polished defaults for most companies" },
  { id: "business", label: "Business numeric", hint: "Strict ledgers, exports, and ops" },
  { id: "compact", label: "Compact", hint: "Date or time alone" },
];
