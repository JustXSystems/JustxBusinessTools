import type { HTMLAttributes, ReactNode } from "react";
import type { BosPastel, BosTone } from "../tokens";
import { cx } from "../cx";

export type BosBadgeTone = BosTone | "neutral" | "lavender";

export type BosBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  /** Status meaning — emerald ok, amber pending, coral problem, blue informational. */
  tone?: BosBadgeTone;
  /** Category tag (pastel). Mutually exclusive with `tone`. */
  tag?: BosPastel;
  size?: "md" | "lg";
  /** Drop the fixed 80px status width (inline tags, kanban cards). */
  auto?: boolean;
  children: ReactNode;
};

/** Mono pill. Status badges keep a fixed width so table columns line up. */
export function Badge({ tone = "blue", tag, size = "md", auto, className, children, ...rest }: BosBadgeProps) {
  return (
    <span
      className={cx(
        "bos-badge",
        tag ? `bos-badge-tag-${tag}` : `bos-badge-${tone}`,
        size === "lg" && "bos-badge-lg",
        (auto || tag) && "bos-badge-auto",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export type BosLightState = "on" | "warn" | "off" | "idle";

/** 7px status light with a mono label ("Operational", "Needs attention"…). */
export function StatusLight({
  state,
  pulse,
  children,
  className,
}: {
  state: BosLightState;
  pulse?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("bos-status", className)}>
      <span className={cx("bos-light", `bos-light-${state}`, pulse && state === "on" && "bos-light-pulse")} aria-hidden="true" />
      {children}
    </span>
  );
}
