"use client";

import { useId, type ReactNode } from "react";
import { computeDonutSegments, scaleBars, sparklinePoints } from "@/lib/bos/charts";
import { cx } from "../cx";

/** Semantic chart colours resolve to tokens so charts follow the theme. */
export type BosChartTone = "blue" | "emerald" | "amber" | "coral" | "faint";

function toneVar(tone: BosChartTone): string {
  return tone === "faint" ? "var(--bos-text-faint)" : `var(--bos-${tone})`;
}

/* ---------- Bar chart (single series, current period highlighted) ---------- */

export type BosBarDatum = { label: string; value: number };

const BAR_VIEW_W = 340;
const BAR_SLOT = 56;
const BAR_X0 = 20;

/**
 * Volume/trend bars: outlined tints for history, a solid bar for the current
 * (last) period, mono axis labels. No gridlines — the delta line below carries
 * the message.
 */
export function BarChart({
  data,
  tone = "blue",
  height = 158,
  renderHeight,
  highlightLast = true,
  ariaLabel,
}: {
  data: BosBarDatum[];
  tone?: Extract<BosChartTone, "blue" | "emerald">;
  /** viewBox height; bars use height − 48. */
  height?: number;
  /** Rendered CSS height (defaults to auto via viewBox). */
  renderHeight?: number;
  highlightLast?: boolean;
  ariaLabel: string;
}) {
  const baseline = height - 18;
  const maxBar = height - 48;
  const heights = scaleBars(data.map((d) => d.value), maxBar, 4);
  const barW = 28;
  return (
    <svg
      className="bos-chart-svg"
      viewBox={`0 0 ${BAR_VIEW_W} ${height}`}
      height={renderHeight}
      role="img"
      aria-label={`${ariaLabel}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}
    >
      {data.map((d, i) => {
        const x = BAR_X0 + i * BAR_SLOT;
        const h = heights[i];
        const current = highlightLast && i === data.length - 1;
        return (
          <g key={d.label}>
            <rect
              className="bos-chart-bar"
              x={x}
              y={baseline - h}
              width={barW}
              height={h}
              rx={5}
              style={
                current
                  ? { fill: toneVar(tone) }
                  : { fill: `var(--bos-${tone}-100)`, stroke: toneVar(tone), strokeWidth: 1.3 }
              }
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            <text
              x={x + barW / 2}
              y={height - 6}
              textAnchor="middle"
              className={cx("bos-chart-axis", current && (tone === "emerald" ? "is-current-emerald" : "is-current"))}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Grouped bars (two series, e.g. revenue vs expense) ---------- */

export type BosGroupedDatum = { label: string; a: number; b: number };

export function GroupedBarChart({
  data,
  renderHeight,
  ariaLabel,
  series = ["Revenue", "Expense"],
}: {
  data: BosGroupedDatum[];
  renderHeight?: number;
  ariaLabel: string;
  series?: [string, string];
}) {
  const height = 158;
  const baseline = 140;
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const scale = (v: number) => Math.max(4, Math.round((v / max) * 110));
  return (
    <svg
      className="bos-chart-svg"
      viewBox={`0 0 ${BAR_VIEW_W} ${height}`}
      height={renderHeight}
      role="img"
      aria-label={`${ariaLabel}: ${data.map((d) => `${d.label} ${series[0]} ${d.a}, ${series[1]} ${d.b}`).join("; ")}`}
    >
      {data.map((d, i) => {
        const x = BAR_X0 + i * BAR_SLOT;
        const ha = scale(d.a);
        const hb = scale(d.b);
        const current = i === data.length - 1;
        return (
          <g key={d.label}>
            <rect className="bos-chart-bar" x={x} y={baseline - ha} width={12} height={ha} rx={3} style={{ fill: "var(--bos-emerald)" }} />
            <rect
              className="bos-chart-bar"
              x={x + 14}
              y={baseline - hb}
              width={12}
              height={hb}
              rx={3}
              style={{ fill: "var(--bos-coral-100)", stroke: "var(--bos-coral)", strokeWidth: 1 }}
            />
            <text x={x + 14} y={152} textAnchor="middle" className={cx("bos-chart-axis", current && "is-current-emerald")}>
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Donut ---------- */

export type BosDonutSegment = { label: string; value: number; tone: BosChartTone };

const DONUT_R = 52;

export function DonutChart({
  segments,
  size = 128,
  centerValue,
  centerLabel,
  rounded = false,
  ariaLabel,
}: {
  segments: BosDonutSegment[];
  size?: number;
  centerValue?: ReactNode;
  centerLabel?: string;
  /** Rounded caps with a small gap between arcs. */
  rounded?: boolean;
  ariaLabel: string;
}) {
  const arcs = computeDonutSegments(segments, DONUT_R, rounded ? 3 : 0);
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={`${ariaLabel}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}
    >
      <g transform="rotate(-90 60 60)">
        {segments.map((s, i) => (
          <circle
            key={s.label}
            cx={60}
            cy={60}
            r={DONUT_R}
            fill="none"
            style={{ stroke: toneVar(s.tone), strokeWidth: 14 }}
            strokeDasharray={arcs[i].dashArray}
            strokeDashoffset={arcs[i].dashOffset}
            strokeLinecap={rounded ? "round" : "butt"}
          >
            <title>{`${s.label}: ${Math.round(arcs[i].fraction * 100)}%`}</title>
          </circle>
        ))}
      </g>
      {centerValue !== undefined ? (
        <text x={60} y={centerLabel ? 57 : 66} textAnchor="middle" className="bos-donut-value" style={{ fontSize: 22 }}>
          {centerValue}
        </text>
      ) : null}
      {centerLabel ? (
        <text x={60} y={73} textAnchor="middle" className="bos-donut-label" style={{ fontSize: 9 }}>
          {centerLabel}
        </text>
      ) : null}
    </svg>
  );
}

/* ---------- Sparkline ---------- */

export function Sparkline({
  values,
  tone = "blue",
  width = 260,
  height = 100,
  renderHeight,
  ariaLabel,
}: {
  values: number[];
  tone?: Extract<BosChartTone, "blue" | "coral" | "emerald" | "amber">;
  width?: number;
  height?: number;
  renderHeight?: number;
  ariaLabel: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const pts = sparklinePoints(values, width - 2, height - 4, 16);
  if (pts.length === 0) return null;
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `M${pts.map(([x, y]) => `${x},${y}`).join(" L")} L${pts[pts.length - 1][0]},${height} L0,${height} Z`;
  const [lx, ly] = pts[pts.length - 1];
  const color = toneVar(tone);
  return (
    <svg className="bos-chart-svg" viewBox={`0 0 ${width} ${height}`} height={renderHeight} role="img" aria-label={`${ariaLabel}: ${values.join(", ")}`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <polyline points={line} fill="none" style={{ stroke: color, strokeWidth: 2.5 }} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={4} style={{ fill: color }} />
    </svg>
  );
}

/* ---------- Legend + card ---------- */

export function ChartLegend({ items }: { items: Array<{ label: ReactNode; tone: BosChartTone }> }) {
  return (
    <div className="bos-chart-legend">
      {items.map((it, i) => (
        <div key={i} className="bos-legend-item">
          <span className="bos-legend-dot" style={{ background: toneVar(it.tone) }} aria-hidden="true" />
          {it.label}
        </div>
      ))}
    </div>
  );
}

/** Chart container: mono label on top, chart, then an optional delta line / legend. */
export function ChartCard({
  title,
  children,
  delta,
  deltaTone = "up",
  legend,
  center,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  delta?: ReactNode;
  deltaTone?: "up" | "down" | "warn" | "info" | "muted";
  legend?: Array<{ label: ReactNode; tone: BosChartTone }>;
  /** Centered layout for donuts. */
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("bos-chart-card", center && "bos-chart-card-center", className)}>
      <div className="bos-kpi-label bos-chart-title">{title}</div>
      {children}
      {delta ? (
        <div className={cx("bos-kpi-delta", deltaTone !== "up" && `bos-kpi-delta-${deltaTone}`)} style={{ marginTop: 8 }}>
          {delta}
        </div>
      ) : null}
      {legend ? <ChartLegend items={legend} /> : null}
    </div>
  );
}
