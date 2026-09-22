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

/** Compact relative time for operational inboxes (e.g. "3m ago", "Yesterday"). */
export function fmtRelativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return "Yesterday";
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return String(value).slice(0, 16).replace("T", " ");
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
