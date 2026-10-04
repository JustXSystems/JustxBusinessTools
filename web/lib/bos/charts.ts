export type DonutSegmentInput = { value: number };

export type DonutSegment = {
  /** `stroke-dasharray` for the arc. */
  dashArray: string;
  /** `stroke-dashoffset` for the arc. */
  dashOffset: number;
  /** Share of the total, 0–1. */
  fraction: number;
};

/**
 * Converts values into SVG circle arcs (stroke-dasharray technique).
 * `gap` (in px of circumference) separates rounded segments so caps don't overlap.
 */
export function computeDonutSegments(
  inputs: DonutSegmentInput[],
  radius: number,
  gap = 0,
): DonutSegment[] {
  const circumference = 2 * Math.PI * radius;
  const total = inputs.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) return inputs.map(() => ({ dashArray: `0 ${circumference}`, dashOffset: 0, fraction: 0 }));

  let consumed = 0;
  return inputs.map((s) => {
    const fraction = Math.max(0, s.value) / total;
    const length = fraction * circumference;
    const visible = Math.max(0, length - gap);
    const segment: DonutSegment = {
      dashArray: `${round(visible)} ${round(circumference)}`,
      dashOffset: round(-consumed),
      fraction,
    };
    consumed += length;
    return segment;
  });
}

/** Scales raw values to bar heights (0…maxHeight) against the series maximum. */
export function scaleBars(values: number[], maxHeight: number, minHeight = 0): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) return values.map(() => minHeight);
  return values.map((v) => Math.max(minHeight, round((Math.max(0, v) / max) * maxHeight)));
}

/** Polyline points for a sparkline fitted into width×height (y grows downward). */
export function sparklinePoints(
  values: number[],
  width: number,
  height: number,
  padTop = 8,
): Array<[number, number]> {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const usable = height - padTop;
  return values.map((v, i) => [round(i * step), round(padTop + (1 - (v - min) / span) * usable)]);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
