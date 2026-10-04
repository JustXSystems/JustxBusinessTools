/** `Mon 27 Jul · 08:17` — the live-clock format used by BOS time pills. */
export function formatBosClock(date: Date, locale?: string): string {
  const weekday = date.toLocaleDateString(locale, { weekday: "short" });
  const month = date.toLocaleDateString(locale, { month: "short" });
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${weekday} ${date.getDate()} ${month} · ${time}`;
}

/** Initials for avatars: "James Workman" → "JW", "Anita" → "AN". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
