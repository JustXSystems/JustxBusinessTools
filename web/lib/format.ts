export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmtINR(value: number | string | null | undefined): string {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const s = String(value).slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(s));
  } catch {
    return s;
  }
}

export function displayMetaValue(
  value: unknown,
  opts?: { money?: boolean; date?: boolean },
): string {
  if (value == null || value === "") return "—";
  if (opts?.money) return `₹${fmtINR(value as number)}`;
  if (opts?.date) return fmtDate(String(value));
  return String(value);
}
