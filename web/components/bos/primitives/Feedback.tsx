import type { CSSProperties, ReactNode } from "react";
import type { BosTone } from "../tokens";
import { BosIcon, type BosIconName } from "../icons";
import { cx } from "../cx";

/** Inline alert with a 3px tone bar. Use for persistent, non-blocking messages. */
export function Alert({
  tone = "blue",
  title,
  children,
  actions,
  className,
}: {
  tone?: BosTone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("bos-alert", `bos-alert-${tone}`, className)} role={tone === "coral" ? "alert" : "status"}>
      <div className="bos-alert-bar" aria-hidden="true" />
      <div className="bos-alert-body">
        <div className="bos-alert-title">{title}</div>
        {children ? <div className="bos-alert-desc">{children}</div> : null}
      </div>
      {actions ? <div className="bos-row" style={{ gap: 8, alignSelf: "center" }}>{actions}</div> : null}
    </div>
  );
}

/** Friendly empty state: soft blue tile, one sentence, one or two actions. */
export function EmptyState({
  icon = "sparkle",
  glyph,
  title,
  children,
  actions,
  className,
}: {
  icon?: BosIconName;
  /** Text glyph instead of an icon (e.g. "⚙"). */
  glyph?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("bos-empty", className)}>
      <div className="bos-empty-icon" aria-hidden="true">
        {glyph ?? <BosIcon name={icon} />}
      </div>
      <div className="bos-empty-title">{title}</div>
      {children ? <div className="bos-empty-desc">{children}</div> : null}
      {actions ? <div className="bos-row" style={{ justifyContent: "center" }}>{actions}</div> : null}
    </div>
  );
}

/** Shimmer placeholder — same duration/ease as every other transition. */
export function Skeleton({
  width = "100%",
  height = 10,
  radius,
  style,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={cx("bos-skel", className)}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

export function ProgressBar({
  value,
  tone = "blue",
  label,
  size = "md",
}: {
  /** 0–100 */
  value: number;
  tone?: BosTone;
  label?: string;
  size?: "md" | "lg";
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cx("bos-progress", size === "lg" && "bos-progress-lg")}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className="bos-progress-fill" style={{ width: `${pct}%`, background: `var(--bos-${tone})` }} />
    </div>
  );
}
