/**
 * Declarative module schema.
 *
 * A BOS business module (HR, Finance, …) is data: a sidebar of modules, each a
 * stack of blocks (KPIs, widgets, charts, tables, approvals…), optionally split
 * into subtabs. `ModuleRenderer` turns blocks into BOS components, so new
 * screens are authored as data and stay visually consistent by construction.
 */
import type { BosBadgeTone, BosChartTone, BosChipColor, BosDeltaTone, BosPastel, BosTone } from "@/components/bos";

/* ---------- Cells ---------- */

export type BadgeSpec = { text: string; tone?: BosBadgeTone; tag?: BosPastel };

export type CellSpec =
  | string
  | number
  | { kind: "badge"; badge: BadgeSpec }
  | { kind: "mono"; text: string }
  | { kind: "text"; text: string; color?: BosTone | "faint"; strong?: boolean; badge?: BadgeSpec }
  | { kind: "person"; initials: string; name: string; role?: string; tone: string }
  | { kind: "action"; label: string; variant?: ActionVariant; action: string };

export type ActionVariant = "primary" | "secondary" | "destructive" | "ghost";

export const cell = {
  badge: (text: string, tone: BosBadgeTone = "blue"): CellSpec => ({ kind: "badge", badge: { text, tone } }),
  tag: (text: string, tag: BosPastel): CellSpec => ({ kind: "badge", badge: { text, tag } }),
  mono: (text: string): CellSpec => ({ kind: "mono", text }),
  text: (text: string, color?: BosTone | "faint", strong?: boolean): CellSpec => ({ kind: "text", text, color, strong }),
  withBadge: (text: string, badge: BadgeSpec): CellSpec => ({ kind: "text", text, badge }),
  person: (initials: string, name: string, tone: string, role?: string): CellSpec => ({ kind: "person", initials, name, role, tone }),
  action: (label: string, action: string, variant: ActionVariant = "primary"): CellSpec => ({
    kind: "action",
    label,
    action,
    variant,
  }),
};

export type ColumnSpec = { key: string; header: string; align?: "left" | "right"; mono?: boolean };

/* ---------- Building blocks ---------- */

export type KpiSpec = {
  label: string;
  value: string;
  chip?: [BosChipColor, string];
  delta?: string;
  deltaTone?: BosDeltaTone;
  valueTone?: BosTone;
};

export type WidgetRowSpec = {
  label: string;
  value?: string;
  valueTone?: BosTone | "faint";
  soft?: boolean;
  badge?: BadgeSpec;
  /** Module key to navigate to when clicked. */
  link?: string;
  /** Named action (toast by default) when clicked. */
  action?: string;
  chevron?: boolean;
};

export type WidgetSpec = { title: string; dot?: BosPastel; note?: string; rows: WidgetRowSpec[] };

export type ChartSpec =
  | {
      kind: "bars";
      title: string;
      data: Array<{ label: string; value: number }>;
      tone?: "blue" | "emerald";
      delta?: string;
      deltaTone?: BosDeltaTone;
      height?: number;
      renderHeight?: number;
    }
  | {
      kind: "grouped";
      title: string;
      data: Array<{ label: string; a: number; b: number }>;
      series: [string, string];
      renderHeight?: number;
    }
  | {
      kind: "donut";
      title: string;
      segments: Array<{ label: string; value: number; tone: BosChartTone }>;
      size?: number;
      centerValue?: string;
      centerLabel?: string;
      rounded?: boolean;
      /** Legend label suffix, e.g. percentages. Defaults to the segment label. */
      legend?: string[];
    }
  | {
      kind: "spark";
      title: string;
      values: number[];
      tone?: "blue" | "coral" | "emerald" | "amber";
      delta?: string;
      deltaTone?: BosDeltaTone;
    };

export type ApprovalSpec = {
  id: string;
  initials: string;
  tone: string;
  name: string;
  meta: string;
  /** Pre-decided rows render the outcome badge only. */
  decided?: "approved" | "rejected";
  /** Extra info badge before the actions (amount, type). */
  badge?: BadgeSpec;
  /** Replaces Approve / Reject with custom actions; clicking one shows its outcome badge. */
  buttons?: Array<{ label: string; variant: ActionVariant; outcome: BadgeSpec }>;
};

export type KanbanSpec = Array<{
  id: string;
  title: string;
  dot: string;
  highlight?: { value: string; color: string };
  cards: Array<{ id: string; title: string; tag?: BadgeSpec; people?: Array<{ initials: string; color: string }>; due?: string }>;
}>;

export type StatusCardSpec = {
  heading: string;
  tone?: BosTone;
  rows: Array<{ label: string; value?: string; tone?: BosTone | "faint"; badge?: BadgeSpec }>;
};

export type CelebrationSpec = { initials: string; name: string; tag: string; pastel: BosPastel; tint: string };

export type Block =
  | { type: "kpis"; items: KpiSpec[]; cols?: number }
  | { type: "widgets"; items: WidgetSpec[]; cols?: number; template?: string }
  | { type: "charts"; items: ChartSpec[]; template?: string }
  | { type: "table"; label?: string; columns: ColumnSpec[]; rows: Array<Record<string, CellSpec>>; compact?: boolean; empty?: string }
  | { type: "approvals"; label?: string; items: ApprovalSpec[] }
  | { type: "balances"; items: Array<{ label: string; value: string; unit?: string; tone?: BosTone }> }
  | { type: "calendar"; title: string; year: number; month: number; events: Array<{ day: number; label: string; tint: string }>; today?: number }
  | { type: "kanban"; label?: string; columns: KanbanSpec; draggable?: boolean }
  | { type: "label"; text: string }
  | { type: "note"; text: string; center?: boolean }
  | { type: "alert"; tone: BosTone; title: string; desc?: string }
  | { type: "chips"; label?: string; items: string[] }
  | { type: "progress"; label?: string; items: Array<{ label: string; value: string; pct: number; tone: BosTone }> }
  | { type: "cards"; items: StatusCardSpec[]; cols?: number; template?: string }
  | { type: "grid"; template: string; children: Block[] }
  | { type: "actions"; items: Array<{ label: string; action: string; variant?: ActionVariant }> }
  | { type: "celebrations"; label?: string; title?: string; items: CelebrationSpec[] }
  /** Escape hatch resolved by the host view (org chart, policy table…). */
  | { type: "custom"; id: string };

export type SubtabSpec = { key: string; label: string; blocks: Block[] };

export type ModuleSpec = {
  key: string;
  label: string;
  icon: string;
  title: string;
  sub?: string;
  /** Dense dashboard density. */
  compact?: boolean;
  blocks?: Block[];
  subtabs?: SubtabSpec[];
};

/** Avatar gradient tones used across the sample data. */
export const TONE = {
  blue: "var(--bos-blue)",
  coral: "var(--bos-coral)",
  amber: "var(--bos-amber)",
  emerald: "var(--bos-emerald)",
  lavender: "var(--bos-pastel-lavender-ink)",
  pastelBlue: "var(--bos-pastel-blue-ink)",
  sage: "var(--bos-pastel-sage-ink)",
  rose: "var(--bos-pastel-rose-ink)",
  mint: "var(--bos-pastel-mint-ink)",
  faint: "var(--bos-text-faint)",
} as const;
