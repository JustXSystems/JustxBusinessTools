import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";

export type BosAvatarSize = "xs" | "sm" | "md" | "base" | "lg" | "xl";

export type BosAvatarProps = {
  /** Initials (or a glyph). */
  children?: ReactNode;
  /**
   * Gradient tone as a CSS color, e.g. `var(--bos-coral)`. Defaults to blue.
   * The gradient darkens 22% toward the bottom, matching the design.
   */
  tone?: string;
  /** Flat pastel fill with ink text instead of a gradient (celebration avatars). */
  pastel?: { fill: string; ink: string };
  size?: BosAvatarSize;
  src?: string;
  alt?: string;
  className?: string;
};

export function Avatar({ children, tone, pastel, size = "base", src, alt = "", className }: BosAvatarProps) {
  const style = pastel
    ? { background: pastel.fill, color: pastel.ink }
    : tone
      ? ({ "--bos-avatar-tone": tone } as CSSProperties)
      : undefined;
  return (
    <span className={cx("bos-avatar", size !== "base" && `bos-avatar-${size}`, className)} style={style} aria-hidden={alt ? undefined : true}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary tenant URLs
        <img src={src} alt={alt} />
      ) : (
        children
      )}
    </span>
  );
}

export function AvatarStack({ children }: { children: ReactNode }) {
  return <span className="bos-avatar-stack">{children}</span>;
}
