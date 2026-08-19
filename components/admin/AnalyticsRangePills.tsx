"use client";

export const ANALYTICS_RANGES = [
  { value: 7, label: "7 days" },
  { value: 15, label: "15 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "6 months" },
  { value: 360, label: "1 year" },
  { value: 720, label: "2 years" },
  { value: 0, label: "Lifetime" },
] as const;

export type AnalyticsRangeValue = (typeof ANALYTICS_RANGES)[number]["value"];

export function analyticsRangeLabel(days: number) {
  return ANALYTICS_RANGES.find((r) => r.value === days)?.label ?? `${days} days`;
}

export function formatAnalyticsBucket(date: string, grain: "day" | "week" | "month") {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  if (grain === "month") {
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  if (grain === "week") {
    return `Week of ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function AnalyticsRangePills({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="analytics-range" role="tablist" aria-label="Date range">
      {ANALYTICS_RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          role="tab"
          aria-selected={value === r.value}
          className={value === r.value ? "active" : ""}
          onClick={() => onChange(r.value)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
