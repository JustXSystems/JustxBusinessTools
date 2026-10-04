import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { BosChipColor, BosPastel, BosTone } from "../tokens";
import { cx } from "../cx";

export type BosCardProps = HTMLAttributes<HTMLDivElement> & {
  /** Lift 2px + deepen shadow on hover (clickable / KPI cards). */
  interactive?: boolean;
  flat?: boolean;
};

export function Card({ interactive, flat, className, ...rest }: BosCardProps) {
  return <div className={cx("bos-card", interactive && "bos-card-interactive", flat && "bos-card-flat", className)} {...rest} />;
}

/** Pastel frosted chip — decorative category marker, never the signal itself. */
export function IconChip({ color = "blue", children }: { color?: BosChipColor; children: ReactNode }) {
  return (
    <div className={cx("bos-chip", `bos-chip-${color}`)} aria-hidden="true">
      {children}
    </div>
  );
}

export type BosDeltaTone = "up" | "down" | "warn" | "info" | "muted";

const DELTA_CLASS: Record<BosDeltaTone, string | false> = {
  up: false,
  down: "bos-kpi-delta-down",
  warn: "bos-kpi-delta-warn",
  info: "bos-kpi-delta-info",
  muted: "bos-kpi-delta-muted",
};

export type BosKpi = {
  label: ReactNode;
  value: ReactNode;
  chip?: { color: BosChipColor; glyph: ReactNode };
  delta?: ReactNode;
  deltaTone?: BosDeltaTone;
  /** Tints the value itself (aging buckets, remaining budget). */
  valueTone?: BosTone;
};

/** KPI card: label, big value, pastel chip, and the delta line that carries the real signal. */
export function KpiCard({ label, value, chip, delta, deltaTone = "up", valueTone, interactive = true }: BosKpi & { interactive?: boolean }) {
  const valueStyle = valueTone ? { color: `var(--bos-${valueTone}-600)` } : undefined;
  return (
    <Card interactive={interactive}>
      {chip ? (
        <div className="bos-kpi-head">
          <div>
            <div className="bos-kpi-label">{label}</div>
            <div className="bos-kpi-value" style={valueStyle}>
              {value}
            </div>
          </div>
          <IconChip color={chip.color}>{chip.glyph}</IconChip>
        </div>
      ) : (
        <>
          <div className="bos-kpi-label">{label}</div>
          <div className="bos-kpi-value" style={valueStyle}>
            {value}
          </div>
        </>
      )}
      {delta ? <div className={cx("bos-kpi-delta", DELTA_CLASS[deltaTone])}>{delta}</div> : null}
    </Card>
  );
}

export function WidgetCard({
  title,
  dot = "blue",
  note,
  children,
  className,
  style,
}: {
  title: ReactNode;
  /** Pastel category dot. */
  dot?: BosPastel;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cx("bos-widget", className)} style={style}>
      <h3 className="bos-widget-title">
        <span className="bos-widget-dot" style={{ background: `var(--bos-pastel-${dot})` }} aria-hidden="true" />
        {title}
        {note ? <span className="bos-widget-title-note">{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

export type BosValueTone = BosTone | "faint" | "text";

/** Label/value row inside a widget card. Renders a button when `onClick` is set. */
export function WidgetRow({
  label,
  value,
  valueTone = "text",
  soft,
  onClick,
  chevron,
}: {
  label: ReactNode;
  value?: ReactNode;
  valueTone?: BosValueTone;
  /** Lighter-weight value (timestamps). */
  soft?: boolean;
  onClick?: () => void;
  /** Show › instead of a value (link rows). */
  chevron?: boolean;
}) {
  const color =
    valueTone === "text" ? undefined : valueTone === "faint" ? "var(--bos-text-faint)" : valueTone === "blue" ? "var(--bos-blue-btn)" : `var(--bos-${valueTone}-600)`;
  const content = (
    <>
      <span className={onClick ? undefined : "bos-widget-label"}>{label}</span>
      {chevron ? (
        <span className="bos-widget-chev" aria-hidden="true">
          ›
        </span>
      ) : typeof value === "string" || typeof value === "number" ? (
        <span className={cx("bos-widget-value", soft && "is-soft")} style={color ? { color } : undefined}>
          {value}
        </span>
      ) : (
        value
      )}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="bos-widget-row bos-widget-link" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="bos-widget-row">{content}</div>;
}
