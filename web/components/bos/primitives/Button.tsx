import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { BosIcon, type BosIconName } from "../icons";
import { cx } from "../cx";

export type BosButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "success";

export type BosButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BosButtonVariant;
  size?: "md" | "sm";
  /** Leading icon from the BOS icon set. */
  icon?: BosIconName;
  /** Round icon-only button; pass `aria-label`. */
  iconOnly?: boolean;
  block?: boolean;
  children?: ReactNode;
};

/**
 * Three intents across the whole product — primary (one per view), secondary,
 * destructive (coral outline, never a filled red block) — plus ghost for
 * low-emphasis actions.
 */
export const Button = forwardRef<HTMLButtonElement, BosButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconOnly, block, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "bos-btn",
        `bos-btn-${variant}`,
        size === "sm" && "bos-btn-sm",
        iconOnly && "bos-btn-icon",
        block && "bos-btn-block",
        className,
      )}
      {...rest}
    >
      {icon ? <BosIcon name={icon} /> : null}
      {children}
    </button>
  );
});

export type BosIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: BosIconName;
  /** Shows the coral notification dot. */
  dot?: boolean;
  "aria-label": string;
};

/** 32px round utility button (topbar bell, calendar nav). */
export function IconButton({ icon, dot, className, type = "button", ...rest }: BosIconButtonProps) {
  return (
    <button type={type} className={cx("bos-icon-btn", className)} {...rest}>
      <BosIcon name={icon} />
      {dot ? <span className="bos-icon-btn-dot" aria-hidden="true" /> : null}
    </button>
  );
}
